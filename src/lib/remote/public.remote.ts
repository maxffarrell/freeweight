import { command, getRequestEvent } from '$app/server';
import { joinInput } from '#lib/schemas.ts';
import { joinGym } from '#lib/server/services/public.ts';
import * as v from 'valibot';

/** Public join form on /j/[slug] — unauthenticated by design (rate-limited + honeypot inside). */
export const joinGymForm = command(
	v.object({ slug: v.string(), input: joinInput }),
	async ({ slug, input }) => {
		const event = getRequestEvent();
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			// adapter without client IPs
		}
		return joinGym(slug, ip, input);
	}
);
