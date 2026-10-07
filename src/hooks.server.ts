import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { isEnterpriseAuthPath } from '#lib/server/ee/auth.ts';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';
import { isDemoBlockedPath } from '#lib/server/demo-mode.ts';

export const handle: Handle = async ({ event, resolve }) => {
	if (isDemoBlockedPath(event.url.pathname)) {
		return Response.json({ message: 'This is turned off in the public demo.' }, { status: 403 });
	}

	if (isEnterpriseAuthPath(event.url.pathname) && !isEnterpriseEnabled()) {
		return Response.json(
			{ error: 'This feature requires Freeweight Cloud or an Enterprise license.' },
			{ status: 402 }
		);
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
