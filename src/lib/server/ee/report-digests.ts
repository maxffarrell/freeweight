/* @license Enterprise */

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import {
	booking,
	checkIn,
	charge,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	notificationLog,
	payment
} from '#lib/server/db/schema.ts';
import { sendEmail } from '#lib/server/email.ts';
import { orgBrand } from '../org-brand.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { localDate } from '#lib/tz.ts';
import { hasFeature } from './license.ts';
import { aiAvailable, aiComplete } from './ai.ts';

export function reportDigestsEnabled() {
	return hasFeature('report-digests');
}

/**
 * Month-close digest — runs inside the daily cron; on the 1st (org tz) it
 * emails every owner/admin last month's numbers. Deduped via
 * notification_log so a re-fired cron never double-sends.
 */
async function monthClosePayload(orgId: string, lookbackDays?: number) {
	const [s, brand] = await Promise.all([
		db
			.select({ timezone: gymSettings.timezone })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1),
		orgBrand(orgId)
	]);
	const tz = s[0]?.timezone ?? 'UTC';
	const prev = new Date(Date.now() - 86400_000);
	const month = localDate(prev, tz).slice(0, 7);
	let from: Date, to: Date;
	if (lookbackDays) {
		from = new Date(Date.now() - lookbackDays * 86400_000);
		to = new Date();
	} else {
		from = new Date(`${month}-01T00:00:00Z`);
		to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1));
	}
	const fromDay = from.toISOString().slice(0, 10);
	const toDay = to.toISOString().slice(0, 10);

	const [rev, joined, visits, open] = await Promise.all([
		db
			.select({ n: sql<number>`coalesce(sum(${payment.amount}),0)`.mapWith(Number) })
			.from(payment)
			.where(
				and(eq(payment.organizationId, orgId), gte(payment.paidAt, from), lt(payment.paidAt, to))
			),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(gymMember)
			.where(
				and(
					eq(gymMember.organizationId, orgId),
					gte(gymMember.joinedAt, fromDay),
					lt(gymMember.joinedAt, toDay)
				)
			),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(checkIn)
			.where(
				and(
					eq(checkIn.organizationId, orgId),
					gte(checkIn.checkedAt, from),
					lt(checkIn.checkedAt, to)
				)
			),
		db
			.select({ n: sql<number>`coalesce(sum(${charge.amount}),0)`.mapWith(Number) })
			.from(charge)
			.where(and(eq(charge.organizationId, orgId), eq(charge.status, 'open')))
	]);
	const money = (c: number) => `$${(c / 100).toFixed(2)}`;
	// Multi-branch gyms: per-location check-in counts for the window.
	const locationLines: string[] = [];
	const locs = await db
		.select({ id: location.id, name: location.name })
		.from(location)
		.where(eq(location.organizationId, orgId));
	if (locs.length > 1) {
		for (const loc of locs) {
			const [n] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(checkIn)
				.where(
					and(
						eq(checkIn.organizationId, orgId),
						eq(checkIn.locationId, loc.id),
						gte(checkIn.checkedAt, from),
						lt(checkIn.checkedAt, to)
					)
				);
			locationLines.push(`${loc.name}: ${n?.n ?? 0} check-in${(n?.n ?? 0) === 1 ? '' : 's'}`);
		}
	}
	// Most-booked classes in the window — owners skim these first.
	const topClasses = await db
		.select({ name: classType.name, n: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.status, 'booked'),
				gte(booking.createdAt, from),
				lt(booking.createdAt, to)
			)
		)
		.groupBy(classType.name)
		.orderBy(desc(sql`count(*)`))
		.limit(3);
	// Licensed AI tier: a two-sentence opener above the numbers.
	let aiLine: string | null = null;
	if (hasFeature('ai') && aiAvailable()) {
		try {
			aiLine = (
				await aiComplete(
					[
						{
							role: 'user',
							content: `You write a two-sentence weekly email opener for a gym's owner digest. Stats for the window: ${money(rev[0]?.n ?? 0)} collected, ${joined[0]?.n ?? 0} new members, ${visits[0]?.n ?? 0} check-ins, ${money(open[0]?.n ?? 0)} open balances, top classes: ${topClasses.map((c) => `${c.name} (${c.n})`).join(', ') || 'none'}. Two plain sentences, encouraging, no numbers beyond these, no emoji, no hype.`
						}
					],
					300
				)
			).trim();
		} catch {
			aiLine = null; // AI outage must never block the digest
		}
	}
	return {
		heading: lookbackDays ? 'The last 7 days' : `${month} in review`,
		orgName: brand.orgName,
		logoUrl: brand.logoUrl,
		whiteLabel: brand.whiteLabel,
		month,
		lines: [
			`Revenue collected: ${money(rev[0]?.n ?? 0)}`,
			`New members: ${joined[0]?.n ?? 0}`,
			`Check-ins: ${visits[0]?.n ?? 0}`,
			`Open balances now: ${money(open[0]?.n ?? 0)}`,
			...(aiLine ? [aiLine] : []),
			...locationLines,
			...topClasses.map((c) => `Top class — ${c.name}: ${c.n} bookings`),
			'Full detail is on the Reports page.'
		]
	};
}

