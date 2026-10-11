import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import {
	classType,
	classWatch,
	document,
	gymMember,
	membership,
	outer,
	plan
} from '#lib/server/db/schema.ts';
import { and, asc, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import * as svc from '#lib/server/services/portal.ts';
import * as billingSvc from '#lib/server/services/billing.ts';
import * as progSvc from '#lib/server/services/programs.ts';
import * as crs from '#lib/server/services/courses.ts';
import * as memberSvc from '#lib/server/services/members.ts';
import * as woSvc from '#lib/server/services/workouts.ts';
import * as resSvc from '#lib/server/services/resources.ts';
import * as ptSvc from '#lib/server/services/pt.ts';
import * as evtSvc from '#lib/server/services/gym-events.ts';
import * as checkinSvc from '#lib/server/services/checkins.ts';
import * as chalSvc from '#lib/server/services/challenges.ts';
import * as gcSvc from '#lib/server/services/giftcards.ts';
import * as notif from '#lib/server/services/notifications.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { zonedToUtc } from '#lib/tz.ts';
import { emit } from '#lib/server/services/events.ts';
import {
	idSchema,
	measurementInput,
	prInput,
	resourceBookInput,
	sessionFeedbackInput,
	giftCreditsInput
} from '#lib/schemas.ts';
import { aiAvailable, requireAi } from '#lib/server/ee/ai.ts';
import {
	healthFormsEnabled,
	PARQ_QUESTIONS,
	requireHealthForms,
	submitParq as hfSubmit
} from '#lib/server/ee/health-forms.ts';
import { workoutPlan } from '#lib/server/ee/ai-features.ts';

/** Resolves the member record the signed-in user is acting as — their own record, or a dependent billing under it. */
async function myMember(memberId: string) {
	const { user } = requireUser();
	const [m] = await db.select().from(gymMember).where(eq(gymMember.id, memberId));
	if (!m) error(403, 'Not your member record');
	if (m.portalUserId !== user.id) {
		const [guardian] = m.guardianId
			? await db
					.select({ id: gymMember.id })
					.from(gymMember)
					.where(and(eq(gymMember.id, m.guardianId), eq(gymMember.portalUserId, user.id)))
					.limit(1)
			: [];
		if (!guardian) error(403, 'Not your member record');
	}
	return m;
}

export const getPortalOverview = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.portalOverview(m.id);
});

/**
 * Member freezes their own active membership for `days` days, capped by the
 * gym's selfFreezeDays-per-year setting. Pauses billing until frozenUntil.
 */
export const selfFreezeMembership = command(
	v.object({
		memberId: idSchema,
		membershipId: idSchema,
		days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))
	}),
	async ({ memberId, membershipId, days }) => {
		const m = await myMember(memberId);
		try {
			return await billingSvc.selfFreezeMembership(m.organizationId, m.id, membershipId, days);
		} finally {
			void getPortalOverview(memberId).refresh();
		}
	}
);

export const getBookable = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.bookableSessions(m.id);
});

/** The member hands an upcoming booking to another member by email. */
export const logWorkout = command(
	v.object({
		memberId: idSchema,
		day: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
		text: v.pipe(v.string(), v.minLength(1), v.maxLength(500))
	}),
	async ({ memberId, day, text }) => {
		const m = await myMember(memberId);
		return await svc.logWorkout(
			m.organizationId,
			m.id,
			day ?? new Date().toISOString().slice(0, 10),
			text
		);
	}
);

export const setMyBookingNote = command(
	v.object({
		memberId: idSchema,
		bookingId: idSchema,
		note: v.optional(v.pipe(v.string(), v.maxLength(120)))
	}),
	async ({ memberId, bookingId, note }) => {
		const m = await myMember(memberId);
		return await svc.setMemberNote(m.organizationId, m.id, bookingId, note ?? '');
	}
);

export const reportIssue = command(
	v.object({
		memberId: idSchema,
		text: v.pipe(v.string(), v.minLength(1), v.maxLength(300))
	}),
	async ({ memberId, text }) => {
		const m = await myMember(memberId);
		return await svc.reportIssue(m.organizationId, m.id, text);
	}
);

