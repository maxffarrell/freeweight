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
	instructorTimeOff,
	location,
	member,
	membership,
	plan,
	user
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 5-char unambiguous class check-in code (no 0/O/1/I/L). */
export function sessionCode() {
	const b = new Uint8Array(5);
	crypto.getRandomValues(b);
	return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
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
	notifyWaitlistPromoted,
	sendCoverRequests
} from './notifications.ts';
import { addDays, localDate, localTime, localWeekday, zonedToUtc } from '#lib/tz.ts';
import { formatMoney, todayISO } from '#lib/format.ts';
import { nextPeriod } from './billing.ts';
import { getSettings } from './settings.ts';
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
			waitlistLimit: input.waitlistLimit ?? null,
			bookCutoffMin: input.bookCutoffMin ?? null,
			memberBookable: input.memberBookable,
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

export type DemandHint = {
	kind: 'add' | 'drop';
	classTypeId: string;
	className: string;
	color: string | null;
	weekday: number;
	/** Mode start time, `HH:MM` in the gym's timezone. */
	time: string;
	avgFill: number;
	sessions: number;
};

/**
 * Demand signals for the schedule: class/weekday pairs that ran at least `minRuns`
 * times in the last `weeks` and average ≥85% full (suggest adding a session) or
 * ≤30% full (suggest dropping/merging). Fill counts every non-cancelled booking —
 * attended + no-show + still-booked + still-waitlisted.
 */
export async function scheduleDemandHints(orgId: string, tz: string, weeks = 6) {
	const rows = await db
		.select({
			classTypeId: classSession.classTypeId,
			className: classType.name,
			color: classType.color,
			startsAt: classSession.startsAt,
			capacity: classSession.capacity,
			demand:
				sql<number>`(select count(*) from ${booking} b where b.session_id = ${classSession.id} and b.status <> 'cancelled')`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, new Date(Date.now() - weeks * 7 * 86400_000)),
				lt(classSession.startsAt, new Date())
			)
		);
	type Group = {
		className: string;
		color: string | null;
		weekday: number;
		sessions: number;
		fillSum: number;
		times: Map<string, number>;
	};
	const groups = new Map<string, Group>();
	for (const r of rows) {
		const weekday = localWeekday(r.startsAt, tz);
		const key = `${r.classTypeId}:${weekday}`;
		const g =
			groups.get(key) ??
			groups
				.set(key, {
					className: r.className,
					color: r.color,
					weekday,
					sessions: 0,
					fillSum: 0,
					times: new Map()
				})
				.get(key)!;
		g.sessions++;
		g.fillSum += Math.min(100, Math.round((r.demand / Math.max(1, r.capacity)) * 100));
		const t = localTime(r.startsAt, tz);
		g.times.set(t, (g.times.get(t) ?? 0) + 1);
	}
	const hints: DemandHint[] = [];
	for (const [key, g] of groups) {
		const avgFill = Math.round(g.fillSum / g.sessions);
		const kind =
			avgFill >= 85 && g.sessions >= 3 ? 'add' : avgFill <= 30 && g.sessions >= 4 ? 'drop' : null;
		if (!kind) continue;
		const time = [...g.times.entries()].sort((a, b) => b[1] - a[1])[0][0];
		hints.push({
			kind,
			classTypeId: key.split(':')[0],
			className: g.className,
			color: g.color,
			weekday: g.weekday,
			time,
			avgFill,
			sessions: g.sessions
		});
	}
	return hints.sort((a, b) =>
		a.kind === b.kind ? b.avgFill - a.avgFill : a.kind === 'add' ? -1 : 1
	);
}

/**
 * The instructor's view: sessions the signed-in staff member teaches,
 * from 2h ago through `days` ahead, with live counts. Staff without a
 * linked member row teach nothing.
 */
export async function myTeachingSessions(ctx: OrgContext, days = 14) {
	const [me] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
	if (!me) return [];
	const until = new Date(Date.now() + days * 86400_000);
	return db
		.select({
			session: classSession,
			className: classType.name,
			color: classType.color,
			locationName: location.name,
			booked: bookedCount(classSession.id),
			waitlisted: waitlistedCount(classSession.id)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				eq(classSession.instructorId, me.id),
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, new Date(Date.now() - 2 * 3600_000)),
				lt(classSession.startsAt, until)
			)
		)
		.orderBy(asc(classSession.startsAt));
}

/** Org-wide open cover requests (future, uncancelled) — powers the "Needs
 * cover" card on My classes; excludes sessions the viewer already teaches. */
