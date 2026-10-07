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
	await startDemo(ip);
	redirect(303, '/dashboard');
};
