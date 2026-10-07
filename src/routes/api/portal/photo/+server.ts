import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { document, gymMember } from '#lib/server/db/schema.ts';
import { saveDocument } from '#lib/server/services/documents.ts';
import { store } from '#lib/server/services/storage.ts';
import type { RequestHandler } from './$types';

const IMAGE = /^image\/(png|jpe?g|webp|gif)$/;

/**
 * Portal photo self-upload: the signed-in portal user sets the photo on their
 * own member record or a dependent's (same access rule as portal remote fns).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const form = await request.formData();
	const memberId = String(form.get('memberId') ?? '');
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file');
	if (!IMAGE.test(file.type)) error(400, 'Photos must be an image (PNG, JPEG, WebP or GIF)');
	const [m] = await db.select().from(gymMember).where(eq(gymMember.id, memberId));
	if (!m) error(404, 'Member not found');
	if (m.portalUserId !== locals.user.id) {
		const [guardian] = m.guardianId
			? await db
					.select({ id: gymMember.id })
					.from(gymMember)
					.where(and(eq(gymMember.id, m.guardianId), eq(gymMember.portalUserId, locals.user.id)))
					.limit(1)
			: [];
		if (!guardian) error(403, 'Not your member record');
	}
	const doc = await saveDocument(m.organizationId, locals.user.id, file, {
		type: 'member_avatar',
		id: m.id
	});
	const oldId = m.photoDocumentId && m.photoDocumentId !== doc.id ? m.photoDocumentId : null;
	await db.update(gymMember).set({ photoDocumentId: doc.id }).where(eq(gymMember.id, m.id));
	if (oldId) {
		const [old] = await db.delete(document).where(eq(document.id, oldId)).returning();
		if (old) await store.delete(old.storageKey).catch(() => {});
	}
	return json({ id: doc.id }, { status: 201 });
};