export async function sessionsNeedingCover(ctx: OrgContext) {
	const [me] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
	return db
		.select({
			session: classSession,
			className: classType.name,
			color: classType.color,
			locationName: location.name,
			instructorName: user.name,
			booked: sql<number>`(select count(*)::int from ${booking} b where b.session_id = ${classSession.id} and b.status = 'booked')`
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				isNotNull(classSession.coverRequestedAt),
				isNull(classSession.cancelledAt),
				gt(classSession.startsAt, new Date()),
				me ? ne(classSession.instructorId, me.id) : undefined
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(10);
}

/** Staff claims a cover request: they become the session's instructor, which
 * clears the flag and emails booked members — all inside updateSession. */
export async function claimCover(ctx: OrgContext, tz: string, sessionId: string) {
	const [me] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
	if (!me) error(403, 'Only staff can cover classes');
	const [s] = await db
		.select({
			coverRequestedAt: classSession.coverRequestedAt,
			startsAt: classSession.startsAt,
			cancelledAt: classSession.cancelledAt,
			instructorId: classSession.instructorId,
			className: classType.name
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, sessionId)));
	if (!s) error(404, 'Session not found');
	if (s.cancelledAt) error(409, 'That session was cancelled');
	if (s.startsAt <= new Date()) error(409, 'That session already started');
	if (!s.coverRequestedAt) error(409, 'Already covered');
	if (s.instructorId === me.id) error(409, 'You already teach it');
	const row = await updateSession(ctx, tz, { id: sessionId, instructorId: me.id });
	return { session: row, className: s.className };
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
				note: input.note ?? null,
				checkinCode: sessionCode()
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
	if (set.needsCover && !prev.coverRequestedAt) {
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'session',
			entityId: id,
			action: 'cover_requested',
			summary: 'Cover requested'
		});
		sendCoverRequests(ctx.orgId, id, row.coverRequestedAt ?? new Date()).catch(() => {});
	}
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

