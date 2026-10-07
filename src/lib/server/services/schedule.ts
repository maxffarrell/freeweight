import { error } from '@sveltejs/kit';
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or,
	sql
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classTemplate,
	classType,
	closure,
	gymMember,
	gymSettings,
	location,
	member,
	membership,
	plan,
	user
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import {
	notifyBookingCancelled,
	notifyBookingConfirmed,
	notifyChargePosted,
	notifyInstructorChanged,
	notifyNoShow,
	notifyPackLowCredit,
	notifySessionChanged,
	notifySessionCancelled,
	notifySeriesBooked,
	notifyWaitlistPromoted
} from './notifications.ts';
import { addDays, localDate, localWeekday, zonedToUtc } from '#lib/tz.ts';
import { formatMoney, todayISO } from '#lib/format.ts';
import { nextPeriod } from './billing.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Class types ----------

export async function listClassTypes(orgId: string) {
	return db
		.select({
			...getTableColumns(classType),
			locationName: location.name,
			instructorName: user.name
		})
		.from(classType)
		.leftJoin(location, eq(classType.locationId, location.id))
		.leftJoin(member, eq(classType.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(eq(classType.organizationId, orgId))
		.orderBy(asc(classType.name));
}

export async function createClassType(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.classTypeInput>
) {
	const [row] = await db
		.insert(classType)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description,
			color: input.color,
			durationMin: input.durationMin,
			capacity: input.capacity,
			locationId: input.locationId ?? null,
			instructorId: input.instructorId ?? null,
			dropInPrice: input.dropInPrice ?? null,
			payRate: input.payRate ?? null,
			minEnrollment: input.minEnrollment ?? null,
			active: input.active
		})
		.returning();
	return row;
}

export async function updateClassType(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.classTypeUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(classType)
		.set({ ...set, instructorId: set.instructorId, locationId: set.locationId })
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, id)))
		.returning();
	if (!row) error(404, 'Class not found');
	return row;
}

// ---------- Sessions ----------

const bookedCount = (sessionId: AnyPgColumn) =>
	sql<number>`(select count(*) from ${booking} b where b.session_id = ${sessionId} and b.status = 'booked')`.mapWith(
		Number
	);
const waitlistedCount = (sessionId: AnyPgColumn) =>
	sql<number>`(select count(*) from ${booking} b where b.session_id = ${sessionId} and b.status = 'waitlisted')`.mapWith(
		Number
	);

export async function listSessions(orgId: string, from: Date, to: Date) {
	return db
		.select({
			session: classSession,
			className: classType.name,
			color: classType.color,
			durationMin: classType.durationMin,
			dropInPrice: classType.dropInPrice,
			locationName: location.name,
			instructorName: user.name,
			booked: bookedCount(classSession.id),
			waitlisted: waitlistedCount(classSession.id)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, from),
				lt(classSession.startsAt, to)
			)
		)
		.orderBy(asc(classSession.startsAt));
}

export async function getSession(orgId: string, id: string) {
	const [row] = await db
		.select({
			session: classSession,
			className: classType.name,
			color: classType.color,
			locationName: location.name,
			instructorName: user.name,
			booked: bookedCount(classSession.id),
			waitlisted: waitlistedCount(classSession.id)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(classSession.organizationId, orgId), eq(classSession.id, id)));
	if (!row) error(404, 'Session not found');
	return row;
}

export async function getRoster(orgId: string, sessionId: string) {
	await getSession(orgId, sessionId);
	return db
		.select({ booking, memberName: gymMember.name, memberEmail: gymMember.email })
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.where(and(eq(booking.organizationId, orgId), eq(booking.sessionId, sessionId)))
		.orderBy(asc(booking.createdAt));
}

/** REST API listing: bookings across sessions, newest session first. */
export async function listBookings(
	orgId: string,
	opts: {
		sessionId?: string;
		memberId?: string;
		status?: string[];
		from?: Date;
		to?: Date;
	} = {}
) {
	return db
		.select({
			booking,
			memberName: gymMember.name,
			startsAt: classSession.startsAt,
			className: classType.name
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				opts.sessionId ? eq(booking.sessionId, opts.sessionId) : undefined,
				opts.memberId ? eq(booking.memberId, opts.memberId) : undefined,
				opts.status?.length ? inArray(booking.status, opts.status as never) : undefined,
				opts.from ? gte(classSession.startsAt, opts.from) : undefined,
				opts.to ? lt(classSession.startsAt, opts.to) : undefined
			)
		)
		.orderBy(desc(classSession.startsAt))
		.limit(200);
}

/**
 * Creates a session, plus weekly repeats through `repeatUntil` if given.
 * `startsAt` is a wall-clock time in the workspace timezone.
 */
