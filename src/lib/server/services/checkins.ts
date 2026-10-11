import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import {
	and,
	asc,
	desc,
	eq,
	gte,
	gt,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or,
	sql
} from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	checkIn,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	membership,
	signRequest,
	plan,
	waiver
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { healthFormsEnabled } from '../ee/health-forms.ts';
import { fireDoorWebhook } from '../ee/door-access.ts';
import {
	notifyCheckInMilestone,
	notifyFirstVisit,
	notifyReviewRequest,
	notifyStreakReward
} from './notifications.ts';
import { creditUsage, getRoster, getSession } from './schedule.ts';
import { addDays, localDate, zonedToUtc } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const STREAK_MILESTONES = [4, 8, 13, 26, 52];

function sign(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`checkin:${payload}`).digest('base64url');
}

/** The token inside a member's portal QR code: `fw1.<memberId>.<sig>`. Stateless, revocable only by rotating the secret. */
export function checkInToken(memberId: string) {
	return `fw1.${memberId}.${sign(memberId)}`;
}

export function verifyCheckInToken(token: string) {
	const m = /^fw1\.([0-9a-f-]{36})\.([\w-]+)$/.exec(token.trim());
	if (!m) return null;
	const [, memberId, sig] = m;
	const expected = Buffer.from(sign(memberId));
	const given = Buffer.from(sig);
	return expected.length === given.length && timingSafeEqual(expected, given) ? memberId : null;
}

/** Records a check-in from a QR token or a member id typed by staff. */
/**
 * Logs a guest brought in by a member, capped by the plan's `guestPasses`
 * per calendar month. The visit is a check_in row tagged with `guestName`
 * so it shows in the front-desk feed like any other arrival.
 */
export async function recordGuestVisit(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.guestVisitInput>
) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const [ms] = await db
		.select({ guestPasses: plan.guestPasses })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, ctx.orgId),
				eq(membership.memberId, m.id),
				eq(membership.status, 'active'),
				or(isNull(membership.endsAt), gt(membership.endsAt, new Date()))
			)
		)
		.orderBy(desc(membership.createdAt))
		.limit(1);
	const cap = ms?.guestPasses ?? 0;
	if (cap <= 0) error(402, `${m.name}'s plan doesn't include guest passes`);
	const [used] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, ctx.orgId),
				eq(checkIn.memberId, m.id),
				isNotNull(checkIn.guestName),
				sql`${checkIn.checkedAt} >= date_trunc('month', now())`
			)
		);
	if ((used?.n ?? 0) >= cap) error(402, `${m.name} has used all ${cap} guest passes this month`);
	const [row] = await db
		.insert(checkIn)
		.values({
			organizationId: ctx.orgId,
			memberId: m.id,
			locationId: input.locationId ?? m.locationId,
			method: 'manual',
			guestName: input.guestName
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'check_in',
		entityId: row!.id,
		action: 'recorded',
		summary: `Guest ${input.guestName} checked in with ${m.name}`
	});
	fireDoorWebhook(ctx.orgId, 'guest.checked_in', {
		checkInId: row!.id,
		memberId: m.id,
		memberName: m.name,
		guestName: input.guestName,
		locationId: input.locationId ?? m.locationId
	});
	return { checkIn: row!, member: m, used: (used?.n ?? 0) + 1, cap };
}

/** Checks a member out — sets checked_out_at on their open check-in row. */
export async function checkOut(ctx: OrgContext, checkInId: string) {
	const [row] = await db
		.update(checkIn)
		.set({ checkedOutAt: new Date() })
		.where(
			and(
				eq(checkIn.organizationId, ctx.orgId),
				eq(checkIn.id, checkInId),
				isNull(checkIn.checkedOutAt)
			)
		)
		.returning();
	if (!row) error(404, 'Open check-in not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'check_in',
		entityId: row.id,
		action: 'checked-out',
		summary: 'Member checked out'
	});
	if (row.memberId && !row.guestName) {
		const [m] = await db
			.select({ name: gymMember.name })
			.from(gymMember)
			.where(eq(gymMember.id, row.memberId))
			.limit(1);
		void fireDoorWebhook(ctx.orgId, 'member.checked_out', {
			memberId: row.memberId,
			memberName: m?.name ?? '',
			checkedAt: (row.checkedOutAt ?? new Date()).toISOString(),
			locationId: row.locationId ?? null
		});
	}
	return row;
}

