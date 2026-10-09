import { markEmailOpened, validOpenToken } from '#lib/server/services/notifications.ts';
import type { RequestHandler } from './$types';

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Signed 1x1 tracking pixel embedded in member-facing emails — stamps openedAt. */
export const GET: RequestHandler = async ({ url }) => {
	const logId = url.searchParams.get('i') ?? '';
	const token = url.searchParams.get('t') ?? '';
	if (logId && validOpenToken(logId, token)) {
		await markEmailOpened(logId);
	}
	return new Response(PIXEL, {
		headers: {
			'content-type': 'image/gif',
			// Pixels must never be cached or a prefetched proxy load looks like an open.
			'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
		}
	});
};