export async function createSession(
	ctx: OrgContext,
	tz: string,
	input: v.InferOutput<typeof s.sessionInput>
) {
	const [ct] = await db
		.select()
		.from(classType)
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, input.classTypeId)));
	if (!ct) error(404, 'Class not found');

	const start = zonedToUtc(input.startsAt, tz);
	const end = new Date(start.getTime() + (input.durationMin ?? ct.durationMin) * 60_000);
	const dates: Date[] = [start];
	if (input.repeatUntil) {
		let day = input.startsAt.slice(0, 10);
		while ((day = addDays(day, 7)) <= input.repeatUntil) {
			dates.push(zonedToUtc(`${day}T${input.startsAt.slice(11, 16)}`, tz));
		}
	}
	const rows = await db
		.insert(classSession)
		.values(
			dates.map((d) => ({
				organizationId: ctx.orgId,
				classTypeId: input.classTypeId,
				locationId: input.locationId ?? ct.locationId,
				instructorId: input.instructorId ?? ct.instructorId,
				startsAt: d,
				endsAt: new Date(d.getTime() + (end.getTime() - start.getTime())),
				capacity: input.capacity ?? ct.capacity,
				note: input.note ?? null
			}))
		)
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'class_session',
		entityId: rows[0]!.id,
		action: 'created',
		summary: rows.length > 1 ? `${ct.name} scheduled ×${rows.length}` : `${ct.name} scheduled`
	});
	return rows[0];
}

export async function updateSession(
	ctx: OrgContext,
	tz: string,
	input: v.InferOutput<typeof s.sessionUpdate>
) {
	const { id, ...set } = input;
	const [prev] = await db
		.select({
			instructorId: classSession.instructorId,
			startsAt: classSession.startsAt,
			locationId: classSession.locationId,
			capacity: classSession.capacity,
			coverRequestedAt: classSession.coverRequestedAt
		})
		.from(classSession)
		.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, id)));
	if (!prev) error(404, 'Session not found');
	const [row] = await db
		.update(classSession)
		.set({
			startsAt: set.startsAt ? zonedToUtc(set.startsAt, tz) : undefined,
			capacity: set.capacity,
			locationId: set.locationId,
			instructorId: set.instructorId,
			note: set.note,
			cancelledAt: set.cancelled === undefined ? undefined : set.cancelled ? new Date() : null,
			// A new instructor means the cover is filled; otherwise honor the flag.
			coverRequestedAt:
				set.instructorId !== undefined && set.instructorId !== prev.instructorId
					? null
					: set.needsCover === undefined
						? undefined
						: set.needsCover
							? new Date()
							: null
		})
		.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, id)))
		.returning();
	if (!row) error(404, 'Session not found');
	if (set.cancelled) {
		notifySessionCancelled(ctx.orgId, id).catch(() => {});
		// Void open drop-in charges the cancelled session's bookings posted —
		// no class, no fee. Paid charges stay; refunds are separate.
		const [{ n: voided }] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(charge)
			.innerJoin(booking, eq(booking.chargeId, charge.id))
			.where(and(eq(booking.sessionId, id), eq(charge.status, 'open')));
		if (voided > 0)
			await db.execute(
				sql`update ${charge} c set status = 'void', updated_at = now()
					from ${booking} b
					where b.charge_id = c.id and b.session_id = ${id} and c.status = 'open'`
			);
	}
	if (set.instructorId !== undefined && set.instructorId !== prev.instructorId)
		notifyInstructorChanged(ctx.orgId, id).catch(() => {});
	if (set.needsCover && !prev.coverRequestedAt)
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'session',
			entityId: id,
			action: 'cover_requested',
			summary: 'Cover requested'
		});
	const moved =
		(set.startsAt && zonedToUtc(set.startsAt, tz).getTime() !== prev.startsAt.getTime()) ||
		(set.locationId !== undefined && set.locationId !== prev.locationId);
	if (moved && !set.cancelled) notifySessionChanged(ctx.orgId, id).catch(() => {});
	// More seats than before — promote waitlisted members FIFO into them.
	// Skipped near class start (same cutoff as spot-freeing promotions) and on
	// cancelled sessions.
	if (set.capacity != null && set.capacity > prev.capacity && !row.cancelledAt) {
		const [st] = await db
			.select({ cutoff: gymSettings.waitlistCutoffMin })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, ctx.orgId));
		const cutoffHit = st?.cutoff && row.startsAt.getTime() - Date.now() < st.cutoff * 60_000;
		if (!cutoffHit) {
			const promotedIds = await db.transaction(async (tx) => {
				const [{ n: booked }] = await tx
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(booking)
					.where(and(eq(booking.sessionId, id), eq(booking.status, 'booked')));
				const free = row.capacity - booked;
				if (free <= 0) return [] as string[];
				const waiters = await tx
					.select({ id: booking.id })
					.from(booking)
					.where(and(eq(booking.sessionId, id), eq(booking.status, 'waitlisted')))
					.orderBy(asc(booking.createdAt))
					.limit(free)
					.for('update');
				if (!waiters.length) return [] as string[];
				await tx
					.update(booking)
					.set({ status: 'booked' })
					.where(
						inArray(
							booking.id,
							waiters.map((w) => w.id)
						)
					);
				return waiters.map((w) => w.id);
			});
			for (const bid of promotedIds) await notifyWaitlistPromoted(ctx.orgId, bid).catch(() => {});
			if (promotedIds.length)
				await emit({
					orgId: ctx.orgId,
					actorId: ctx.userId,
					entityType: 'class_session',
					entityId: id,
					action: 'waitlist_promoted',
					summary: `${promotedIds.length} member${promotedIds.length > 1 ? 's' : ''} promoted off the waitlist`,
					data: { bookingIds: promotedIds }
				});
		}
	}
	// Keep endsAt in step when the start moves or a per-session duration is set.
	if (set.startsAt || set.durationMin != null) {
		const [ct] = await db
			.select({ durationMin: classType.durationMin })
			.from(classType)
			.where(eq(classType.id, row.classTypeId));
		await db
			.update(classSession)
			.set({
				endsAt: new Date(
					row.startsAt.getTime() + (set.durationMin ?? ct?.durationMin ?? 60) * 60_000
				)
			})
			.where(eq(classSession.id, id));
	}
	return row;
}

