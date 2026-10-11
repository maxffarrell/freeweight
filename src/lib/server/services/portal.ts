import { createHmac, timingSafeEqual } from 'node:crypto';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { membersLeaderboard } from './members.ts';
import {
	locker,
	booking,
	charge,
	checkIn,
	classSession,
	classWatch,
	classType,
	document,
	sessionFeedback,
	shopItem,
	resourceBooking,
	challenge,
	challengeEntry,
	eventRegistration,
	shopSale,
	signRequest,
	classVideo,
	workoutResult,
	memberIssue,
	workoutLog,
	gymMember,
	gymSettings,
	location,
	memberLevel,
	memberNps,
	memberMeasurement,
	memberNote,
	membership,
	organization,
	payment,
	personalRecord,
	plan,
	recurringCharge,
	waiver,
	outer
} from '#lib/server/db/schema.ts';
import { checkInToken } from './checkins.ts';
import { activeMembership, bookSession, cancelBooking } from './schedule.ts';
import { notifySeriesBooked } from './notifications.ts';
import {
	assertPlanCapacity,
	createMembership,
	getPlan,
	memberBalance,
	nextPeriod,
	proratePlanChange,
	recordPayment,
	sellItem
} from './billing.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';
import { creditUsage } from './schedule.ts';
import { emit } from './events.ts';
import {
	calendarToken,
	notifyCancellationRequested,
	notifyLowRating,
	notifyPauseRequested,
	notifyPlanChanged
} from './notifications.ts';
import { addDays, localDate } from '#lib/tz.ts';
import { formatMoney, loyaltyTier, todayISO } from '#lib/format.ts';

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

	// Family packs: a dependent books from the guardian's memberships — the
	// portal's booking gate needs to know one exists.
	const guardianHasMembership = m.guardianId
		? !!(
				await db
					.select({ id: membership.id })
					.from(membership)
					.where(
						and(
							eq(membership.organizationId, orgId),
							eq(membership.memberId, m.guardianId),
							eq(membership.status, 'active')
						)
					)
					.limit(1)
			).length
		: false;

	const now = new Date();
	const upcoming = await db
		.select({
			booking,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			classTypeId: classSession.classTypeId,
			className: classType.name,
			locationName: location.name,
			workout: classSession.workout,
			streamUrl: classSession.streamUrl,
			bringNote: classType.bringNote
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

	// Recurring add-ons billed to this member (PT packages, towel service). Shown
	// in the Balance card so members can see them and ask staff to stop one.
	const addOns = await db
		.select()
		.from(recurringCharge)
		.where(and(eq(recurringCharge.memberId, memberId), eq(recurringCharge.organizationId, orgId)))
		.orderBy(asc(recurringCharge.nextDue));

	// The member's own workout journal — newest first, portal "Workout log" card.
	const workouts = await db
		.select()
		.from(workoutLog)
		.where(eq(workoutLog.memberId, memberId))
		.orderBy(desc(workoutLog.day), desc(workoutLog.createdAt))
		.limit(10);
	const issues = await db
		.select()
		.from(memberIssue)
		.where(eq(memberIssue.memberId, memberId))
		.orderBy(desc(memberIssue.createdAt))
		.limit(5);

	const [[org], [referred], referralRows] = await Promise.all([
		db.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(gymMember)
			.where(eq(gymMember.referredByMemberId, memberId)),
		db
			.select({ id: gymMember.id, name: gymMember.name })
			.from(gymMember)
			.where(eq(gymMember.referredByMemberId, memberId))
			.orderBy(desc(gymMember.createdAt))
			.limit(20)
	]);
	let referrals: { name: string; paying: boolean }[] = [];
	if (referralRows.length) {
		const paid = await db
			.select({ memberId: payment.memberId })
			.from(payment)
			.where(
				and(
					eq(payment.organizationId, orgId),
					inArray(
						payment.memberId,
						referralRows.map((r) => r.id)
					),
					isNull(payment.refundedAt)
				)
			)
			.groupBy(payment.memberId);
		const paidSet = new Set(paid.map((p) => p.memberId));
		referrals = referralRows.map((r) => ({ name: r.name, paying: paidSet.has(r.id) }));
	}

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

	// Past bookings, most recent first — the member's class history.
	const history = await db
		.select({
			booking,
			sessionId: classSession.id,
			startsAt: classSession.startsAt,
			classTypeId: classSession.classTypeId,
			className: classType.name,
			locationName: location.name,
			workout: classSession.workout
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(and(eq(booking.memberId, memberId), lt(classSession.startsAt, now)))
		.orderBy(desc(classSession.startsAt))
		.limit(10);
	// Ratings the member already gave on sessions in that history.
	const fbRows = history.length
		? await db
				.select({
					sessionId: sessionFeedback.sessionId,
					rating: sessionFeedback.rating,
					comment: sessionFeedback.comment
				})
				.from(sessionFeedback)
				.where(
					and(
						eq(sessionFeedback.memberId, memberId),
						inArray(
							sessionFeedback.sessionId,
							history.map((h) => h.sessionId)
						)
					)
				)
		: [];
	const feedback = Object.fromEntries(fbRows.map((f) => [f.sessionId, f]));
	// Workout scores the member logged on sessions in that history.
	const resRows = history.length
		? await db
				.select({
					sessionId: workoutResult.sessionId,
					score: workoutResult.score,
					asRx: workoutResult.asRx
				})
				.from(workoutResult)
				.where(
					and(
						eq(workoutResult.memberId, memberId),
						inArray(
							workoutResult.sessionId,
							history.map((h) => h.sessionId)
						)
					)
				)
		: [];
	const results = Object.fromEntries(resRows.map((r) => [r.sessionId, r]));

	// The whiteboard: every logged score on sessions this member can see (ones
	// they're booked into or attended), oldest first — like the gym's real one.
	const wodSessionIds = [
		...new Set(
			[...upcomingWithPos, ...history].filter((u) => u.workout).map((u) => u.booking.sessionId)
		)
	];
	const wbRows = wodSessionIds.length
		? await db
				.select({
					sessionId: workoutResult.sessionId,
					memberId: workoutResult.memberId,
					name: gymMember.name,
					score: workoutResult.score,
					asRx: workoutResult.asRx
				})
				.from(workoutResult)
				.innerJoin(gymMember, eq(workoutResult.memberId, gymMember.id))
				.where(inArray(workoutResult.sessionId, wodSessionIds))
				.orderBy(asc(workoutResult.createdAt))
		: [];
	const whiteboard: Record<
		string,
		{ memberId: string; name: string; score: string; asRx: boolean }[]
	> = {};
	for (const r of wbRows) (whiteboard[r.sessionId] ??= []).push(r);

	const [priorBooking, [avatarDoc], [firstVisit], [level]] = await Promise.all([
		hasPriorBooking(memberId),
		db
			.select({ id: document.id })
			.from(document)
			.where(and(eq(document.entityType, 'member_avatar'), eq(document.entityId, memberId)))
			.limit(1),
		db
			.select({ id: checkIn.id })
			.from(checkIn)
			.where(
				and(
					eq(checkIn.organizationId, orgId),
					eq(checkIn.memberId, memberId),
					isNull(checkIn.guestName)
				)
			)
			.limit(1),
		m.skillLevelId
			? db
					.select({ name: memberLevel.name, color: memberLevel.color })
					.from(memberLevel)
					.where(eq(memberLevel.id, m.skillLevelId))
					.limit(1)
			: Promise.resolve([])
	]);

	const [lk] = await db
		.select({ label: locker.label })
		.from(locker)
		.where(and(eq(locker.organizationId, orgId), eq(locker.memberId, memberId)))
		.limit(1);

	// Next scheduled membership charge + what it'll bill (staff override or plan price).
	const nb = memberships.find(
		(r) => r.membership.status === 'active' && !r.membership.noBill && r.membership.nextChargeAt
	);
	const nextBill = nb
		? { date: nb.membership.nextChargeAt!, amount: nb.membership.price ?? nb.plan.amount }
		: null;

	// Upsell hint: a pack-only member visiting often enough that the cheapest
	// plan would cost less than their effective drop-in spend per month.
	let upsell: { plan: string; monthly: number; spend: number } | null = null;
	{
		const hasPlan = memberships.some((r) => r.membership.status === 'active' && !r.plan.isPack);
		const hasPack = memberships.some((r) => r.membership.status === 'active' && r.plan.isPack);
		if (!hasPlan && hasPack) {
			const [{ n: visits60 }] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(checkIn)
				.where(
					and(
						eq(checkIn.organizationId, orgId),
						eq(checkIn.memberId, memberId),
						isNull(checkIn.guestName),
						gte(checkIn.checkedAt, new Date(Date.now() - 60 * 86400_000))
					)
				);
			const [di] = await db
				.select({
					min: sql<number | null>`min(${classType.dropInPrice})`.mapWith((v) =>
						v ? Number(v) : null
					)
				})
				.from(classType)
				.where(
					and(
						eq(classType.organizationId, orgId),
						eq(classType.active, true),
						gt(classType.dropInPrice, 0)
					)
				);
			const [cheapest] = await db
				.select({ name: plan.name, amount: plan.amount, interval: plan.interval })
				.from(plan)
				.where(
					and(
						eq(plan.organizationId, orgId),
						eq(plan.active, true),
						eq(plan.isPack, false),
						gt(plan.amount, 0)
					)
				)
				.orderBy(asc(plan.amount))
				.limit(1);
			if (di?.min && cheapest) {
				const monthly =
					(cheapest.interval === 'year'
						? cheapest.amount / 12
						: cheapest.interval === 'week'
							? cheapest.amount * 4.33
							: cheapest.amount) / 100;
				const spend = (visits60 / 2) * (di.min / 100);
				if (spend > monthly * 1.1)
					upsell = { plan: cheapest.name, monthly: Math.round(monthly), spend: Math.round(spend) };
			}
		}
	}

	return {
		member: m,
		lockerLabel: lk?.label ?? null,
		upsell,
		level: level ?? null,
		settings,
		brandColor: settings?.whiteLabel && isEnterpriseEnabled() ? settings.brandColor : '',
		memberships,
		guardianHasMembership,
		upcoming: upcomingWithPos,
		balance,
		openCharges,
		payments,
		addOns,
		nextBill,
		workouts,
		issues,
		history,
		feedback,
		results,
		whiteboard,
		credits: await creditUsage(orgId, memberId),
		checkInCode: checkInToken(memberId),
		calendarToken: calendarToken(memberId),
		orgSlug: org?.slug ?? '',
		referralCount: referred?.n ?? 0,
		referrals,
		dropInFree: !!settings?.firstClassFree && !priorBooking,
		onboarding: {
			waiver: !settings?.waiver || !!signedWaiver,
			photo: !!avatarDoc,
			goal: m.goalVisitsPerMonth != null,
			booked: priorBooking,
			visited: !!firstVisit
		},
		waiverRequired: !!settings?.waiver,
		signedWaiver,
		waiverStale: !!settings?.waiver && !!signedWaiver && signedWaiver.text !== settings.waiver,
		attendance: await attendanceStats(orgId, memberId, settings?.timezone ?? 'UTC'),
		leaderboard: await membersLeaderboard(orgId, memberId, settings?.timezone ?? 'UTC'),
		loyalty: loyaltyTier(await lifetimeVisits(orgId, memberId)),
		insideNow: await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(checkIn)
			.where(and(eq(checkIn.organizationId, orgId), isNull(checkIn.checkedOutAt)))
			.then((r) => r[0]?.n ?? 0),
		year: await yearRecap(orgId, memberId),
		watchList: await watchList(orgId, memberId)
	};
}

/**
 * Member-facing engagement numbers: own check-ins this calendar month and the run of
 * consecutive ISO weeks with at least one visit (guest visits don't count).
 */
async function hasPriorBooking(memberId: string) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.where(and(eq(booking.memberId, memberId), ne(booking.status, 'cancelled')));
	return n > 0;
}

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
	// Longest run of consecutive visited weeks (for the streak card).
	const sortedWeeks = [...weeks].sort();
	let longestStreak = 0;
	let run = 0;
	let prevW = '';
	for (const wk of sortedWeeks) {
		const expect = prevW
			? new Date(new Date(`${prevW}T12:00:00Z`).getTime() + 7 * 86400_000)
					.toISOString()
					.slice(0, 10)
			: '';
		run = wk === expect ? run + 1 : 1;
		if (run > longestStreak) longestStreak = run;
		prevW = wk;
	}
	const nextMilestone = [10, 25, 50, 100, 250, 500, 1000].find((n) => n > rows.length) ?? null;
	return {
		visitsThisMonth,
		weekStreak,
		longestStreak,
		nextMilestone,
		totalVisits: rows.length,
		recent: rows.slice(0, 10)
	};
}

/** Portal badges — achievements computed from existing data (no table). */
export async function portalBadges(orgId: string, memberId: string, tz: string) {
	const [stats, [m], [prs], [refs], [rates], [shops], [amen], [evts], [wavs], [fins]] =
		await Promise.all([
			attendanceStats(orgId, memberId, tz),
			db
				.select({ photoDocumentId: gymMember.photoDocumentId })
				.from(gymMember)
				.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)))
				.limit(1),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(personalRecord)
				.where(
					and(eq(personalRecord.organizationId, orgId), eq(personalRecord.memberId, memberId))
				),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(gymMember)
				.where(
					and(eq(gymMember.organizationId, orgId), eq(gymMember.referredByMemberId, memberId))
				),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(sessionFeedback)
				.where(
					and(eq(sessionFeedback.organizationId, orgId), eq(sessionFeedback.memberId, memberId))
				),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(shopSale)
				.where(and(eq(shopSale.organizationId, orgId), eq(shopSale.memberId, memberId))),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(resourceBooking)
				.where(
					and(
						eq(resourceBooking.organizationId, orgId),
						eq(resourceBooking.memberId, memberId),
						eq(resourceBooking.status, 'booked')
					)
				),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(eventRegistration)
				.where(
					and(eq(eventRegistration.organizationId, orgId), eq(eventRegistration.memberId, memberId))
				),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(waiver)
				.where(and(eq(waiver.organizationId, orgId), eq(waiver.memberId, memberId))),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(challengeEntry)
				.innerJoin(challenge, eq(challengeEntry.challengeId, challenge.id))
				.where(
					and(
						eq(challengeEntry.organizationId, orgId),
						eq(challengeEntry.memberId, memberId),
						sql`(select count(*) from check_in ci where ci.member_id = ${outer(challengeEntry.memberId)} and ci.organization_id = ${orgId} and ci.guest_name is null and ci.checked_at >= ${challenge.startDate}::timestamptz and ci.checked_at < (${challenge.endDate}::date + 1)::timestamptz) >= ${challenge.goal}`
					)
				)
		]);
	const v = stats.totalVisits;
	const badges: { id: string; label: string; earned: boolean }[] = [
		{ id: 'first-visit', label: 'First check-in', earned: v >= 1 },
		{ id: 'regular-10', label: '10 visits', earned: v >= 10 },
		{ id: 'regular-50', label: '50 visits', earned: v >= 50 },
		{ id: 'regular-100', label: '100 visits', earned: v >= 100 },
		{ id: 'regular-250', label: '250 visits', earned: v >= 250 },
		{ id: 'streak-4', label: '4-week streak', earned: stats.longestStreak >= 4 },
		{ id: 'streak-13', label: '13-week streak', earned: stats.longestStreak >= 13 },
		{ id: 'streak-26', label: 'Half-year streak', earned: stats.longestStreak >= 26 },
		{ id: 'record-setter', label: 'Logged a PR', earned: (prs?.n ?? 0) > 0 },
		{ id: 'finisher', label: 'Finished a challenge', earned: (fins?.n ?? 0) > 0 },
		{ id: 'recruiter', label: 'Referred a member', earned: (refs?.n ?? 0) > 0 },
		{ id: 'critic', label: 'Rated a class', earned: (rates?.n ?? 0) > 0 },
		{ id: 'shopper', label: 'Bought something', earned: (shops?.n ?? 0) > 0 },
		{ id: 'spa-day', label: 'Booked an amenity', earned: (amen?.n ?? 0) > 0 },
		{ id: 'event-goer', label: 'Joined an event', earned: (evts?.n ?? 0) > 0 },
		{ id: 'paperwork', label: 'Waiver signed', earned: (wavs?.n ?? 0) > 0 },
		{ id: 'photo-ready', label: 'Photo uploaded', earned: !!m?.photoDocumentId }
	];
	return badges;
}

