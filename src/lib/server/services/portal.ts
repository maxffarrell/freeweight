import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, sql, lt } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	membership,
	payment,
	plan,
	outer
} from '#lib/server/db/schema.ts';
import { checkInToken } from './checkins.ts';
import { bookSession, cancelBooking } from './schedule.ts';
import { memberBalance } from './billing.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';

const TTL_MS = 14 * 86400_000;

function sign(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`portal:${payload}`).digest('base64url');
}

/** A signed, expiring link that lets a member attach their login to their member record. */
export function portalToken(memberId: string) {
	const payload = `${memberId}.${Date.now() + TTL_MS}`;
	return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export async function claimPortal(token: string, userId: string) {
	const [encoded, sig] = token.split('.');
	if (!encoded || !sig) error(400, 'Invalid link');
	const payload = Buffer.from(encoded, 'base64url').toString();
	const expected = Buffer.from(sign(payload));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given))
		error(400, 'Invalid link');
	const [memberId, exp] = payload.split('.');
	if (!memberId || Number(exp) < Date.now())
		error(410, 'This link has expired. Ask your gym for a new one.');
	const [m] = await db
		.update(gymMember)
		.set({ portalUserId: userId })
		.where(eq(gymMember.id, memberId))
		.returning();
	if (!m) error(404, 'Member not found');
	return m;
}

/** Everything the portal home shows for one member record. */
export async function portalOverview(memberId: string) {
	const [m] = await db.select().from(gymMember).where(eq(gymMember.id, memberId));
	if (!m) error(404, 'Member not found');
	const orgId = m.organizationId;

	const [settings] = await db
		.select()
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));

	const memberships = await db
		.select({ membership, plan })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(eq(membership.memberId, memberId))
		.orderBy(desc(membership.createdAt));

	const now = new Date();
	const upcoming = await db
		.select({
			booking,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			className: classType.name,
			locationName: location.name
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(booking.memberId, memberId),
				gte(classSession.startsAt, now),
				sql`${outer(booking.status)} in ('booked','waitlisted')`
			)
		)
		.orderBy(asc(classSession.startsAt));

	const balance = await memberBalance(orgId, memberId);

	const openCharges = await db
		.select({
			charge,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.memberId, memberId), eq(charge.status, 'open')))
		.orderBy(asc(charge.dueDate));

	return {
		member: m,
		settings,
		memberships,
		upcoming,
		balance,
		openCharges,
		checkInCode: checkInToken(memberId)
	};
}

/** Sessions open for booking in the next two weeks, with the member's own booking state. */
export async function bookableSessions(memberId: string, days = 14) {
	const [m] = await db.select().from(gymMember).where(eq(gymMember.id, memberId));
	if (!m) error(404, 'Member not found');
	const now = new Date();
	const until = new Date(now.getTime() + days * 86400_000);
	return db
		.select({
			session: classSession,
			className: classType.name,
			color: classType.color,
			locationName: location.name,
			booked:
				sql<number>`(select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'booked')`.mapWith(
					Number
				),
			myStatus: sql<
				string | null
			>`(select b.status from ${booking} b where b.session_id = ${outer(classSession.id)} and b.member_id = ${memberId} and b.status != 'cancelled' limit 1)`
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(classSession.organizationId, m.organizationId),
				gte(classSession.startsAt, now),
				lt(classSession.startsAt, until),
				isNull(classSession.cancelledAt)
			)
		)
		.orderBy(asc(classSession.startsAt));
}

/** Members book against their own gym's org context. */
const memberCtx = (orgId: string, userId: string) => ({
	orgId,
	userId,
	role: 'member' as const,
	org: { id: orgId, name: '', slug: '', logo: null }
});

export async function memberBook(
	orgId: string,
	userId: string,
	sessionId: string,
	memberId: string
) {
	return bookSession(memberCtx(orgId, userId), { sessionId, memberId }, userId);
}

export async function memberCancel(orgId: string, userId: string, bookingId: string) {
	return cancelBooking(memberCtx(orgId, userId), bookingId, userId);
}

/** Starts a provider checkout for the member's full open balance. */
export async function portalCheckout(memberId: string, providerId: string) {
	const overview = await portalOverview(memberId);
	if (overview.balance <= 0) error(400, 'Nothing to pay');
	const provider = providers.find((p) => p.id === providerId);
	if (!provider?.configured()) error(404, 'Unknown provider');
	const row = await providerRow(overview.member.organizationId, providerId);
	if (!provider.ready(row)) error(400, `${provider.name} is not available right now`);
	return provider.checkout({
		orgId: overview.member.organizationId,
		memberId,
		email: overview.member.email,
		amount: overview.balance,
		currency: overview.settings?.currency ?? 'usd',
		description: `Balance payment — ${overview.member.name}`,
		row
	});
}

/** Which providers the member can actually pay with right now. */
export async function availableProviders(orgId: string, currency: string) {
	const out = [];
	for (const p of providers) {
		if (!p.configured() || !p.supportsCurrency(currency)) continue;
		const row = await providerRow(orgId, p.id);
		if (p.ready(row)) out.push({ id: p.id, name: p.name, payLabel: p.payLabel, newTab: p.newTab });
	}
	return out;
}