// ---------- Bookings ----------

async function activeMembership(orgId: string, memberId: string) {
	const [row] = await db
		.select({
			membership,
			classCredits: plan.classCredits,
			interval: plan.interval,
			isPack: plan.isPack
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active'),
				// Expired packs stop granting bookings.
				or(isNull(membership.endsAt), gt(membership.endsAt, new Date()))
			)
		)
		.orderBy(desc(membership.createdAt))
		.limit(1);
	return row;
}

/**
 * Daily housekeeping: 'booked' rows for sessions that already ended become 'no_show'
 * (check-ins have already flipped attendees to 'attended'). Cancelled sessions skip.
 */
export async function markPastNoShows(orgId: string) {
	// Read before flip: need member/class for the optional no-show fee charge.
	const rows = await db
		.select({
			id: booking.id,
			memberId: booking.memberId,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.status, 'booked'),
				lt(classSession.endsAt, new Date()),
				isNull(classSession.cancelledAt)
			)
		);
	if (!rows.length) return 0;
	await db
		.update(booking)
		.set({ status: 'no_show' })
		.where(
			inArray(
				booking.id,
				rows.map((r) => r.id)
			)
		);

	const [st] = await db
		.select({ noShowFee: gymSettings.noShowFee, timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	if (st?.noShowFee && st.noShowFee > 0) {
		const tz = st.timezone ?? 'UTC';
		for (const r of rows) {
			const [c] = await db
				.insert(charge)
				.values({
					organizationId: orgId,
					memberId: r.memberId,
					kind: 'other',
					description: `No-show fee — ${r.className} ${localDate(r.startsAt, tz)}`,
					amount: st.noShowFee,
					dueDate: todayISO()
				})
				.returning({ id: charge.id });
			if (c) notifyChargePosted(orgId, c.id).catch(() => {});
		}
	}
	for (const r of rows)
		notifyNoShow(orgId, r.id, r.memberId, r.className, r.startsAt).catch(() => {});
	return rows.length;
}

/** Waitlist spots die when the session starts — flips them to cancelled in the daily sweep. */
export async function expireWaitlists(orgId: string) {
	const rows = await db
		.update(booking)
		.set({ status: 'cancelled', cancelledAt: new Date() })
		.from(classSession)
		.where(
			and(
				eq(booking.sessionId, classSession.id),
				eq(booking.organizationId, orgId),
				eq(booking.status, 'waitlisted'),
				lt(classSession.startsAt, new Date())
			)
		)
		.returning({ id: booking.id });
	return rows.length;
}

/**
 * Daily cron: cancels sessions starting within 24h whose class type sets a
 * minimum enrollment and is still under it — gyms decide the day before, not
 * at door time. Same aftermath as a manual cancel: attendees and the
 * instructor are emailed (notifySessionCancelled), open drop-in charges are
 * voided, and credit usage ignores cancelled sessions automatically.
 */
export async function autoCancelUnderEnrolled(orgId: string) {
	const until = new Date(Date.now() + 24 * 3600_000);
	const rows = await db
		.select({
			id: classSession.id,
			min: classType.minEnrollment,
			booked: bookedCount(classSession.id)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				isNull(classSession.cancelledAt),
				isNotNull(classType.minEnrollment),
				gt(classSession.startsAt, new Date()),
				lt(classSession.startsAt, until)
			)
		);
	let cancelled = 0;
	for (const s of rows) {
		if (s.min == null || s.booked >= s.min) continue;
		const [row] = await db
			.update(classSession)
			.set({ cancelledAt: new Date(), updatedAt: new Date() })
			.where(and(eq(classSession.id, s.id), isNull(classSession.cancelledAt)))
			.returning({ id: classSession.id });
		if (!row) continue;
		await emit({
			orgId,
			entityType: 'session',
			entityId: s.id,
			action: 'auto_cancelled',
			summary: `Under-enrolled (${s.booked}/${s.min})`
		});
		notifySessionCancelled(orgId, s.id).catch(() => {});
		await db.execute(
			sql`update ${charge} c set status = 'void', updated_at = now()
				from ${booking} b
				where b.charge_id = c.id and b.session_id = ${s.id} and c.status = 'open'`
		);
		cancelled++;
	}
	return cancelled;
}

/** Bookings that consume a class credit (cancelled doesn't). */
const CREDIT_STATUSES = ['booked', 'attended', 'no_show'] as const;

type ActiveMembership = {
	classCredits: number | null;
	interval: 'week' | 'month' | 'year';
	isPack: boolean;
	membership: { id: string; startsAt: Date; endsAt: Date | null; bonusCredits: number };
};

/** Current rolling membership period: startsAt stepped forward on the plan's interval. */
function periodWindow(startsAt: Date, interval: 'week' | 'month' | 'year') {
	let start = startsAt.toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);
	while (nextPeriod(start, interval) <= today) start = nextPeriod(start, interval);
	return { start, end: nextPeriod(start, interval) };
}

