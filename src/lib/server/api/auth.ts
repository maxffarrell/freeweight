import { error, type RequestEvent } from '@sveltejs/kit';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { allows, type ApiAction } from '#lib/api-permissions.ts';

/**
 * Authenticates `Authorization: Bearer fw_…` against organization-scoped API keys and checks the
 * key grants `action` on the route's resource. Keys without permissions are denied.
 */
export async function apiContext(event: RequestEvent, action: ApiAction): Promise<OrgContext> {
	const header = event.request.headers.get('authorization') ?? '';
	const key = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? event.request.headers.get('x-api-key');
	if (!key) error(401, 'Missing API key');

	const result = await auth.api.verifyApiKey({ body: { key } });
	if (!result.valid || !result.key) error(401, 'Invalid API key');

	const resource = event.params.resource ?? '';
	if (!allows(result.key.permissions, resource, action)) {
		error(403, `API key lacks ${resource}:${action} permission`);
	}

	const orgId = result.key.referenceId;
	const org = await db.query.organization.findFirst({ where: (o, { eq }) => eq(o.id, orgId) });
	if (!org) error(401, 'Invalid API key');

	// Attribute API writes to the key's creator, falling back to the workspace owner.
	const createdBy = (result.key.metadata as { createdBy?: string } | null)?.createdBy;
	const members = await db.query.member.findMany({
		where: (m, { eq }) => eq(m.organizationId, orgId)
	});
	const actor =
		members.find((m) => m.userId === createdBy) ??
		members.find((m) => m.role === 'owner') ??
		members[0];
	if (!actor) error(401, 'Invalid API key');

	return {
		userId: actor.userId,
		orgId,
		role: 'admin',
		org: { id: org.id, name: org.name, slug: org.slug, logo: org.logo ?? null }
	};
}