export const memberGiveSpot = command(
	v.object({
		memberId: idSchema,
		bookingId: idSchema,
		email: v.pipe(v.string(), v.trim(), v.email())
	}),
	async ({ memberId, bookingId, email }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		try {
			return await svc.giveSpot(m.organizationId, user.id, m.id, bookingId, email);
		} finally {
			void getPortalOverview(memberId).refresh();
			void getBookable(memberId).refresh();
		}
	}
);

export const memberBook = command(
	v.object({
		memberId: idSchema,
		sessionId: idSchema,
		guests: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(5)))
	}),
	async ({ memberId, sessionId, guests }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const b = await svc.memberBook(m.organizationId, user.id, sessionId, m.id, { guests });
		void getBookable(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return b;
	}
);

/** Books the member into every upcoming session of one class (the 2-week bookable window). */
export const memberBookSeries = command(
	v.object({ memberId: idSchema, classTypeId: idSchema }),
	async ({ memberId, classTypeId }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const r = await svc.memberBookSeries(m.organizationId, user.id, m.id, classTypeId);
		void getBookable(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Rate a class the member attended — one rating per session, editable. */
export const rateSession = command(sessionFeedbackInput, async (input) => {
	const m = await myMember(input.memberId);
	const r = await svc.submitSessionFeedback(
		m.organizationId,
		m.id,
		input.sessionId,
		input.rating,
		input.comment
	);
	void getPortalOverview(input.memberId).refresh();
	return r;
});

export const signWaiver = command(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	const w = await svc.signWaiver(m.organizationId, m.id);
	void getPortalOverview(memberId).refresh();
	return w;
});

export const memberCancel = command(
	v.object({ memberId: idSchema, bookingId: idSchema }),
	async ({ memberId, bookingId }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const b = await svc.memberCancel(m.organizationId, user.id, m.id, bookingId);
		void getBookable(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return b;
	}
);

/** Drops one upcoming occurrence of an enrolled course without unenrolling. */
/** Cancel every upcoming booking the member has for one class type. */
export const memberCancelSeries = command(
	v.object({ memberId: v.pipe(v.string(), v.uuid()), classTypeId: v.pipe(v.string(), v.uuid()) }),
	async ({ memberId, classTypeId }) => {
		const { user } = requireUser();
		const m = await myMember(memberId);
		return svc.memberCancelAllUpcoming(m.organizationId, user.id, m.id, classTypeId);
	}
);

export const dropCourseSession = command(
	v.object({ memberId: idSchema, bookingId: idSchema }),
	async ({ memberId, bookingId }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const b = await svc.memberCancel(m.organizationId, user.id, m.id, bookingId);
		void getPortalCourses(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return b;
	}
);

/** Member asks staff to stop a recurring add-on — staff deactivate on their side. */
export const requestAddonRemoval = command(
	v.object({ memberId: idSchema, addOnId: idSchema }),
	async ({ memberId, addOnId }) => {
		const m = await myMember(memberId);
		const r = await svc.requestAddOnRemoval(m.organizationId, m.id, addOnId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Re-books a previously dropped course occurrence — waitlisted when full. */
export const rebookCourseSession = command(
	v.object({ memberId: idSchema, bookingId: idSchema }),
	async ({ memberId, bookingId }) => {
		const m = await myMember(memberId);
		const b = await crs.rebookCourseSession(m.organizationId, m.id, bookingId);
		void getPortalCourses(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return b;
	}
);

/** Moves an upcoming booking to a different session — one-tap swap. */
export const memberMove = command(
	v.object({ memberId: idSchema, bookingId: idSchema, sessionId: idSchema }),
	async ({ memberId, bookingId, sessionId }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const b = await svc.memberMoveBooking(m.organizationId, user.id, m.id, bookingId, sessionId);
		void getBookable(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return b;
	}
);

const reasonField = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)));

export const requestMembershipCancel = command(
	v.object({ memberId: idSchema, membershipId: idSchema, reason: reasonField }),
	async ({ memberId, membershipId, reason }) => {
		const m = await myMember(memberId);
		const r = await svc.requestCancellation(m.organizationId, m.id, membershipId, reason);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const requestMembershipPause = command(
	v.object({
		memberId: idSchema,
		membershipId: idSchema,
		resumeOn: v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD')),
		reason: reasonField
	}),
	async ({ memberId, membershipId, resumeOn, reason }) => {
		const m = await myMember(memberId);
		const r = await svc.requestPause(m.organizationId, m.id, membershipId, resumeOn, reason);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const withdrawMembershipPause = command(
	v.object({ memberId: idSchema, membershipId: idSchema }),
	async ({ memberId, membershipId }) => {
		const m = await myMember(memberId);
		const r = await svc.withdrawPause(m.organizationId, m.id, membershipId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const withdrawMembershipCancel = command(
	v.object({ memberId: idSchema, membershipId: idSchema }),
	async ({ memberId, membershipId }) => {
		const m = await myMember(memberId);
		const r = await svc.withdrawCancellation(m.organizationId, m.id, membershipId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const getProviders = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	const overview = await svc.portalOverview(m.id);
	return svc.availableProviders(m.organizationId, overview.settings?.currency ?? 'usd');
});

export const startCheckout = command(
	v.object({ memberId: idSchema, provider: v.string() }),
	async ({ memberId, provider }) => {
		const m = await myMember(memberId);
		return { url: await svc.portalCheckout(m.id, provider) };
	}
);

/** The member's own documents — the portal Documents card. */
export const getMyDocuments = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return db
		.select({
			id: document.id,
			name: document.name,
			contentType: document.contentType,
			size: document.size,
			createdAt: document.createdAt
		})
		.from(document)
		.where(and(eq(document.entityType, 'member'), eq(document.entityId, m.id)))
		.orderBy(desc(document.createdAt));
});

/** Member turns gym emails back on after unsubscribing. */
export const resubscribe = command(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	await svc.resubscribe(m.id);
	void getPortalOverview(memberId).refresh();
});

/** Listed + active plans the member can self-join (the public page's plan set). */
export const getJoinablePlans = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return db
		.select({
			...getTableColumns(plan),
			packClassName: classType.name,
			activeMembers:
				sql<number>`(select count(*) from ${membership} mm where mm.plan_id = ${outer(plan.id)} and mm.status = 'active')`.mapWith(
					Number
				)
		})
		.from(plan)
		.leftJoin(classType, eq(plan.classTypeId, classType.id))
		.where(
			and(eq(plan.organizationId, m.organizationId), eq(plan.active, true), eq(plan.listed, true))
		)
		.orderBy(asc(plan.amount));
});

export const getMeasurements = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return memberSvc.listMeasurements(m.organizationId, m.id);
});

export const logMeasurement = command(
	v.object({ memberId: idSchema, ...measurementInput.entries }),
	async ({ memberId, ...input }) => {
		const m = await myMember(memberId);
		const r = await memberSvc.addMeasurement(m.organizationId, m.id, input);
		void getMeasurements(memberId).refresh();
		return r;
	}
);

export const removeMeasurement = command(
	v.object({ memberId: idSchema, id: idSchema }),
	async ({ memberId, id }) => {
		const m = await myMember(memberId);
		await memberSvc.deleteMeasurement(m.organizationId, m.id, id);
		void getMeasurements(memberId).refresh();
	}
);

export const joinPlan = command(
	v.object({ memberId: idSchema, planId: idSchema }),
	async ({ memberId, planId }) => {
		const m = await myMember(memberId);
		const r = await svc.memberJoinPlan(m.organizationId, m.id, planId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Member buys a class pack — stacks on top of a regular membership. */
export const buyPack = command(
	v.object({ memberId: idSchema, planId: idSchema }),
	async ({ memberId, planId }) => {
		const m = await myMember(memberId);
		const r = await svc.memberBuyPack(m.organizationId, m.id, planId);
		void getPortalOverview(memberId).refresh();
		void getJoinablePlans(memberId).refresh();
		return r;
	}
);

/** Member redeems a gift card code — drains it across their open charges, leftover becomes account credit. */
export const redeemGiftCard = command(
	v.object({ memberId: idSchema, code: v.string() }),
	async ({ memberId, code }) => {
		const m = await myMember(memberId);
		const r = await gcSvc.redeemGiftCard(m.organizationId, m.id, code);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const changePlan = command(
	v.object({ memberId: idSchema, planId: idSchema }),
	async ({ memberId, planId }) => {
		const m = await myMember(memberId);
		const r = await svc.memberChangePlan(m.organizationId, m.id, planId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Member edits their own profile (name, phone, birthday — not email). */
export const updateProfile = command(
	v.object({
		memberId: idSchema,
		name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
		phone: v.optional(v.nullable(v.string())),
		birthday: v.optional(v.nullable(v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD')))),
		emergencyName: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(80)))),
		emergencyPhone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(30))))
	}),
	async ({ memberId, ...input }) => {
		const m = await myMember(memberId);
		const r = await svc.updatePortalProfile(m.organizationId, m.id, input);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Member asks for their personal data to be deleted — staff anonymize. */
export const requestDataDeletion = command(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	const r = await memberSvc.requestDataDeletion(m.organizationId, m.id);
	void getPortalOverview(memberId).refresh();
	return r;
});

// ---------- Resource reservations (sauna, court, child care) ----------

/** Active bookable amenities for the member's gym. */
export const getPortalResources = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	const rows = await resSvc.listResources(m.organizationId);
	return rows.filter((r) => r.resource.active);
});

/** Slot grid for one resource on one day. */
export const getResourceDay = query(
	v.object({ memberId: idSchema, resourceId: idSchema, day: v.pipe(v.string(), v.isoDate()) }),
	async ({ memberId, resourceId, day }) => {
		const m = await myMember(memberId);
		const st = await getSettings(m.organizationId);
		return resSvc.resourceAvailability(m.organizationId, resourceId, day, st.timezone);
	}
);

/** The member's upcoming reservations. */
export const getReservations = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return resSvc.memberReservations(m.organizationId, m.id);
});

export const bookResource = command(resourceBookInput, async ({ memberId, ...input }) => {
	const m = await myMember(memberId);
	const st = await getSettings(m.organizationId);
	const r = await resSvc.bookResource(
		m.organizationId,
		m.id,
		input.resourceId,
		input.day,
		input.time,
		input.note,
		st.timezone
	);
	void getReservations(memberId).refresh();
	return r;
});

export const cancelReservation = command(
	v.object({ memberId: idSchema, id: idSchema }),
	async ({ memberId, id }) => {
		const m = await myMember(memberId);
		const r = await resSvc.cancelResourceBooking(m.organizationId, id, m.id);
		void getReservations(memberId).refresh();
		return r;
	}
);

/** The member's weekly amenity rules. */
export const getAmenityRules = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return resSvc.memberRecurringRules(m.organizationId, m.id);
});

/** Turn a reservation into a weekly rule at the same weekday+time. */
export const repeatAmenityWeekly = command(
	v.object({ memberId: idSchema, bookingId: idSchema }),
	async ({ memberId, bookingId }) => {
		const m = await myMember(memberId);
		const st = await getSettings(m.organizationId);
		const r = await resSvc.repeatResourceWeekly(m.organizationId, m.id, bookingId, st.timezone);
		void getAmenityRules(memberId).refresh();
		return r;
	}
);

export const cancelAmenityRule = command(
	v.object({ memberId: idSchema, ruleId: idSchema }),
	async ({ memberId, ruleId }) => {
		const m = await myMember(memberId);
		const r = await resSvc.cancelResourceRecurring(m.organizationId, m.id, ruleId);
		void getAmenityRules(memberId).refresh();
		return r;
	}
);

// ---------- PT (1:1) session requests ----------

/** Coaches the member can request a session with. */
export const getPtCoaches = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return ptSvc.ptCoaches(m.organizationId);
});

export const getMyPtRequests = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return ptSvc.memberPtRequests(m.organizationId, m.id);
});

export const requestPt = command(
	v.object({
		memberId: idSchema,
		instructorId: v.optional(v.nullable(idSchema)),
		preferredAt: v.pipe(v.string(), v.nonEmpty('Pick a date and time')),
		note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)))
	}),
	async ({ memberId, instructorId, preferredAt, note }) => {
		const m = await myMember(memberId);
		const st = await getSettings(m.organizationId);
		const when = zonedToUtc(preferredAt, st.timezone ?? 'UTC');
		const r = await ptSvc.requestPt(m.organizationId, m.id, instructorId, when, note);
		void getMyPtRequests(memberId).refresh();
		return r;
	}
);

