import { and, asc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { gymMember, memberLevel } from '#lib/server/db/schema.ts';
import { emit } from './events.ts';

/** Progression ranks, ordered — belts, levels, however the gym structures them. */
export async function listLevels(orgId: string) {
	return db
		.select()
		.from(memberLevel)
		.where(eq(memberLevel.organizationId, orgId))
		.orderBy(asc(memberLevel.sortOrder), asc(memberLevel.createdAt));
}

export async function addLevel(orgId: string, name: string, color?: string) {
	const [maxRow] = await db
		.select({ max: memberLevel.sortOrder })
		.from(memberLevel)
		.where(eq(memberLevel.organizationId, orgId))
		.orderBy(memberLevel.sortOrder)
		.limit(1);
	const [row] = await db
		.insert(memberLevel)
		.values({
			organizationId: orgId,
			name,
			color: color || null,
			sortOrder: (maxRow?.max ?? 0) + 1
		})
		.returning();
	return row;
}

export async function removeLevel(orgId: string, id: string) {
	// Members holding the rank keep it blanked via set null below (FK has no action,
	// so clear the reference first).
	await db
		.update(gymMember)
		.set({ skillLevelId: null, updatedAt: new Date() })
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.skillLevelId, id)));
	const [row] = await db
		.delete(memberLevel)
		.where(and(eq(memberLevel.id, id), eq(memberLevel.organizationId, orgId)))
		.returning();
	if (!row) error(404, 'Level not found');
	return { ok: true };
}

export async function setMemberLevel(
	ctx: { orgId: string; userId: string },
	memberId: string,
	levelId: string | null
) {
	if (levelId) {
		const [lvl] = await db
			.select({ id: memberLevel.id })
			.from(memberLevel)
			.where(and(eq(memberLevel.id, levelId), eq(memberLevel.organizationId, ctx.orgId)));
		if (!lvl) error(404, 'Level not found');
	}
	const [m] = await db
		.update(gymMember)
		.set({ skillLevelId: levelId, updatedAt: new Date() })
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, ctx.orgId)))
		.returning({ id: gymMember.id });
	if (!m) error(404, 'Member not found');
	emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: memberId,
		action: 'updated',
		summary: 'Progression level changed'
	});
	return { ok: true };
}