export async function activeMembership(orgId: string, memberId: string) {
	const [row] = await db
		.select({
			membership,
			classCredits: plan.classCredits,
			interval: plan.interval,
			isPack: plan.isPack,
			bookAheadDays: plan.bookAheadDays
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
	opts?: { notify?: boolean; skipDailyLimit?: boolean }
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
		.select({
			tz: gymSettings.timezone,
			maxPerDay: gymSettings.maxBookingsPerDay,
			firstClassFree: gymSettings.firstClassFree
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));

	const { row, dropInInfo } = await db.transaction(async (tx) => {
		const [s] = await tx
			.select({
				capacity: classSession.capacity,
				cancelledAt: classSession.cancelledAt,
				startsAt: classSession.startsAt,
				dropInPrice: classType.dropInPrice,
				waitlistLimit: classType.waitlistLimit,
				className: classType.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, input.sessionId)))
			.for('update');
		if (!s) error(404, 'Session not found');
		if (s.cancelledAt) error(409, 'This session is cancelled');
		if (input.dropIn && (s.dropInPrice == null || s.dropInPrice <= 0))
			error(409, `No drop-in price set on ${s.className}`);
		// "First class free": a member's first-ever booking skips the drop-in charge.
		const [{ prior }] = input.dropIn
			? await tx
					.select({ prior: sql<number>`count(*)`.mapWith(Number) })
					.from(booking)
					.where(and(eq(booking.memberId, input.memberId), ne(booking.status, 'cancelled')))
			: [{ prior: 1 }];
		const freeFirst = !!input.dropIn && !!st?.firstClassFree && prior === 0;
		const dropInInfo =
			input.dropIn && !freeFirst ? { className: s.className, price: s.dropInPrice! } : null;

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
		if (
			st?.maxPerDay != null &&
			!opts?.skipDailyLimit &&
			!(existing && existing.status !== 'cancelled')
		) {
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
		if (count >= s.capacity && s.waitlistLimit != null) {
			const [{ waiting }] = await tx
				.select({ waiting: sql<number>`count(*)`.mapWith(Number) })
				.from(booking)
				.where(and(eq(booking.sessionId, input.sessionId), eq(booking.status, 'waitlisted')));
			if (waiting >= s.waitlistLimit) error(409, 'This class and its waitlist are full');
		}
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

/** Preview counts for the instructor-handoff dialog. */
export async function instructorUpcoming(
	orgId: string,
	input: { instructorId: string; classTypeId?: string }
) {
	const [s] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, orgId),
				eq(classSession.instructorId, input.instructorId),
				gt(classSession.startsAt, new Date()),
				isNull(classSession.cancelledAt),
				input.classTypeId ? eq(classSession.classTypeId, input.classTypeId) : undefined
			)
		);
	const [t] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(classTemplate)
		.where(
			and(
				eq(classTemplate.organizationId, orgId),
				eq(classTemplate.instructorId, input.instructorId),
				eq(classTemplate.active, true),
				input.classTypeId ? eq(classTemplate.classTypeId, input.classTypeId) : undefined
			)
		);
	return { sessions: s?.n ?? 0, templates: t?.n ?? 0 };
}

/**
 * "Kate is leaving" — reassign or cancel every future session an instructor
 * teaches, and move (or remove) their recurring templates so new sessions don't
 * keep materializing under them. Each session goes through updateSession so the
 * usual attendee emails, credit refunds and drop-in voids still fire.
 */
export async function instructorHandoff(
	ctx: OrgContext,
	tz: string,
	input: v.InferOutput<typeof s.instructorHandoffInput>
) {
	if (!input.cancel && (!input.toId || input.toId === input.fromId))
		error(400, 'Pick a different instructor to take over');
	const rows = await db
		.select({ id: classSession.id })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				eq(classSession.instructorId, input.fromId),
				gt(classSession.startsAt, new Date()),
				isNull(classSession.cancelledAt),
				input.classTypeId ? eq(classSession.classTypeId, input.classTypeId) : undefined
			)
		);
	for (const r of rows) {
		await updateSession(
			ctx,
			tz,
			input.cancel ? { id: r.id, cancelled: true } : { id: r.id, instructorId: input.toId! }
		);
	}
	const tplWhere = and(
		eq(classTemplate.organizationId, ctx.orgId),
		eq(classTemplate.instructorId, input.fromId),
		eq(classTemplate.active, true),
		input.classTypeId ? eq(classTemplate.classTypeId, input.classTypeId) : undefined
	);
	// Sessions beyond the materialize window regenerate from templates, so the
	// handoff has to touch them too — reassign keeps the class running; cancel
	// removes the rule entirely.
	const tplRows = input.cancel
		? await db.delete(classTemplate).where(tplWhere).returning({ id: classTemplate.id })
		: await db
				.update(classTemplate)
				.set({ instructorId: input.toId! })
				.where(tplWhere)
				.returning({ id: classTemplate.id });
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'instructor',
		entityId: input.fromId,
		action: input.cancel ? 'sessions_cancelled' : 'instructor_handoff',
		summary: `${rows.length} upcoming session${rows.length === 1 ? '' : 's'} ${input.cancel ? 'cancelled' : 'reassigned'}`,
		data: {
			fromId: input.fromId,
			toId: input.toId,
			classTypeId: input.classTypeId,
			templates: tplRows.length
		}
	});
	return { sessions: rows.length, templates: tplRows.length };
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
			capacity: input.capacity ?? null,
			until: input.until ?? null
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
			until: set.until ?? null,
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
			note: s.note,
			checkinCode: sessionCode()
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

	// Instructor time-off windows intersecting the horizon — a session generated
	// while its instructor is off auto-flags "needs cover".
	const offs = await db
		.select({
			instructorId: instructorTimeOff.instructorId,
			startDate: instructorTimeOff.startDate,
			endDate: instructorTimeOff.endDate
		})
		.from(instructorTimeOff)
		.where(
			and(
				eq(instructorTimeOff.organizationId, orgId),
				lte(instructorTimeOff.startDate, addDays(today, TEMPLATE_HORIZON_DAYS)),
				gte(instructorTimeOff.endDate, today)
			)
		);
	const isOff = (instructorId: string | null, day: string) =>
		instructorId != null &&
		offs.some((o) => o.instructorId === instructorId && day >= o.startDate && day <= o.endDate);

	const now = Date.now();
	const rows = [];
	for (let i = 0; i <= TEMPLATE_HORIZON_DAYS; i++) {
		const day = addDays(today, i);
		if (closed.has(day)) continue;
		// Noon local avoids the DST edge where the day has no midnight.
		const weekday = localWeekday(zonedToUtc(`${day}T12:00`, tz), tz);
		for (const { template: tpl, classType: ct } of templates) {
			if (tpl.weekday !== weekday) continue;
			// Seasonal classes stop generating past their end date.
			if (tpl.until && day > tpl.until) continue;
			const startsAt = zonedToUtc(`${day}T${tpl.startTime}`, tz);
			if (startsAt.getTime() < now || have.has(`${tpl.id}|${startsAt.getTime()}`)) continue;
			have.add(`${tpl.id}|${startsAt.getTime()}`);
			const instructorId = tpl.instructorId ?? ct.instructorId;
			rows.push({
				organizationId: orgId,
				classTypeId: tpl.classTypeId,
				locationId: tpl.locationId ?? ct.locationId,
				instructorId,
				templateId: tpl.id,
				startsAt,
				endsAt: new Date(startsAt.getTime() + ct.durationMin * 60_000),
				capacity: tpl.capacity ?? ct.capacity,
				coverRequestedAt: isOff(instructorId, day) ? new Date() : null,
				checkinCode: sessionCode()
			});
		}
	}
	if (!rows.length) return 0;
	const inserted = await db
		.insert(classSession)
		.values(rows)
		.returning({ id: classSession.id, coverRequestedAt: classSession.coverRequestedAt });
	for (const s of inserted)
		if (s.coverRequestedAt) sendCoverRequests(orgId, s.id, s.coverRequestedAt).catch(() => {});
	return inserted.length;
}

