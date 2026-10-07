import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	classSession,
	classType,
	gymMember,
	location,
	member,
	membership,
	plan,
	user
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { notifySessionCancelled, notifyWaitlistPromoted } from './notifications.ts';
import { addDays, zonedToUtc } from '#lib/tz.ts';
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
	const end = new Date(start.getTime() + ct.durationMin * 60_000);
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
				capacity: input.capacity ?? ct.capacity
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
	const [row] = await db
		.update(classSession)
		.set({
			startsAt: set.startsAt ? zonedToUtc(set.startsAt, tz) : undefined,
			capacity: set.capacity,
			locationId: set.locationId,
			instructorId: set.instructorId,
			cancelledAt: set.cancelled === undefined ? undefined : set.cancelled ? new Date() : null
		})
		.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, id)))
		.returning();
	if (!row) error(404, 'Session not found');
	if (set.cancelled) notifySessionCancelled(ctx.orgId, id).catch(() => {});
	// Keep endsAt in step with the class duration when the start moves.
	if (set.startsAt) {
		const [ct] = await db
			.select({ durationMin: classType.durationMin })
			.from(classType)
			.where(eq(classType.id, row.classTypeId));
		await db
			.update(classSession)
			.set({ endsAt: new Date(row.startsAt.getTime() + (ct?.durationMin ?? 60) * 60_000) })
			.where(eq(classSession.id, id));
	}
	return row;
}

// ---------- Bookings ----------

async function activeMembership(orgId: string, memberId: string) {
	const [row] = await db
		.select({ membership, classCredits: plan.classCredits, interval: plan.interval })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active')
			)
		)
		.orderBy(desc(membership.createdAt))
		.limit(1);
	return row;
}

/** Bookings that consume a class credit (cancelled doesn't). */
const CREDIT_STATUSES = ['booked', 'attended', 'no_show'] as const;

type ActiveMembership = {
	classCredits: number | null;
	interval: 'week' | 'month' | 'year';
	membership: { startsAt: Date };
};

/** Current rolling membership period: startsAt stepped forward on the plan's interval. */
function periodWindow(startsAt: Date, interval: 'week' | 'month' | 'year') {
	let start = startsAt.toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);
	while (nextPeriod(start, interval) <= today) start = nextPeriod(start, interval);
	return { start, end: nextPeriod(start, interval) };
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
	const used = await creditsUsedIn(
		orgId,
		memberId,
		periodWindow(ms.membership.startsAt, ms.interval)
	);
	return { used, limit: ms.classCredits };
}

/** 402s when the member's plan caps classes per period and they've used them. */
async function assertCreditAvailable(orgId: string, memberId: string, ms: ActiveMembership) {
	if (ms.classCredits == null) return;
	const used = await creditsUsedIn(
		orgId,
		memberId,
		periodWindow(ms.membership.startsAt, ms.interval)
	);
	if (used >= ms.classCredits) error(402, `All ${ms.classCredits} classes used for this period`);
}

/**
 * Books a member into a session. Full sessions go to the waitlist in order.
 * `FOR UPDATE` on the session row serializes concurrent bookings against capacity.
 */
export async function bookSession(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.bookingInput>,
	actorId?: string | null
) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const ms = await activeMembership(ctx.orgId, input.memberId);
	if (!ms) error(402, 'An active membership is required to book');
	await assertCreditAvailable(ctx.orgId, input.memberId, ms);

	const row = await db.transaction(async (tx) => {
		const [s] = await tx
			.select({ capacity: classSession.capacity, cancelledAt: classSession.cancelledAt })
			.from(classSession)
			.where(and(eq(classSession.organizationId, ctx.orgId), eq(classSession.id, input.sessionId)))
			.for('update');
		if (!s) error(404, 'Session not found');
		if (s.cancelledAt) error(409, 'This session is cancelled');

		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(booking)
			.where(and(eq(booking.sessionId, input.sessionId), eq(booking.status, 'booked')));

		// Rebook if they cancelled before, else insert fresh.
		const [existing] = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, input.sessionId), eq(booking.memberId, input.memberId)));
		const status = count >= s.capacity ? 'waitlisted' : 'booked';
		if (existing) {
			if (existing.status !== 'cancelled') error(409, 'Already booked');
			const [row] = await tx
				.update(booking)
				.set({ status, cancelledAt: null, createdAt: new Date() })
				.where(eq(booking.id, existing.id))
				.returning();
			return row!;
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
		return row!;
	});
	await emit({
		orgId: ctx.orgId,
		actorId: actorId ?? ctx.userId,
		entityType: 'booking',
		entityId: row.id,
		action: row.status === 'waitlisted' ? 'waitlisted' : 'booked',
		summary: `${m.name} ${row.status === 'waitlisted' ? 'joined the waitlist' : 'booked a class'}`,
		data: { sessionId: input.sessionId, memberId: input.memberId }
	});
	return row;
}

/** Cancels a booking and promotes the longest-waiting member, if any. */
export async function cancelBooking(ctx: OrgContext, id: string, actorId?: string | null) {
	const promoted = await db.transaction(async (tx) => {
		// Read status before updating — the returning row is always 'cancelled'.
		const [prev] = await tx
			.select({ status: booking.status })
			.from(booking)
			.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.id, id)))
			.for('update');
		if (!prev || prev.status === 'cancelled') error(404, 'Booking not found');
		const [b] = await tx
			.update(booking)
			.set({ status: 'cancelled', cancelledAt: new Date() })
			.where(eq(booking.id, id))
			.returning();
		if (prev.status !== 'booked') return null;

		const [next] = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, b.sessionId), eq(booking.status, 'waitlisted')))
			.orderBy(asc(booking.createdAt))
			.limit(1);
		if (!next) return null;
		await tx.update(booking).set({ status: 'booked' }).where(eq(booking.id, next.id));
		return next;
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
	if (promoted) await notifyWaitlistPromoted(ctx.orgId, promoted.id).catch(() => {});
	return b;
}

export async function updateBooking(ctx: OrgContext, input: v.InferOutput<typeof s.bookingUpdate>) {
	if (input.status === 'cancelled') return cancelBooking(ctx, input.id);
	const [row] = await db
		.update(booking)
		.set({ status: input.status })
		.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.id, input.id)))
		.returning();
	if (!row) error(404, 'Booking not found');
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
