import { and, desc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { gymMember, member, ptRequest, user } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { bookSession, createSession } from './schedule.ts';
import { localDate, localTime } from '#lib/tz.ts';

/** Staff members a member can request a session with (portal coach picker). */
export async function ptCoaches(orgId: string) {
	return db
		.select({ id: member.id, name: user.name })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, orgId))
		.orderBy(user.name);
}

/** Pending requests visible to staff (all pending, newest first). */
export async function listPtRequests(orgId: string) {
	return db
		.select({
			request: ptRequest,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			instructorName: user.name
		})
		.from(ptRequest)
		.innerJoin(gymMember, eq(gymMember.id, ptRequest.memberId))
		.leftJoin(member, eq(member.id, ptRequest.instructorId))
		.leftJoin(user, eq(user.id, member.userId))
		.where(and(eq(ptRequest.organizationId, orgId), eq(ptRequest.status, 'pending')))
		.orderBy(ptRequest.preferredAt);
}

/** Requests relevant to the signed-in instructor (theirs + unassigned). */
export async function myPtRequests(ctx: OrgContext) {
	const [me] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
	const rows = await listPtRequests(ctx.orgId);
	if (!me) return rows.filter((r) => !r.request.instructorId);
	return rows.filter((r) => !r.request.instructorId || r.request.instructorId === me.id);
}

export async function memberPtRequests(orgId: string, memberId: string) {
	return db
		.select({ request: ptRequest, instructorName: user.name })
		.from(ptRequest)
		.leftJoin(member, eq(member.id, ptRequest.instructorId))
		.leftJoin(user, eq(user.id, member.userId))
		.where(and(eq(ptRequest.organizationId, orgId), eq(ptRequest.memberId, memberId)))
		.orderBy(desc(ptRequest.createdAt))
		.limit(10);
}

export async function requestPt(
	orgId: string,
	memberId: string,
	instructorId: string | null | undefined,
	preferredAt: Date,
	note: string | undefined
) {
	if (preferredAt.getTime() < Date.now() + 30 * 60_000)
		error(400, 'Pick a time at least 30 minutes out');
	const [row] = await db
		.insert(ptRequest)
		.values({
			organizationId: orgId,
			memberId,
			instructorId: instructorId || null,
			preferredAt,
			note: note?.slice(0, 300) ?? ''
		})
		.returning();
	const [m] = await db
		.select({ name: gymMember.name })
		.from(gymMember)
		.where(eq(gymMember.id, memberId));
	void emit({
		orgId,
		actorId: memberId,
		entityType: 'pt_request',
		entityId: row.id,
		action: 'created',
		summary: `${m?.name ?? 'Member'} requested a PT session`
	});
	return row;
}

/**
 * Approve: create a 1:1 session of the chosen class type at the requested
 * time and book the member into it. Member without a membership → drop-in.
 */
export async function approvePtRequest(
	ctx: OrgContext,
	id: string,
	classTypeId: string,
	tz: string,
	opts?: { startsAt?: string }
) {
	const [r] = await db
		.select()
		.from(ptRequest)
		.where(and(eq(ptRequest.organizationId, ctx.orgId), eq(ptRequest.id, id)));
	if (!r) error(404, 'Request not found');
	if (r.status !== 'pending') error(409, 'Already handled');
	const startsAt =
		opts?.startsAt ?? `${localDate(r.preferredAt, tz)}T${localTime(r.preferredAt, tz)}`;
	// Unassigned request → the approver teaches it.
	let instructorId = r.instructorId;
	if (!instructorId) {
		const [me] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
		instructorId = me?.id ?? null;
	}
	const sess = await createSession(ctx, tz, {
		classTypeId,
		instructorId,
		startsAt,
		capacity: 1
	});
	const sessionId = sess.id;
	await bookSession(ctx, { sessionId, memberId: r.memberId }, ctx.userId).catch(async () => {
		// Member has no plan — staff drop-in instead.
		await bookSession(ctx, { sessionId, memberId: r.memberId, dropIn: true }, ctx.userId);
	});
	const [row] = await db
		.update(ptRequest)
		.set({ status: 'approved', sessionId, updatedAt: new Date() })
		.where(eq(ptRequest.id, id))
		.returning();
	void emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'pt_request',
		entityId: id,
		action: 'approved',
		summary: 'Approved a PT request'
	});
	return row;
}

export async function declinePtRequest(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(ptRequest)
		.set({ status: 'declined', updatedAt: new Date() })
		.where(
			and(
				eq(ptRequest.organizationId, ctx.orgId),
				eq(ptRequest.id, id),
				eq(ptRequest.status, 'pending')
			)
		)
		.returning();
	if (!row) error(404, 'Request not found or already handled');
	void emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'pt_request',
		entityId: id,
		action: 'declined',
		summary: 'Declined a PT request'
	});
	return row;
}
