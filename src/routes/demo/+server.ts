import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isDemo, startDemo } from '#lib/server/demo-mode.ts';

export const POST: RequestHandler = async (event) => {
	if (!isDemo()) error(404);
	let ip = 'unknown';
	try {
		ip = event.getClientAddress();
	} catch {
		// adapter without client IPs
	}
	const view = event.url.searchParams.get('view') === 'member' ? 'member' : 'staff';
	await startDemo(ip, view);
	redirect(303, view === 'member' ? '/portal' : '/dashboard');
};
