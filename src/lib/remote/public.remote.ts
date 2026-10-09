import { command, getRequestEvent, query } from '$app/server';
import { dayPassInput, dropInInput, joinInput, leadInput, trialInput } from '#lib/schemas.ts';
import {
	bookDropIn,
	buyDayPass,
	captureLead,
	joinGym,
	referrerName,
	requestTrial
} from '#lib/server/services/public.ts';
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

/** First name behind a ?ref= link so the join page can say "Invited by X". Public-safe. */
export const getReferrerName = query(
	v.object({ slug: v.string(), ref: v.string() }),
	({ slug, ref }) => referrerName(slug, ref)
);

/** Public lead form on /j/[slug] — same unauthenticated + rate-limited treatment as join. */
export const captureLeadForm = command(
	v.object({ slug: v.string(), input: leadInput }),
	async ({ slug, input }) => {
		const event = getRequestEvent();
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			// adapter without client IPs
		}
		return captureLead(slug, ip, input);
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

/** Public day-pass purchase on /j/[slug] — same unauthenticated + rate-limited treatment. */
export const buyDayPassForm = command(
	v.object({ slug: v.string(), input: dayPassInput }),
	async ({ slug, input }) => {
		const event = getRequestEvent();
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			// adapter without client IPs
		}
		return buyDayPass(slug, ip, input);
	}
);

/** Public free-trial request on /j/[slug]/schedule — unauthenticated + rate-limited. */
export const requestTrialForm = command(
	v.object({ slug: v.string(), input: trialInput }),
	async ({ slug, input }) => {
		const event = getRequestEvent();
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			// adapter without client IPs
		}
		return requestTrial(slug, ip, input);
	}
);
