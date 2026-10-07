import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { document, gymMember, membership, outer, plan } from '#lib/server/db/schema.ts';
import { and, asc, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import * as svc from '#lib/server/services/portal.ts';
import * as memberSvc from '#lib/server/services/members.ts';
import * as resSvc from '#lib/server/services/resources.ts';
import * as evtSvc from '#lib/server/services/gym-events.ts';
import * as checkinSvc from '#lib/server/services/checkins.ts';
import * as chalSvc from '#lib/server/services/challenges.ts';
import * as notif from '#lib/server/services/notifications.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { idSchema, measurementInput, resourceBookInput } from '#lib/schemas.ts';

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

export const getBookable = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	return svc.bookableSessions(m.id);
});

export const memberBook = command(
	v.object({ memberId: idSchema, sessionId: idSchema }),
	async ({ memberId, sessionId }) => {
		const m = await myMember(memberId);
		const { user } = requireUser();
		const b = await svc.memberBook(m.organizationId, user.id, sessionId, m.id);
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
		const b = await svc.memberCancel(m.organizationId, user.id, bookingId);
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
			activeMembers:
				sql<number>`(select count(*) from ${membership} mm where mm.plan_id = ${outer(plan.id)} and mm.status = 'active')`.mapWith(
					Number
				)
		})
		.from(plan)
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
		birthday: v.optional(v.nullable(v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD'))))
	}),
	async ({ memberId, ...input }) => {
		const m = await myMember(memberId);
		const r = await svc.updatePortalProfile(m.organizationId, m.id, input);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

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

/** Announcements this member was actually sent — the portal's News feed. */
export const getPortalAnnouncements = query(idSchema, async (memberId) => {
	const m = await myMember(memberId);
	if (!m.email) return [];
	return notif.memberAnnouncements(m.organizationId, m.email);
});

export const joinChallenge = command(
	v.object({ memberId: idSchema, challengeId: idSchema }),
	async ({ memberId, challengeId }) => {
		const m = await myMember(memberId);
		const r = await chalSvc.joinChallenge(m.organizationId, challengeId, m.id);
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
