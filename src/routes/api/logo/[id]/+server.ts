import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { document, gymSettings } from '#lib/server/db/schema.ts';
import { readDocument } from '#lib/server/services/documents.ts';
import type { RequestHandler } from './$types';

/** Public logo image for the unauthenticated join page — only serves a doc
 * that is currently set as some org's logo, so other documents can't leak. */
export const GET: RequestHandler = async ({ params }) => {
	const [doc] = await db
		.select()
		.from(document)
		.where(and(eq(document.id, params.id), eq(document.entityType, 'org_logo')));
	if (!doc) error(404, 'Not found');
	const [s] = await db
		.select({ id: gymSettings.organizationId })
		.from(gymSettings)
		.where(
			and(
				eq(gymSettings.organizationId, doc.organizationId),
				eq(gymSettings.logoDocumentId, doc.id)
			)
		);
	if (!s) error(404, 'Not found');
	const { data } = await readDocument(doc.organizationId, doc.id);
	return new Response(data as Uint8Array<ArrayBuffer>, {
		headers: {
			'content-type': doc.contentType,
			'content-length': String(doc.size),
			'x-content-type-options': 'nosniff',
			'cache-control': 'public, max-age=3600'
		}
	});
};