/**
 * Desk undo for a mis-scan: deletes the check-in row and reverts that day's
 * auto-attend — but only when no other check-in still justifies "attended".
 */
export async function voidCheckIn(ctx: OrgContext, checkInId: string) {
	const [row] = await db
		.delete(checkIn)
		.where(and(eq(checkIn.organizationId, ctx.orgId), eq(checkIn.id, checkInId)))
		.returning();
	if (!row) error(404, 'Check-in not found');
	if (row.memberId && !row.guestName) {
		const [vm] = await db
			.select({ name: gymMember.name })
			.from(gymMember)
			.where(eq(gymMember.id, row.memberId))
			.limit(1);
		void fireDoorWebhook(ctx.orgId, 'member.checkin_voided', {
			memberId: row.memberId,
			memberName: vm?.name ?? '',
			checkedAt: row.checkedAt.toISOString(),
			locationId: row.locationId ?? null
		});
	}
	let reverted = 0;
	if (!row.guestName) {
		const [st] = await db
			.select({ timezone: gymSettings.timezone })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, ctx.orgId));
		const tz = st?.timezone ?? 'UTC';
		// Bound to the check-in's own local day so old log rows void correctly too.
		const day = localDate(row.checkedAt, tz);
		const [{ n }] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(checkIn)
			.where(
				and(
					eq(checkIn.organizationId, ctx.orgId),
					eq(checkIn.memberId, row.memberId),
					isNull(checkIn.guestName),
					gte(checkIn.checkedAt, zonedToUtc(`${day}T00:00`, tz)),
					lt(checkIn.checkedAt, zonedToUtc(`${addDays(day, 1)}T00:00`, tz))
				)
			);
		if (!n) {
			const upd = await db
				.update(booking)
				.set({ status: 'booked' })
				.from(classSession)
				.where(
					and(
						eq(booking.sessionId, classSession.id),
						eq(booking.organizationId, ctx.orgId),
						eq(booking.memberId, row.memberId),
						eq(booking.status, 'attended'),
						gte(classSession.startsAt, zonedToUtc(`${day}T00:00`, tz)),
						lt(classSession.startsAt, zonedToUtc(`${addDays(day, 1)}T00:00`, tz)),
						lt(classSession.startsAt, new Date())
					)
				)
				.returning({ id: booking.id });
			reverted = upd.length;
		}
	}
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'check_in',
		entityId: row.id,
		action: 'voided',
		summary: 'Check-in voided'
	});
	return { reverted };
}

/** Minutes a fresh check-in must be open before a repeat QR scan means "check out" instead of a duplicate. */
const TOGGLE_GRACE_MS = 15 * 60_000;

