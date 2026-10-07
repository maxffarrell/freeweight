import * as v from 'valibot';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireOrg, requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { gymMember, member, user, userPref, webhook } from '#lib/server/db/schema.ts';
import { dashboard } from '#lib/server/services/dashboard.ts';
import * as dashboardSvc from '#lib/server/services/dashboard.ts';
import { search } from '#lib/server/services/search.ts';
import { loadDemoData } from '#lib/server/services/demo.ts';
import * as settingsSvc from '#lib/server/services/settings.ts';
import {
	idSchema,
	locationInput,
	locationUpdate,
	settingsInput,
	webhookInput
} from '#lib/schemas.ts';
import { assertNotDemo } from '#lib/server/demo-mode.ts';
import { appOrigin } from '#lib/server/email.ts';

export const getDashboard = query(async () => dashboard((await requireOrg()).orgId));

/** Audit-log page feed; `before` is the createdAt cursor of the previous page's last row. */
export const getActivity = query(
	v.object({
		entityType: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
		before: v.optional(v.pipe(v.string(), v.isoTimestamp()))
	}),
	async (input) => {
		const { orgId } = await requireOrg();
		return dashboardSvc.listActivity(orgId, input.entityType, input.before);
	}
);

export const getActivityTypes = query(async () =>
	dashboardSvc.listActivityTypes((await requireOrg()).orgId)
);
export const searchAll = query(v.pipe(v.string(), v.maxLength(100)), async (q) =>
	search((await requireOrg()).orgId, q)
);

export const getSettings = query(async () => settingsSvc.getSettings((await requireOrg()).orgId));

/** The gym's public join page — URL, on/off state, and org name for the printable QR poster. */
export const getJoinInfo = query(async () => {
	const ctx = await requireOrg();
	const s = await settingsSvc.getSettings(ctx.orgId);
	return { url: `${appOrigin()}/j/${ctx.org.slug}`, name: ctx.org.name, enabled: s.publicPage };
});
export const updateSettings = command(settingsInput, async (input) => {
	const s = await settingsSvc.updateSettings(await requireOrg('admin'), input);
	void getSettings().refresh();
	return s;
});
/** Logo upload itself goes through POST /api/documents (entityType=org_logo); this just removes it. */
export const removeLogo = command(async () => {
	await settingsSvc.removeLogo(await requireOrg('admin'));
	void getSettings().refresh();
});

export const getLocations = query(async () =>
	settingsSvc.listLocations((await requireOrg()).orgId, true)
);
export const createLocation = command(locationInput, async (input) => {
	const l = await settingsSvc.createLocation(await requireOrg('admin'), input);
	void getLocations().refresh();
	return l;
});
export const updateLocation = command(locationUpdate, async (input) => {
	const l = await settingsSvc.updateLocation(await requireOrg('admin'), input);
	void getLocations().refresh();
	return l;
});

/** Staff of the org (instructors are picked from these). */
export const getStaff = query(async () => {
	const { orgId } = await requireOrg();
	return db
		.select({
			id: member.id,
			userId: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			role: member.role,
			createdAt: member.createdAt
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(member.createdAt));
});

export const getWebhooks = query(async () => {
	const { orgId } = await requireOrg('admin');
	return db
		.select()
		.from(webhook)
		.where(eq(webhook.organizationId, orgId))
		.orderBy(desc(webhook.createdAt));
});
export const createWebhook = command(webhookInput, async (input) => {
	assertNotDemo();
	const { orgId } = await requireOrg('admin');
	const [w] = await db
		.insert(webhook)
		.values({
			organizationId: orgId,
			url: input.url,
			events: input.events,
			secret: `whsec_${randomBytes(24).toString('base64url')}`
		})
		.returning();
	void getWebhooks().refresh();
	return w!;
});
export const toggleWebhook = command(
	v.object({ id: idSchema, enabled: v.boolean() }),
	async ({ id, enabled }) => {
		assertNotDemo();
		const { orgId } = await requireOrg('admin');
		await db
			.update(webhook)
			.set({ enabled })
			.where(and(eq(webhook.organizationId, orgId), eq(webhook.id, id)));
		void getWebhooks().refresh();
	}
);
export const deleteWebhook = command(idSchema, async (id) => {
	const { orgId } = await requireOrg('admin');
	await db.delete(webhook).where(and(eq(webhook.organizationId, orgId), eq(webhook.id, id)));
	void getWebhooks().refresh();
});

// ------- onboarding tour -------
const TOUR_KEY = 'app_tour';

/** Whether this user has already dismissed the guided tour (per-user, cross-org). */
export const getTourSeen = query(async () => {
	const { user } = requireUser();
	const [row] = await db
		.select({ value: userPref.value })
		.from(userPref)
		.where(and(eq(userPref.userId, user.id), eq(userPref.key, TOUR_KEY)))
		.limit(1);
	return !!row;
});

/** Record the tour as seen — fired on finish or skip; replaying re-opens the dialog. */
export const markTourSeen = command(async () => {
	const { user } = requireUser();
	await db
		.insert(userPref)
		.values({ userId: user.id, key: TOUR_KEY, value: 'seen' })
		.onConflictDoUpdate({
			target: [userPref.userId, userPref.key],
			set: { value: 'seen', updatedAt: new Date() }
		});
	void getTourSeen().refresh();
});

export const seedDemo = command(async () => {
	const ctx = await requireOrg('admin');
	const [existing] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(eq(gymMember.organizationId, ctx.orgId))
		.limit(1);
	if (existing) error(409, 'Demo data can only be loaded into an empty workspace');
	const result = await loadDemoData(ctx);
	void getDashboard().refresh();
	return result;
});