// ---------- Events (workshops, comps) ----------

/** Upcoming member-bookable events with this member's registration status. */
export const getPortalEvents = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return evtSvc.memberEvents(m.organizationId, m.id);
});

export const registerEvent = command(
	v.object({ memberId: idSchema, eventId: idSchema }),
	async ({ memberId, eventId }) => {
		const m = await myMember(memberId);
		const r = await evtSvc.registerForEvent(m.organizationId, m.id, eventId);
		void getPortalEvents(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const cancelEventReg = command(
	v.object({ memberId: idSchema, id: idSchema }),
	async ({ memberId, id }) => {
		const m = await myMember(memberId);
		const r = await evtSvc.cancelRegistration(m.organizationId, id, m.id);
		void getPortalEvents(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

// ---------- Class check-in code ----------

/** Member types the code the coach announced — marks their booking attended + logs a check-in. */
export const checkInWithCode = command(
	v.object({
		memberId: idSchema,
		code: v.pipe(v.string(), v.trim(), v.minLength(4), v.maxLength(8))
	}),
	async ({ memberId, code }) => {
		const m = await myMember(memberId);
		const r = await checkinSvc.checkInWithCode(m.organizationId, m.id, code);
		void getPortalOverview(memberId).refresh();
		void getBookable(memberId).refresh();
		return r;
	}
);

// ---------- Challenges ----------

export const getPortalChallenges = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return chalSvc.portalChallenges(m.organizationId, m.id);
});

export const getPortalBadges = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	const st = await getSettings(m.organizationId);
	return svc.portalBadges(m.organizationId, m.id, st.timezone ?? 'UTC');
});

/** Announcements this member was actually sent — the portal's News feed. */
/** Stamps openedAt on the member's announcement rows when the News card renders. */
export const markNewsRead = command(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	if (!m || !m.email) return;
	await notif.markAnnouncementsRead(m.organizationId, m.email);
});

/** Makeup offers for bookings lost to gym-side class cancellations. */
export const getMakeups = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	if (!m) error(404);
	return svc.memberMakeups(m.organizationId, memberId);
});

