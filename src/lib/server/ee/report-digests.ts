/* @license Enterprise */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, organization, user } from '#lib/server/db/auth.schema.ts';
import {
	checkIn,
	charge,
	gymMember,
	gymSettings,
	notificationLog,
	payment
} from '#lib/server/db/schema.ts';
import { sendEmail } from '#lib/server/email.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { localDate } from '#lib/tz.ts';
import { hasFeature } from './license.ts';

export function reportDigestsEnabled() {
	return hasFeature('report-digests');
}

/**
 * Month-close digest — runs inside the daily cron; on the 1st (org tz) it
 * emails every owner/admin last month's numbers. Deduped via
 * notification_log so a re-fired cron never double-sends.
 */
async function monthClosePayload(orgId: string) {
	const [s] = await db
		.select({ timezone: gymSettings.timezone, logoDocumentId: gymSettings.logoDocumentId })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const tz = s?.timezone ?? 'UTC';
	const prev = new Date(Date.now() - 86400_000);
	const month = localDate(prev, tz).slice(0, 7);
	const from = new Date(`${month}-01T00:00:00Z`);
	const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1));
	const fromDay = from.toISOString().slice(0, 10);
	const toDay = to.toISOString().slice(0, 10);

	const [o] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);
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
	return {
		orgName: o?.name ?? 'your gym',
		logoUrl: s?.logoDocumentId ? `/api/logo/${s.logoDocumentId}` : undefined,
		month,
		lines: [
			`Revenue collected: ${money(rev[0]?.n ?? 0)}`,
			`New members: ${joined[0]?.n ?? 0}`,
			`Check-ins: ${visits[0]?.n ?? 0}`,
			`Open balances now: ${money(open[0]?.n ?? 0)}`,
			'Full detail is on the Reports page.'
		]
	};
}

export async function sendMonthClose(orgId: string): Promise<number> {
	if (!reportDigestsEnabled()) return 0;
	const [s0] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const today = localDate(new Date(), s0?.timezone ?? 'UTC');
	if (!today.endsWith('-01')) return 0;
	const p = await monthClosePayload(orgId);
	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	let sent = 0;
	for (const st of staff) {
		const [row] = await db
			.insert(notificationLog)
			.values({
				organizationId: orgId,
				kind: 'month_close',
				entityId: p.month,
				recipient: st.email
			})
			.onConflictDoNothing()
			.returning({ id: notificationLog.id });
		if (!row) continue;
		await sendEmail({
			to: st.email,
			subject: `${p.orgName} — ${p.month} close`,
			...renderEmail({
				orgName: p.orgName,
				logoUrl: p.logoUrl,
				heading: `${p.month} in review`,
				lines: p.lines
			})
		});
		sent++;
	}
	return sent;
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
			heading: `${p.month} in review (preview)`,
			lines: p.lines
		})
	});
}
