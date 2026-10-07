import { command, getRequestEvent } from '$app/server';
import { dropInInput, joinInput } from '#lib/schemas.ts';
import { bookDropIn, joinGym } from '#lib/server/services/public.ts';
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

/** Public drop-in purchase on /j/[slug] — same unauthenticated + rate-limited treatment. */
export const bookDropInForm = command(
	v.object({ slug: v.string(), input: dropInInput }),
	async ({ slug, input }) => {
		const event = getRequestEvent();
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			// adapter without client IPs
		}
		return bookDropIn(slug, ip, input);
	}
);