export async function recordCheckIn(ctx: OrgContext, input: v.InferOutput<typeof s.checkInInput>) {
	const memberId = verifyCheckInToken(input.code) ?? input.code;
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'No member for that code — check the QR or search by name');

	// Re-scanning while already inside toggles to a check-out instead of
	// logging a second arrival.
	const [open] = await db
		.select()
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, ctx.orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.checkedOutAt),
				lt(checkIn.checkedAt, new Date(Date.now() - TOGGLE_GRACE_MS))
			)
		)
		.orderBy(desc(checkIn.checkedAt))
		.limit(1);
	if (open) {
		const [row] = await db
			.update(checkIn)
			.set({ checkedOutAt: new Date() })
			.where(eq(checkIn.id, open.id))
			.returning();
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'check_in',
			entityId: row!.id,
			action: 'checked-out',
			summary: `${m.name} checked out`
		});
		return {
			checkIn: row!,
			member: m,
			attended: 0,
			checkedOut: true,
			birthday: false,
			visits: 0,
			waiverMissing: false
		};
	}
	const [row] = await db
		.insert(checkIn)
		.values({
			organizationId: ctx.orgId,
			memberId,
			locationId: input.locationId ?? m.locationId,
			method: verifyCheckInToken(input.code) ? 'qr' : 'manual'
		})
		.returning();
	// A check-in marks that member's already-started bookings today as attended.
	const [st] = await db
		.select({
			timezone: gymSettings.timezone,
			waiverText: gymSettings.waiver,
			rewardCredits: gymSettings.rewardCredits,
			streakRewardCredits: gymSettings.streakRewardCredits,
			parqMonths: gymSettings.parqMonths
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));
	const tz = st?.timezone ?? 'UTC';
	const today = localDate(new Date(), tz);
	const attended = await db
		.update(booking)
		.set({ status: 'attended' })
		.from(classSession)
		.where(
			and(
				eq(booking.sessionId, classSession.id),
				eq(booking.organizationId, ctx.orgId),
				eq(booking.memberId, memberId),
				eq(booking.status, 'booked'),
				gte(classSession.startsAt, zonedToUtc(`${today}T00:00`, tz)),
				lt(classSession.startsAt, zonedToUtc(`${addDays(today, 1)}T00:00`, tz)),
				lt(classSession.startsAt, new Date())
			)
		)
		.returning({ id: booking.id });

	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'check_in',
		entityId: row!.id,
		action: 'recorded',
		summary: `${m.name} checked in`
	});

	// Milestone congrats when this visit crosses a check-in threshold.
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.memberId, memberId),
				eq(checkIn.organizationId, ctx.orgId),
				isNull(checkIn.guestName)
			)
		);
	if (n === 1) notifyFirstVisit(ctx.orgId, memberId).catch(() => {});
	else if (MILESTONES.includes(n)) {
		notifyCheckInMilestone(ctx.orgId, memberId, n).catch(() => {});
		// Milestone reward: comp classes on the member's active membership.
		if (st?.rewardCredits) {
			const [ms] = await db
				.select({ id: membership.id })
				.from(membership)
				.where(
					and(
						eq(membership.organizationId, ctx.orgId),
						eq(membership.memberId, memberId),
						eq(membership.status, 'active')
					)
				)
				.limit(1);
			if (ms)
				await db
					.update(membership)
					.set({ bonusCredits: sql`${membership.bonusCredits} + ${st.rewardCredits}` })
					.where(eq(membership.id, ms.id));
		}
	}

	// Streak reward: comp classes at week-streak milestones, deduped per streak.
	if (st?.streakRewardCredits) {
		const visits = await db
			.select({ checkedAt: checkIn.checkedAt })
			.from(checkIn)
			.where(
				and(
					eq(checkIn.memberId, memberId),
					eq(checkIn.organizationId, ctx.orgId),
					isNull(checkIn.guestName)
				)
			);
		const weekOf = (iso: string) => {
			const d = new Date(`${iso}T12:00:00Z`);
			d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
			return d.toISOString().slice(0, 10);
		};
		const weeks = new Set(visits.map((v) => weekOf(localDate(v.checkedAt, tz))));
		let w = weekOf(today);
		if (!weeks.has(w)) {
			const prev = new Date(`${w}T12:00:00Z`);
			prev.setUTCDate(prev.getUTCDate() - 7);
			w = prev.toISOString().slice(0, 10);
		}
		let streak = 0;
		while (weeks.has(w)) {
			streak++;
			const prev = new Date(`${w}T12:00:00Z`);
			prev.setUTCDate(prev.getUTCDate() - 7);
			w = prev.toISOString().slice(0, 10);
		}
		if (STREAK_MILESTONES.includes(streak)) {
			const [ms] = await db
				.select({ id: membership.id })
				.from(membership)
				.where(
					and(
						eq(membership.organizationId, ctx.orgId),
						eq(membership.memberId, memberId),
						eq(membership.status, 'active')
					)
				)
				.limit(1);
			if (ms && (await notifyStreakReward(ctx.orgId, memberId, streak, st.streakRewardCredits)))
				await db
					.update(membership)
					.set({ bonusCredits: sql`${membership.bonusCredits} + ${st.streakRewardCredits}` })
					.where(eq(membership.id, ms.id));
		}
	}

	// Desk heads-up: it's the member's birthday today (MM-DD compare, org tz).
	const birthday = !!m.birthday && m.birthday.slice(5) === today.slice(5);
	// Join-date anniversary (same MM-DD, at least one year in) — nice flash moment.
	const anniversary =
		m.joinedAt && m.joinedAt.slice(5) === today.slice(5)
			? Number(today.slice(0, 4)) - Number(m.joinedAt.slice(0, 4))
			: 0;
	// Same heads-up when the gym requires a waiver and theirs is missing or stale.
	const waiverMissing =
		!!st?.waiverText &&
		!(
			await db
				.select({ id: waiver.id })
				.from(waiver)
				.where(and(eq(waiver.memberId, memberId), eq(waiver.text, st.waiverText)))
				.limit(1)
		).length;
	// Desk heads-up (Enterprise health-forms): PAR-Q not yet signed.
	const parqMissing =
		healthFormsEnabled() &&
		(!m.parqSignedAt ||
			(!!st?.parqMonths &&
				m.parqSignedAt.getTime() < Date.now() - st.parqMonths * 30.4 * 86400_000));
	// Desk heads-up: a suspended membership (dunning or staff action) — the
	// member can still walk in, staff decide whether to chase the balance.
	const suspended = !!(
		await db
			.select({ id: membership.id })
			.from(membership)
			.where(and(eq(membership.memberId, memberId), eq(membership.status, 'suspended')))
			.limit(1)
	).length;
	// Desk heads-up: a document signature is pending on this member.
	const [ps] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(signRequest)
		.where(and(eq(signRequest.memberId, memberId), eq(signRequest.status, 'pending')));
	const pendingSigns = ps!.n;
	// Desk heads-up: remaining classes on a capped plan/pack (null = unlimited or none).
	const credits = await creditUsage(ctx.orgId, memberId);
	// Desk heads-up: guest passes left this month (null = the plan has none).
	const [gp] = await db
		.select({ guestPasses: plan.guestPasses })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, ctx.orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active'),
				or(isNull(membership.endsAt), gt(membership.endsAt, new Date()))
			)
		)
		.orderBy(desc(membership.createdAt))
		.limit(1);
	let guestPassesLeft: number | null = null;
	if (gp?.guestPasses) {
		const [used] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(checkIn)
			.where(
				and(
					eq(checkIn.organizationId, ctx.orgId),
					eq(checkIn.memberId, memberId),
					isNotNull(checkIn.guestName),
					gte(checkIn.checkedAt, zonedToUtc(`${today.slice(0, 7)}-01T00:00`, tz))
				)
			);
		guestPassesLeft = Math.max(0, gp.guestPasses - used!.n);
	}
	// Desk heads-up: their next class today (booked or waitlisted).
	const [nb] = await db
		.select({ className: classType.name, startsAt: classSession.startsAt })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(booking.organizationId, ctx.orgId),
				eq(booking.memberId, memberId),
				inArray(booking.status, ['booked', 'waitlisted']),
				isNull(classSession.cancelledAt),
				gt(classSession.startsAt, new Date()),
				lt(classSession.startsAt, zonedToUtc(`${addDays(today, 1)}T00:00`, tz))
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(1);
	const [prevVisit] = await db
		.select({ at: checkIn.checkedAt })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, ctx.orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.guestName),
				ne(checkIn.id, row!.id)
			)
		)
		.orderBy(desc(checkIn.checkedAt))
		.limit(1);
	// How many visits today (this one included) — ≥3 hints a shared card.
	const [{ n: visitsToday }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.memberId, memberId),
				eq(checkIn.organizationId, ctx.orgId),
				gte(checkIn.checkedAt, zonedToUtc(`${today}T00:00`, tz)),
				isNull(checkIn.guestName)
			)
		);
	const [{ n: visitsMonth }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, ctx.orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, zonedToUtc(`${today.slice(0, 7)}-01T00:00`, tz))
			)
		);
	void fireDoorWebhook(ctx.orgId, 'member.checked_in', {
		memberId: m.id,
		memberName: m.name,
		checkedAt: row!.checkedAt.toISOString(),
		locationId: row!.locationId ?? null
	});
	// Enterprise door-access: a heads-up flag (suspended membership or expired
	// health form) fires a second event so door systems can log/deny.
	if (suspended || parqMissing) {
		void fireDoorWebhook(ctx.orgId, 'member.checkin_flagged', {
			memberId: m.id,
			memberName: m.name,
			checkInId: row!.id,
			flags: [suspended ? 'suspended' : '', parqMissing ? 'health_form' : ''].filter(Boolean),
			locationId: row!.locationId ?? null
		});
	}
	return {
		checkIn: row!,
		member: m,
		welcomeBack: !!prevVisit && Date.now() - prevVisit.at.getTime() > 30 * 86400_000,
		attended: attended.length,
		birthday,
		anniversary,
		visits: n,
		visitsMonth,
		visitsToday,
		waiverMissing,
		parqMissing,
		suspended,
		pendingSigns,
		creditsLeft: credits ? Math.max(0, credits.limit - credits.used) : null,
		creditsClass: credits?.className ?? null,
		guestPassesLeft,
		nextClass: nb ?? null
	};
}

