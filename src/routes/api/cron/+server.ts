import { timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { CRON_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/schema.ts';
import { runBilling, suspendDelinquentMembers } from '#lib/server/services/billing.ts';
import { purgeExpiredDemos } from '#lib/server/demo-mode.ts';
import {
	sendBirthdayGreetings,
	sendClassReminders,
	sendPastDueNotices,
	sendTrialEndingNotices,
	sendWeeklyDigest
} from '#lib/server/services/notifications.ts';
import { markPastNoShows, materializeTemplates } from '#lib/server/services/schedule.ts';
import type { RequestHandler } from './$types';

const authorized = (header: string | null) => {
	if (!CRON_SECRET || !header) return false;
	const a = Buffer.from(header);
	const b = Buffer.from(`Bearer ${CRON_SECRET}`);
	return a.length === b.length && timingSafeEqual(a, b);
};

/** Daily job: posts due membership charges, sends reminders + past-due notices + Monday digests, marks no-shows, generates template sessions, deletes expired demos. */
export const GET: RequestHandler = async ({ request }) => {
	if (!authorized(request.headers.get('authorization'))) error(401, 'Unauthorized');
	const orgs = await db.select({ id: organization.id }).from(organization);
	let failed = 0;
	let reminders = 0;
	let pastDue = 0;
	let trials = 0;
	let birthdays = 0;
	let noShows = 0;
	let suspended = 0;
	let generated = 0;
	let digests = 0;
	for (const o of orgs) {
		try {
			await runBilling(o.id);
			suspended += await suspendDelinquentMembers(o.id);
		} catch (err) {
			failed++;
			console.error(`billing cron failed for ${o.id}`, err);
		}
		try {
			reminders += await sendClassReminders(o.id);
		} catch (err) {
			failed++;
			console.error(`reminder cron failed for ${o.id}`, err);
		}
		try {
			pastDue += await sendPastDueNotices(o.id);
		} catch (err) {
			failed++;
			console.error(`past-due cron failed for ${o.id}`, err);
		}
		try {
			trials += await sendTrialEndingNotices(o.id);
		} catch (err) {
			failed++;
			console.error(`trial-ending cron failed for ${o.id}`, err);
		}
		try {
			birthdays += await sendBirthdayGreetings(o.id);
		} catch (err) {
			failed++;
			console.error(`birthday cron failed for ${o.id}`, err);
		}
		try {
			noShows += await markPastNoShows(o.id);
		} catch (err) {
			failed++;
			console.error(`no-show cron failed for ${o.id}`, err);
		}
		try {
			generated += await materializeTemplates(o.id);
		} catch (err) {
			failed++;
			console.error(`template cron failed for ${o.id}`, err);
		}
		try {
			digests += await sendWeeklyDigest(o.id);
		} catch (err) {
			failed++;
			console.error(`digest cron failed for ${o.id}`, err);
		}
	}
	await purgeExpiredDemos();
	return json({
		workspaces: orgs.length,
		failed,
		reminders,
		pastDue,
		trials,
		birthdays,
		noShows,
		suspended,
		generated,
		digests
	});
};

export const POST = GET;
