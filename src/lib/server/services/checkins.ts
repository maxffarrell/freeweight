import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import {
	and,
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
	plan,
	waiver
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { notifyCheckInMilestone, notifyFirstVisit, notifyReviewRequest } from './notifications.ts';
import { getRoster, getSession } from './schedule.ts';
import { addDays, localDate, zonedToUtc } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

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
		.select({ timezone: gymSettings.timezone, waiverText: gymSettings.waiver })
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
	else if (MILESTONES.includes(n)) notifyCheckInMilestone(ctx.orgId, memberId, n).catch(() => {});

	// Desk heads-up: it's the member's birthday today (MM-DD compare, org tz).
	const birthday = !!m.birthday && m.birthday.slice(5) === today.slice(5);
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
	return {
		checkIn: row!,
		member: m,
		attended: attended.length,
		birthday,
		visits: n,
		waiverMissing
	};
}

export async function listCheckIns(
	orgId: string,
	opts: { since: Date; until?: Date; q?: string; inside?: boolean; memberId?: string }
) {
	const term = opts.q?.trim();
	return db
		.select({
			checkIn,
			memberName: gymMember.name,
			memberPhotoId: gymMember.photoDocumentId,
			locationName: location.name
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
	if (!booked.length) return { checkedIn: 0, skipped: 0, birthdays: [] as string[] };
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
		} catch {
			skipped++;
		}
	}
	return { checkedIn, skipped, birthdays };
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
