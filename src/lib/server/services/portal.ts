import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, sql, lt } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	checkIn,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	membership,
	organization,
	payment,
	plan,
	waiver,
	outer
} from '#lib/server/db/schema.ts';
import { checkInToken } from './checkins.ts';
import { bookSession, cancelBooking } from './schedule.ts';
import { createMembership, getPlan, memberBalance } from './billing.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';
import { creditUsage } from './schedule.ts';
import { emit } from './events.ts';
import { notifyCancellationRequested, notifyPlanChanged } from './notifications.ts';
import { localDate } from '#lib/tz.ts';

const TTL_MS = 14 * 86400_000;

function sign(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`portal:${payload}`).digest('base64url');
}

/** A signed, expiring link that lets a member attach their login to their member record. */
export function portalToken(memberId: string) {
	const payload = `${memberId}.${Date.now() + TTL_MS}`;
	return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export async function hasPortalMembership(userId: string) {
	const [row] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(eq(gymMember.portalUserId, userId))
		.limit(1);
	return !!row;
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

	// Waitlist position per waitlisted booking: FIFO rank among that session's waitlist.
	const waitlisted = upcoming.filter((u) => u.booking.status === 'waitlisted');
	const waitlistPos = new Map<string, number>();
	if (waitlisted.length) {
		const rows = await db
			.select({ id: booking.id, sessionId: booking.sessionId })
			.from(booking)
			.where(
				and(
					eq(booking.organizationId, orgId),
					eq(booking.status, 'waitlisted'),
					inArray(booking.sessionId, [...new Set(waitlisted.map((u) => u.booking.sessionId))])
				)
			)
			.orderBy(asc(booking.createdAt));
		const counters = new Map<string, number>();
		for (const r of rows) {
			const n = (counters.get(r.sessionId) ?? 0) + 1;
			counters.set(r.sessionId, n);
			waitlistPos.set(r.id, n);
		}
	}
	const upcomingWithPos = upcoming.map((u) => ({
		...u,
		waitlistPos: waitlistPos.get(u.booking.id) ?? null
	}));

	const balance = await memberBalance(orgId, memberId);

	const openCharges = await db
		.select({
			charge,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.memberId, memberId), eq(charge.status, 'open')))
		.orderBy(asc(charge.dueDate));

	const [signedWaiver] = await db
		.select()
		.from(waiver)
		.where(eq(waiver.memberId, memberId))
		.orderBy(desc(waiver.signedAt))
		.limit(1);

	const [[org], [referred]] = await Promise.all([
		db.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(gymMember)
			.where(eq(gymMember.referredByMemberId, memberId))
	]);

	// Recent payments for the portal's billing history (most recent first).
	const payments = await db
		.select({
			payment,
			chargeDescription: charge.description,
			chargeKind: charge.kind
		})
		.from(payment)
		.leftJoin(charge, eq(payment.chargeId, charge.id))
		.where(eq(payment.memberId, memberId))
		.orderBy(desc(payment.paidAt))
		.limit(10);
	return {
		member: m,
		settings,
		memberships,
		upcoming: upcomingWithPos,
		balance,
		openCharges,
		payments,
		credits: await creditUsage(orgId, memberId),
		checkInCode: checkInToken(memberId),
		orgSlug: org?.slug ?? '',
		referralCount: referred?.n ?? 0,
		waiverRequired: !!settings?.waiver,
		signedWaiver,
		attendance: await attendanceStats(orgId, memberId, settings?.timezone ?? 'UTC')
	};
}

/**
 * Member-facing engagement numbers: own check-ins this calendar month and the run of
 * consecutive ISO weeks with at least one visit (guest visits don't count).
 */