/** Instructor time-off windows overlapping any interval's org-local day. */
export async function instructorTimeOffConflicts(
	orgId: string,
	instructorId: string,
	intervals: { start: Date; end: Date }[],
	tz: string
) {
	if (!intervals.length) return [] as { startDate: string; endDate: string; note: string }[];
	const offs = await db
		.select({
			startDate: instructorTimeOff.startDate,
			endDate: instructorTimeOff.endDate,
			note: instructorTimeOff.note
		})
		.from(instructorTimeOff)
		.where(
			and(
				eq(instructorTimeOff.organizationId, orgId),
				eq(instructorTimeOff.instructorId, instructorId)
			)
		);
	return offs.filter((o) =>
		intervals.some((i) => {
			const d = localDate(i.start, tz);
			return d >= o.startDate && d <= o.endDate;
		})
	);
}

/** Non-cancelled sessions one instructor is already teaching that overlap any given interval. */
export async function instructorConflicts(
	orgId: string,
	instructorId: string,
	intervals: { start: Date; end: Date }[],
	excludeSessionId?: string
) {
	if (!intervals.length) return [];
	return db
		.select({
			id: classSession.id,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			className: classType.name
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				eq(classSession.instructorId, instructorId),
				isNull(classSession.cancelledAt),
				excludeSessionId ? ne(classSession.id, excludeSessionId) : undefined,
				or(
					...intervals.map((i) =>
						and(lt(classSession.startsAt, i.end), gt(classSession.endsAt, i.start))
					)
				)
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(6);
}

// ---------- Instructor time off ----------

async function myMemberId(ctx: OrgContext) {
	const [me] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
	return me?.id ?? null;
}

export async function myTimeOff(ctx: OrgContext) {
	const me = await myMemberId(ctx);
	if (!me) return [];
	return db
		.select()
		.from(instructorTimeOff)
		.where(
			and(eq(instructorTimeOff.organizationId, ctx.orgId), eq(instructorTimeOff.instructorId, me))
		)
		.orderBy(asc(instructorTimeOff.startDate));
}

export async function addTimeOff(ctx: OrgContext, input: v.InferOutput<typeof s.timeOffInput>) {
	const me = await myMemberId(ctx);
	if (!me) error(404, 'No staff record for you in this workspace');
	if (input.endDate < input.startDate) error(400, 'End date must be on or after the start date');
	const [row] = await db
		.insert(instructorTimeOff)
		.values({
			organizationId: ctx.orgId,
			instructorId: me,
			startDate: input.startDate,
			endDate: input.endDate,
			note: input.note ?? ''
		})
		.returning();
	// Flag already-scheduled sessions inside the window as needing cover.
	const tz = (await getSettings(ctx.orgId)).timezone;
	const upcoming = await db
		.select({ id: classSession.id, startsAt: classSession.startsAt })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				eq(classSession.instructorId, me),
				isNull(classSession.cancelledAt),
				isNull(classSession.coverRequestedAt),
				gte(classSession.startsAt, new Date())
			)
		);
	for (const sess of upcoming) {
		const d = localDate(sess.startsAt, tz);
		if (d < input.startDate || d > input.endDate) continue;
		await db
			.update(classSession)
			.set({ coverRequestedAt: new Date() })
			.where(eq(classSession.id, sess.id));
		sendCoverRequests(ctx.orgId, sess.id, new Date()).catch(() => {});
	}
	return row;
}

export async function removeTimeOff(ctx: OrgContext, id: string) {
	const me = await myMemberId(ctx);
	if (!me) error(404, 'No staff record for you in this workspace');
	await db
		.delete(instructorTimeOff)
		.where(
			and(
				eq(instructorTimeOff.organizationId, ctx.orgId),
				eq(instructorTimeOff.id, id),
				eq(instructorTimeOff.instructorId, me)
			)
		);
}