async function digestRecipientsList(orgId: string, extrasCsv: string): Promise<string[]> {
	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	// Extra comma-separated recipients (owners' investors, accountants…)
	// alongside owner/admin staff — dedupe against the staff list.
	const seen = new Set(staff.map((s) => s.email));
	const extras = (extrasCsv ?? '')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.includes('@') && !seen.has(e));
	return [...staff.map((s) => s.email), ...extras];
}

async function sendDigest(
	orgId: string,
	p: Awaited<ReturnType<typeof monthClosePayload>>,
	kind: string,
	entityId: string,
	subject: string,
	recipients: string[]
): Promise<number> {
	let sent = 0;
	for (const email of recipients) {
		const [row] = await db
			.insert(notificationLog)
			.values({ organizationId: orgId, kind, entityId, recipient: email })
			.onConflictDoNothing()
			.returning({ id: notificationLog.id });
		if (!row) continue;
		await sendEmail({
			to: email,
			subject,
			...renderEmail({
				orgName: p.orgName,
				logoUrl: p.logoUrl,
				whiteLabel: p.whiteLabel,
				heading: p.heading,
				lines: p.lines
			})
		});
		sent++;
	}
	return sent;
}

export async function sendMonthClose(orgId: string, force = false): Promise<number> {
	if (!reportDigestsEnabled()) return 0;
	const [s0] = await db
		.select({ timezone: gymSettings.timezone, digestRecipients: gymSettings.digestRecipients })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const today = localDate(new Date(), s0?.timezone ?? 'UTC');
	if (!force && !today.endsWith('-01')) return 0;
	const p = await monthClosePayload(orgId);
	return sendDigest(
		orgId,
		p,
		'month_close',
		p.month,
		`${p.orgName} — ${p.month} close`,
		await digestRecipientsList(orgId, s0?.digestRecipients ?? '')
	);
}

/**
 * Weekly digest — on Mondays (org tz), emails the same recipient list the
 * trailing-7-day numbers. Separate `week_close` dedupe key.
 */
export async function sendWeekDigest(orgId: string, force = false): Promise<number> {
	if (!reportDigestsEnabled()) return 0;
	const [s0] = await db
		.select({
			timezone: gymSettings.timezone,
			digestRecipients: gymSettings.digestRecipients,
			digestWeekly: gymSettings.digestWeekly,
			digestDay: gymSettings.digestDay
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s0?.digestWeekly && !force) return 0;
	const today = localDate(new Date(), s0?.timezone ?? 'UTC');
	// The org's chosen digest day in its timezone — parse the local date at
	// noon UTC so the weekday isn't skewed by DST.
	if (!force && new Date(`${today}T12:00:00Z`).getDay() !== (s0?.digestDay ?? 1)) return 0;
	const p = await monthClosePayload(orgId, 7);
	const week = today;
	return sendDigest(
		orgId,
		p,
		'week_close',
		week,
		`${p.orgName} — week in review`,
		await digestRecipientsList(orgId, s0?.digestRecipients ?? '')
	);
}

/** Preview — emails last month's digest to the requesting admin only, no dedupe. */
export async function sendMonthClosePreview(orgId: string, email: string): Promise<void> {
	if (!reportDigestsEnabled()) return;
	const p = await monthClosePayload(orgId);
	await sendEmail({
		to: email,
		subject: `[preview] ${p.orgName} — ${p.month} close`,
		...renderEmail({
			orgName: p.orgName,
			logoUrl: p.logoUrl,
			whiteLabel: p.whiteLabel,
			heading: `${p.month} in review (preview)`,
			lines: p.lines
		})
	});
}

/** In-app digest preview — the exact payload the weekly digest would send. */
export async function previewDigest(orgId: string) {
	return monthClosePayload(orgId, 7);
}
