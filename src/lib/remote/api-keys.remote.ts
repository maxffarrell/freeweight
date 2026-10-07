import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { getRequestEvent, command, query } from '$app/server';
import { auth } from '#lib/server/auth.ts';
import { requireOrg } from '#lib/server/context.ts';
import { apiPermissionsSchema } from '#lib/api-permissions.ts';
import { assertNotDemo } from '#lib/server/demo-mode.ts';

type StoredKey = {
	id: string;
	name: string | null;
	start: string | null;
	prefix: string | null;
	createdAt: Date;
	lastRequest: Date | null;
	expiresAt: Date | null;
	permissions?: Record<string, string[]> | null;
};

async function listKeys(orgId: string) {
	const res = await auth.api.listApiKeys({
		query: { organizationId: orgId },
		headers: getRequestEvent().request.headers
	});
	return (
		Array.isArray(res) ? res : ((res as { apiKeys?: unknown[] }).apiKeys ?? [])
	) as StoredKey[];
}

export const getApiKeys = query(async () => {
	const { orgId } = await requireOrg('admin');
	return (await listKeys(orgId)).map((k) => ({
		id: k.id,
		name: k.name,
		start: k.start,
		prefix: k.prefix,
		createdAt: k.createdAt,
		lastRequest: k.lastRequest,
		expiresAt: k.expiresAt,
		permissions: k.permissions ?? null
	}));
});

// Permissions are server-only in Better Auth, so these calls pass `userId` instead of request headers;
// the plugin still checks that user's role in the organization.
export const createApiKey = command(
	v.object({
		name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(64)),
		permissions: apiPermissionsSchema
	}),
	async ({ name, permissions }) => {
		assertNotDemo();
		const { orgId, userId } = await requireOrg('admin');
		const key = await auth.api.createApiKey({
			body: {
				name,
				organizationId: orgId,
				userId,
				permissions: permissions as Record<string, string[]>,
				metadata: { createdBy: userId }
			}
		});
		void getApiKeys().refresh();
		return { key: key.key };
	}
);

export const updateApiKeyPermissions = command(
	v.object({ keyId: v.string(), permissions: apiPermissionsSchema }),
	async ({ keyId, permissions }) => {
		assertNotDemo();
		const { orgId, userId } = await requireOrg('admin');
		if (!(await listKeys(orgId)).some((k) => k.id === keyId)) error(404, 'API key not found');
		await auth.api.updateApiKey({
			body: { keyId, userId, permissions: permissions as Record<string, string[]> }
		});
		void getApiKeys().refresh();
	}
);

export const deleteApiKey = command(v.string(), async (keyId) => {
	await requireOrg('admin');
	await auth.api.deleteApiKey({ body: { keyId }, headers: getRequestEvent().request.headers });
	void getApiKeys().refresh();
});