/** Credit-counting window: a pack counts bookings from purchase to expiry. */
function creditWindow(ms: ActiveMembership) {
	if (ms.isPack) {
		return {
			start: ms.membership.startsAt.toISOString().slice(0, 10),
			end: (ms.membership.endsAt ?? new Date()).toISOString().slice(0, 10)
		};
	}
	return periodWindow(ms.membership.startsAt, ms.interval);
}

async function creditsUsedIn(
	orgId: string,
	memberId: string,
	window: { start: string; end: string }
) {
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.memberId, memberId),
				inArray(booking.status, [...CREDIT_STATUSES]),
				// A cancelled class gives the credit back.
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, new Date(`${window.start}T00:00:00Z`)),
				lt(classSession.startsAt, new Date(`${window.end}T00:00:00Z`))
			)
		);
	return count;
}

/**
 * Classes used this membership period, or null when the active plan has no cap.
 * Shared by the staff member page, portal overview and booking enforcement.
 */
export async function creditUsage(orgId: string, memberId: string) {
	const ms = await activeMembership(orgId, memberId);
	if (!ms || ms.classCredits == null) return null;
	const used = await creditsUsedIn(orgId, memberId, creditWindow(ms));
	return {
		used,
		limit: ms.classCredits + ms.membership.bonusCredits,
		bonus: ms.membership.bonusCredits,
		membershipId: ms.membership.id
	};
}

/**
 * Daily sweep: active pack memberships down to ≤2 remaining credits get one
 * nudge email each (once per membership via notification_log — a new pack
 * purchase is a new membership, so the nudge re-arms naturally).
 */
export async function sendPackLowCreditNudges(orgId: string) {
	const packs = await db
		.select({ ms: membership, memberId: membership.memberId, classCredits: plan.classCredits })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, true),
				isNotNull(plan.classCredits)
			)
		);
	let n = 0;
	for (const p of packs) {
		const window = {
			start: p.ms.startsAt.toISOString().slice(0, 10),
			end: (p.ms.endsAt ?? new Date()).toISOString().slice(0, 10)
		};
		const used = await creditsUsedIn(orgId, p.memberId, window);
		const limit = (p.classCredits ?? 0) + p.ms.bonusCredits;
		const remaining = limit - used;
		if (remaining <= 2 && remaining >= 0) {
			if (await notifyPackLowCredit(orgId, p.memberId, remaining, limit, p.ms.id)) n++;
		}
	}
	return n;
}

/** 402s when the member's plan caps classes per period and they've used them. */
async function assertCreditAvailable(orgId: string, memberId: string, ms: ActiveMembership) {
	if (ms.classCredits == null) return;
	const used = await creditsUsedIn(orgId, memberId, creditWindow(ms));
	const limit = ms.classCredits + ms.membership.bonusCredits;
	if (used >= limit)
		error(
			402,
			ms.isPack
				? `All ${limit} classes used in this pack`
				: `All ${limit} classes used for this period`
		);
}

/**
 * Books a member into a session. Full sessions go to the waitlist in order.
 * `FOR UPDATE` on the session row serializes concurrent bookings against capacity.
 */
