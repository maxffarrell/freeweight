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
	memberLevel,
	instructorQual,
	booking,
	charge,
	checkIn,
	classSession,
	classTemplate,
	classType,
	classVideo,
	closure,
	courseEnrollment,
	gymMember,
	gymSettings,
	instructorAvailability,
	instructorTimeOff,
	location,
	member,
	membership,
	plan,
	sessionFeedback,
	user,
	workoutResult
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
import { addDays, localDate, localMinutes, localTime, localWeekday, zonedToUtc } from '#lib/tz.ts';
import { formatMoney, todayISO } from '#lib/format.ts';
import { nextPeriod, postMembershipCharge } from './billing.ts';
import { getSettings } from './settings.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Class types ----------

// ---------- Movement video library (per class type) ----------

export async function listClassVideos(orgId: string) {
	return db
		.select({ video: classVideo, className: classType.name })
		.from(classVideo)
		.innerJoin(classType, eq(classVideo.classTypeId, classType.id))
		.where(eq(classVideo.organizationId, orgId))
		.orderBy(asc(classType.name), asc(classVideo.title));
}

export async function addClassVideo(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.classVideoInput>
) {
	const [t] = await db
		.select({ id: classType.id })
		.from(classType)
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, input.classTypeId)));
	if (!t) error(404, 'Class type not found');
	const [row] = await db
		.insert(classVideo)
		.values({
			organizationId: ctx.orgId,
			classTypeId: input.classTypeId,
			title: input.title,
			url: input.url
		})
		.returning();
	return row;
}

export async function deleteClassVideo(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(classVideo)
		.where(and(eq(classVideo.organizationId, ctx.orgId), eq(classVideo.id, id)))
		.returning();
	if (!row) error(404, 'Video not found');
}

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
			minLevelId: input.minLevelId ?? null,
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

/** Spots taken — a booking occupies 1 + its guest seats. */
const bookedCount = (sessionId: AnyPgColumn) =>
	sql<number>`(select count(*) + coalesce(sum(b.guest_count), 0) from ${booking} b where b.session_id = ${sessionId} and b.status = 'booked')`.mapWith(
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
			booked: sql<number>`(select count(*)::int + coalesce(sum(b.guest_count), 0)::int from ${booking} b where b.session_id = ${classSession.id} and b.status = 'booked')`
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
				me ? or(ne(classSession.instructorId, me.id), isNull(classSession.instructorId)) : undefined
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
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'session',
		entityId: sessionId,
		action: 'cover_claimed',
		summary: `Cover claimed — ${s.className}`
	});
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
		.select({
			booking,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			resultScore: workoutResult.score,
			resultRx: workoutResult.asRx,
			// First-timer: no prior check-in or attended booking at this org.
			firstTimer:
				sql<boolean>`not exists (select 1 from ${checkIn} ci where ci.member_id = ${gymMember.id} and ci.organization_id = ${orgId}) and not exists (select 1 from ${booking} b2 where b2.member_id = ${gymMember.id} and b2.organization_id = ${orgId} and b2.status = 'attended')`.mapWith(
					Boolean
				)
		})
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.leftJoin(
			workoutResult,
			and(
				eq(workoutResult.sessionId, booking.sessionId),
				eq(workoutResult.memberId, booking.memberId)
			)
		)
		.where(and(eq(booking.organizationId, orgId), eq(booking.sessionId, sessionId)))
		.orderBy(asc(booking.createdAt));
}

