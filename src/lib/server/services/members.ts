import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	checkIn,
	classSession,
	classType,
	gymMember,
	location,
	memberNote,
	membership,
	organization,
	payment,
	user,
	waiver,
	plan,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { creditUsage } from './schedule.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export async function listMembers(orgId: string, q?: string) {
	const term = q?.trim();
	return db
		.select({
			id: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			phone: gymMember.phone,
			status: gymMember.status,
			joinedAt: gymMember.joinedAt,
			locationName: location.name,
			openBalance:
				sql<number>`coalesce((select sum(c.amount - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id and p.refunded_at is null), 0)) from ${charge} c where c.member_id = ${outer(gymMember.id)} and c.status = 'open'), 0)`.mapWith(
					Number
				),
			planName: sql<
				string | null
			>`(select p2.name from ${membership} m2 join ${plan} p2 on p2.id = m2.plan_id where m2.member_id = ${outer(gymMember.id)} and m2.status = 'active' order by m2.created_at desc limit 1)`
		})
		.from(gymMember)
		.leftJoin(location, eq(gymMember.locationId, location.id))
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				term
					? or(
							ilike(gymMember.name, `%${term}%`),
							ilike(gymMember.email, `%${term}%`),
							ilike(gymMember.phone, `%${term}%`)
						)
					: undefined
			)
		)
		.orderBy(asc(gymMember.name));
}

export async function getMember(orgId: string, id: string) {
	const [row] = await db
		.select({ member: gymMember, locationName: location.name })
		.from(gymMember)
		.leftJoin(location, eq(gymMember.locationId, location.id))
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, id)));
	if (!row) error(404, 'Member not found');

	const memberships = await db
		.select({
			membership,
			planName: plan.name,
			amount: plan.amount,
			interval: plan.interval,
			isPack: plan.isPack,
			guestPasses: plan.guestPasses
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.memberId, id)))
		.orderBy(desc(membership.createdAt));

	const charges = await db
		.select({
			charge,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.memberId, id)))
		.orderBy(desc(charge.dueDate))
		.limit(50);

	const payments = await db
		.select()
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), eq(payment.memberId, id)))
		.orderBy(desc(payment.paidAt))
		.limit(50);

	const bookings = await db
		.select({
			booking,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			className: classType.name
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(booking.organizationId, orgId), eq(booking.memberId, id)))
		.orderBy(desc(classSession.startsAt))
		.limit(50);

	const checkIns = await db
		.select()
		.from(checkIn)
		.where(and(eq(checkIn.organizationId, orgId), eq(checkIn.memberId, id)))
		.orderBy(desc(checkIn.checkedAt))
		.limit(50);

	const credits = await creditUsage(orgId, id);

	const [signedWaiver] = await db
		.select()
		.from(waiver)
		.where(eq(waiver.memberId, id))
		.orderBy(desc(waiver.signedAt))
		.limit(1);

	const activeMs = memberships.find((m) => m.membership.status === 'active');
	const [guests] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, id),
				isNotNull(checkIn.guestName),
				sql`${checkIn.checkedAt} >= date_trunc('month', now())`
			)
		);
	return {
		...row,
		memberships,
		charges,
		payments,
		bookings,
		checkIns,
		credits,
		signedWaiver,
		guestPasses: activeMs?.guestPasses ?? 0,
		guestsUsed: guests?.n ?? 0
	};
}

export async function createMember(ctx: OrgContext, input: v.InferOutput<typeof s.memberInput>) {
	const [row] = await db
		.insert(gymMember)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			email: input.email || null,
			phone: input.phone ?? null,
			locationId: input.locationId ?? null,
			status: input.status,
			notes: input.notes ?? null,
			joinedAt: input.joinedAt ?? null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: row!.id,
		action: 'created',
		summary: `${input.name} joined`
	});
	return row;
}

/** Bulk-creates members from CSV rows; skips rows whose email already belongs to a member (or is repeated). */
export async function importMembers(
	ctx: OrgContext,
	rows: v.InferOutput<typeof s.memberImportInput>
) {
	const emails = rows.map((r) => r.email?.toLowerCase()).filter((e): e is string => !!e);
	const taken = new Set(
		emails.length
			? (
					await db
						.select({ email: sql<string>`lower(${gymMember.email})` })
						.from(gymMember)
						.where(
							and(
								eq(gymMember.organizationId, ctx.orgId),
								inArray(sql`lower(${gymMember.email})`, emails)
							)
						)
				).map((r) => r.email)
			: []
	);
	const seen = new Set<string>();
	const toInsert = rows.filter((r) => {
		const e = r.email?.toLowerCase();
		if (!e) return true;
		if (taken.has(e) || seen.has(e)) return false;
		seen.add(e);
		return true;
	});
	if (toInsert.length)
		await db.insert(gymMember).values(
			toInsert.map((r) => ({
				organizationId: ctx.orgId,
				name: r.name,
				email: r.email || null,
				phone: r.phone ?? null
			}))
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: 'csv-import',
		action: 'imported',
		summary: `Imported ${toInsert.length} member${toInsert.length === 1 ? '' : 's'}`,
		data: { skipped: rows.length - toInsert.length }
	});
	return { created: toInsert.length, skipped: rows.length - toInsert.length };
}

export async function updateMember(ctx: OrgContext, input: v.InferOutput<typeof s.memberUpdate>) {
	const { id, ...set } = input;
	const [row] = await db
		.update(gymMember)
		.set({
			name: set.name,
			email: set.email === undefined ? undefined : set.email || null,
			phone: set.phone,
			locationId: set.locationId,
			status: set.status,
			notes: set.notes,
			joinedAt: set.joinedAt
		})
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, id)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
}

// ------- staff notes on a member -------

export async function listMemberNotes(orgId: string, memberId: string) {
	return db
		.select({
			id: memberNote.id,
			body: memberNote.body,
			createdAt: memberNote.createdAt,
			authorName: user.name
		})
		.from(memberNote)
		.leftJoin(user, eq(memberNote.authorId, user.id))
		.where(and(eq(memberNote.organizationId, orgId), eq(memberNote.memberId, memberId)))
		.orderBy(desc(memberNote.createdAt))
		.limit(50);
}

export async function addMemberNote(ctx: OrgContext, memberId: string, body: string) {
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(memberNote)
		.values({ organizationId: ctx.orgId, memberId, authorId: ctx.userId, body })
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: memberId,
		action: 'note_added',
		summary: 'Staff note added',
		data: { noteId: row!.id }
	});
	return row;
}

export async function deleteMemberNote(ctx: OrgContext, noteId: string) {
	const [row] = await db
		.delete(memberNote)
		.where(and(eq(memberNote.organizationId, ctx.orgId), eq(memberNote.id, noteId)))
		.returning();
	if (!row) error(404, 'Note not found');
}

/** Members whose portal login is this user — one user can belong to several gyms. */
export async function portalMembers(userId: string) {
	return db
		.select({ member: gymMember, orgName: organization.name, orgSlug: organization.slug })
		.from(gymMember)
		.innerJoin(organization, eq(organization.id, gymMember.organizationId))
		.where(eq(gymMember.portalUserId, userId));
}