async function attendanceStats(orgId: string, memberId: string, tz: string) {
	const rows = await db
		.select({ checkedAt: checkIn.checkedAt, locationName: location.name })
		.from(checkIn)
		.leftJoin(location, eq(checkIn.locationId, location.id))
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, new Date(Date.now() - 180 * 24 * 3600_000))
			)
		)
		.orderBy(desc(checkIn.checkedAt));
	const days = new Set(rows.map((r) => localDate(r.checkedAt, tz)));
	const month = localDate(new Date(), tz).slice(0, 7);
	const visitsThisMonth = rows.filter((r) => localDate(r.checkedAt, tz).startsWith(month)).length;
	// Week bucket = the Monday of that week's ISO date string.
	const weekOf = (iso: string) => {
		const d = new Date(`${iso}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		return d.toISOString().slice(0, 10);
	};
	const weeks = new Set([...days].map(weekOf));
	let weekStreak = 0;
	let w = weekOf(localDate(new Date(), tz));
	if (!weeks.has(w)) {
		// This week isn't over — count from last week so a streak isn't lost mid-week.
		const prev = new Date(`${w}T12:00:00Z`);
		prev.setUTCDate(prev.getUTCDate() - 7);
		w = prev.toISOString().slice(0, 10);
	}
	while (weeks.has(w)) {
		weekStreak++;
		const prev = new Date(`${w}T12:00:00Z`);
		prev.setUTCDate(prev.getUTCDate() - 7);
		w = prev.toISOString().slice(0, 10);
	}
	return { visitsThisMonth, weekStreak, totalVisits: rows.length, recent: rows.slice(0, 10) };
}

/**
 * Records a member's signature for the workspace's current waiver text.
 * Re-signing replaces the stored snapshot (staff edits warrant a fresh agreement).
 */
export async function signWaiver(orgId: string, memberId: string) {
	const [settings] = await db
		.select({ waiver: gymSettings.waiver })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	if (!settings?.waiver) error(400, 'This gym does not use a waiver');
	const [row] = await db
		.insert(waiver)
		.values({ organizationId: orgId, memberId, text: settings.waiver })
		.returning();
	await emit({
		orgId,
		entityType: 'member',
		entityId: memberId,
		action: 'waiver_signed',
		summary: 'Waiver signed'
	});
	return row;
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
	// Booking window: how far ahead members may book (staff bookings are unrestricted).
	const [s] = await db
		.select({ startsAt: classSession.startsAt })
		.from(classSession)
		.where(and(eq(classSession.organizationId, orgId), eq(classSession.id, sessionId)));
	if (!s) error(404, 'Session not found');
	const { bookingWindowDays } = await bookingRules(orgId);
	if (
		bookingWindowDays != null &&
		s.startsAt.getTime() > Date.now() + bookingWindowDays * 86400_000
	)
		error(409, `Bookings open ${bookingWindowDays} days ahead`);
	return bookSession(memberCtx(orgId, userId), { sessionId, memberId }, userId);
}

export async function memberCancel(orgId: string, userId: string, bookingId: string) {
	// Cancel cutoff: no last-minute member cancels (staff can still cancel from the roster).
	const [b] = await db
		.select({ startsAt: classSession.startsAt })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(and(eq(booking.organizationId, orgId), eq(booking.id, bookingId)));
	if (!b) error(404, 'Booking not found');
	const { cancelCutoffMin } = await bookingRules(orgId);
	if (cancelCutoffMin != null && b.startsAt.getTime() - Date.now() < cancelCutoffMin * 60_000)
		error(409, `Cancelling closes ${cancelCutoffMin} minutes before class`);
	return cancelBooking(memberCtx(orgId, userId), bookingId, userId);
}

async function bookingRules(orgId: string) {
	const [st] = await db
		.select({
			bookingWindowDays: gymSettings.bookingWindowDays,
			cancelCutoffMin: gymSettings.cancelCutoffMin
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	return st ?? { bookingWindowDays: null, cancelCutoffMin: null };
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

/** Member asks to cancel a membership — staff confirm from the member page. */
export async function requestCancellation(orgId: string, memberId: string, membershipId: string) {
	const [row] = await db
		.update(membership)
		.set({ cancelRequestedAt: new Date() })
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.id, membershipId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active')
			)
		)
		.returning();
	if (!row) error(404, 'Membership not found');
	await emit({
		orgId,
		actorId: null,
		entityType: 'membership',
		entityId: membershipId,
		action: 'cancel_requested',
		summary: 'Member requested cancellation',
		data: { memberId }
	});
	notifyCancellationRequested(orgId, membershipId).catch(() => {});
	return row;
}

/** Member changes their mind before staff act on the request. */
export async function withdrawCancellation(orgId: string, memberId: string, membershipId: string) {
	const [row] = await db
		.update(membership)
		.set({ cancelRequestedAt: null })
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.id, membershipId),
				eq(membership.memberId, memberId)
			)
		)
		.returning();
	if (!row) error(404, 'Membership not found');
	return row;
}

/** Member re-enables gym emails after using the unsubscribe link. */
export async function resubscribe(memberId: string) {
	await db.update(gymMember).set({ unsubscribedAt: null }).where(eq(gymMember.id, memberId));
}

/**
 * Member self-joins a plan from the portal — the same plans the public join
 * page offers (active + listed). Refuses when an active (non-pack) membership
 * already exists — a pack holder can still join a plan; members with a plan
 * use memberChangePlan instead. Resulting charges appear on the member's
 * balance and are paid via the normal portal checkout.
 */
export async function memberJoinPlan(orgId: string, memberId: string, planId: string) {
	const [active] = await db
		.select({ id: membership.id })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active'),
				eq(plan.isPack, false)
			)
		)
		.limit(1);
	if (active) error(409, 'You already have an active membership');
	const p = await getPlan(orgId, planId);
	if (!p.active || !p.listed) error(404, 'Plan not available');
	return createMembership({ orgId }, { memberId, planId });
}

/**
 * Member switches their active membership to another listed plan from the
 * portal. Takes effect immediately for access/credits; billing reads the plan
 * at charge time, so the next scheduled bill is at the new price (no
 * proration, no signup fee, no new trial). Packs are excluded — a pack is a
 * one-time purchase, not a switchable plan.
 */
export async function memberChangePlan(orgId: string, memberId: string, planId: string) {
	const [ms] = await db
		.select({ membership, plan })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active'),
				eq(plan.isPack, false)
			)
		)
		.limit(1);
	if (!ms) error(409, 'No active membership to change');
	const p = await getPlan(orgId, planId);
	if (!p.active || !p.listed || p.isPack) error(404, 'Plan not available');
	if (ms.plan.id === planId) error(409, 'Already on this plan');
	const [row] = await db
		.update(membership)
		.set({ planId })
		.where(eq(membership.id, ms.membership.id))
		.returning();
	await emit({
		orgId,
		entityType: 'membership',
		entityId: ms.membership.id,
		action: 'plan_changed',
		summary: `Plan changed from ${ms.plan.name} to ${p.name} (member self-serve)`
	});
	notifyPlanChanged(orgId, ms.membership.id, ms.plan.name).catch(() => {});
	return row;
}