export async function listCheckIns(
	orgId: string,
	opts: {
		since: Date;
		until?: Date;
		q?: string;
		inside?: boolean;
		memberId?: string;
		guestsOnly?: boolean;
		/** Only scans logged this way — 'qr' or 'manual'. */
		method?: 'qr' | 'manual';
		/** Only check-ins at this location. */
		locationId?: string;
		/** Only a member's first-ever check-in (guest rows excluded). */
		firstVisit?: boolean;
	}
) {
	const term = opts.q?.trim();
	return db
		.select({
			checkIn,
			memberName: gymMember.name,
			memberPhotoId: gymMember.photoDocumentId,
			locationName: location.name,
			/** true when this row is the member's first-ever non-guest check-in. */
			firstVisit:
				sql<boolean>`${checkIn.checkedAt} = (select min(c2.checked_at) from check_in c2 where c2.member_id = ${checkIn.memberId} and c2.guest_name is null) and ${checkIn.guestName} is null`.mapWith(
					Boolean
				)
		})
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.leftJoin(location, eq(checkIn.locationId, location.id))
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, opts.since),
				opts.until ? lt(checkIn.checkedAt, opts.until) : undefined,
				opts.inside ? isNull(checkIn.checkedOutAt) : undefined,
				opts.memberId ? eq(checkIn.memberId, opts.memberId) : undefined,
				opts.guestsOnly ? isNotNull(checkIn.guestName) : undefined,
				opts.method ? eq(checkIn.method, opts.method) : undefined,
				opts.locationId ? eq(checkIn.locationId, opts.locationId) : undefined,
				opts.firstVisit
					? and(
							isNull(checkIn.guestName),
							sql`${checkIn.checkedAt} = (select min(c2.checked_at) from check_in c2 where c2.member_id = ${checkIn.memberId} and c2.guest_name is null)`
						)
					: undefined,
				term
					? or(ilike(gymMember.name, `%${term}%`), ilike(checkIn.guestName, `%${term}%`))
					: undefined
			)
		)
		.orderBy(desc(checkIn.checkedAt));
}