export const bookMakeup = command(
	v.object({ memberId: idSchema, compFrom: idSchema, sessionId: idSchema }),
	async ({ memberId, compFrom, sessionId }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const r = await svc.memberBookMakeup(m.organizationId, user.id, memberId, compFrom, sessionId);
		await getPortalOverview(memberId).refresh();
		await getMakeups(memberId).refresh();
		return r.status;
	}
);

export const getPortalAnnouncements = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	if (!m.email) return [];
	return notif.memberAnnouncements(m.organizationId, m.email);
});

export const joinChallenge = command(
	v.object({
		memberId: idSchema,
		challengeId: idSchema,
		team: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)))
	}),
	async ({ memberId, challengeId, team }) => {
		const m = await myMember(memberId);
		const r = await chalSvc.joinChallenge(m.organizationId, challengeId, m.id, undefined, team);
		void getPortalChallenges(memberId).refresh();
		return r;
	}
);

export const leaveChallenge = command(
	v.object({ memberId: idSchema, challengeId: idSchema }),
	async ({ memberId, challengeId }) => {
		const m = await myMember(memberId);
		const r = await chalSvc.leaveChallenge(m.organizationId, challengeId, m.id);
		void getPortalChallenges(memberId).refresh();
		return r;
	}
);

/**
 * Parent adds a family member (kid, partner) from the portal — the new record bills
 * under them (`guardianId`) and shows up in the portal member switcher.
 */