export async function bookSession(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.bookingInput>,
	actorId?: string | null,
	opts?: { notify?: boolean }
) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const ms = await activeMembership(ctx.orgId, input.memberId);
	// Staff-side drop-in: no membership required, the class's drop-in
	// charge posts to the member's balance instead.
	if (!ms && !input.dropIn) error(402, 'An active membership is required to book');
	if (ms) await assertCreditAvailable(ctx.orgId, input.memberId, ms);

	const [st] = await db
		.select({ tz: gymSettings.timezone, maxPerDay: gymSettings.maxBookingsPerDay })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));

	const { row, dropInInfo } = await db.transaction(async (tx) => {
		const [s] = await tx
			.select({
				capacity: classSession.capacity,
				cancelledAt: classSession.cancelledAt,
				startsAt: classSession.startsAt,
				dropInPrice: classType.dropInPrice,
				className: classType.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, input.sessionId)))
			.for('update');
		if (!s) error(404, 'Session not found');
		if (s.cancelledAt) error(409, 'This session is cancelled');
		const dropInInfo =
			input.dropIn && s.dropInPrice != null && s.dropInPrice > 0
				? { className: s.className, price: s.dropInPrice }
				: null;
		if (input.dropIn && !dropInInfo) error(409, `No drop-in price set on ${s.className}`);

		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(booking)
			.where(and(eq(booking.sessionId, input.sessionId), eq(booking.status, 'booked')));

		// Rebook if they cancelled before, else insert fresh.
		const [existing] = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, input.sessionId), eq(booking.memberId, input.memberId)));

		// Daily booking limit: the member can't hold more than N non-cancelled
		// bookings on sessions in the same local day. (An existing live booking
		// falls through to the 'Already booked' check below instead.)
		if (st?.maxPerDay != null && !(existing && existing.status !== 'cancelled')) {
			const tz = st.tz ?? 'UTC';
			const day = localDate(s.startsAt, tz);
			const dayStart = zonedToUtc(`${day}T00:00`, tz);
			const dayEnd = zonedToUtc(`${addDays(day, 1)}T00:00`, tz);
			const [{ dayCount }] = await tx
				.select({ dayCount: sql<number>`count(*)`.mapWith(Number) })
				.from(booking)
				.innerJoin(classSession, eq(booking.sessionId, classSession.id))
				.where(
					and(
						eq(booking.memberId, input.memberId),
						ne(booking.status, 'cancelled'),
						gte(classSession.startsAt, dayStart),
						lt(classSession.startsAt, dayEnd)
					)
				);
			if (dayCount >= st.maxPerDay)
				error(409, `Daily booking limit reached (${st.maxPerDay} per day)`);
		}

		if (input.dropIn && count >= s.capacity)
			error(409, "This class is full — paid drop-ins can't join the waitlist");
		const status = count >= s.capacity ? 'waitlisted' : 'booked';
		if (existing) {
			if (existing.status !== 'cancelled') error(409, 'Already booked');
			const [row] = await tx
				.update(booking)
				.set({ status, cancelledAt: null, createdAt: new Date() })
				.where(eq(booking.id, existing.id))
				.returning();
			return { row: row!, dropInInfo };
		}
		const [row] = await tx
			.insert(booking)
			.values({
				organizationId: ctx.orgId,
				sessionId: input.sessionId,
				memberId: input.memberId,
				status
			})
			.returning();
		return { row: row!, dropInInfo };
	});
	if (dropInInfo) {
		const [c] = await db
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				memberId: input.memberId,
				kind: 'dropin',
				description: `${dropInInfo.className} drop-in`,
				amount: dropInInfo.price,
				dueDate: todayISO()
			})
			.returning({ id: charge.id });
		// Link back so cancelling the booking or the session voids the charge.
		await db.update(booking).set({ chargeId: c!.id }).where(eq(booking.id, row.id));
		await emit({
			orgId: ctx.orgId,
			actorId: actorId ?? ctx.userId,
			entityType: 'charge',
			entityId: c!.id,
			action: 'created',
			summary: `Drop-in charge of ${formatMoney(dropInInfo.price)} posted`
		});
		notifyChargePosted(ctx.orgId, c!.id).catch(() => {});
	}
	await emit({
		orgId: ctx.orgId,
		actorId: actorId ?? ctx.userId,
		entityType: 'booking',
		entityId: row.id,
		action: row.status === 'waitlisted' ? 'waitlisted' : 'booked',
		summary: `${m.name} ${row.status === 'waitlisted' ? 'joined the waitlist' : 'booked a class'}`,
		data: { sessionId: input.sessionId, memberId: input.memberId }
	});
	if (opts?.notify !== false) notifyBookingConfirmed(ctx.orgId, row.id).catch(() => {});
	return row;
}

/**
 * Books a member into every upcoming session of a class type for the next `weeks`
 * weeks — "all Monday 6am Spins this month". Sessions they're already in, or that
 * reject them (daily cap, credits), count as skipped; one summary email would be
 * spam so booking confirmations are suppressed per session.
 */
export async function bookSeries(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.seriesBookingInput>
) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const [ct] = await db
		.select()
		.from(classType)
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, input.classTypeId)));
	if (!ct) error(404, 'Class not found');

	const sessions = await db
		.select({ id: classSession.id })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				eq(classSession.classTypeId, input.classTypeId),
				isNull(classSession.cancelledAt),
				gt(classSession.startsAt, new Date()),
				lt(classSession.startsAt, new Date(Date.now() + input.weeks * 7 * 86400_000))
			)
		)
		.orderBy(asc(classSession.startsAt));

	let booked = 0;
	let waitlisted = 0;
	let skipped = 0;
	for (const s of sessions) {
		try {
			const b = await bookSession(ctx, { sessionId: s.id, memberId: input.memberId }, ctx.userId, {
				notify: false
			});
			if (b.status === 'waitlisted') waitlisted++;
			else booked++;
		} catch {
			skipped++;
		}
	}
	if (booked + waitlisted)
		notifySeriesBooked(ctx.orgId, m.id, ct.name, { booked, waitlisted }, input.weeks).catch(
			() => {}
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: m.id,
		action: 'series_booked',
		summary: `${m.name} booked into ${ct.name} ×${booked}${waitlisted ? ` (+${waitlisted} waitlisted)` : ''}`
	});
	return { booked, waitlisted, skipped, total: sessions.length };
}