/**
 * Records a member's signature for the workspace's current waiver text.
 * Re-signing replaces the stored snapshot (staff edits warrant a fresh agreement).
 */
/** Portal: rate a class the member attended — upserts their one rating per session. */
export async function submitSessionFeedback(
	orgId: string,
	memberId: string,
	sessionId: string,
	rating: number,
	comment?: string
) {
	const [attended] = await db
		.select({ id: booking.id })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.memberId, memberId),
				eq(booking.sessionId, sessionId),
				eq(booking.status, 'attended')
			)
		)
		.limit(1);
	if (!attended) error(403, 'You can only rate classes you attended');
	const [row] = await db
		.insert(sessionFeedback)
		.values({
			organizationId: orgId,
			sessionId,
			memberId,
			rating,
			comment: comment ?? ''
		})
		.onConflictDoUpdate({
			target: [sessionFeedback.sessionId, sessionFeedback.memberId],
			set: { rating, comment: comment ?? '', updatedAt: new Date() }
		})
		.returning();
	if (rating <= 3) notifyLowRating(orgId, sessionId, memberId).catch(() => {});
	return row;
}

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
			memberBookable: classType.memberBookable,
			dropInPrice: classType.dropInPrice,
			booked:
				sql<number>`(select count(*) + coalesce(sum(b.guest_count), 0) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'booked')`.mapWith(
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
	memberId: string,
	opts?: { notify?: boolean; skipDailyLimit?: boolean; guests?: number }
) {
	// Booking window: how far ahead members may book (staff bookings are unrestricted).
	const [s] = await db
		.select({
			startsAt: classSession.startsAt,
			bookingClosed: classSession.bookingClosed,
			classCutoff: classType.bookCutoffMin,
			memberBookable: classType.memberBookable,
			dropInPrice: classType.dropInPrice
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(classSession.organizationId, orgId), eq(classSession.id, sessionId)));
	if (!s) error(404, 'Session not found');
	if (!s.memberBookable) error(409, 'This class is booked at the front desk');
	if (s.bookingClosed) error(409, 'Bookings are closed for this class');
	const { bookingWindowDays, bookCutoffMin } = await bookingRules(orgId);
	// Members without an active plan buy the visit as a drop-in — the class's
	// drop-in charge lands on their balance to pay online or at the desk.
	let ms = await activeMembership(orgId, memberId);
	// Dependents ride on the guardian's plan/pack — check before marking drop-in.
	if (!ms) {
		const [me] = await db
			.select({ guardianId: gymMember.guardianId })
			.from(gymMember)
			.where(eq(gymMember.id, memberId));
		if (me?.guardianId) ms = (await activeMembership(orgId, me.guardianId)) ?? null;
	}
	// A plan's own book-ahead window takes precedence over the gym-wide one.
	const windowDays = ms?.bookAheadDays ?? bookingWindowDays;
	if (windowDays != null && s.startsAt.getTime() > Date.now() + windowDays * 86400_000)
		error(409, `Bookings open ${windowDays} days ahead`);
	const cutoff = s.classCutoff ?? bookCutoffMin;
	if (cutoff != null && s.startsAt.getTime() - Date.now() < cutoff * 60_000)
		error(409, `Booking closes ${cutoff} minutes before class`);
	const dropIn = !ms;
	if (dropIn && (s.dropInPrice == null || s.dropInPrice <= 0))
		error(402, 'An active membership is required to book');
	return bookSession(
		memberCtx(orgId, userId),
		{ sessionId, memberId, dropIn, guests: opts?.guests },
		userId,
		opts
	);
}