export const addDependent = command(
	v.object({
		memberId: idSchema,
		name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(200)),
		birthday: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)))
	}),
	async ({ memberId, name, birthday }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		if (m.portalUserId !== user.id) error(403, 'Only the account holder can add family members');
		const [dep] = await db
			.insert(gymMember)
			.values({
				organizationId: m.organizationId,
				name,
				birthday: birthday ?? null,
				guardianId: m.id,
				joinedAt: new Date().toISOString().slice(0, 10)
			})
			.returning();
		await emit({
			orgId: m.organizationId,
			entityType: 'member',
			entityId: dep.id,
			action: 'created',
			summary: `${name} added as a dependent of ${m.name}`
		});
		return { member: dep };
	}
);

// ------- AI workout plan (Enterprise) -------
/** Generates a one-week workout plan for the member (or their dependent). EE + provider-gated. */
export const aiWorkoutPlan = command(
	v.object({
		memberId: idSchema,
		goal: v.pipe(v.string(), v.trim(), v.nonEmpty('Goal is required'), v.maxLength(200)),
		daysPerWeek: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(7)),
		minutesPerSession: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(240)),
		notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)))
	}),
	async (input) => {
		const m = await myMember(input.memberId);
		requireAi();
		return workoutPlan(m.name, {
			goal: input.goal,
			daysPerWeek: input.daysPerWeek,
			minutesPerSession: input.minutesPerSession,
			notes: input.notes
		});
	}
);