/** Cancels a booking and promotes the longest-waiting member, if any. */
export async function cancelBooking(
	ctx: OrgContext,
	id: string,
	actorId?: string | null,
	opts?: { notify?: boolean; lateFee?: boolean }
) {
	const { promoted, lateCancel } = await db.transaction(async (tx) => {
		// Read status before updating — the returning row is always 'cancelled'.
		const [prev] = await tx
			.select({ status: booking.status, chargeId: booking.chargeId })
			.from(booking)
			.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.id, id)))
			.for('update');
		if (!prev || prev.status === 'cancelled') error(404, 'Booking not found');
		const [b] = await tx
			.update(booking)
			.set({ status: 'cancelled', cancelledAt: new Date() })
			.where(eq(booking.id, id))
			.returning();
		// A cancelled drop-in shouldn't keep billing — void the charge it
		// posted. Already-paid charges stay (refunds are a separate flow).
		if (prev.chargeId)
			await tx
				.update(charge)
				.set({ status: 'void', updatedAt: new Date() })
				.where(and(eq(charge.id, prev.chargeId), eq(charge.status, 'open')));
		if (prev.status !== 'booked') return { promoted: null, lateCancel: null };

		const [[sess], [st]] = await Promise.all([
			tx
				.select({
					startsAt: classSession.startsAt,
					cancelledAt: classSession.cancelledAt,
					className: classType.name
				})
				.from(classSession)
				.innerJoin(classType, eq(classSession.classTypeId, classType.id))
				.where(eq(classSession.id, b.sessionId)),
			tx
				.select({
					cutoff: gymSettings.waitlistCutoffMin,
					cancelCutoffMin: gymSettings.cancelCutoffMin,
					lateCancelFee: gymSettings.lateCancelFee,
					timezone: gymSettings.timezone
				})
				.from(gymSettings)
				.where(eq(gymSettings.organizationId, ctx.orgId))
		]);
		const lateCancel =
			sess &&
			!sess.cancelledAt &&
			st?.cancelCutoffMin != null &&
			st.lateCancelFee &&
			st.lateCancelFee > 0 &&
			sess.startsAt.getTime() - Date.now() < st.cancelCutoffMin * 60_000
				? {
						className: sess.className,
						startsAt: sess.startsAt,
						fee: st.lateCancelFee,
						tz: st.timezone ?? 'UTC'
					}
				: null;

		// Don't promote when the class is about to start — the member can't
		// realistically make it. The spot just opens for walk-in booking.
		if (st?.cutoff && sess && sess.startsAt.getTime() - Date.now() < st.cutoff * 60_000)
			return { promoted: null, lateCancel };

		const [next] = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, b.sessionId), eq(booking.status, 'waitlisted')))
			.orderBy(asc(booking.createdAt))
			.limit(1);
		if (!next) return { promoted: null, lateCancel };
		await tx.update(booking).set({ status: 'booked' }).where(eq(booking.id, next.id));
		return { promoted: next, lateCancel };
	});
	const [b] = await db.select().from(booking).where(eq(booking.id, id));
	await emit({
		orgId: ctx.orgId,
		actorId: actorId ?? ctx.userId,
		entityType: 'booking',
		entityId: id,
		action: 'cancelled',
		summary: 'Booking cancelled',
		data: { sessionId: b!.sessionId, memberId: b!.memberId, promotedId: promoted?.memberId }
	});
	if (opts?.notify !== false) notifyBookingCancelled(ctx.orgId, id).catch(() => {});
	if (promoted) await notifyWaitlistPromoted(ctx.orgId, promoted.id).catch(() => {});
	if (lateCancel && opts?.lateFee !== false) {
		const [c] = await db
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				memberId: b!.memberId,
				kind: 'other',
				description: `Late-cancel fee — ${lateCancel.className} ${localDate(lateCancel.startsAt, lateCancel.tz)}`,
				amount: lateCancel.fee,
				dueDate: todayISO()
			})
			.returning({ id: charge.id });
		if (c) notifyChargePosted(ctx.orgId, c.id).catch(() => {});
	}
	return { ...b, lateFeeApplied: lateCancel != null };
}

/**
 * Cancels every upcoming booking a member holds — called when their membership
 * is cancelled so their spots free up (and waitlists promote). Member-facing
 * cancel emails and late fees are suppressed; the membership-cancel email
 * covers it.
 */
export async function cancelUpcomingBookings(ctx: OrgContext, memberId: string) {
	const rows = await db
		.select({ id: booking.id })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(
			and(
				eq(booking.organizationId, ctx.orgId),
				eq(booking.memberId, memberId),
				inArray(booking.status, ['booked', 'waitlisted']),
				gt(classSession.startsAt, new Date())
			)
		);
	for (const r of rows)
		await cancelBooking(ctx, r.id, ctx.userId, { notify: false, lateFee: false });
	return rows.length;
}

export async function updateBooking(ctx: OrgContext, input: v.InferOutput<typeof s.bookingUpdate>) {
	if (input.status === 'cancelled') return cancelBooking(ctx, input.id);
	const { row, promoted } = await db.transaction(async (tx) => {
		const [prev] = await tx
			.select({ status: booking.status })
			.from(booking)
			.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.id, input.id)))
			.for('update');
		if (!prev) error(404, 'Booking not found');
		const [row] = await tx
			.update(booking)
			.set({ status: input.status })
			.where(eq(booking.id, input.id))
			.returning();
		return { row, promoted: prev.status === 'waitlisted' && input.status === 'booked' };
	});
	// waitlisted → booked is a staff override of the auto-promote order (e.g.
	// inside the promotion cutoff or picking someone other than first-in-line):
	// audit it and send the member the same "you're in" email.
	if (promoted) {
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'booking',
			entityId: input.id,
			action: 'promoted',
			summary: 'Promoted off the waitlist',
			data: { sessionId: row!.sessionId, memberId: row!.memberId }
		});
		notifyWaitlistPromoted(ctx.orgId, row!.id).catch(() => {});
	}
	return row;
}