/**
 * "Give my spot" — the member hands an upcoming booking to another member by
 * email. Their seat is released (credits returned as with any cancel) and the
 * recipient books it on their own entitlement — an active membership (their own
 * or a guardian's shared pack) is required so no surprise charge lands. If the
 * recipient's book fails after the seat freed, the giver's booking is restored.
 */
export async function giveSpot(
	orgId: string,
	userId: string,
	memberId: string,
	bookingId: string,
	recipientEmail: string
) {
	const [b] = await db
		.select({
			memberId: booking.memberId,
			status: booking.status,
			sessionId: booking.sessionId,
			startsAt: classSession.startsAt
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(and(eq(booking.organizationId, orgId), eq(booking.id, bookingId)));
	if (!b || b.memberId !== memberId) error(404, 'Booking not found');
	if (b.status !== 'booked') error(409, 'Only a booked spot can be given');
	if (b.startsAt.getTime() <= Date.now()) error(409, 'That class already started');
	const email = recipientEmail.trim().toLowerCase();
	const [r] = await db
		.select({ id: gymMember.id, name: gymMember.name, guardianId: gymMember.guardianId })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				sql`lower(${gymMember.email}) = ${email}`
			)
		)
		.limit(1);
	if (!r) error(404, 'No member with that email');
	if (r.id === memberId) error(400, 'That is your own email');
	// Recipient must hold an active membership — their own or a guardian's.
	let rms = await activeMembership(orgId, r.id);
	if (!rms && r.guardianId) rms = await activeMembership(orgId, r.guardianId);
	if (!rms) error(409, `${r.name} has no active membership — they can't take the spot`);
	await cancelBooking(memberCtx(orgId, userId), bookingId, userId, { notify: false });
	try {
		await memberBook(orgId, userId, b.sessionId, r.id, { skipDailyLimit: true });
	} catch (err) {
		// Put the giver's seat back rather than lose it — un-cancel the original
		// row directly. Rebooking via memberBook would re-run level/credit checks
		// the original booking may predate and silently drop the seat. If the
		// freed seat already went to a waitlister, the giver rejoins the queue at
		// the front (createdAt unchanged) instead of vanishing entirely.
		const [[gb], [cap], [{ spots }]] = await Promise.all([
			db
				.select({ guestCount: booking.guestCount, chargeId: booking.chargeId })
				.from(booking)
				.where(eq(booking.id, bookingId)),
			db
				.select({ capacity: classSession.capacity })
				.from(classSession)
				.where(eq(classSession.id, b.sessionId)),
			db
				.select({
					spots: sql<number>`count(*) + coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
				})
				.from(booking)
				.where(and(eq(booking.sessionId, b.sessionId), eq(booking.status, 'booked')))
		]);
		const free = (cap?.capacity ?? 0) - (spots ?? 0);
		await db
			.update(booking)
			.set({
				status: free >= 1 + (gb?.guestCount ?? 0) ? 'booked' : 'waitlisted',
				cancelledAt: null
			})
			.where(eq(booking.id, bookingId));
		// A voided drop-in charge comes back open with the restored booking.
		if (gb?.chargeId)
			await db
				.update(charge)
				.set({ status: 'open', updatedAt: new Date() })
				.where(and(eq(charge.id, gb.chargeId), eq(charge.status, 'void')));
		throw err;
	}
	await emit({
		orgId,
		actorId: userId,
		entityType: 'booking',
		entityId: bookingId,
		action: 'spot_given',
		summary: `Spot given to ${r.name}`
	});
	return { recipient: r.name };
}

/**
 * Makeup offers: bookings the member lost to a gym-side session cancellation
 * and hasn't replaced yet, each with the free candidate sessions of the same
 * class coming up in the next 14 days.
 */
/** Portal: member writes a note on their own upcoming booking — staff see it on the roster. */
export async function setMemberNote(
	orgId: string,
	memberId: string,
	bookingId: string,
	note: string
) {
	const t = note.trim().slice(0, 120) || null;
	const [row] = await db
		.update(booking)
		.set({ memberNote: t })
		.where(
			and(
				eq(booking.id, bookingId),
				eq(booking.memberId, memberId),
				eq(booking.organizationId, orgId)
			)
		)
		.returning();
	if (!row) error(404, 'Booking not found');
	return row;
}

/** Portal: member reports a problem ("locker 12 hinge is broken") → staff Needs-attention. */
export async function reportIssue(orgId: string, memberId: string, text: string) {
	const t = text.trim().slice(0, 300);
	if (!t) error(400, 'Describe the issue first');
	const [row] = await db
		.insert(memberIssue)
		.values({ organizationId: orgId, memberId, text: t })
		.returning();
	return row!;
}

/** Portal: member logs a free-form workout entry ("Ran 5k — 24:30"). */
export async function logWorkout(orgId: string, memberId: string, day: string, text: string) {
	const t = text.trim().slice(0, 500);
	if (!t) error(400, 'Write something first');
	const [row] = await db
		.insert(workoutLog)
		.values({ organizationId: orgId, memberId, day, text: t })
		.returning();
	return row!;
}

export async function memberMakeups(orgId: string, memberId: string) {
	const lost = await db
		.select({
			bookingId: booking.id,
			className: classType.name,
			classTypeId: classSession.classTypeId,
			wasAt: classSession.startsAt,
			replacedBy: sql<
				string | null
			>`(select b2.id from ${booking} b2 where b2.comp_booking_id = ${booking.id} and b2.status != 'cancelled' limit 1)`
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.memberId, memberId),
				eq(booking.status, 'booked'),
				isNotNull(classSession.cancelledAt)
			)
		)
		.orderBy(desc(classSession.startsAt))
		.limit(10);

	const now = new Date();
	const horizon = new Date(Date.now() + 14 * 86_400_000);
	const out = [];
	for (const l of lost) {
		if (l.replacedBy) continue;
		const candidates = await db
			.select({
				sessionId: classSession.id,
				startsAt: classSession.startsAt,
				locationName: location.name,
				free: sql<number>`${classSession.capacity} - (select count(*) + coalesce(sum(b.guest_count), 0) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'booked')`.mapWith(
					Number
				)
			})
			.from(classSession)
			.leftJoin(location, eq(classSession.locationId, location.id))
			.where(
				and(
					eq(classSession.organizationId, orgId),
					eq(classSession.classTypeId, l.classTypeId),
					isNull(classSession.cancelledAt),
					gte(classSession.startsAt, now),
					lt(classSession.startsAt, horizon),
					sql`not exists (select 1 from ${booking} b3 where b3.session_id = ${outer(classSession.id)} and b3.member_id = ${memberId} and b3.status in ('booked','waitlisted'))`
				)
			)
			.orderBy(asc(classSession.startsAt))
			.limit(6);
		if (candidates.length) out.push({ ...l, candidates });
	}
	return out;
}

/**
 * Books the member into a makeup session for a booking they lost to a
 * gym-side cancellation — free, no credit drain, same class only.
 * `compFrom` is validated inside bookSession's row lock.
 */
export async function memberBookMakeup(
	orgId: string,
	userId: string,
	memberId: string,
	compFrom: string,
	sessionId: string
) {
	return bookSession(memberCtx(orgId, userId), { sessionId, memberId }, userId, { compFrom });
}

/**
 * Books the member into every upcoming bookable session of one class — the
 * portal version of staff series booking, so the member booking window and
 * cutoff still apply per session. Sessions they already hold or that fail
 * any rule are skipped; one summary email goes out at the end.
 */
export async function memberBookSeries(
	orgId: string,
	userId: string,
	memberId: string,
	classTypeId: string
) {
	const sessions = (await bookableSessions(memberId)).filter(
		(b) => b.session.classTypeId === classTypeId
	);
	if (!sessions.length) error(404, 'No upcoming sessions for that class');
	let booked = 0;
	let waitlisted = 0;
	let skipped = 0;
	for (const b of sessions) {
		if (b.myStatus && b.myStatus !== 'cancelled') {
			skipped++;
			continue;
		}
		try {
			const r = await memberBook(orgId, userId, b.session.id, memberId, { notify: false });
			if (r.status === 'waitlisted') waitlisted++;
			else booked++;
		} catch {
			skipped++;
		}
	}
	if (!booked && !waitlisted)
		error(409, 'Nothing to book — you are already in every upcoming session of that class');
	notifySeriesBooked(orgId, memberId, sessions[0]!.className, { booked, waitlisted }, 2).catch(
		() => {}
	);
	return { booked, waitlisted, skipped };
}

export async function memberCancel(
	orgId: string,
	userId: string,
	memberId: string,
	bookingId: string
) {
	// Cancel cutoff: no last-minute member cancels unless a late-cancel fee is set
	// (staff can still cancel from the roster regardless).
	const [b] = await db
		.select({ startsAt: classSession.startsAt })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.id, bookingId),
				eq(booking.memberId, memberId)
			)
		);
	if (!b) error(404, 'Booking not found');
	const { cancelCutoffMin, lateCancelFee } = await bookingRules(orgId);
	if (
		cancelCutoffMin != null &&
		!(lateCancelFee != null && lateCancelFee > 0) &&
		b.startsAt.getTime() - Date.now() < cancelCutoffMin * 60_000
	)
		error(409, `Cancelling closes ${cancelCutoffMin} minutes before class`);
	return cancelBooking(memberCtx(orgId, userId), bookingId, userId);
}

/**
 * Moves an upcoming booking to a different session — the portal's one-tap "swap
 * class". The old session's cancel cutoff still applies (a move is a cancel),
 * minus the late-fee escape: inside the cutoff a move is refused outright since
 * the late fee was designed for no-shows, not swaps. The new booking runs through
 * memberBook, so booking window/cutoff/memberBookable/drop-in rules all hold;
 * the daily limit is skipped because the move is count-neutral. If the new class
 * is full the swap is refused (joining the waitlist stays a separate choice) so
 * the member never trades a held spot for a queue position.
 */
export async function memberMoveBooking(
	orgId: string,
	userId: string,
	memberId: string,
	bookingId: string,
	newSessionId: string
) {
	const [b] = await db
		.select({
			memberId: booking.memberId,
			status: booking.status,
			sessionId: booking.sessionId,
			startsAt: classSession.startsAt
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(and(eq(booking.organizationId, orgId), eq(booking.id, bookingId)));
	if (!b || b.memberId !== memberId) error(404, 'Booking not found');
	if (b.sessionId === newSessionId) error(400, 'You are already in that session');
	if (b.status !== 'booked' && b.status !== 'waitlisted') error(409, 'That booking already ended');
	if (b.startsAt.getTime() <= Date.now()) error(409, 'That class already started');
	const { cancelCutoffMin } = await bookingRules(orgId);
	if (cancelCutoffMin != null && b.startsAt.getTime() - Date.now() < cancelCutoffMin * 60_000)
		error(409, `Moving closes ${cancelCutoffMin} minutes before class`);
	const n = await memberBook(orgId, userId, newSessionId, memberId, {
		skipDailyLimit: true
	});
	if (n.status === 'waitlisted') {
		await cancelBooking(memberCtx(orgId, userId), n.id, userId, { notify: false });
		error(409, 'That class is full — join its waitlist from the class list instead');
	}
	// The new spot is held before the old one frees — cancel without the
	// "cancelled" email so the only mail is the new booking's confirmation.
	await cancelBooking(memberCtx(orgId, userId), bookingId, userId, { notify: false });
	return n;
}

async function bookingRules(orgId: string) {
	const [st] = await db
		.select({
			bookingWindowDays: gymSettings.bookingWindowDays,
			bookCutoffMin: gymSettings.bookCutoffMin,
			cancelCutoffMin: gymSettings.cancelCutoffMin,
			lateCancelFee: gymSettings.lateCancelFee
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	return (
		st ?? {
			bookingWindowDays: null,
			bookCutoffMin: null,
			cancelCutoffMin: null,
			lateCancelFee: null
		}
	);
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
export async function requestCancellation(
	orgId: string,
	memberId: string,
	membershipId: string,
	reason?: string
) {
	const [ms] = await db
		.select({ membership, commitmentMonths: plan.commitmentMonths })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.id, membershipId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active')
			)
		);
	if (!ms) error(404, 'Membership not found');
	if (ms.commitmentMonths) {
		let end = ms.membership.createdAt.toISOString().slice(0, 10);
		for (let i = 0; i < ms.commitmentMonths; i++) end = nextPeriod(end, 'month');
		if (end > todayISO())
			error(
				409,
				`Your plan has a ${ms.commitmentMonths}-month commitment through ${end} — talk to the front desk about cancelling early`
			);
	}
	const [row] = await db
		.update(membership)
		.set({ cancelRequestedAt: new Date(), requestReason: reason?.trim() || null })
		.where(eq(membership.id, membershipId))
		.returning();
	if (!row) error(404, 'Membership not found');
	await emit({
		orgId,
		actorId: null,
		entityType: 'membership',
		entityId: membershipId,
		action: 'cancel_requested',
		summary: 'Member requested cancellation',
		data: { memberId, reason }
	});
	notifyCancellationRequested(orgId, membershipId).catch(() => {});
	return row;
}

/**
 * Member asks to pause a membership, picking the date it should resume.
 * Staff approve from the member page — the request never pauses billing by
 * itself. `resumeOn` is a YYYY-MM-DD date in the gym's timezone.
 */
export async function requestPause(
	orgId: string,
	memberId: string,
	membershipId: string,
	resumeOn: string,
	reason?: string
) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const today = localDate(new Date(), st?.timezone ?? 'UTC');
	if (resumeOn <= today) error(400, 'Pick a resume date after today');
	if (resumeOn > addDays(today, 366)) error(400, 'Pick a resume date within a year');
	const [row] = await db
		.update(membership)
		.set({
			pauseRequestedAt: new Date(),
			pauseUntil: resumeOn,
			requestReason: reason?.trim() || null
		})
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
		action: 'pause_requested',
		summary: `Member requested a pause until ${resumeOn}`,
		data: { memberId, resumeOn, reason }
	});
	notifyPauseRequested(orgId, membershipId).catch(() => {});
	return row;
}

/** Member changes their mind on a pending pause request. */
export async function withdrawPause(orgId: string, memberId: string, membershipId: string) {
	const [row] = await db
		.update(membership)
		.set({ pauseRequestedAt: null, pauseUntil: null, requestReason: null })
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

/** Member changes their mind before staff act on the request. */
export async function withdrawCancellation(orgId: string, memberId: string, membershipId: string) {
	const [row] = await db
		.update(membership)
		.set({ cancelRequestedAt: null, requestReason: null })
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

/**
 * Member asks staff to stop a recurring add-on (PT package, towel service).
 * Sets `removalRequestedAt` — the charge keeps posting until staff deactivate
 * it, and the request is surfaced on the dashboard and the Billing tab.
 */
export async function requestAddOnRemoval(orgId: string, memberId: string, addOnId: string) {
	const [row] = await db
		.select()
		.from(recurringCharge)
		.where(
			and(
				eq(recurringCharge.id, addOnId),
				eq(recurringCharge.memberId, memberId),
				eq(recurringCharge.organizationId, orgId),
				eq(recurringCharge.active, true)
			)
		);
	if (!row) error(404, 'Add-on not found');
	if (row.removalRequestedAt) return row;
	const [updated] = await db
		.update(recurringCharge)
		.set({ removalRequestedAt: new Date(), updatedAt: new Date() })
		.where(eq(recurringCharge.id, row.id))
		.returning();
	await db.insert(memberNote).values({
		organizationId: orgId,
		memberId,
		body: `Requested removal of recurring add-on: ${row.description} (${formatMoney(row.amount)}/${row.interval})`
	});
	await emit({
		orgId,
		actorId: null,
		entityType: 'recurring_charge',
		entityId: row.id,
		action: 'cancel_requested',
		summary: `Member asked to stop ${row.description}`,
		data: { memberId }
	});
	return updated;
}

/** Member re-enables gym emails after using the unsubscribe link. */
export async function resubscribe(memberId: string) {
	await db.update(gymMember).set({ unsubscribedAt: null }).where(eq(gymMember.id, memberId));
}

/**
 * Member self-service profile edit — name, phone, birthday. Email stays
 * staff-managed (it's tied to claim links, unsubscribe state and billing mail).
 */
export async function updatePortalProfile(
	orgId: string,
	memberId: string,
	input: {
		name: string;
		phone?: string | null;
		birthday?: string | null;
		emergencyName?: string | null;
		emergencyPhone?: string | null;
	}
) {
	const name = input.name.trim();
	if (!name) error(400, 'Name is required');
	const [row] = await db
		.update(gymMember)
		.set({
			name,
			phone: input.phone?.trim() || null,
			birthday: input.birthday || null,
			emergencyName: input.emergencyName?.trim() || null,
			emergencyPhone: input.emergencyPhone?.trim() || null
		})
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)))
		.returning({ id: gymMember.id });
	if (!row) error(404, 'Member not found');
	await emit({
		orgId,
		actorId: null,
		entityType: 'member',
		entityId: memberId,
		action: 'profile_updated',
		summary: `${name} updated their profile from the portal`
	});
	return row;
}

/** Member sets (or clears with null) their own monthly visit goal. */
export async function setVisitGoal(orgId: string, memberId: string, goal: number | null) {
	if (goal !== null && (goal < 1 || goal > 60)) error(400, 'Goal must be 1–60 visits');
	const [row] = await db
		.update(gymMember)
		.set({ goalVisitsPerMonth: goal })
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)))
		.returning({ id: gymMember.id });
	if (!row) error(404, 'Member not found');
	return row;
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
 * Member buys a one-off class pack from the portal. Stacks alongside any
 * membership (unlike plans, which are exclusive) — the pack's single charge
 * posts to their balance and is paid via the normal portal checkout.
 */
export async function memberBuyPack(orgId: string, memberId: string, planId: string) {
	const p = await getPlan(orgId, planId);
	if (!p.active || !p.listed || !p.isPack) error(404, 'Pack not available');
	const [existing] = await db
		.select({ id: membership.id })
		.from(membership)
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.planId, planId),
				eq(membership.status, 'active')
			)
		)
		.limit(1);
	if (existing) error(409, 'You already have this pack');
	return createMembership({ orgId }, { memberId, planId });
}

/**
 * Member switches their active membership to another listed plan from the
 * portal. Takes effect immediately for access/credits; billing reads the plan
 * at charge time, so the next scheduled bill is at the new price (no signup
 * fee, no new trial). The price difference for the rest of the current period
 * is prorated: an upgrade posts a charge due today, a downgrade posts an
 * account credit. Packs are excluded — a pack is a one-time purchase, not a
 * switchable plan.
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
	await assertPlanCapacity(orgId, p);
	const [row] = await db
		.update(membership)
		.set({ planId })
		.where(eq(membership.id, ms.membership.id))
		.returning();
	const prorated = await proratePlanChange(
		{ orgId },
		ms.membership,
		{ name: ms.plan.name, amount: ms.plan.amount, interval: ms.plan.interval },
		p
	);
	await emit({
		orgId,
		entityType: 'membership',
		entityId: ms.membership.id,
		action: 'plan_changed',
		summary: `Plan changed from ${ms.plan.name} to ${p.name} (member self-serve)${prorated ? ` — prorated ${formatMoney(prorated)}` : ''}`
	});
	notifyPlanChanged(orgId, ms.membership.id, ms.plan.name).catch(() => {});
	return { row, prorated };
}

/**
 * Logs (or updates) the member's score on a session's workout of the day.
 * Requires the member to have attended and the session to actually have a WOD.
 */
export async function logWorkoutResult(
	orgId: string,
	memberId: string,
	sessionId: string,
	score: string,
	asRx: boolean
) {
	const trimmed = score.trim();
	if (!trimmed || trimmed.length > 120) error(400, 'Score must be 1-120 characters');
	const [sess] = await db
		.select({ workout: classSession.workout })
		.from(classSession)
		.where(and(eq(classSession.id, sessionId), eq(classSession.organizationId, orgId)))
		.limit(1);
	if (!sess?.workout) error(404, 'No workout logged for that session');
	const [attended] = await db
		.select({ id: booking.id })
		.from(booking)
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.memberId, memberId),
				eq(booking.sessionId, sessionId),
				eq(booking.status, 'attended')
			)
		)
		.limit(1);
	if (!attended) error(403, 'You can only log a score on classes you attended');
	const [row] = await db
		.insert(workoutResult)
		.values({ organizationId: orgId, sessionId, memberId, score: trimmed, asRx })
		.onConflictDoUpdate({
			target: [workoutResult.sessionId, workoutResult.memberId],
			set: { score: trimmed, asRx, updatedAt: new Date() }
		})
		.returning();
	return row;
}

/**
 * Retention "save" offer: a member about to cancel takes N% off their next
 * bill instead of submitting the request. One per membership — `saveOfferAt`
 * stamps it so the offer can't be farmed; the credit applies like a
 * proration credit (kept out of revenue sums).
 */
export async function acceptSaveOffer(orgId: string, memberId: string) {
	const [settings] = await db
		.select({ saveOfferPct: gymSettings.saveOfferPct })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const pct = settings?.saveOfferPct ?? 0;
	if (pct <= 0) error(404, 'No save offer configured');
	const [ms] = await db
		.select({ membership, plan })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active')
			)
		)
		.orderBy(desc(membership.createdAt))
		.limit(1);
	if (!ms) error(404, 'No active membership');
	if (ms.membership.saveOfferAt) error(409, 'This offer can only be used once');
	const base = ms.membership.price ?? ms.plan.amount;
	const credit = Math.round((base * pct) / 100);
	if (credit <= 0) error(400, 'Nothing to discount');
	await recordPayment(
		{ orgId },
		{
			memberId,
			amount: credit,
			method: 'credit',
			notes: `Stay offer — ${pct}% off ${ms.plan.name}`
		},
		{ silent: true }
	);
	await db
		.update(membership)
		.set({ saveOfferAt: new Date() })
		.where(eq(membership.id, ms.membership.id));
	await emit({
		orgId,
		entityType: 'membership',
		entityId: ms.membership.id,
		action: 'save_offer',
		summary: `Stay offer accepted — ${pct}% off (${formatMoney(credit)})`
	});
	return { credit };
}

// ---------- Portal shop — members buy retail, pay the gym tab ----------

/** Active items the member can buy in the portal (active only, stock-aware). */
export async function memberShopItems(orgId: string) {
	return db
		.select()
		.from(shopItem)
		.where(and(eq(shopItem.organizationId, orgId), eq(shopItem.active, true)))
		.orderBy(asc(shopItem.name));
}

/** The member's recent shop purchases with pickup status. */
export async function memberPurchases(orgId: string, memberId: string) {
	return db
		.select({
			id: shopSale.id,
			qty: shopSale.qty,
			createdAt: shopSale.createdAt,
			pickedUpAt: shopSale.pickedUpAt,
			itemName: shopItem.name,
			price: shopItem.price
		})
		.from(shopSale)
		.innerJoin(shopItem, eq(shopSale.itemId, shopItem.id))
		.where(and(eq(shopSale.organizationId, orgId), eq(shopSale.memberId, memberId)))
		.orderBy(desc(shopSale.createdAt))
		.limit(15);
}

/**
 * Buys one of an item — posts an 'other' charge on the member's tab and
 * decrements stock. Pick-up is at the desk; no member-facing inventory.
 */
export async function memberBuyItem(
	orgId: string,
	userId: string,
	memberId: string,
	itemId: string
) {
	return sellItem(memberCtx(orgId, userId), {
		itemId,
		memberId,
		qty: 1,
		payNow: false,
		method: 'card'
	});
}

// ---------- Signature requests + movement library (portal) ----------

/** Documents the member can see — pending first so 'to sign' is always on top. */
export async function memberSignRequests(orgId: string, memberId: string) {
	return db
		.select()
		.from(signRequest)
		.where(and(eq(signRequest.organizationId, orgId), eq(signRequest.memberId, memberId)))
		.orderBy(
			sql`case when ${signRequest.status} = 'pending' then 0 else 1 end`,
			desc(signRequest.createdAt)
		)
		.limit(25);
}

/**
 * Coaching videos for the class types the member has booked or attended in the
 * last 60 days — the 'how do I do this movement' library.
 */
export async function memberClassVideos(orgId: string, memberId: string) {
	return db
		.select({ video: classVideo, className: classType.name })
		.from(classVideo)
		.innerJoin(classType, eq(classVideo.classTypeId, classType.id))
		.where(
			and(
				eq(classVideo.organizationId, orgId),
				sql`exists (
					select 1 from ${booking} b
					join ${classSession} s on s.id = b.session_id
					where b.member_id = ${memberId}
					and b.status != 'cancelled'
					and s.class_type_id = ${classVideo.classTypeId}
					and s.starts_at > now() - interval '60 days'
				)`
			)
		)
		.orderBy(asc(classType.name), asc(classVideo.title))
		.limit(50);
}

/** Member flips pack auto-renew on one of their own pack memberships. */
export async function memberSetPackAutoRenew(
	orgId: string,
	memberId: string,
	membershipId: string,
	on: boolean
) {
	const [row] = await db
		.update(membership)
		.set({ autoRenew: on })
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.id, membershipId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'active'),
				sql`exists (select 1 from ${plan} p where p.id = ${membership.planId} and p.is_pack)`
			)
		)
		.returning();
	if (!row) error(404, 'Pack membership not found');
	await emit({
		orgId,
		entityType: 'membership',
		entityId: membershipId,
		action: 'updated',
		summary: `Auto-renew ${on ? 'on' : 'off'}`
	});
	return row;
}

/** Everything we hold on one member — portal "download my data" export. */
export async function exportMemberData(orgId: string, memberId: string) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [
		memberships,
		charges,
		payments,
		checkIns,
		bookings,
		prs,
		measurements,
		documents,
		signRequests,
		waivers
	] = await Promise.all([
		db
			.select({ membership, planName: plan.name })
			.from(membership)
			.leftJoin(plan, eq(membership.planId, plan.id))
			.where(eq(membership.memberId, memberId)),
		db.select().from(charge).where(eq(charge.memberId, memberId)),
		db.select().from(payment).where(eq(payment.memberId, memberId)),
		db.select().from(checkIn).where(eq(checkIn.memberId, memberId)),
		db.select().from(booking).where(eq(booking.memberId, memberId)),
		db.select().from(personalRecord).where(eq(personalRecord.memberId, memberId)),
		db.select().from(memberMeasurement).where(eq(memberMeasurement.memberId, memberId)),
		db
			.select({
				id: document.id,
				name: document.name,
				contentType: document.contentType,
				size: document.size,
				createdAt: document.createdAt
			})
			.from(document)
			.where(
				and(
					eq(document.organizationId, orgId),
					eq(document.entityType, 'member'),
					eq(document.entityId, memberId)
				)
			),
		db.select().from(signRequest).where(eq(signRequest.memberId, memberId)),
		db.select().from(waiver).where(eq(waiver.memberId, memberId))
	]);
	return {
		exportedAt: new Date().toISOString(),
		member: m,
		memberships,
		charges,
		payments,
		checkIns,
		bookings,
		personalRecords: prs,
		measurements,
		documents,
		signRequests,
		waivers
	};
}

/** Latest satisfaction score — the portal asks once every 90 days. */
export async function npsStatus(orgId: string, memberId: string) {
	const cutoff = new Date(Date.now() - 90 * 86400_000);
	const [row] = await db
		.select({ id: memberNps.id })
		.from(memberNps)
		.where(
			and(
				eq(memberNps.organizationId, orgId),
				eq(memberNps.memberId, memberId),
				gte(memberNps.createdAt, cutoff)
			)
		)
		.limit(1);
	return { due: !row };
}

export async function submitNps(
	orgId: string,
	memberId: string,
	userId: string | null,
	score: number,
	comment?: string
) {
	if (score < 0 || score > 10) error(400, 'Score must be 0–10');
	const [row] = await db
		.insert(memberNps)
		.values({ organizationId: orgId, memberId, score, comment: comment || null })
		.returning();
	emit({
		orgId,
		actorId: null,
		entityType: 'member',
		entityId: memberId,
		action: 'updated',
		summary: `Left feedback — ${score}/10`
	});
	return row;
}

/** All-time check-ins (guest visits excluded) — feeds the loyalty tier. */
async function lifetimeVisits(orgId: string, memberId: string) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.guestName)
			)
		);
	return n;
}

/** "Your year" card: visits YTD, the member's most-attended class, PRs logged this year. */
async function yearRecap(orgId: string, memberId: string) {
	const yearStart = new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`);
	const [visits, prs, top] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(checkIn)
			.where(
				and(
					eq(checkIn.organizationId, orgId),
					eq(checkIn.memberId, memberId),
					isNull(checkIn.guestName),
					gte(checkIn.checkedAt, yearStart)
				)
			),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(personalRecord)
			.where(
				and(
					eq(personalRecord.organizationId, orgId),
					eq(personalRecord.memberId, memberId),
					gte(personalRecord.createdAt, yearStart)
				)
			),
		db
			.select({ name: classType.name, n: sql<number>`count(*)`.mapWith(Number) })
			.from(booking)
			.innerJoin(classSession, eq(booking.sessionId, classSession.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(
				and(
					eq(booking.organizationId, orgId),
					eq(booking.memberId, memberId),
					eq(booking.status, 'attended'),
					gte(classSession.startsAt, yearStart)
				)
			)
			.groupBy(classType.name)
			.orderBy(desc(sql`count(*)`))
			.limit(1)
	]);
	return {
		visits: visits[0]?.n ?? 0,
		prs: prs[0]?.n ?? 0,
		topClass: top[0]?.name ?? null,
		topCount: top[0]?.n ?? 0
	};
}

/** Class-alert toggles: every member-bookable class type + whether this member watches it. */
async function watchList(orgId: string, memberId: string) {
	const [types, watches] = await Promise.all([
		db
			.select({ id: classType.id, name: classType.name })
			.from(classType)
			.where(
				and(
					eq(classType.organizationId, orgId),
					eq(classType.active, true),
					eq(classType.memberBookable, true)
				)
			)
			.orderBy(asc(classType.name)),
		db
			.select({ classTypeId: classWatch.classTypeId })
			.from(classWatch)
			.where(and(eq(classWatch.organizationId, orgId), eq(classWatch.memberId, memberId)))
	]);
	const watching = new Set(watches.map((w) => w.classTypeId));
	return types.map((t) => ({ ...t, watching: watching.has(t.id) }));
}

/**
 * Portal "Cancel all upcoming {class}" — cancels every future booked session of one
 * class type for the member in one tap (series undo). Skips anything inside the
 * cancel cutoff since those are already locked; returns how many were cancelled.
 */
export async function memberCancelAllUpcoming(
	orgId: string,
	userId: string,
	memberId: string,
	classTypeId: string
) {
	const { cancelCutoffMin } = await bookingRules(orgId);
	const rows = await db
		.select({ id: booking.id, startsAt: classSession.startsAt })
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.memberId, memberId),
				eq(classSession.classTypeId, classTypeId),
				inArray(booking.status, ['booked', 'waitlisted']),
				isNull(classSession.cancelledAt),
				gt(classSession.startsAt, new Date())
			)
		);
	let cancelled = 0;
	for (const b of rows) {
		if (cancelCutoffMin != null && b.startsAt.getTime() - Date.now() < cancelCutoffMin * 60_000)
			continue;
		await cancelBooking(memberCtx(orgId, userId), b.id, userId);
		cancelled++;
	}
	return { cancelled, skipped: rows.length - cancelled };
}
