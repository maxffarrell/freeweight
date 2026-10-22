import '../scripts/check-node.mjs';
import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { isDemoBlockedPath } from '#lib/server/demo-mode.ts';

export const handle: Handle = async ({ event, resolve }) => {
	if (isDemoBlockedPath(event.url.pathname)) {
		return Response.json({ message: 'This is turned off in the public demo.' }, { status: 403 });
	}

	if (!building && !event.url.pathname.startsWith('/api/v1/')) {
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};
