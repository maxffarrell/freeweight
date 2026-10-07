import { and, eq } from 'drizzle-orm';
import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { gymMember } from '#lib/server/db/schema.ts';
import { requireOrg } from '#lib/server/context.ts';
import { deleteDocument, uploadDocument } from '#lib/server/services/documents.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const ctx = await requireOrg();
	const form = await request.formData();
	const files = form.getAll('file').filter((f): f is File => f instanceof File);
	if (!files.length) error(400, 'No file');
	const entityType = form.get('entityType');
	const entityId = form.get('entityId');
	if (typeof entityType === 'string' && typeof entityId === 'string' && entityType && entityId) {
		if (entityType !== 'member') error(400, 'Unknown entity type');
		const [m] = await db
			.select({ id: gymMember.id, photoDocumentId: gymMember.photoDocumentId })
			.from(gymMember)
			.where(and(eq(gymMember.id, entityId), eq(gymMember.organizationId, ctx.orgId)));
		if (!m) error(404, 'Member not found');
		const avatar = form.get('avatar') === '1';
		const docs = [];
		for (const file of files)
			docs.push(
				await uploadDocument(ctx, file, {
					type: avatar ? 'member_avatar' : 'member',
					id: entityId
				})
			);
		if (avatar && docs[0]) {
			if (m.photoDocumentId && m.photoDocumentId !== docs[0].id)
				await deleteDocument(ctx, m.photoDocumentId);
			await db
				.update(gymMember)
				.set({ photoDocumentId: docs[0].id })
				.where(eq(gymMember.id, entityId));
		}
		return json(docs, { status: 201 });
	}
	const docs = [];
	for (const file of files) docs.push(await uploadDocument(ctx, file));
	return json(docs, { status: 201 });
};
