import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { error } from '@sveltejs/kit';
import { charge, eventRegistration, gymEvent, gymMember, location } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { todayISO } from '#lib/format.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export async function listEvents(orgId: string) {
	const events = await db
		.select({ event: gymEvent, locationName: location.name })
		.from(gymEvent)
		.leftJoin(location, eq(gymEvent.locationId, location.id))
		.where(eq(gymEvent.organizationId, orgId))
		.orderBy(asc(gymEvent.startsAt));
	const counts = await db
		.select({
			eventId: eventRegistration.eventId,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(eventRegistration)
		.where(
			and(eq(eventRegistration.organizationId, orgId), ne(eventRegistration.status, 'cancelled'))
		)
		.groupBy(eventRegistration.eventId);
	const byId = new Map(counts.map((c) => [c.eventId, c.n]));
	return events.map((e) => ({ ...e, registered: byId.get(e.event.id) ?? 0 }));
}

export async function createEvent(
	ctx: OrgContext,
	input: Omit<v.InferOutput<typeof s.eventInput>, 'startsAt'> & {
		startsAt: Date;
		endsAt: Date;
	}
) {
	const [row] = await db
		.insert(gymEvent)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description ?? '',
			locationId: input.locationId ?? null,
			startsAt: input.startsAt,
			endsAt: input.endsAt,
			capacity: input.capacity,
			price: input.price ?? null,
			memberBookable: input.memberBookable,
			active: input.active
		})
		.returning();
	return row;
}

export async function updateEvent(ctx: OrgContext, input: v.InferOutput<typeof s.eventUpdate>) {
	const { id, ...set } = input;
	const [row] = await db
		.update(gymEvent)
		.set({ ...set })
		.where(and(eq(gymEvent.organizationId, ctx.orgId), eq(gymEvent.id, id)))
		.returning();
	if (!row) error(404, 'Event not found');
	return row;
}

/** Upcoming registerable events for the portal, with this member's status. */
export async function memberEvents(orgId: string, memberId: string) {
	const events = await db
		.select({ event: gymEvent, locationName: location.name })
		.from(gymEvent)
		.leftJoin(location, eq(gymEvent.locationId, location.id))
		.where(
			and(
				eq(gymEvent.organizationId, orgId),
				eq(gymEvent.active, true),
				eq(gymEvent.memberBookable, true),
				gte(gymEvent.endsAt, new Date())
			)
		)
		.orderBy(asc(gymEvent.startsAt));
	const [mine, counts] = await Promise.all([
		db
			.select()
			.from(eventRegistration)
			.where(
				and(eq(eventRegistration.memberId, memberId), ne(eventRegistration.status, 'cancelled'))
			),
		db
			.select({ eventId: eventRegistration.eventId, n: sql<number>`count(*)`.mapWith(Number) })
			.from(eventRegistration)
			.where(
				and(eq(eventRegistration.organizationId, orgId), ne(eventRegistration.status, 'cancelled'))
			)
			.groupBy(eventRegistration.eventId)
	]);
	const byEvent = new Map(mine.map((r) => [r.eventId, r]));
	const byCount = new Map(counts.map((c) => [c.eventId, c.n]));
	return events.map((e) => ({
		...e,
		registered: byCount.get(e.event.id) ?? 0,
		myRegistration: byEvent.get(e.event.id) ?? null
	}));
}

/**
 * Register a member for an event. Locked on the event row: enforces capacity
 * and dedupe; posts a signup charge to the payer (guardian-aware) when priced.
 */
export async function registerForEvent(orgId: string, memberId: string, eventId: string) {
	const r = await db.transaction(async (tx) => {
		const [ev] = await tx
			.select()
			.from(gymEvent)
			.where(and(eq(gymEvent.organizationId, orgId), eq(gymEvent.id, eventId)))
			.for('update');
		if (!ev || !ev.active) error(404, 'Event not found');
		if (ev.endsAt.getTime() <= Date.now()) error(409, 'That event already ended');
		const [m] = await tx
			.select({ id: gymMember.id, name: gymMember.name, guardianId: gymMember.guardianId })
			.from(gymMember)
			.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
		if (!m) error(404, 'Member not found');
		const [{ n }] = await tx
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(eventRegistration)
			.where(
				and(eq(eventRegistration.eventId, eventId), ne(eventRegistration.status, 'cancelled'))
			);
		if (n >= ev.capacity) error(409, `${ev.name} is full`);
		const [existing] = await tx
			.select({ id: eventRegistration.id })
			.from(eventRegistration)
			.where(
				and(
					eq(eventRegistration.eventId, eventId),
					eq(eventRegistration.memberId, memberId),
					ne(eventRegistration.status, 'cancelled')
				)
			);
		if (existing) error(409, `${m.name} is already registered`);

		let chargeId: string | null = null;
		if (ev.price && ev.price > 0) {
			const payerId = m.guardianId ?? m.id;
			const forDependent = payerId !== m.id ? ` — ${m.name}` : '';
			const [c] = await tx
				.insert(charge)
				.values({
					organizationId: orgId,
					memberId: payerId,
					kind: 'other',
					description: `Event: ${ev.name}${forDependent}`,
					amount: ev.price,
					dueDate: todayISO()
				})
				.returning({ id: charge.id });
			chargeId = c.id;
		}
		const [row] = await tx
			.insert(eventRegistration)
			.values({ organizationId: orgId, eventId, memberId, chargeId })
			.returning();
		return { registration: row, event: ev, memberName: m.name };
	});
	await emit({
		orgId,
		entityType: 'event_registration',
		entityId: r.registration.id,
		action: 'created',
		summary: `${r.memberName} → ${r.event.name}`
	});
	return r;
}

/** Cancel a registration; an unpaid signup charge is voided with it. */
export async function cancelRegistration(orgId: string, registrationId: string, memberId?: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.update(eventRegistration)
			.set({ status: 'cancelled' })
			.where(
				and(
					eq(eventRegistration.organizationId, orgId),
					eq(eventRegistration.id, registrationId),
					ne(eventRegistration.status, 'cancelled'),
					memberId ? eq(eventRegistration.memberId, memberId) : undefined
				)
			)
			.returning();
		if (!row) error(404, 'Registration not found');
		if (row.chargeId)
			await tx
				.update(charge)
				.set({ status: 'void', updatedAt: new Date() })
				.where(and(eq(charge.id, row.chargeId), eq(charge.status, 'open')));
		return row;
	});
}

/** Staff roster view for one event. */
export async function eventRoster(orgId: string, eventId: string) {
	const [ev] = await db
		.select()
		.from(gymEvent)
		.where(and(eq(gymEvent.organizationId, orgId), eq(gymEvent.id, eventId)));
	if (!ev) error(404, 'Event not found');
	const rows = await db
		.select({ registration: eventRegistration, memberName: gymMember.name })
		.from(eventRegistration)
		.innerJoin(gymMember, eq(eventRegistration.memberId, gymMember.id))
		.where(and(eq(eventRegistration.eventId, eventId), ne(eventRegistration.status, 'cancelled')))
		.orderBy(asc(eventRegistration.createdAt));
	return { event: ev, rows };
}
