import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, organization } from '#lib/server/db/schema.ts';

export type Role = 'owner' | 'admin' | 'member';

export type OrgContext = {
	userId: string;
	orgId: string;
	role: Role;
	org: { id: string; name: string; slug: string; logo: string | null };
};

const cache = new WeakMap<object, Promise<OrgContext | null>>();

export function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user || !locals.session) error(401, 'Not signed in');
	return { user: locals.user, session: locals.session };
}

async function resolveOrg(): Promise<OrgContext | null> {
	const { locals } = getRequestEvent();
	if (!locals.user || !locals.session) return null;
	const userId = locals.user.id;
	const activeId = locals.session.activeOrganizationId;

	const rows = await db
		.select({
			role: member.role,
			org: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo
			}
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(
			activeId
				? and(eq(member.userId, userId), eq(member.organizationId, activeId))
				: eq(member.userId, userId)
		)
		.orderBy(asc(member.createdAt))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	return { userId, orgId: row.org.id, role: row.role as Role, org: row.org };
}

/** Membership for the active organization, memoised per request. */
export function getOrg(): Promise<OrgContext | null> {
	const event = getRequestEvent();
	let pending = cache.get(event.locals);
	if (!pending) {
		pending = resolveOrg();
		cache.set(event.locals, pending);
	}
	return pending;
}

export async function requireOrg(minRole: Role = 'member'): Promise<OrgContext> {
	requireUser();
	const ctx = await getOrg();
	if (!ctx) error(403, 'No workspace');
	if (minRole !== 'member' && rank(ctx.role) < rank(minRole))
		error(403, 'Insufficient permissions');
	return ctx;
}

function rank(role: Role) {
	return role === 'owner' ? 2 : role === 'admin' ? 1 : 0;
}