/** Staff note on a roster row — saved on blur in the roster dialog. */
export async function setBookingNote(ctx: OrgContext, bookingId: string, note: string | null) {
	const [row] = await db
		.update(booking)
		.set({ note })
		.where(and(eq(booking.id, bookingId), eq(booking.organizationId, ctx.orgId)))
		.returning({ sessionId: booking.sessionId });
	if (!row) error(404, 'Booking not found');
	return { ok: true };
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
			workout: set.workout,
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
	if (set.cancelled && set.rebookNext) {
		// Next upcoming session of the same class — members get booked into it.
		const [next] = await db
			.select({ id: classSession.id, startsAt: classSession.startsAt })
			.from(classSession)
			.where(
				and(
					eq(classSession.organizationId, ctx.orgId),
					eq(classSession.classTypeId, row.classTypeId),
					isNull(classSession.cancelledAt),
					gt(classSession.startsAt, row.startsAt)
				)
			)
			.orderBy(asc(classSession.startsAt))
			.limit(1);
		if (next) {
			const booked = await db
				.select({ memberId: booking.memberId })
				.from(booking)
				.where(
					and(
						eq(booking.organizationId, ctx.orgId),
						eq(booking.sessionId, id),
						eq(booking.status, 'booked')
					)
				);
			let moved = 0;
			for (const b of booked) {
				try {
					await bookSession(ctx, { sessionId: next.id, memberId: b.memberId }, ctx.userId, {
						skipDailyLimit: true
					});
					moved++;
				} catch {
					// Full, duplicate, or no entitlement — the cancel email already went out.
				}
			}
			await emit({
				orgId: ctx.orgId,
				actorId: ctx.userId,
				entityType: 'session',
				entityId: id,
				action: 'rebooked',
				summary: `${moved}/${booked.length} booked members moved to the next session`
			});
		}
	}
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
					.select({
						n: sql<number>`count(*) + coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
					})
					.from(booking)
					.where(and(eq(booking.sessionId, id), eq(booking.status, 'booked')));
				let free = row.capacity - booked;
				if (free <= 0) return [] as string[];
				const waiters = await tx
					.select({ id: booking.id, guestCount: booking.guestCount })
					.from(booking)
					.where(and(eq(booking.sessionId, id), eq(booking.status, 'waitlisted')))
					.orderBy(asc(booking.createdAt))
					.limit(free)
					.for('update');
				if (!waiters.length) return [] as string[];
				// A booking needs 1 + guestCount seats — skip parties that don't fit
				// so a smaller party behind them can still take the spot.
				const fit = waiters.filter((w) => {
					const ok = 1 + w.guestCount <= free;
					if (ok) free -= 1 + w.guestCount;
					return ok;
				});
				if (!fit.length) return [] as string[];
				await tx
					.update(booking)
					.set({ status: 'booked' })
					.where(
						inArray(
							booking.id,
							fit.map((w) => w.id)
						)
					);
				return fit.map((w) => w.id);
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

/** Every live membership a member holds — a plan plus one or more packs. */
export async function activeMemberships(orgId: string, memberId: string) {
	return db
		.select({
			membership,
			classCredits: plan.classCredits,
			interval: plan.interval,
			isPack: plan.isPack,
			classTypeId: plan.classTypeId,
			bookAheadDays: plan.bookAheadDays,
			guestPasses: plan.guestPasses
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
		.orderBy(desc(membership.createdAt));
}

/** The membership a member is billed against for display (newest wins). */
export async function activeMembership(orgId: string, memberId: string) {
	return (await activeMemberships(orgId, memberId))[0];
}

/**
 * Daily housekeeping: 'booked' rows for sessions that already ended become 'no_show'
 * (check-ins have already flipped attendees to 'attended'). Cancelled sessions skip.
 */
export async function markPastNoShows(orgId: string, sessionId?: string) {
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
				isNull(classSession.cancelledAt),
				sessionId ? eq(classSession.id, sessionId) : undefined
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
	classTypeId: string | null;
	guestPasses: number | null;
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

export async function creditsUsedIn(
	orgId: string,
	memberId: string | null,
	membershipId: string,
	window: { start: string; end: string },
	classTypeId?: string | null,
	q: Pick<typeof db, 'select'> = db
) {
	const [{ count }] = await q
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				// null counts every booking charged to this membership — shared
				// family packs let dependents drain a guardian's pack.
				memberId ? eq(booking.memberId, memberId) : undefined,
				inArray(booking.status, [...CREDIT_STATUSES]),
				// A cancelled class gives the credit back.
				isNull(classSession.cancelledAt),
				or(
					// New bookings are attributed to the membership that granted them, so a
					// plan + pack member only drains the entitlement that paid.
					eq(booking.membershipId, membershipId),
					// Pre-attribution rows still count by window (and class for a restricted pack).
					and(
						isNull(booking.membershipId),
						classTypeId ? eq(classSession.classTypeId, classTypeId) : undefined,
						gte(classSession.startsAt, new Date(`${window.start}T00:00:00Z`)),
						lt(classSession.startsAt, new Date(`${window.end}T00:00:00Z`))
					)
				)
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
	const used = await creditsUsedIn(
		orgId,
		memberId,
		ms.membership.id,
		creditWindow(ms),
		ms.isPack ? ms.classTypeId : null
	);
	const [ct] =
		ms.isPack && ms.classTypeId
			? await db
					.select({ name: classType.name })
					.from(classType)
					.where(eq(classType.id, ms.classTypeId))
			: [null];
	return {
		used,
		limit: ms.classCredits + ms.membership.bonusCredits,
		bonus: ms.membership.bonusCredits,
		membershipId: ms.membership.id,
		/** Set on a class-type pack — UI shows "of your {className} pack". */
		className: ct?.name ?? null
	};
}

/**
 * Daily sweep: active pack memberships down to ≤2 remaining credits get one
 * nudge email each (once per membership via notification_log — a new pack
 * purchase is a new membership, so the nudge re-arms naturally).
 */
export async function sendPackLowCreditNudges(orgId: string) {
	const packs = await db
		.select({
			ms: membership,
			memberId: membership.memberId,
			classCredits: plan.classCredits,
			classTypeId: plan.classTypeId
		})
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
		const used = await creditsUsedIn(orgId, p.memberId, p.ms.id, window, p.classTypeId);
		const limit = (p.classCredits ?? 0) + p.ms.bonusCredits;
		const remaining = limit - used;
		if (remaining <= 2 && remaining >= 0) {
			if (await notifyPackLowCredit(orgId, p.memberId, remaining, limit, p.ms.id)) n++;
		}
	}
	return n;
}

/**
 * Pack auto-renew: a pack membership with `autoRenew` that expired or burned its
 * last credit spawns a fresh identical membership (fresh credit window + expiry)
 * and posts the pack charge — the member never loses booking access. The old
 * membership stays 'active' but spent; entitlement selection already skips it.
 * Runs in the daily cron.
 */
export async function renewExpiredPacks(orgId: string) {
	const packs = await db
		.select({ ms: membership, plan })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(membership.autoRenew, true),
				eq(plan.isPack, true)
			)
		);
	let renewed = 0;
	for (const { ms, plan: p } of packs) {
		const expired = ms.endsAt != null && ms.endsAt < new Date();
		let exhausted = false;
		if (!expired && p.classCredits != null) {
			const used = await creditsUsedIn(
				orgId,
				ms.memberId,
				ms.id,
				{
					start: ms.startsAt.toISOString().slice(0, 10),
					end: (ms.endsAt ?? new Date()).toISOString().slice(0, 10)
				},
				p.classTypeId
			);
			exhausted = used >= p.classCredits + ms.bonusCredits;
		}
		if (!expired && !exhausted) continue;
		const start = todayISO();
		const [row] = await db
			.insert(membership)
			.values({
				organizationId: orgId,
				memberId: ms.memberId,
				planId: p.id,
				autoRenew: true,
				price: ms.price,
				endsAt: p.packDays
					? new Date(new Date(`${start}T00:00:00Z`).getTime() + p.packDays * 86400_000)
					: null
			})
			.returning();
		// Stop the spent pack renewing alongside its replacement.
		await db.update(membership).set({ autoRenew: false }).where(eq(membership.id, ms.id));
		await postMembershipCharge(orgId, row!.id, start, p);
		await emit({
			orgId,
			entityType: 'membership',
			entityId: row!.id,
			action: 'created',
			summary: `Auto-renewed pack "${p.name}"`,
			data: { memberId: ms.memberId }
		});
		renewed++;
	}
	return renewed;
}

/**
 * Which membership pays for a booking on this class type. Order: a restricted
 * pack matching the class (the pack exists for exactly this), then a recurring
 * plan, then an unrestricted pack — generic punch credits are the fallback so
 * they aren't drained by visits the plan already covers. Exhausted
 * memberships are skipped for the next eligible one; when none qualify, 402s
 * (class mismatch when only restricted packs exist, else credits used up).
 */
async function pickEntitlement(
	q: Pick<typeof db, 'select'>,
	orgId: string,
	memberId: string | null,
	mss: ActiveMembership[],
	classTypeId: string,
	className: string
) {
	const eligible = mss.filter(
		(ms) => !ms.isPack || !ms.classTypeId || ms.classTypeId === classTypeId
	);
	if (!eligible.length) error(402, `Your pack doesn't cover ${className} classes`);
	const ordered = [
		...eligible.filter((ms) => ms.isPack && ms.classTypeId),
		...eligible.filter((ms) => !ms.isPack),
		...eligible.filter((ms) => ms.isPack && !ms.classTypeId)
	];
	let exhausted: ActiveMembership | null = null;
	for (const ms of ordered) {
		if (ms.classCredits == null) return ms;
		const used = await creditsUsedIn(
			orgId,
			memberId,
			ms.membership.id,
			creditWindow(ms),
			ms.isPack ? ms.classTypeId : null,
			q
		);
		const limit = ms.classCredits + ms.membership.bonusCredits;
		if (used < limit) return ms;
		exhausted ??= ms;
	}
	const ms = exhausted!;
	error(
		402,
		ms.isPack
			? `All ${ms.classCredits! + ms.membership.bonusCredits} classes used in this pack`
			: `All ${ms.classCredits! + ms.membership.bonusCredits} classes used for this period`
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
	opts?: { notify?: boolean; skipDailyLimit?: boolean; compFrom?: string }
) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	let mss = await activeMemberships(ctx.orgId, input.memberId);
	// Family packs: a dependent with no own membership may book from the
	// guardian's — credits then count across the whole household.
	let sharedPack = false;
	if (!mss.length && m.guardianId && !input.dropIn) {
		const gm = await activeMemberships(ctx.orgId, m.guardianId);
		if (gm.length) {
			mss = gm;
			sharedPack = true;
		}
	}
	// Staff-side drop-in: no membership required, the class's drop-in
	// charge posts to the member's balance instead.
	if (!mss.length && !input.dropIn && !opts?.compFrom)
		error(402, 'An active membership is required to book');

	const [st] = await db
		.select({
			tz: gymSettings.timezone,
			maxPerDay: gymSettings.maxBookingsPerDay,
			firstClassFree: gymSettings.firstClassFree
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));

	const { row, dropInInfo, guestCharge } = await db.transaction(async (tx) => {
		const [s] = await tx
			.select({
				capacity: classSession.capacity,
				cancelledAt: classSession.cancelledAt,
				startsAt: classSession.startsAt,
				classTypeId: classSession.classTypeId,
				dropInPrice: classType.dropInPrice,
				waitlistLimit: classType.waitlistLimit,
				minLevelId: classType.minLevelId,
				className: classType.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, input.sessionId)))
			.for('update');
		if (!s) error(404, 'Session not found');
		if (s.cancelledAt) error(409, 'This session is cancelled');
		// Level gate: gated classes need the member to hold at least the
		// required progression level (compare rank order).
		if (s.minLevelId) {
			const [gate] = await tx
				.select({ sort: memberLevel.sortOrder, name: memberLevel.name })
				.from(memberLevel)
				.where(eq(memberLevel.id, s.minLevelId));
			const [held] = m.skillLevelId
				? await tx
						.select({ sort: memberLevel.sortOrder })
						.from(memberLevel)
						.where(eq(memberLevel.id, m.skillLevelId))
				: [undefined];
			if (!gate || !held || held.sort < gate.sort)
				error(409, `${s.className} requires ${gate?.name ?? 'a higher level'}`);
		}
		// Makeup booking: compFrom marks a free replacement for a booking the
		// member lost to a gym-side cancellation (same class, no credit drain).
		let compFrom: string | null = null;
		if (opts?.compFrom) {
			if (input.dropIn) error(400, 'A makeup booking cannot be a drop-in');
			const [src] = await tx
				.select({
					status: booking.status,
					sessionCancelled: classSession.cancelledAt,
					srcClassTypeId: classSession.classTypeId
				})
				.from(booking)
				.innerJoin(classSession, eq(booking.sessionId, classSession.id))
				.where(
					and(
						eq(booking.id, opts.compFrom),
						eq(booking.memberId, input.memberId),
						eq(booking.organizationId, ctx.orgId)
					)
				)
				.for('update');
			if (!src || src.status !== 'booked' || !src.sessionCancelled)
				error(409, 'Only a booking lost to a class cancellation earns a makeup');
			if (src.srcClassTypeId !== s.classTypeId)
				error(409, 'Makeup bookings must be for the same class');
			compFrom = opts.compFrom;
		}
		// Which membership pays for this booking — restricted pack for its own
		// class first, then a plan, then an open pack. Drop-ins and makeups
		// never drain credits.
		const ms =
			input.dropIn || compFrom
				? null
				: await pickEntitlement(
						tx,
						ctx.orgId,
						sharedPack ? null : input.memberId,
						mss,
						s.classTypeId,
						s.className
					);
		if (input.dropIn && (s.dropInPrice == null || s.dropInPrice <= 0))
			error(409, `No drop-in price set on ${s.className}`);
		// "First class free": a member's first-ever booking skips the drop-in charge.
		const [{ prior }] = input.dropIn
			? await tx
					.select({ prior: sql<number>`count(*)`.mapWith(Number) })
					.from(booking)
					.where(and(eq(booking.memberId, input.memberId), ne(booking.status, 'cancelled')))
			: [{ prior: 1 }];
		// Rebook if they cancelled before, else insert fresh.
		const [existing] = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, input.sessionId), eq(booking.memberId, input.memberId)));
		const existingId = existing?.id ?? 'none';
		const guests = Math.max(0, Math.min(5, input.guests ?? 0));
		const freeFirst = !!input.dropIn && !!st?.firstClassFree && prior === 0;
		const seats = 1 + guests;
		const dropInInfo =
			input.dropIn && !freeFirst
				? {
						className: s.className,
						price: s.dropInPrice! * seats,
						// "(×3)" suffix on the charge line when guests ride along.
						seats
					}
				: null;
		// Guests ride the member's monthly guest-pass allowance first (shared with
		// kiosk guest check-ins); seats beyond it bill at the class's drop-in price.
		let guestCharge: { seats: number; price: number } | null = null;
		if (!input.dropIn && guests > 0) {
			const cap = Math.max(0, ...mss.map((x) => x.guestPasses ?? 0));
			const month = s.startsAt.toISOString().slice(0, 7);
			const [{ usedCk }] = await tx
				.select({ usedCk: sql<number>`count(*)`.mapWith(Number) })
				.from(checkIn)
				.where(
					and(
						eq(checkIn.organizationId, ctx.orgId),
						eq(checkIn.memberId, input.memberId),
						isNotNull(checkIn.guestName),
						sql`date_trunc('month', ${checkIn.checkedAt}) = ${month + '-01'}::date`
					)
				);
			const [{ usedBk }] = await tx
				.select({
					usedBk: sql<number>`coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
				})
				.from(booking)
				.innerJoin(classSession, eq(booking.sessionId, classSession.id))
				.where(
					and(
						eq(booking.organizationId, ctx.orgId),
						eq(booking.memberId, input.memberId),
						ne(booking.status, 'cancelled'),
						ne(booking.id, existingId),
						sql`date_trunc('month', ${classSession.startsAt}) = ${month + '-01'}::date`
					)
				);
			const paidGuests = Math.max(0, guests - Math.max(0, cap - usedCk - usedBk));
			if (paidGuests > 0 && (s.dropInPrice == null || s.dropInPrice <= 0))
				error(
					402,
					cap > 0
						? `${m.name} has used all ${cap} guest passes this month`
						: `${m.name}'s plan doesn't include guest passes`
				);
			if (paidGuests > 0) guestCharge = { seats: paidGuests, price: s.dropInPrice! * paidGuests };
		}

		const [{ count }] = await tx
			.select({
				count: sql<number>`count(*) + coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
			})
			.from(booking)
			.where(and(eq(booking.sessionId, input.sessionId), eq(booking.status, 'booked')));

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

		if (input.dropIn && count + seats > s.capacity)
			error(409, "This class is full — paid drop-ins can't join the waitlist");
		if (count + seats > s.capacity && s.waitlistLimit != null) {
			const [{ waiting }] = await tx
				.select({ waiting: sql<number>`count(*)`.mapWith(Number) })
				.from(booking)
				.where(and(eq(booking.sessionId, input.sessionId), eq(booking.status, 'waitlisted')));
			if (waiting >= s.waitlistLimit) error(409, 'This class and its waitlist are full');
		}
		const status = count + seats > s.capacity ? 'waitlisted' : 'booked';
		if (existing) {
			if (existing.status !== 'cancelled') error(409, 'Already booked');
			const [row] = await tx
				.update(booking)
				.set({
					status,
					cancelledAt: null,
					createdAt: new Date(),
					membershipId: ms?.membership.id ?? null,
					guestCount: guests,
					compBookingId: compFrom
				})
				.where(eq(booking.id, existing.id))
				.returning();
			return { row: row!, dropInInfo, guestCharge };
		}
		const [row] = await tx
			.insert(booking)
			.values({
				organizationId: ctx.orgId,
				sessionId: input.sessionId,
				memberId: input.memberId,
				membershipId: ms?.membership.id ?? null,
				guestCount: guests,
				compBookingId: compFrom,
				status
			})
			.returning();
		return { row: row!, dropInInfo, guestCharge };
	});
	if (dropInInfo) {
		const [c] = await db
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				memberId: input.memberId,
				kind: 'dropin',
				description: `${dropInInfo.className} drop-in${dropInInfo.seats > 1 ? ` (×${dropInInfo.seats})` : ''}`,
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
	// Guests beyond the member's pass allowance bill at the drop-in price.
	if (guestCharge) {
		const [c] = await db
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				memberId: input.memberId,
				kind: 'dropin',
				description: `Guest drop-in ×${guestCharge.seats}`,
				amount: guestCharge.price,
				dueDate: todayISO()
			})
			.returning({ id: charge.id });
		await db.update(booking).set({ chargeId: c!.id }).where(eq(booking.id, row.id));
		notifyChargePosted(ctx.orgId, c!.id).catch(() => {});
	}
	await emit({
		orgId: ctx.orgId,
		actorId: actorId ?? ctx.userId,
		entityType: 'booking',
		entityId: row.id,
		action: row.status === 'waitlisted' ? 'waitlisted' : 'booked',
		summary: `${m.name} ${row.status === 'waitlisted' ? 'joined the waitlist' : 'booked a class'}${row.guestCount ? ` (+${row.guestCount} guest${row.guestCount > 1 ? 's' : ''})` : ''}`,
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
	const { promoted, lateCancel, lateFeeForgiven } = await db.transaction(async (tx) => {
		// Read status before updating — the returning row is always 'cancelled'.
		const [prev] = await tx
			.select({
				status: booking.status,
				chargeId: booking.chargeId,
				guestCount: booking.guestCount
			})
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
		if (prev.status !== 'booked')
			return { promoted: null, lateCancel: null, lateFeeForgiven: false };

		const [[sess], [st]] = await Promise.all([
			tx
				.select({
					startsAt: classSession.startsAt,
					cancelledAt: classSession.cancelledAt,
					capacity: classSession.capacity,
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
					lateCancelFreebies: gymSettings.lateCancelFreebies,
					timezone: gymSettings.timezone
				})
				.from(gymSettings)
				.where(eq(gymSettings.organizationId, ctx.orgId))
		]);
		let lateCancel =
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

		// Forgiveness budget: the first N late cancels a member makes each
		// calendar month skip the fee entirely.
		let lateFeeForgiven = false;
		if (lateCancel && st?.lateCancelFreebies && st.lateCancelFreebies > 0) {
			const tz = st.timezone ?? 'UTC';
			const monthStart = zonedToUtc(`${localDate(new Date(), tz).slice(0, 7)}-01T00:00`, tz);
			const [{ used }] = await tx
				.select({ used: sql<number>`count(*)`.mapWith(Number) })
				.from(charge)
				.where(
					and(
						eq(charge.memberId, b.memberId),
						eq(charge.kind, 'other'),
						sql`${charge.description} like 'Late-cancel fee%'`,
						gte(charge.createdAt, monthStart)
					)
				);
			if ((used ?? 0) < st.lateCancelFreebies) {
				// $0 void marker keeps the forgiven cancel countable for the
				// budget without touching the member's balance or revenue sums.
				await tx.insert(charge).values({
					organizationId: ctx.orgId,
					memberId: b.memberId,
					kind: 'other',
					description: `Late-cancel fee — forgiven — ${sess.className} ${localDate(sess.startsAt, st.timezone ?? 'UTC')}`,
					amount: 0,
					status: 'void',
					dueDate: todayISO()
				});
				lateCancel = null;
				lateFeeForgiven = true;
			}
		}

		// Don't promote when the class is about to start — the member can't
		// realistically make it. The spot just opens for walk-in booking.
		if (st?.cutoff && sess && sess.startsAt.getTime() - Date.now() < st.cutoff * 60_000)
			return { promoted: null, lateCancel, lateFeeForgiven };

		// First waitlisted party that fits the freed seats — a bigger party is
		// skipped rather than blocking the queue behind it.
		const freed = 1 + prev.guestCount;
		const [{ spots }] = await tx
			.select({
				spots: sql<number>`count(*) + coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
			})
			.from(booking)
			.where(and(eq(booking.sessionId, b.sessionId), eq(booking.status, 'booked')));
		const free = (sess?.capacity ?? 0) - spots;
		if (free <= 0) return { promoted: null, lateCancel, lateFeeForgiven };
		const waiters = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, b.sessionId), eq(booking.status, 'waitlisted')))
			.orderBy(asc(booking.createdAt))
			.limit(freed + 2);
		const next = waiters.find((w) => 1 + w.guestCount <= free);
		if (!next) return { promoted: null, lateCancel, lateFeeForgiven };
		await tx.update(booking).set({ status: 'booked' }).where(eq(booking.id, next.id));
		return { promoted: next, lateCancel, lateFeeForgiven };
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
	return { ...b, lateFeeApplied: lateCancel != null, lateFeeForgiven };
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
	const inserted = await db.insert(classSession).values(rows).returning({
		id: classSession.id,
		templateId: classSession.templateId,
		capacity: classSession.capacity,
		coverRequestedAt: classSession.coverRequestedAt
	});
	for (const s of inserted)
		if (s.coverRequestedAt) sendCoverRequests(orgId, s.id, s.coverRequestedAt).catch(() => {});

	// Course-linked templates book every enrollee into each generated session —
	// keeps a multi-week course full as the horizon window slides forward.
	const courseByTpl = new Map(
		templates
			.filter((t) => t.template.courseId)
			.map((t) => [t.template.id, t.template.courseId!] as const)
	);
	const courseSess = inserted.filter((s) => s.templateId && courseByTpl.has(s.templateId));
	if (courseSess.length) {
		const courseIds = [...new Set(courseSess.map((s) => courseByTpl.get(s.templateId!)!))];
		const enrollees = await db
			.select({ courseId: courseEnrollment.courseId, memberId: courseEnrollment.memberId })
			.from(courseEnrollment)
			.where(inArray(courseEnrollment.courseId, courseIds));
		for (const sess of courseSess) {
			const cid = courseByTpl.get(sess.templateId!)!;
			let n = 0;
			for (const e of enrollees) {
				if (e.courseId !== cid) continue;
				await db.insert(booking).values({
					organizationId: orgId,
					sessionId: sess.id,
					memberId: e.memberId,
					status: n < sess.capacity ? 'booked' : 'waitlisted'
				});
				n++;
			}
		}
	}
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

// ---------- Instructor availability ----------

export async function myAvailability(ctx: OrgContext) {
	const me = await myMemberId(ctx);
	if (!me) return [];
	return db
		.select({
			id: instructorAvailability.id,
			weekday: instructorAvailability.weekday,
			startTime: instructorAvailability.startTime,
			endTime: instructorAvailability.endTime
		})
		.from(instructorAvailability)
		.where(
			and(
				eq(instructorAvailability.organizationId, ctx.orgId),
				eq(instructorAvailability.instructorId, me)
			)
		)
		.orderBy(asc(instructorAvailability.weekday), asc(instructorAvailability.startTime));
}

/** The instructor's own class ratings: average + count across all their sessions,
 * plus recent member comments — powers the "Your ratings" card on My classes. */
export async function myRatings(ctx: OrgContext) {
	const me = await myMemberId(ctx);
	if (!me) return { avg: null, count: 0, recent: [] };
	const [agg] = await db
		.select({
			avg: sql<number>`round(avg(${sessionFeedback.rating})::numeric, 1)`.mapWith(Number),
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(sessionFeedback)
		.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
		.where(and(eq(sessionFeedback.organizationId, ctx.orgId), eq(classSession.instructorId, me)));
	const recent = await db
		.select({
			rating: sessionFeedback.rating,
			comment: sessionFeedback.comment,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(sessionFeedback)
		.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(sessionFeedback.organizationId, ctx.orgId),
				eq(classSession.instructorId, me),
				ne(sessionFeedback.comment, '')
			)
		)
		.orderBy(desc(sessionFeedback.createdAt))
		.limit(6);
	return { avg: agg?.count ? agg.avg : null, count: agg?.count ?? 0, recent };
}

/** Replace the caller's whole weekly availability set (empty = always available). */
export async function setAvailability(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.availabilityInput>
) {
	const me = await myMemberId(ctx);
	if (!me) error(404, 'No staff record for you in this workspace');
	for (const w of input.windows)
		if (w.endTime <= w.startTime) error(400, 'Each window must end after it starts');
	return db.transaction(async (tx) => {
		await tx
			.delete(instructorAvailability)
			.where(
				and(
					eq(instructorAvailability.organizationId, ctx.orgId),
					eq(instructorAvailability.instructorId, me)
				)
			);
		if (!input.windows.length) return [];
		return tx
			.insert(instructorAvailability)
			.values(
				input.windows.map((w) => ({
					organizationId: ctx.orgId,
					instructorId: me,
					weekday: w.weekday,
					startTime: w.startTime,
					endTime: w.endTime
				}))
			)
			.returning();
	});
}

/** Intervals that fall outside every configured weekly window; [] when the instructor set none. */
export async function instructorAvailabilityConflicts(
	orgId: string,
	instructorId: string,
	intervals: { start: Date; end: Date }[],
	tz: string
) {
	if (!intervals.length) return [] as { start: Date; end: Date }[];
	const windows = await db
		.select({
			weekday: instructorAvailability.weekday,
			startTime: instructorAvailability.startTime,
			endTime: instructorAvailability.endTime
		})
		.from(instructorAvailability)
		.where(
			and(
				eq(instructorAvailability.organizationId, orgId),
				eq(instructorAvailability.instructorId, instructorId)
			)
		);
	if (!windows.length) return [];
	const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
	return intervals.filter((i) => {
		const wd = localWeekday(i.start, tz);
		const s = localMinutes(i.start, tz);
		const e = localMinutes(i.end, tz);
		return !windows.some(
			(w) => w.weekday === wd && s >= toMin(w.startTime) && e <= toMin(w.endTime)
		);
	});
}

// ---------- Open slots (availability-driven 1:1/bookable sessions) ----------

/**
 * Generates capacity-N sessions inside an instructor's weekly availability
 * windows — PT/assessment "open slots" members or the desk can book.
 * Steps `classType.durationMin` through each window, skipping gym closures,
 * instructor time-off, past slots, and slots that overlap an existing
 * (non-cancelled) session of that instructor — so re-runs are idempotent.
 */
export async function generateSlots(ctx: OrgContext, input: v.InferOutput<typeof s.slotGenInput>) {
	const [ct] = await db
		.select()
		.from(classType)
		.where(and(eq(classType.id, input.classTypeId), eq(classType.organizationId, ctx.orgId)));
	if (!ct) error(404, 'Class type not found');
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));
	const tz = st?.timezone ?? 'UTC';

	const windows = await db
		.select({
			weekday: instructorAvailability.weekday,
			startTime: instructorAvailability.startTime,
			endTime: instructorAvailability.endTime
		})
		.from(instructorAvailability)
		.where(
			and(
				eq(instructorAvailability.organizationId, ctx.orgId),
				eq(instructorAvailability.instructorId, input.instructorId)
			)
		)
		.orderBy(asc(instructorAvailability.startTime));
	if (!windows.length)
		error(
			404,
			'No availability windows for this instructor — set them on My classes → Availability'
		);

	// Whole-day time-off in the range — skip those days entirely.
	const offs = new Set(
		(
			await db
				.select({ startDate: instructorTimeOff.startDate, endDate: instructorTimeOff.endDate })
				.from(instructorTimeOff)
				.where(
					and(
						eq(instructorTimeOff.organizationId, ctx.orgId),
						eq(instructorTimeOff.instructorId, input.instructorId),
						lte(instructorTimeOff.startDate, input.to),
						gte(instructorTimeOff.endDate, input.from)
					)
				)
		).flatMap((o) => {
			const days = [];
			for (let d = o.startDate; d <= o.endDate; d = addDays(d, 1)) days.push(d);
			return days;
		})
	);
	const closed = new Set(
		(
			await db
				.select({ date: closure.date })
				.from(closure)
				.where(
					and(
						eq(closure.organizationId, ctx.orgId),
						gte(closure.date, input.from),
						lte(closure.date, input.to)
					)
				)
		).map((c) => c.date)
	);

	// The instructor's existing sessions in the range — skip overlapping slots.
	const busy = await db
		.select({ startsAt: classSession.startsAt, endsAt: classSession.endsAt })
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, ctx.orgId),
				eq(classSession.instructorId, input.instructorId),
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, zonedToUtc(`${input.from}T00:00`, tz)),
				lt(classSession.startsAt, zonedToUtc(`${addDays(input.to, 1)}T00:00`, tz))
			)
		);

	const now = Date.now();
	const stepMs = ct.durationMin * 60_000;
	const rows = [];
	let skipped = 0;
	for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
		if (closed.has(day) || offs.has(day)) continue;
		const weekday = localWeekday(zonedToUtc(`${day}T12:00`, tz), tz);
		for (const w of windows.filter((x) => x.weekday === weekday)) {
			for (let t = w.startTime; ;) {
				const startsAt = zonedToUtc(`${day}T${t}`, tz);
				const endsAt = new Date(startsAt.getTime() + stepMs);
				// Advance the cursor to the next slot start.
				const [h, m] = w.endTime.split(':').map(Number);
				const windowEnd = zonedToUtc(
					`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
					tz
				);
				if (endsAt > windowEnd) break;
				const next = localMinutes(startsAt, tz) + ct.durationMin;
				t = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
				if (startsAt.getTime() < now) {
					skipped++;
					continue;
				}
				if (busy.some((b) => b.startsAt < endsAt && b.endsAt > startsAt)) {
					skipped++;
					continue;
				}
				rows.push({
					organizationId: ctx.orgId,
					classTypeId: ct.id,
					locationId: ct.locationId,
					instructorId: input.instructorId,
					startsAt,
					endsAt,
					capacity: input.capacity ?? 1,
					checkinCode: sessionCode()
				});
			}
		}
	}
	if (rows.length) await db.insert(classSession).values(rows);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'class_type',
		entityId: ct.id,
		action: 'slots_generated',
		summary: `${rows.length} open ${ct.name} slot${rows.length === 1 ? '' : 's'} generated${skipped ? ` (${skipped} skipped)` : ''}`
	});
	return { created: rows.length, skipped };
}

