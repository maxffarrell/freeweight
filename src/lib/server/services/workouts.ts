import { and, desc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { memberWorkout } from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import type { OrgContext } from '#lib/server/context.ts';

/** Workouts a coach assigned to one member — staff view on the member page. */
export async function listMemberWorkouts(orgId: string, memberId: string) {
	return db
		.select()
		.from(memberWorkout)
		.where(and(eq(memberWorkout.organizationId, orgId), eq(memberWorkout.memberId, memberId)))
		.orderBy(desc(memberWorkout.createdAt))
		.limit(50);
}

/** Portal view: the member's own assigned routines. */
export async function listMyWorkouts(orgId: string, memberId: string) {
	return listMemberWorkouts(orgId, memberId);
}

export async function addWorkout(ctx: OrgContext, memberId: string, title: string, body: string) {
	const [row] = await db
		.insert(memberWorkout)
		.values({ organizationId: ctx.orgId, memberId, title, body, createdBy: ctx.userId })
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: memberId,
		action: 'workout.assigned',
		summary: `Workout assigned: ${title}`
	});
	return row;
}

export async function updateWorkout(
	ctx: OrgContext,
	workoutId: string,
	title: string,
	body: string
) {
	const [row] = await db
		.update(memberWorkout)
		.set({ title, body })
		.where(and(eq(memberWorkout.id, workoutId), eq(memberWorkout.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Workout not found');
	return row;
}

export async function deleteWorkout(ctx: OrgContext, workoutId: string) {
	const [row] = await db
		.delete(memberWorkout)
		.where(and(eq(memberWorkout.id, workoutId), eq(memberWorkout.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Workout not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: row.memberId,
		action: 'workout.deleted',
		summary: `Workout removed: ${row.title}`
	});
}
