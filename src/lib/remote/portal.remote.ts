import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { gymMember } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
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