/** Whether the portal workout-plan generator is on (Enterprise + provider configured). */
export const getPortalAi = query(async () => {
	requireUser();
	return { configured: aiAvailable() };
});

/** Member sets their monthly visit goal (null clears it). */
export const setVisitGoal = command(
	v.object({
		memberId: idSchema,
		goal: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60)))
	}),
	async ({ memberId, goal }) => {
		const m = await myMember(memberId);
		const r = await svc.setVisitGoal(m.organizationId, m.id, goal);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Logs the member's score on a session's workout of the day (upserts on re-log). */
export const logWorkoutResult = command(
	v.object({
		memberId: idSchema,
		sessionId: idSchema,
		score: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
		asRx: v.optional(v.boolean(), false)
	}),
	async (input) => {
		const m = await myMember(input.memberId);
		const r = await svc.logWorkoutResult(
			m.organizationId,
			m.id,
			input.sessionId,
			input.score,
			input.asRx ?? false
		);
		void getPortalOverview(input.memberId).refresh();
		return r;
	}
);

/** Member takes the configured "stay" offer — a one-time credit instead of cancelling. */
export const acceptSaveOffer = command(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	const r = await svc.acceptSaveOffer(m.organizationId, m.id);
	void getPortalOverview(memberId).refresh();
	return r;
});

/** Courses the member can see + their enrollments. */
export const getPortalCourses = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return crs.portalCourses(m.organizationId, m.id);
});

/** Member self-enrolls into a memberBookable course (charge posts to balance when priced). */
export const enrollCourse = command(
	v.object({ memberId: idSchema, courseId: idSchema }),
	async ({ memberId, courseId }) => {
		const m = await myMember(memberId);
		const [c] = await crs
			.portalCourses(m.organizationId, m.id)
			.then((rows) => rows.filter((r) => r.course.id === courseId));
		if (!c) error(404, 'Course not available');
		const r = await crs.enrollCourse(m.organizationId, m.id, courseId);
		void getPortalCourses(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

/** Member leaves a course — upcoming bookings cancelled, unpaid signup charge voided. */
export const leaveCourse = command(
	v.object({ memberId: idSchema, courseId: idSchema }),
	async ({ memberId, courseId }) => {
		const m = await myMember(memberId);
		const r = await crs.unenrollCourse(m.organizationId, m.id, courseId);
		void getPortalCourses(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

// ---------- Portal shop + personal records ----------

export const getShopItems = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.memberShopItems(m.organizationId);
});

export const buyShopItem = command(
	v.object({ memberId: idSchema, itemId: idSchema }),
	async ({ memberId, itemId }) => {
		const { user } = requireUser();
		const m = await myMember(memberId);
		const r = await svc.memberBuyItem(m.organizationId, user.id, memberId, itemId);
		void getShopItems(memberId).refresh();
		void getMyPurchases(memberId).refresh();
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const getMyPurchases = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.memberPurchases(m.organizationId, memberId);
});

export const getPersonalRecords = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return memberSvc.listPersonalRecords(m.organizationId, memberId);
});

export const addPersonalRecord = command(
	v.object({ memberId: idSchema, ...prInput.entries }),
	async ({ memberId, ...input }) => {
		const m = await myMember(memberId);
		const r = await memberSvc.addPersonalRecord(m.organizationId, memberId, input);
		void getPersonalRecords(memberId).refresh();
		return r;
	}
);

export const deletePersonalRecord = command(
	v.object({ memberId: idSchema, prId: idSchema }),
	async ({ memberId, prId }) => {
		const m = await myMember(memberId);
		return memberSvc.deletePersonalRecord(m.organizationId, memberId, prId);
	}
);

/** Gym-wide recent PRs — the leaderboard shown beside the member's own log. */
export const getPrBoard = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return memberSvc.prBoard(m.organizationId);
});

// ---------- Signature requests + movement library ----------

export const getSignRequests = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.memberSignRequests(m.organizationId, memberId);
});

