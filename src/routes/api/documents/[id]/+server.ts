import { requireOrg } from '#lib/server/context.ts';
import { readDocument } from '#lib/server/services/documents.ts';
import type { RequestHandler } from './$types';

const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;

export const GET: RequestHandler = async ({ params, url }) => {
	const { orgId } = await requireOrg();
	const { doc, data } = await readDocument(orgId, params.id);
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
