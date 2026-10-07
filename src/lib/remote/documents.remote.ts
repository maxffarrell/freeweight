import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { gymMember } from '#lib/server/db/schema.ts';
import { deleteDocument as remove, listDocuments } from '#lib/server/services/documents.ts';
import { idSchema } from '#lib/schemas.ts';

/** Documents attached to one member — member page's Documents card. */
export const getMemberDocuments = query(idSchema, async (memberId) => {
	const { orgId } = await requireOrg();
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)));
	if (!m) error(404, 'Member not found');
	return listDocuments(orgId, { type: 'member', id: memberId });
});

export const deleteDocument = command(idSchema, async (id) => {
	await remove(await requireOrg(), id);
});