/**
 * Desk undo for a no-show: flips the booking to 'cancelled' (which frees the
 * credit it consumed — no_show counts toward creditsUsedIn, cancelled doesn't)
 * and voids the matching open "No-show fee — <class> <date>" charge.
 */
export async function forgiveNoShow(ctx: OrgContext, bookingId: string, actorId?: string | null) {
	const [b] = await db
		.select({
			id: booking.id,
			status: booking.status,
			memberId: booking.memberId,
			startsAt: classSession.startsAt,
			className: classType.name
		})
		.from(booking)
		.innerJoin(classSession, eq(classSession.id, booking.sessionId))
		.innerJoin(classType, eq(classType.id, classSession.classTypeId))
		.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.id, bookingId)));
	if (!b || b.status !== 'no_show') error(404, 'No-show booking not found');
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));
	const tz = st?.timezone ?? 'UTC';
	await db.transaction(async (tx) => {
		await tx
			.update(booking)
			.set({ status: 'cancelled', cancelledAt: new Date() })
			.where(eq(booking.id, b.id));
		await tx
			.update(charge)
			.set({ status: 'void', updatedAt: new Date() })
			.where(
				and(
					eq(charge.organizationId, ctx.orgId),
					eq(charge.memberId, b.memberId),
					eq(charge.status, 'open'),
					eq(charge.description, `No-show fee — ${b.className} ${localDate(b.startsAt, tz)}`)
				)
			);
	});
	await emit({
		orgId: ctx.orgId,
		actorId: actorId ?? null,
		entityType: 'booking',
		entityId: b.id,
		action: 'forgiven',
		summary: `Forgave a no-show — ${b.className}`
	});
	return { ok: true };
}