/** Instructors = staff members of the org. */
export async function listInstructors(orgId: string) {
	return db
		.select({ id: member.id, name: user.name })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(user.name));
}

// ---------- Recurring templates ----------

export async function listTemplates(orgId: string) {
	return db
		.select({
			template: classTemplate,
			className: classType.name,
			color: classType.color,
			locationName: location.name,
			instructorName: user.name
		})
		.from(classTemplate)
		.innerJoin(classType, eq(classTemplate.classTypeId, classType.id))
		.leftJoin(location, eq(classTemplate.locationId, location.id))
		.leftJoin(member, eq(classTemplate.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(eq(classTemplate.organizationId, orgId))
		.orderBy(asc(classTemplate.weekday), asc(classTemplate.startTime));
}

export async function createTemplate(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.templateInput>
) {
	const [ct] = await db
		.select({ id: classType.id, name: classType.name })
		.from(classType)
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, input.classTypeId)));
	if (!ct) error(404, 'Class not found');
	const [row] = await db
		.insert(classTemplate)
		.values({
			organizationId: ctx.orgId,
			classTypeId: input.classTypeId,
			locationId: input.locationId ?? null,
			instructorId: input.instructorId ?? null,
			weekday: input.weekday,
			startTime: input.startTime,
			capacity: input.capacity ?? null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'class_template',
		entityId: row!.id,
		action: 'created',
		summary: `Recurring ${ct.name} — ${WEEKDAYS[input.weekday]}s ${input.startTime}`
	});
	// Generate the first window right away; the daily cron keeps it rolling.
	await materializeTemplates(ctx.orgId);
	return row;
}

/**
 * Edits a template's class/day/time/seats. Sessions already materialized keep
 * what they were generated with — the new values only shape future cron runs
 * (and the immediate materialize below), same as before.
 */
export async function updateTemplate(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.templateUpdate>
) {
	const { id, ...set } = input;
	const [ct] = await db
		.select({ id: classType.id, name: classType.name })
		.from(classType)
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, set.classTypeId)));
	if (!ct) error(404, 'Class not found');
	const [row] = await db
		.update(classTemplate)
		.set({
			classTypeId: set.classTypeId,
			locationId: set.locationId ?? null,
			instructorId: set.instructorId ?? null,
			weekday: set.weekday,
			startTime: set.startTime,
			capacity: set.capacity ?? null,
			updatedAt: new Date()
		})
		.where(and(eq(classTemplate.organizationId, ctx.orgId), eq(classTemplate.id, id)))
		.returning();
	if (!row) error(404, 'Template not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'class_template',
		entityId: row.id,
		action: 'updated',
		summary: `Recurring ${ct.name} — ${WEEKDAYS[set.weekday]}s ${set.startTime}`
	});
	await materializeTemplates(ctx.orgId);
	return row;
}

export async function deleteTemplate(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(classTemplate)
		.where(and(eq(classTemplate.organizationId, ctx.orgId), eq(classTemplate.id, id)))
		.returning();
	if (!row) error(404, 'Template not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'class_template',
		entityId: row.id,
		action: 'deleted',
		summary: `Deleted recurring template`
	});
	return row;
}

/**
 * Copies a local week's sessions into another week (default: the next).
 * Cancelled sessions aren't copied; sessions landing on a closed day are skipped.
 */
export async function copyWeek(
	ctx: OrgContext,
	tz: string,
	weekStart: string,
	targetStart?: string
) {
	const from = zonedToUtc(`${weekStart}T00:00`, tz);
	const to = zonedToUtc(`${addDays(weekStart, 7)}T00:00`, tz);
	const target = targetStart ?? addDays(weekStart, 7);
	const shiftMs = zonedToUtc(`${target}T00:00`, tz).getTime() - from.getTime();
	const closed = new Set(
		(
			await db
				.select({ date: closure.date })
				.from(closure)
				.where(
					and(
						eq(closure.organizationId, ctx.orgId),
						gte(closure.date, target),
						lt(closure.date, addDays(target, 7))
					)
				)
		).map((c) => c.date)
	);
	const src = await db
		.select()
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				gte(classSession.startsAt, from),
				lt(classSession.startsAt, to),
				isNull(classSession.cancelledAt)
			)
		);
	const rows = src
		.filter((s) => !closed.has(localDate(new Date(s.startsAt.getTime() + shiftMs), tz)))
		.map((s) => ({
			organizationId: ctx.orgId,
			classTypeId: s.classTypeId,
			locationId: s.locationId,
			instructorId: s.instructorId,
			startsAt: new Date(s.startsAt.getTime() + shiftMs),
			endsAt: new Date(s.endsAt.getTime() + shiftMs),
			capacity: s.capacity,
			note: s.note
		}));
	const inserted = rows.length
		? await db.insert(classSession).values(rows).returning({ id: classSession.id })
		: [];
	if (inserted.length)
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'class_session',
			entityId: inserted[0]!.id,
			action: 'copied',
			summary: `Copied ${inserted.length} session${inserted.length === 1 ? '' : 's'} to week of ${target}${src.length - rows.length ? ` — ${src.length - rows.length} skipped (closed)` : ''}`
		});
	return { created: inserted.length, skipped: src.length - rows.length };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Sessions templates keep ahead of today (org-local). */
