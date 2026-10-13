import { error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like, lt } from 'drizzle-orm';
import { FREEWEIGHT_DEMO } from '$app/env/private';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { gymMember, member, organization, user } from '#lib/server/db/schema.ts';
import { loadDemoData } from '#lib/server/services/demo.ts';

const DEMO_EMAIL_DOMAIN = '@demo.freeweight.invalid';
const DEMO_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEMOS_PER_IP_PER_HOUR = 5;

const BLOCKED_AUTH_PATHS = [
	'/api/auth/sign-up',
	'/api/auth/api-key',
	'/api/auth/organization/create',
	'/api/auth/organization/delete',
	'/api/auth/organization/invite-member',
	'/api/auth/change-email',
	'/api/auth/change-password',
	'/api/auth/delete-user',
	'/api/auth/update-user',
	'/api/auth/passkey/',
	'/api/auth/sso/'
];

export const isDemo = (): boolean => FREEWEIGHT_DEMO;

export function assertNotDemo() {
	if (FREEWEIGHT_DEMO) error(403, 'This is turned off in the public demo');
}

export function isDemoBlockedPath(path: string) {
	if (!FREEWEIGHT_DEMO) return false;
	if (path.startsWith('/api/v1/')) return path !== '/api/v1/openapi.json';
	if (path.startsWith('/api/payments/')) return true;
	return BLOCKED_AUTH_PATHS.some((p) => path.startsWith(p));
}

const recent = new Map<string, number[]>();
function rateLimit(ip: string) {
	const now = Date.now();
	const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
	if (hits.length >= MAX_DEMOS_PER_IP_PER_HOUR) {
		error(429, 'Too many demo workspaces from this address. Try again in an hour.');
	}
	recent.set(ip, [...hits, now]);
}

/** Deletes demo users older than the TTL along with their workspaces. */
export async function purgeExpiredDemos() {
	if (!FREEWEIGHT_DEMO) return;
	const stale = await db
		.select({ id: user.id })
		.from(user)
		.where(
			and(
				like(user.email, `%${DEMO_EMAIL_DOMAIN}`),
				lt(user.createdAt, new Date(Date.now() - DEMO_TTL_MS))
			)
		);
	if (!stale.length) return;
	const userIds = stale.map((u) => u.id);
	const orgIds = (
		await db
			.select({ id: member.organizationId })
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.where(
				and(
					inArray(member.userId, userIds),
					eq(member.role, 'owner'),
					like(organization.slug, 'demo-%')
				)
			)
	).map((m) => m.id);
	// Every gym table cascades on organization.
	if (orgIds.length) await db.delete(organization).where(inArray(organization.id, orgIds));
	await db.delete(user).where(inArray(user.id, userIds));
}

/** Signs the visitor into a fresh, private workspace filled with sample data. */
export async function startDemo(ip: string, view: 'staff' | 'member' = 'staff') {
	if (!FREEWEIGHT_DEMO) error(404, 'Not found');
	rateLimit(ip);
	await purgeExpiredDemos();

	const id = randomBytes(6).toString('hex');
	const { user: demoUser } = await auth.api.signUpEmail({
		body: {
			name: view === 'member' ? 'Demo Member' : 'Demo Manager',
			email: `demo-${id}${DEMO_EMAIL_DOMAIN}`,
			password: randomBytes(24).toString('base64url')
		}
	});
	const org = await auth.api.createOrganization({
		body: { name: 'Iron Works Gym', slug: `demo-${id}`, userId: demoUser.id }
	});
	if (!org) error(500, 'Could not create demo workspace');
	await loadDemoData({
		userId: demoUser.id,
		orgId: org.id,
		role: 'owner',
		org: { id: org.id, name: org.name, slug: org.slug, logo: null }
	});

	// Every demo visitor can explore the portal in their own sample workspace.
	const [profile] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(eq(gymMember.organizationId, org.id))
		.limit(1);
	if (!profile) error(500, 'Could not create demo portal profile');
	await db
		.update(gymMember)
		.set({ portalUserId: demoUser.id })
		.where(and(eq(gymMember.id, profile.id), eq(gymMember.organizationId, org.id)));
}
