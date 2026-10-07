import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymMember } from '#lib/server/db/schema.ts';
import { readMemberDocument } from '#lib/server/services/documents.ts';
import type { RequestHandler } from './$types';

const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;

/** Portal download: the logged-in portal user may only fetch docs attached to their own membership. */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	const memberId = url.searchParams.get('m') ?? '';
	if (!memberId) error(400, 'Missing member');
	const [mine] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.portalUserId, locals.user.id)));
	if (!mine) error(404, 'Document not found');
	const { doc, data } = await readMemberDocument(params.id, memberId);
	const inline = INLINE.test(doc.contentType) && !url.searchParams.has('download');
	return new Response(data as Uint8Array<ArrayBuffer>, {
		headers: {
			'content-type': doc.contentType,
			'content-length': String(doc.size),
			'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, max-age=3600'
		}
	});
};
