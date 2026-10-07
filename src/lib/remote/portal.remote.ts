import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { document, gymMember, plan } from '#lib/server/db/schema.ts';
import { and, asc, desc, eq } from 'drizzle-orm';
import * as svc from '#lib/server/services/portal.ts';
import { idSchema } from '#lib/schemas.ts';

/** Resolves the member record the signed-in user is acting as, and checks it belongs to them. */
async function myMember(memberId: string) {
	const { user } = requireUser();
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.portalUserId, user.id)));
	if (!m) error(403, 'Not your member record');
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

export const requestMembershipCancel = command(
	v.object({ memberId: idSchema, membershipId: idSchema }),
	async ({ memberId, membershipId }) => {
		const m = await myMember(memberId);
		const r = await svc.requestCancellation(m.organizationId, m.id, membershipId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);

export const requestMembershipPause = command(
	v.object({
		memberId: idSchema,
		membershipId: idSchema,
		resumeOn: v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD'))
	}),
	async ({ memberId, membershipId, resumeOn }) => {
		const m = await myMember(memberId);
		const r = await svc.requestPause(m.organizationId, m.id, membershipId, resumeOn);
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
		.select()
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

export const changePlan = command(
	v.object({ memberId: idSchema, planId: idSchema }),
	async ({ memberId, planId }) => {
		const m = await myMember(memberId);
		const r = await svc.memberChangePlan(m.organizationId, m.id, planId);
		void getPortalOverview(memberId).refresh();
		return r;
	}
);
