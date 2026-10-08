import { timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { CRON_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/schema.ts';
import { runBilling, suspendDelinquentMembers } from '#lib/server/services/billing.ts';
import { purgeExpiredDemos } from '#lib/server/demo-mode.ts';
import {
	sendAnniversaryGreetings,
	sendBillingReminders,
	sendBirthdayGreetings,
	sendChallengeInvites,
	sendChallengeResults,
	sendClassReminders,
	sendCourseCompletions,
	sendDueAnnouncements,
	sendEventReminders,
	sendResourceReminders,
	sendInstructorFeedbackDigests,
	sendInstructorRosters,
	sendPastDueNotices,
	ratingNudges,
	sendStaffBriefing,
	sendTrialEndingNotices,
	sendWaiverReminders,
	sendWeeklyDigest,
	sendWinBackNudges,
	sendLeadNudges
} from '#lib/server/services/notifications.ts';
import {
	autoCancelUnderEnrolled,
	expireWaitlists,
	markPastNoShows,
	materializeTemplates,
	sendPackLowCreditNudges
} from '#lib/server/services/schedule.ts';
import { closeStaleCheckIns } from '#lib/server/services/checkins.ts';
import { closeStaleShifts } from '#lib/server/services/shifts.ts';
import { postDueRecurring } from '#lib/server/services/recurring.ts';
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
	let eventReminders = 0;
	let amenityReminders = 0;
	let pastDue = 0;
	let trials = 0;
	let birthdays = 0;
	let anniversaries = 0;
	let noShows = 0;
	let waitlistExpired = 0;
	let suspended = 0;
	let generated = 0;
	let digests = 0;
	let winbacks = 0;
	let leadNudges = 0;
	let rosters = 0;
	let feedbackDigests = 0;
	let courseCompletions = 0;
	let briefings = 0;
	let billingReminders = 0;
	let announcements = 0;
	let packNudges = 0;
	let waiverNudges = 0;
	let ratingNudgeCount = 0;
	let challengeInvites = 0;
	let challengeResults = 0;
	let underEnrolled = 0;
	let autoCheckouts = 0;
	let shiftCloses = 0;
	let recurringPosted = 0;
	for (const o of orgs) {
		try {
			await runBilling(o.id);
			suspended += await suspendDelinquentMembers(o.id);
			recurringPosted += await postDueRecurring(o.id);
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
			eventReminders += await sendEventReminders(o.id);
			amenityReminders += await sendResourceReminders(o.id);
		} catch (err) {
			failed++;
			console.error(`event-reminder cron failed for ${o.id}`, err);
		}
		try {
			challengeInvites += await sendChallengeInvites(o.id);
			challengeResults += await sendChallengeResults(o.id);
		} catch (err) {
			failed++;
			console.error(`challenge-invite cron failed for ${o.id}`, err);
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
			anniversaries += await sendAnniversaryGreetings(o.id);
		} catch (err) {
			failed++;
			console.error(`anniversary cron failed for ${o.id}`, err);
		}
		try {
			noShows += await markPastNoShows(o.id);
		} catch (err) {
			failed++;
			console.error(`no-show cron failed for ${o.id}`, err);
		}
		try {
			waitlistExpired += await expireWaitlists(o.id);
		} catch (err) {
			failed++;
			console.error(`waitlist-expiry cron failed for ${o.id}`, err);
		}
		try {
			announcements += await sendDueAnnouncements(o.id);
		} catch (err) {
			failed++;
			console.error(`scheduled-announcement cron failed for ${o.id}`, err);
		}
		try {
			packNudges += await sendPackLowCreditNudges(o.id);
		} catch (err) {
			failed++;
			console.error(`pack-nudge cron failed for ${o.id}`, err);
		}
		try {
			waiverNudges += await sendWaiverReminders(o.id);
		} catch (err) {
			failed++;
			console.error(`waiver-reminder cron failed for ${o.id}`, err);
		}
		try {
			ratingNudgeCount += await ratingNudges(o.id);
		} catch (err) {
			failed++;
			console.error(`rating-nudge cron failed for ${o.id}`, err);
		}
		try {
			underEnrolled += await autoCancelUnderEnrolled(o.id);
		} catch (err) {
			failed++;
			console.error(`under-enrollment cron failed for ${o.id}`, err);
		}
		try {
			autoCheckouts += await closeStaleCheckIns(o.id);
		} catch (err) {
			failed++;
			console.error(`auto-checkout cron failed for ${o.id}`, err);
		}
		try {
			shiftCloses += await closeStaleShifts(o.id);
		} catch (err) {
			failed++;
			console.error(`shift-close cron failed for ${o.id}`, err);
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
		try {
			winbacks += await sendWinBackNudges(o.id);
		} catch (err) {
			failed++;
			console.error(`win-back cron failed for ${o.id}`, err);
		}
		try {
			leadNudges += await sendLeadNudges(o.id);
		} catch (err) {
			failed++;
			console.error(`lead-nudge cron failed for ${o.id}`, err);
		}
		try {
			rosters += await sendInstructorRosters(o.id);
		} catch (err) {
			failed++;
			console.error(`instructor-roster cron failed for ${o.id}`, err);
		}
		try {
			feedbackDigests += await sendInstructorFeedbackDigests(o.id);
		} catch (err) {
			failed++;
			console.error(`feedback-digest cron failed for ${o.id}`, err);
		}
		try {
			courseCompletions += await sendCourseCompletions(o.id);
		} catch (err) {
			failed++;
			console.error(`course-completion cron failed for ${o.id}`, err);
		}
		try {
			briefings += await sendStaffBriefing(o.id);
		} catch (err) {
			failed++;
			console.error(`staff-briefing cron failed for ${o.id}`, err);
		}
		try {
			billingReminders += await sendBillingReminders(o.id);
		} catch (err) {
			failed++;
			console.error(`billing-reminder cron failed for ${o.id}`, err);
		}
	}
	await purgeExpiredDemos();
	return json({
		workspaces: orgs.length,
		failed,
		reminders,
		eventReminders,
		amenityReminders,
		challengeInvites,
		challengeResults,
		pastDue,
		trials,
		birthdays,
		anniversaries,
		noShows,
		waitlistExpired,
		suspended,
		generated,
		digests,
		winbacks,
		leadNudges,
		rosters,
		feedbackDigests,
		courseCompletions,
		briefings,
		billingReminders,
		announcements,
		packNudges,
		waiverNudges,
		ratingNudges: ratingNudgeCount,
		underEnrolled,
		autoCheckouts,
		shiftCloses,
		recurringPosted
	});
};

export const POST = GET;
