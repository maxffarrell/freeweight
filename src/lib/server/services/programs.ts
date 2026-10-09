import { and, asc, desc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { gymMember, memberProgram, programDay, workoutProgram } from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import type { OrgContext } from '#lib/server/context.ts';

/** Program templates with their days, for the library picker/editor. */
export async function listPrograms(orgId: string) {
	const programs = await db
		.select()
		.from(workoutProgram)
		.where(eq(workoutProgram.organizationId, orgId))
		.orderBy(asc(workoutProgram.name));
	if (!programs.length) return [];
	const days = await db
		.select()
		.from(programDay)
		.where(eq(programDay.organizationId, orgId))
		.orderBy(asc(programDay.dayNo));
	const byProgram = new Map<string, typeof days>();
	for (const d of days) {
		const arr = byProgram.get(d.programId) ?? [];
		arr.push(d);
		byProgram.set(d.programId, arr);
	}
	return programs.map((p) => ({ program: p, days: byProgram.get(p.id) ?? [] }));
}

/** Create or replace a program: name + weeks + a flat list of days. */
export async function saveProgram(
	ctx: OrgContext,
	input: {
		id?: string;
		name: string;
		weeks: number;
		note?: string;
		days: { dayNo: number; title: string; body: string }[];
	}
) {
	return db.transaction(async (tx) => {
		let programId = input.id;
		if (programId) {
			const [row] = await tx
				.update(workoutProgram)
				.set({
					name: input.name,
					weeks: input.weeks,
					note: input.note ?? null,
					updatedAt: new Date()
				})
				.where(and(eq(workoutProgram.id, programId), eq(workoutProgram.organizationId, ctx.orgId)))
				.returning();
			if (!row) error(404, 'Program not found');
			await tx.delete(programDay).where(eq(programDay.programId, programId));
		} else {
			const [row] = await tx
				.insert(workoutProgram)
				.values({
					organizationId: ctx.orgId,
					name: input.name,
					weeks: input.weeks,
					note: input.note ?? null,
					createdBy: ctx.userId
				})
				.returning();
			programId = row.id;
		}
		if (input.days.length) {
			await tx.insert(programDay).values(
				input.days.map((d) => ({
					organizationId: ctx.orgId,
					programId: programId!,
					dayNo: d.dayNo,
					title: d.title,
					body: d.body
				}))
			);
		}
		emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'workout_program',
			entityId: programId!,
			action: input.id ? 'updated' : 'created',
			summary: `Program ${input.name} ${input.id ? 'updated' : 'created'}`
		});
		return { id: programId };
	});
}

export async function removeProgram(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(workoutProgram)
		.where(and(eq(workoutProgram.id, id), eq(workoutProgram.organizationId, ctx.orgId)))
		.returning({ id: workoutProgram.id });
	if (!row) error(404, 'Program not found');
	return { ok: true };
}

export async function memberPrograms(orgId: string, memberId: string) {
	return db
		.select({ assignment: memberProgram, program: workoutProgram })
		.from(memberProgram)
		.innerJoin(workoutProgram, eq(memberProgram.programId, workoutProgram.id))
		.where(and(eq(memberProgram.organizationId, orgId), eq(memberProgram.memberId, memberId)))
		.orderBy(desc(memberProgram.createdAt));
}

export async function assignProgram(
	ctx: OrgContext,
	memberId: string,
	programId: string,
	startDate: string
) {
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, ctx.orgId)));
	if (!m) error(404, 'Member not found');
	const [p] = await db
		.select({ id: workoutProgram.id })
		.from(workoutProgram)
		.where(and(eq(workoutProgram.id, programId), eq(workoutProgram.organizationId, ctx.orgId)));
	if (!p) error(404, 'Program not found');
	const [row] = await db
		.insert(memberProgram)
		.values({ organizationId: ctx.orgId, programId, memberId, startDate })
		.returning();
	emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: memberId,
		action: 'updated',
		summary: 'Assigned to a workout program'
	});
	return row;
}

export async function setAssignmentStatus(
	ctx: OrgContext,
	assignmentId: string,
	status: 'done' | 'stopped' | 'active'
) {
	const [row] = await db
		.update(memberProgram)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(memberProgram.id, assignmentId), eq(memberProgram.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Assignment not found');
	return { ok: true };
}

/** Member's active assignments with days, plus which program day they're on. */
export async function portalPrograms(orgId: string, memberId: string) {
	const assignments = await db
		.select({ assignment: memberProgram, program: workoutProgram })
		.from(memberProgram)
		.innerJoin(workoutProgram, eq(memberProgram.programId, workoutProgram.id))
		.where(
			and(
				eq(memberProgram.organizationId, orgId),
				eq(memberProgram.memberId, memberId),
				eq(memberProgram.status, 'active')
			)
		)
		.orderBy(desc(memberProgram.createdAt));
	if (!assignments.length) return [];
	const days = await db
		.select()
		.from(programDay)
		.where(eq(programDay.organizationId, orgId))
		.orderBy(asc(programDay.dayNo));
	const today = new Date().toISOString().slice(0, 10);
	return assignments.map(({ assignment, program }) => {
		const elapsed =
			Math.floor((Date.parse(today) - Date.parse(assignment.startDate)) / 86400000) + 1;
		const programDays = days.filter((d) => d.programId === program.id);
		const total = programDays.length;
		const current = elapsed >= 1 && elapsed <= total ? elapsed : elapsed > total ? total : 1;
		return {
			assignment,
			program,
			days: programDays,
			dayNo: current,
			finished: elapsed > total
		};
	});
}