/**
 * Kiosk "Check in all": logs a visit for every still-booked member on a session's roster.
 * Members already inside (an open check-in) are skipped — a second recordCheckIn would check them out.
 */
export async function checkInRoster(ctx: OrgContext, sessionId: string) {
	const [sess, roster] = await Promise.all([
		getSession(ctx.orgId, sessionId),
		getRoster(ctx.orgId, sessionId)
	]);
	const booked = roster.filter((r) => r.booking.status === 'booked');
	if (!booked.length)
		return {
			checkedIn: 0,
			skipped: 0,
			birthdays: [] as string[],
			anniversaries: [] as { name: string; years: number }[]
		};
	const open = await db
		.select({ memberId: checkIn.memberId })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, ctx.orgId),
				inArray(
					checkIn.memberId,
					booked.map((r) => r.booking.memberId)
				),
				isNull(checkIn.checkedOutAt)
			)
		);
	const inside = new Set(open.map((o) => o.memberId));
	let checkedIn = 0;
	let skipped = 0;
	const birthdays: string[] = [];
	const anniversaries: { name: string; years: number }[] = [];
	for (const r of booked) {
		if (inside.has(r.booking.memberId)) {
			skipped++;
			continue;
		}
		try {
			const res = await recordCheckIn(ctx, {
				code: r.booking.memberId,
				locationId: sess.session.locationId
			});
			checkedIn++;
			if (res.birthday) birthdays.push(r.memberName);
			if (res.anniversary) anniversaries.push({ name: r.memberName, years: res.anniversary });
		} catch {
			skipped++;
		}
	}
	return { checkedIn, skipped, birthdays, anniversaries };
}