export const signDocument = command(
	v.object({
		memberId: idSchema,
		requestId: idSchema,
		signedName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120))
	}),
	async ({ memberId, requestId, signedName }) => {
		const m = await myMember(memberId);
		const r = await memberSvc.signDocumentRequest(
			m.organizationId,
			memberId,
			requestId,
			signedName
		);
		void getSignRequests(memberId).refresh();
		return r;
	}
);

export const getMovementVideos = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.memberClassVideos(m.organizationId, memberId);
});

/** Member toggles pack auto-renew on their own membership. */
export const setPackAutoRenew = command(
	v.object({ memberId: idSchema, membershipId: idSchema, on: v.boolean() }),
	async ({ memberId, membershipId, on }) => {
		const m = await myMember(memberId);
		await svc.memberSetPackAutoRenew(m.organizationId, m.id, membershipId, on);
		await getPortalOverview(memberId).refresh();
	}
);

/** Portal: the member's assigned workouts. */
export const getMyWorkouts = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return woSvc.listMyWorkouts(m.organizationId, m.id);
});

/** Portal: gift classes off the member's own pack to another member by email. */
export const giftPackCredits = command(giftCreditsInput, async ({ memberId, email, credits }) => {
	const m = await myMember(memberId);
	const { user } = requireUser();
	const r = await memberSvc.giftPackCredits(m.organizationId, m.id, email, credits, user.id);
	void getPortalOverview(memberId).refresh();
	return r;
});

/** Portal: one-shot JSON export of everything we hold on the member. */
export const getMyDataExport = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.exportMemberData(m.organizationId, m.id);
});

export const getNpsStatus = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.npsStatus(m.organizationId, m.id);
});

export const submitNps = command(
	v.object({
		memberId: idSchema,
		score: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)),
		comment: v.optional(v.pipe(v.string(), v.maxLength(500)))
	}),
	async (input) => {
		const m = await myMember(input.memberId);
		const r = await svc.submitNps(m.organizationId, m.id, null, input.score, input.comment);
		void getNpsStatus(input.memberId).refresh();
		return r;
	}
);

export const getMyPrograms = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return progSvc.portalPrograms(m.organizationId, m.id);
});

/** Watch/unwatch a class type — watchers get emailed when a new session is published. */
export const setClassWatch = command(
	v.object({
		memberId: v.pipe(v.string(), v.uuid()),
		classTypeId: v.pipe(v.string(), v.uuid()),
		on: v.boolean()
	}),
	async ({ memberId, classTypeId, on }) => {
		const m = await myMember(memberId);
		if (on) {
			await db
				.insert(classWatch)
				.values({ organizationId: m.organizationId, memberId: m.id, classTypeId })
				.onConflictDoNothing();
		} else {
			await db
				.delete(classWatch)
				.where(
					and(
						eq(classWatch.organizationId, m.organizationId),
						eq(classWatch.memberId, m.id),
						eq(classWatch.classTypeId, classTypeId)
					)
				);
		}
		await getPortalOverview(m.id).refresh();
	}
);

/** Member emails their referral join link to a friend. Deduped per (member, address). */
export const inviteFriend = command(
	v.object({
		memberId: idSchema,
		email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
		name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)))
	}),
	async ({ memberId, email, name }) => {
		const m = await myMember(memberId);
		return notif.sendReferralInvite(m.organizationId, m.id, email, name);
	}
);

/** Enterprise health-forms: the member's PAR-Q state + the question list. */
export const getMyParq = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	if (!healthFormsEnabled())
		return { licensed: false, questions: [] as string[], answers: null, signedAt: null };
	return {
		licensed: true,
		questions: [...PARQ_QUESTIONS],
		answers: m.parqAnswers ?? null,
		signedAt: m.parqSignedAt
	};
});

/** Member signs their PAR-Q in the portal. */
export const submitParq = command(
	v.object({
		memberId: idSchema,
		answers: v.record(v.string(), v.boolean())
	}),
	async ({ memberId, answers }) => {
		const m = await myMember(memberId);
		requireHealthForms();
		await hfSubmit(m.id, m.organizationId, answers);
		emit({
			orgId: m.organizationId,
			actorId: null,
			entityType: 'member',
			entityId: m.id,
			action: 'parq-signed',
			summary: 'Signed the health questionnaire'
		});
		await getMyParq(m.id).refresh();
		return { ok: true };
	}
);
