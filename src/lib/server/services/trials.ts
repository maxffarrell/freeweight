import { error } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	classSession,
	classType,
	gymMember,
	trialRequest
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { notifyTrialConfirmed, notifyTrialDeclined } from './notifications.ts';

/** Pending trial requests — shown on the dashboard Needs-attention card. */
export async function listTrialRequests(orgId: string) {
	return db
		.select({
			request: trialRequest,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(trialRequest)
		.innerJoin(gymMember, eq(trialRequest.memberId, gymMember.id))
		.innerJoin(classSession, eq(trialRequest.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(trialRequest.organizationId, orgId), eq(trialRequest.status, 'pending')))
		.orderBy(classSession.startsAt);
}

/**
 * Confirm a trial request: books the member a comp'd seat directly (no
 * membership or credits — the trial IS the intro) inside the session row lock.
 */
export async function approveTrialRequest(ctx: OrgContext, requestId: string) {
	const result = await db.transaction(async (tx) => {
		const [req] = await tx
			.select()
			.from(trialRequest)
			.where(and(eq(trialRequest.organizationId, ctx.orgId), eq(trialRequest.id, requestId)))
			.limit(1);
		if (!req) error(404, 'Request not found');
		if (req.status !== 'pending') error(409, 'Already handled');

		const [sess] = await tx
			.select({
				id: classSession.id,
				capacity: classSession.capacity,
				startsAt: classSession.startsAt,
				cancelledAt: classSession.cancelledAt,
				className: classType.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(eq(classSession.id, req.sessionId))
			.for('update')
			.limit(1);
		if (!sess || sess.cancelledAt) error(409, 'That session no longer exists');
		if (sess.startsAt.getTime() <= Date.now()) error(409, 'That session already started');

		const [existing] = await tx
			.select({ id: booking.id })
			.from(booking)
			.where(
				and(
					eq(booking.sessionId, sess.id),
					eq(booking.memberId, req.memberId),
					ne(booking.status, 'cancelled')
				)
			)
			.limit(1);
		if (existing) error(409, 'Member is already booked into this class');

		const [{ count }] = await tx
			.select({
				count: sql<number>`count(*) + coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
			})
			.from(booking)
			.where(and(eq(booking.sessionId, sess.id), eq(booking.status, 'booked')));
		if (count >= sess.capacity) error(409, 'Class is full — decline or pick another session');

		const [b] = await tx
			.insert(booking)
			.values({
				organizationId: ctx.orgId,
				sessionId: sess.id,
				memberId: req.memberId,
				status: 'booked',
				note: 'Free trial'
			})
			.returning();
		await tx
			.update(trialRequest)
			.set({ status: 'confirmed', bookingId: b!.id, updatedAt: new Date() })
			.where(eq(trialRequest.id, req.id));
		return { bookingId: b!.id, className: sess.className };
	});

	await emit({
		orgId: ctx.orgId,
		entityType: 'booking',
		entityId: result.bookingId,
		action: 'trial_confirmed',
		summary: `Free trial confirmed — ${result.className}`,
		actorId: ctx.userId
	});
	notifyTrialConfirmed(ctx.orgId, requestId).catch(() => {});
	return result;
}

/** Decline a trial request — member gets a polite email. */
export async function declineTrialRequest(ctx: OrgContext, requestId: string) {
	const [req] = await db
		.update(trialRequest)
		.set({ status: 'declined', updatedAt: new Date() })
		.where(
			and(
				eq(trialRequest.organizationId, ctx.orgId),
				eq(trialRequest.id, requestId),
				eq(trialRequest.status, 'pending')
			)
		)
		.returning();
	if (!req) error(404, 'Request not found');
	await emit({
		orgId: ctx.orgId,
		entityType: 'member',
		entityId: req.memberId,
		action: 'trial_declined',
		summary: 'Free trial request declined',
		actorId: ctx.userId
	});
	notifyTrialDeclined(ctx.orgId, requestId).catch(() => {});
	return { ok: true };
}
