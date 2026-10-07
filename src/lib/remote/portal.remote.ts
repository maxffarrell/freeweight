import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { document, gymMember, membership, outer, plan } from '#lib/server/db/schema.ts';
import { and, asc, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import * as svc from '#lib/server/services/portal.ts';
import { idSchema } from '#lib/schemas.ts';

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