/** Staff qualified per class type — flat rows the dialog groups by type. */
export async function listClassTypeQuals(orgId: string) {
	return db
		.select({ classTypeId: instructorQual.classTypeId, memberId: instructorQual.memberId })
		.from(instructorQual)
		.where(eq(instructorQual.organizationId, orgId));
}

export async function setClassTypeQuals(ctx: OrgContext, classTypeId: string, memberIds: string[]) {
	const [ct] = await db
		.select({ id: classType.id })
		.from(classType)
		.where(and(eq(classType.organizationId, ctx.orgId), eq(classType.id, classTypeId)));
	if (!ct) error(404, 'Class not found');
	await db.transaction(async (tx) => {
		await tx
			.delete(instructorQual)
			.where(
				and(
					eq(instructorQual.organizationId, ctx.orgId),
					eq(instructorQual.classTypeId, classTypeId)
				)
			);
		if (memberIds.length)
			await tx.insert(instructorQual).values(
				memberIds.map((mid) => ({
					organizationId: ctx.orgId,
					classTypeId,
					memberId: mid
				}))
			);
	});
	return { ok: true };
}

/**
 * Printable front-desk day sheet: every session on one local day (org tz) with
 * its booked/attended/waitlisted roster in one grouped read.
 */
export async function daySheet(orgId: string, date: string) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const tz = st?.timezone ?? 'UTC';
	const rows = await db
		.select({
			sessionId: classSession.id,
			className: classType.name,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			instructor: user.name,
			location: location.name,
			cancelled: classSession.cancelledAt,
			note: classSession.note,
			cover: classSession.coverRequestedAt,
			memberName: gymMember.name,
			status: booking.status,
			guests: booking.guestCount
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.leftJoin(
			booking,
			and(
				eq(booking.sessionId, classSession.id),
				inArray(booking.status, ['booked', 'attended', 'waitlisted', 'no_show'])
			)
		)
		.leftJoin(gymMember, eq(booking.memberId, gymMember.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, zonedToUtc(`${date}T00:00`, tz)),
				lt(classSession.startsAt, zonedToUtc(`${addDays(date, 1)}T00:00`, tz))
			)
		)
		.orderBy(asc(classSession.startsAt), asc(gymMember.name));

	const sessions: {
		id: string;
		className: string;
		startsAt: Date;
		endsAt: Date;
		instructor: string | null;
		location: string | null;
		cancelled: boolean;
		note: string | null;
		cover: boolean;
		roster: { name: string; status: string; guests: number }[];
	}[] = [];
	const byId = new Map<string, (typeof sessions)[number]>();
	for (const r of rows) {
		let e = byId.get(r.sessionId);
		if (!e) {
			e = {
				id: r.sessionId,
				className: r.className,
				startsAt: r.startsAt,
				endsAt: r.endsAt,
				instructor: r.instructor,
				location: r.location,
				cancelled: !!r.cancelled,
				note: r.note,
				cover: !!r.cover,
				roster: []
			};
			byId.set(r.sessionId, e);
			sessions.push(e);
		}
		if (r.memberName) e.roster.push({ name: r.memberName, status: r.status!, guests: r.guests ?? 0 });
	}
	return { tz, date, sessions };
}

