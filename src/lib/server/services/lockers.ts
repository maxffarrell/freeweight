import { and, asc, eq, isNull } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { gymMember, locker } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';

/** All lockers with the assigned member's name, if any. */
export async function listLockers(orgId: string) {
	return db
		.select({ locker, memberName: gymMember.name })
		.from(locker)
		.leftJoin(gymMember, eq(gymMember.id, locker.memberId))
		.where(eq(locker.organizationId, orgId))
		.orderBy(asc(locker.label));
}

export async function addLocker(orgId: string, label: string) {
	const l = label.trim().slice(0, 30);
	if (!l) error(400, 'Locker label required');
	const [row] = await db
		.insert(locker)
		.values({ organizationId: orgId, label: l })
		.onConflictDoNothing()
		.returning();
	if (!row) error(409, `Locker "${l}" already exists`);
	return row;
}

/** Remove a locker — must be unassigned. */
export async function removeLocker(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(locker)
		.where(and(eq(locker.organizationId, ctx.orgId), eq(locker.id, id), isNull(locker.memberId)))
		.returning();
	if (!row) error(404, 'Locker not found or still assigned');
	return { ok: true };
}

/** The locker a member holds, if any. */
export async function memberLocker(orgId: string, memberId: string) {
	const [row] = await db
		.select()
		.from(locker)
		.where(and(eq(locker.organizationId, orgId), eq(locker.memberId, memberId)))
		.limit(1);
	return row ?? null;
}

/**
 * Assign a locker to a member: the locker must be free; if the member already
 * holds another locker it's released first (one locker per member).
 */
export async function assignLocker(ctx: OrgContext, lockerId: string, memberId: string) {
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db.transaction(async (tx) => {
		await tx
			.update(locker)
			.set({ memberId: null, updatedAt: new Date() })
			.where(and(eq(locker.organizationId, ctx.orgId), eq(locker.memberId, memberId)));
		const [r] = await tx
			.update(locker)
			.set({ memberId, updatedAt: new Date() })
			.where(
				and(eq(locker.organizationId, ctx.orgId), eq(locker.id, lockerId), isNull(locker.memberId))
			)
			.returning();
		return [r];
	});
	if (!row) error(409, 'That locker is taken');
	void emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'locker',
		entityId: lockerId,
		action: 'assigned',
		summary: `Locker ${row.label} assigned to ${m.name}`
	});
	return row;
}

export async function releaseLocker(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(locker)
		.set({ memberId: null, updatedAt: new Date() })
		.where(and(eq(locker.organizationId, ctx.orgId), eq(locker.id, id)))
		.returning();
	if (!row) error(404, 'Locker not found');
	void emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'locker',
		entityId: id,
		action: 'released',
		summary: `Locker ${row.label} released`
	});
	return row;
}
