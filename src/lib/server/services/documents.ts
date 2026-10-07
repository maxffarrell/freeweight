import { and, desc, eq, inArray } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { db } from '#lib/server/db/index.ts';
import { document, user } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { MAX_UPLOAD_BYTES, store } from './storage.ts';
import { emit } from './events.ts';
import { assertNotDemo } from '#lib/server/demo-mode.ts';

export async function listDocuments(orgId: string, entity?: { type: string; id: string }) {
	return db
		.select({
			id: document.id,
			name: document.name,
			contentType: document.contentType,
			size: document.size,
			entityType: document.entityType,
			entityId: document.entityId,
			createdAt: document.createdAt,
			uploadedBy: user.name
		})
		.from(document)
		.leftJoin(user, eq(user.id, document.uploadedBy))
		.where(
			and(
				eq(document.organizationId, orgId),
				entity
					? and(eq(document.entityType, entity.type), eq(document.entityId, entity.id))
					: undefined
			)
		)
		.orderBy(desc(document.createdAt));
}

/** Stores a file for a workspace. `uploadedBy` is null for uploads from public links. */
export async function saveDocument(
	orgId: string,
	uploadedBy: string | null,
	file: File,
	entity?: { type: string; id: string }
) {
	assertNotDemo();
	if (file.size === 0) error(400, 'File is empty');
	if (file.size > MAX_UPLOAD_BYTES) error(413, 'Files must be 10 MB or smaller');
	const storageKey = `${orgId}/${randomUUID()}`;
	await store.put(storageKey, new Uint8Array(await file.arrayBuffer()));
	const [doc] = await db
		.insert(document)
		.values({
			organizationId: orgId,
			name: file.name.slice(0, 200),
			contentType: file.type || 'application/octet-stream',
			size: file.size,
			storageKey,
			entityType: entity?.type ?? null,
			entityId: entity?.id ?? null,
			uploadedBy
		})
		.returning();
	await emit({
		orgId,
		actorId: uploadedBy,
		entityType: 'document',
		entityId: doc!.id,
		action: 'created',
		summary: `Uploaded ${doc!.name}`
	});
	return doc!;
}

export function uploadDocument(ctx: OrgContext, file: File, entity?: { type: string; id: string }) {
	return saveDocument(ctx.orgId, ctx.userId, file, entity);
}

export async function readDocument(orgId: string, id: string) {
	const [doc] = await db
		.select()
		.from(document)
		.where(and(eq(document.organizationId, orgId), eq(document.id, id)));
	if (!doc) error(404, 'Document not found');
	const data = await store.get(doc.storageKey);
	if (!data) error(404, 'File missing');
	return { doc, data };
}

/** Reads a member-attached document for the member themselves (portal download). */
export async function readMemberDocument(id: string, memberId: string) {
	const [doc] = await db
		.select()
		.from(document)
		.where(
			and(
				eq(document.id, id),
				inArray(document.entityType, ['member', 'member_avatar']),
				eq(document.entityId, memberId)
			)
		);
	if (!doc) error(404, 'Document not found');
	const data = await store.get(doc.storageKey);
	if (!data) error(404, 'File missing');
	return { doc, data };
}

export async function deleteDocument(ctx: OrgContext, id: string) {
	const [doc] = await db
		.delete(document)
		.where(and(eq(document.organizationId, ctx.orgId), eq(document.id, id)))
		.returning();
	if (!doc) error(404, 'Document not found');
	await store.delete(doc.storageKey);
}
