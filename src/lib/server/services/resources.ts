import { and, asc, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { error } from '@sveltejs/kit';
import { facilityResource, gymMember, location, resourceBooking } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { localDate, zonedToUtc } from '#lib/tz.ts';
import { getSettings } from './settings.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Resources ----------

export async function listResources(orgId: string) {
	return db
		.select({ resource: facilityResource, locationName: location.name })
		.from(facilityResource)
		.leftJoin(location, eq(facilityResource.locationId, location.id))
		.where(eq(facilityResource.organizationId, orgId))
		.orderBy(asc(facilityResource.name));
}

export async function createResource(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.resourceInput>
) {
	const [row] = await db
		.insert(facilityResource)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			kind: input.kind ?? '',
			description: input.description ?? '',
			slotMin: input.slotMin,
			capacity: input.capacity,
			openFrom: input.openFrom,
			openTo: input.openTo,
			locationId: input.locationId ?? null,
			active: input.active
		})
		.returning();
	return row;
}

export async function updateResource(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.resourceUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(facilityResource)
		.set({ ...set })
		.where(and(eq(facilityResource.organizationId, ctx.orgId), eq(facilityResource.id, id)))
		.returning();
	if (!row) error(404, 'Resource not found');
	return row;
}

/** Slot grid for one org-local date: each slot's UTC bounds + how full it is. */
export async function resourceAvailability(
	orgId: string,
	resourceId: string,
	day: string,
	tz: string
) {
	const [r] = await db
		.select()
		.from(facilityResource)
		.where(
			and(
				eq(facilityResource.organizationId, orgId),
				eq(facilityResource.id, resourceId),
				eq(facilityResource.active, true)
			)
		);
	if (!r) error(404, 'Resource not found');
	// Slots are local-clock times: "sauna at 6pm" keeps its meaning across DST.
	const slots: { startsAt: Date; endsAt: Date; taken: number }[] = [];
	let cur = zonedToUtc(`${day}T${r.openFrom}`, tz);
	const close = zonedToUtc(`${day}T${r.openTo}`, tz);
	while (cur.getTime() + r.slotMin * 60_000 <= close.getTime()) {
		slots.push({
			startsAt: cur,
			endsAt: new Date(cur.getTime() + r.slotMin * 60_000),
			taken: 0
		});
		cur = new Date(cur.getTime() + r.slotMin * 60_000);
	}
	if (!slots.length) return { resource: r, slots };
	const taken = await db
		.select({ startsAt: resourceBooking.startsAt, count: sql<number>`count(*)`.mapWith(Number) })
		.from(resourceBooking)
		.where(
			and(
				eq(resourceBooking.organizationId, orgId),
				eq(resourceBooking.resourceId, resourceId),
				eq(resourceBooking.status, 'booked'),
				lt(resourceBooking.startsAt, slots[slots.length - 1].endsAt),
				gt(resourceBooking.endsAt, slots[0].startsAt)
			)
		)
		.groupBy(resourceBooking.startsAt);
	const byStart = new Map(taken.map((t) => [t.startsAt.getTime(), t.count]));
	for (const slot of slots) slot.taken = byStart.get(slot.startsAt.getTime()) ?? 0;
	return { resource: r, slots };
}

/**
 * Book a slot for a member. Serialized on the resource row; enforces the
 * daily window, lead time, and per-slot capacity.
 */
export async function bookResource(
	orgId: string,
	memberId: string,
	resourceId: string,
	day: string,
	time: string,
	note: string | undefined,
	tz: string
) {
	const st = await getSettings(orgId);
	return db.transaction(async (tx) => {
		const [r] = await tx
			.select()
			.from(facilityResource)
			.where(and(eq(facilityResource.organizationId, orgId), eq(facilityResource.id, resourceId)))
			.for('update');
		if (!r || !r.active) error(404, 'Resource not found');
		const startsAt = zonedToUtc(`${day}T${time}`, tz);
		const endsAt = new Date(startsAt.getTime() + r.slotMin * 60_000);
		// Must sit inside the daily bookable window.
		if (time < r.openFrom || localDate(endsAt, tz) !== day || time >= r.openTo)
			error(409, 'Outside bookable hours');
		const leadMs = (st.bookCutoffMin ?? 0) * 60_000;
		if (startsAt.getTime() - leadMs <= Date.now()) error(409, 'Booking closed for that slot');
		const [{ taken }] = await tx
			.select({ taken: sql<number>`count(*)`.mapWith(Number) })
			.from(resourceBooking)
			.where(
				and(
					eq(resourceBooking.organizationId, orgId),
					eq(resourceBooking.resourceId, resourceId),
					eq(resourceBooking.status, 'booked'),
					lt(resourceBooking.startsAt, endsAt),
					gt(resourceBooking.endsAt, startsAt)
				)
			);
		if (taken >= r.capacity) error(409, 'That slot is full');
		const [{ dup }] = await tx
			.select({ dup: sql<number>`count(*)`.mapWith(Number) })
			.from(resourceBooking)
			.where(
				and(
					eq(resourceBooking.resourceId, resourceId),
					eq(resourceBooking.memberId, memberId),
					eq(resourceBooking.status, 'booked'),
					lt(resourceBooking.startsAt, endsAt),
					gt(resourceBooking.endsAt, startsAt)
				)
			);
		if (dup) error(409, 'You already have that slot');
		const [row] = await tx
			.insert(resourceBooking)
			.values({
				organizationId: orgId,
				resourceId,
				memberId,
				startsAt,
				endsAt,
				note: note ?? ''
			})
			.returning();
		return row;
	});
}

/** A member's upcoming reservations (portal + member page). */
export async function memberReservations(orgId: string, memberId: string, from = new Date()) {
	return db
		.select({
			booking: resourceBooking,
			resourceName: facilityResource.name,
			resourceKind: facilityResource.kind
		})
		.from(resourceBooking)
		.innerJoin(facilityResource, eq(resourceBooking.resourceId, facilityResource.id))
		.where(
			and(
				eq(resourceBooking.organizationId, orgId),
				eq(resourceBooking.memberId, memberId),
				eq(resourceBooking.status, 'booked'),
				gte(resourceBooking.endsAt, from)
			)
		)
		.orderBy(asc(resourceBooking.startsAt))
		.limit(30);
}

/** All upcoming reservations across resources (staff view + REST API). */
export async function listResourceBookings(orgId: string, from = new Date()) {
	return db
		.select({
			booking: resourceBooking,
			resourceName: facilityResource.name,
			memberName: gymMember.name
		})
		.from(resourceBooking)
		.innerJoin(facilityResource, eq(resourceBooking.resourceId, facilityResource.id))
		.innerJoin(gymMember, eq(resourceBooking.memberId, gymMember.id))
		.where(
			and(
				eq(resourceBooking.organizationId, orgId),
				eq(resourceBooking.status, 'booked'),
				gte(resourceBooking.endsAt, from)
			)
		)
		.orderBy(asc(resourceBooking.startsAt))
		.limit(200);
}

/** Cancel — members may cancel their own upcoming slots; staff cancel anyone's. */
export async function cancelResourceBooking(orgId: string, id: string, forMemberId?: string) {
	const [row] = await db
		.update(resourceBooking)
		.set({ status: 'cancelled' })
		.where(
			and(
				eq(resourceBooking.organizationId, orgId),
				eq(resourceBooking.id, id),
				eq(resourceBooking.status, 'booked'),
				forMemberId ? eq(resourceBooking.memberId, forMemberId) : undefined
			)
		)
		.returning();
	if (!row) error(404, 'Reservation not found');
	return row;
}