/**
 * Staff-side move: re-seat a booking into another session of the same class.
 * The desk overrides member-facing rules (cutoffs, booking windows); capacity
 * still applies — a full target puts them on its waitlist. The member gets the
 * new booking confirmation, never a cancellation.
 */
export async function moveBooking(ctx: OrgContext, bookingId: string, newSessionId: string) {
	const [b] = await db
		.select({
			status: booking.status,
			sessionId: booking.sessionId,
			classTypeId: classSession.classTypeId,
			memberName: gymMember.name
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.id, bookingId)));
	if (!b) error(404, 'Booking not found');
	if (b.status !== 'booked' && b.status !== 'waitlisted')
		error(409, 'That booking already ended');
	if (b.sessionId === newSessionId) error(400, 'Already in that session');
	const [target] = await db
		.select({
			id: classSession.id,
			classTypeId: classSession.classTypeId,
			capacity: classSession.capacity,
			startsAt: classSession.startsAt,
			cancelledAt: classSession.cancelledAt
		})
		.from(classSession)
		.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, newSessionId)));
	if (!target) error(404, 'Session not found');
	if (target.cancelledAt) error(409, 'That session is cancelled');
	if (target.classTypeId !== b.classTypeId) error(400, 'Pick a session of the same class');
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.where(
			and(
				eq(booking.organizationId, ctx.orgId),
				eq(booking.sessionId, newSessionId),
				inArray(booking.status, ['booked', 'attended'])
			)
		);
	const status = n < target.capacity ? 'booked' : 'waitlisted';
	await db
		.update(booking)
		.set({ sessionId: newSessionId, status })
		.where(eq(booking.id, bookingId));
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'booking',
		entityId: bookingId,
		action: 'moved',
		summary: `${b.memberName} moved to another session`
	});
	if (status === 'booked') notifyBookingConfirmed(ctx.orgId, bookingId).catch(() => {});
	return { status };
}