/**
 * Daily cron: members who forgot to scan out still count as "inside" forever and
 * inflate visit-length stats. Closes any check-in left open past the end of its
 * own local day, stamped at 23:59 that day (org timezone).
 */
export async function closeStaleCheckIns(orgId: string) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = st?.timezone ?? 'UTC';
	const rows = await db
		.update(checkIn)
		.set({
			checkedOutAt: sql`((${checkIn.checkedAt} at time zone ${tz})::date + time '23:59:59') at time zone ${tz}`
		})
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				isNull(checkIn.checkedOutAt),
				sql`(${checkIn.checkedAt} at time zone ${tz})::date < (now() at time zone ${tz})::date`
			)
		)
		.returning({ id: checkIn.id });
	return rows.length;
}

/** Kiosk "Out all": stamps every still-open check-in out right now. */
export async function checkOutAll(orgId: string) {
	const rows = await db
		.update(checkIn)
		.set({ checkedOutAt: new Date() })
		.where(and(eq(checkIn.organizationId, orgId), isNull(checkIn.checkedOutAt)))
		.returning({ id: checkIn.id });
	return rows.length;
}

/**
 * Portal self check-in: the instructor announces the session's `checkinCode` at
 * class; a booked member types it into the portal to mark their booking
 * attended and log a check-in. Window: 15 min before start until the session ends.
 */
export async function checkInWithCode(orgId: string, memberId: string, rawCode: string) {
	const code = rawCode.trim().toUpperCase();
	const now = new Date();
	const [row] = await db
		.select({ session: classSession, className: classType.name })
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				eq(classSession.checkinCode, code),
				isNull(classSession.cancelledAt),
				lte(classSession.startsAt, new Date(now.getTime() + 15 * 60_000)),
				gte(classSession.endsAt, now)
			)
		)
		.orderBy(classSession.startsAt)
		.limit(1);
	if (!row) error(404, "That code doesn't match a class in session right now");
	const [b] = await db
		.select()
		.from(booking)
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.sessionId, row.session.id),
				eq(booking.memberId, memberId),
				ne(booking.status, 'cancelled')
			)
		);
	if (!b) error(409, `You're not booked into ${row.className}`);
	if (b.status === 'waitlisted') error(409, `You're waitlisted for ${row.className}, not booked`);
	if (b.status === 'attended') return { className: row.className, already: true };
	const [m] = await db
		.select({ name: gymMember.name })
		.from(gymMember)
		.where(eq(gymMember.id, memberId));
	await db.update(booking).set({ status: 'attended' }).where(eq(booking.id, b.id));
	const [open] = await db
		.select({ id: checkIn.id })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.checkedOutAt)
			)
		)
		.limit(1);
	if (!open)
		await db.insert(checkIn).values({
			organizationId: orgId,
			memberId,
			locationId: row.session.locationId,
			method: 'manual',
			sessionId: row.session.id
		});
	await emit({
		orgId,
		actorId: null,
		entityType: 'booking',
		entityId: b.id,
		action: 'checked-in',
		summary: `${m?.name ?? 'Member'} checked in to ${row.className} with the class code`
	});
	return { className: row.className, already: false };
}

/**
 * Daily sweep: when a member's lifetime check-ins cross `reviewAfterVisits`,
 * send them the gym's `reviewUrl` once (notification_log dedupes per member).
 * Off unless both settings are set.
 */
export async function sendReviewNudges(orgId: string) {
	const [st] = await db
		.select({ url: gymSettings.reviewUrl, after: gymSettings.reviewAfterVisits })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	if (!st?.url || !st.after) return 0;
	const rows = await db
		.select({ memberId: checkIn.memberId })
		.from(checkIn)
		.where(and(eq(checkIn.organizationId, orgId), isNull(checkIn.guestName)))
		.groupBy(checkIn.memberId)
		.having(sql`count(*) >= ${st.after}`);
	let n = 0;
	for (const r of rows) {
		if (await notifyReviewRequest(orgId, r.memberId, st.url)) n++;
	}
	return n;
}