// ------- Closures -------

/** Lists every closure day, soonest first. */
export async function listClosures(orgId: string) {
	return db
		.select()
		.from(closure)
		.where(eq(closure.organizationId, orgId))
		.orderBy(asc(closure.date));
}

/**
 * Marks a day closed and cancels every live session on it — members get the usual
 * cancellation email and credits are returned. Recurring templates skip closed days.
 */
export async function addClosure(ctx: OrgContext, input: { date: string; reason: string }) {
	const [row] = await db
		.insert(closure)
		.values({ organizationId: ctx.orgId, date: input.date, reason: input.reason })
		.onConflictDoNothing()
		.returning();
	if (!row) error(409, 'That day is already marked closed');

	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));
	const tz = st?.timezone ?? 'UTC';
	const sessions = await db
		.select({ id: classSession.id })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				isNull(classSession.cancelledAt),
				sql`to_char(${classSession.startsAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD') = ${row.date}`
			)
		);
	if (sessions.length)
		await db
			.update(classSession)
			.set({ cancelledAt: new Date() })
			.where(
				inArray(
					classSession.id,
					sessions.map((s) => s.id)
				)
			);
	for (const s of sessions) notifySessionCancelled(ctx.orgId, s.id).catch(() => {});

	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'closure',
		entityId: row.id,
		action: 'created',
		summary: `Closed ${row.date}${row.reason ? ` (${row.reason})` : ''}${sessions.length ? ` — ${sessions.length} session${sessions.length === 1 ? '' : 's'} cancelled` : ''}`
	});
	return { ...row, sessionsCancelled: sessions.length };
}

/** Removes a closure day. Sessions already cancelled stay cancelled. */
export async function removeClosure(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(closure)
		.where(and(eq(closure.organizationId, ctx.orgId), eq(closure.id, id)))
		.returning();
	if (!row) error(404, 'Closure not found');
	return row;
}

const TEMPLATE_HORIZON_DAYS = 14;

/**
 * Turns active class templates into real sessions for the next TEMPLATE_HORIZON_DAYS
 * org-local days. Dedup by (templateId, startsAt) — a session a staff member edited or
 * cancelled stays as they left it; deleting the session lets the cron regenerate it.
 */
export async function materializeTemplates(orgId: string) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = st?.timezone ?? 'UTC';
	const today = localDate(new Date(), tz);

	const templates = await db
		.select({ template: classTemplate, classType })
		.from(classTemplate)
		.innerJoin(classType, eq(classTemplate.classTypeId, classType.id))
		.where(and(eq(classTemplate.organizationId, orgId), eq(classTemplate.active, true)));
	if (!templates.length) return 0;

	const windowStart = zonedToUtc(`${today}T00:00`, tz);
	const windowEnd = zonedToUtc(`${addDays(today, TEMPLATE_HORIZON_DAYS + 1)}T00:00`, tz);
	const existing = await db
		.select({ templateId: classSession.templateId, startsAt: classSession.startsAt })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, orgId),
				inArray(
					classSession.templateId,
					templates.map((t) => t.template.id)
				),
				gte(classSession.startsAt, windowStart),
				lt(classSession.startsAt, windowEnd)
			)
		);
	const have = new Set(existing.map((e) => `${e.templateId}|${e.startsAt.getTime()}`));
	const closed = new Set(
		(
			await db
				.select({ date: closure.date })
				.from(closure)
				.where(
					and(
						eq(closure.organizationId, orgId),
						gte(closure.date, today),
						lte(closure.date, addDays(today, TEMPLATE_HORIZON_DAYS))
					)
				)
		).map((c) => c.date)
	);

	const now = Date.now();
	const rows = [];
	for (let i = 0; i <= TEMPLATE_HORIZON_DAYS; i++) {
		const day = addDays(today, i);
		if (closed.has(day)) continue;
		// Noon local avoids the DST edge where the day has no midnight.
		const weekday = localWeekday(zonedToUtc(`${day}T12:00`, tz), tz);
		for (const { template: tpl, classType: ct } of templates) {
			if (tpl.weekday !== weekday) continue;
			const startsAt = zonedToUtc(`${day}T${tpl.startTime}`, tz);
			if (startsAt.getTime() < now || have.has(`${tpl.id}|${startsAt.getTime()}`)) continue;
			have.add(`${tpl.id}|${startsAt.getTime()}`);
			rows.push({
				organizationId: orgId,
				classTypeId: tpl.classTypeId,
				locationId: tpl.locationId ?? ct.locationId,
				instructorId: tpl.instructorId ?? ct.instructorId,
				templateId: tpl.id,
				startsAt,
				endsAt: new Date(startsAt.getTime() + ct.durationMin * 60_000),
				capacity: tpl.capacity ?? ct.capacity
			});
		}
	}
	if (rows.length) await db.insert(classSession).values(rows);
	return rows.length;
}
