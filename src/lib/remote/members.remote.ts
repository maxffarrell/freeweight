import * as v from 'valibot';
import { atRiskMembers } from '#lib/server/services/reports.ts';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/members.ts';
import * as workoutSvc from '#lib/server/services/workouts.ts';
import * as checkins from '#lib/server/services/checkins.ts';
import * as sched from '#lib/server/services/schedule.ts';
import * as trialSvc from '#lib/server/services/trials.ts';
import * as billingSvc from '#lib/server/services/billing.ts';
import * as giftcardSvc from '#lib/server/services/giftcards.ts';
import { portalToken } from '#lib/server/services/portal.ts';
import { appOrigin } from '#lib/server/email.ts';
import {
	announcementInput,
	bulkTagInput,
	checkInInput,
	creditTransferInput,
	guestVisitInput,
	idSchema,
	incidentInput,
	incidentUpdate,
	memberImportInput,
	memberInput,
	memberMergeInput,
	memberNoteInput,
	memberTagInput,
	memberUpdate,
	lockerInput,
	recurringEmailInput,
	levelInput,
	setLevelInput,
	announcementTemplateInput,
	scheduledAnnouncementInput,
	signRequestInput,
	workoutInput,
	workoutUpdate
} from '#lib/schemas.ts';
import {
	resendAnnouncementToNonOpeners,
	cancelScheduledAnnouncement,
	countAnnouncementAudience,
	createRecurringAnnouncement,
	deleteRecurringAnnouncement,
	listRecentAnnouncements,
	listRecurringAnnouncements,
	requestPaymentNotice,
	scheduleAnnouncement,
	sendAnnouncement,
	previewAnnouncement as previewAnnouncementSvc,
	sendAnnouncementTest,
	listAnnouncementTemplates,
	createAnnouncementTemplate,
	deleteAnnouncementTemplate as deleteAnnouncementTemplateSvc
} from '#lib/server/services/notifications.ts';
import * as levelSvc from '#lib/server/services/levels.ts';
import * as loanSvc from '#lib/server/services/loans.ts';
import * as progSvc from '#lib/server/services/programs.ts';
import * as lockerSvc from '#lib/server/services/lockers.ts';
import * as settingsSvc from '#lib/server/services/settings.ts';
import { localDate, zonedToUtc } from '#lib/tz.ts';

/** Dependents billing under a member — kiosk family check-in. */
export const getDependents = query(idSchema, async (memberId) =>
	svc.listDependents((await requireOrg()).orgId, memberId)
);

export const getMembers = query(
	v.optional(
		v.object({
			q: v.optional(v.string()),
			tag: v.optional(v.string()),
			status: v.optional(v.picklist(['active', 'inactive'])),
			planId: v.optional(v.string()),
			sort: v.optional(v.picklist(['name', 'joined', 'lastVisit', 'stale', 'balance', 'visits30'])),
			owes: v.optional(v.boolean()),
			suspended: v.optional(v.boolean()),
			recent: v.optional(v.boolean()),
			risk: v.optional(v.boolean()),
			family: v.optional(v.boolean()),
			birthday: v.optional(v.boolean()),
			noContact: v.optional(v.boolean()),
			unsubscribed: v.optional(v.boolean()),
			referred: v.optional(v.boolean()),
			neverBooked: v.optional(v.boolean()),
			endingSoon: v.optional(v.boolean()),
			noWaiver: v.optional(v.boolean()),
			onWaitlist: v.optional(v.boolean()),
			paused: v.optional(v.boolean()),
			noUpcoming: v.optional(v.boolean()),
			comped: v.optional(v.boolean()),
			packExpiring: v.optional(v.boolean()),
			insideNow: v.optional(v.boolean()),
			hasLocker: v.optional(v.boolean()),
			lowCredits: v.optional(v.boolean()),
			autoRenew: v.optional(v.boolean()),
			cancelRequested: v.optional(v.boolean()),
			pauseRequested: v.optional(v.boolean()),
			noPortal: v.optional(v.boolean())
		})
	),
	async (opts) =>
		svc.listMembers(
			(await requireOrg()).orgId,
			opts?.q,
			opts?.tag,
			opts?.status,
			opts?.planId,
			opts?.sort,
			opts?.owes,
			opts?.suspended,
			opts?.recent,
			opts?.risk,
			opts?.family,
			opts?.birthday,
			opts?.noContact,
			opts?.unsubscribed,
			opts?.referred,
			opts?.neverBooked,
			opts?.endingSoon,
			opts?.noWaiver,
			opts?.onWaitlist,
			opts?.paused,
			opts?.noUpcoming,
			opts?.comped,
			opts?.packExpiring,
			opts?.insideNow,
			opts?.hasLocker,
			opts?.lowCredits,
			opts?.autoRenew,
			opts?.cancelRequested,
			opts?.pauseRequested,
			opts?.noPortal
		)
);
/** Distinct tags in use — feeds the members-page filter and the member-page autocomplete. */
export const getTags = query(async () => svc.listTags((await requireOrg()).orgId));

/** Groups of members who share an email or name — the members-list "possible duplicates" hint. */
export const getDuplicates = query(async () => svc.findDuplicates((await requireOrg()).orgId));
export const addMemberTag = command(memberTagInput, async ({ memberId, tag }) => {
	await svc.addMemberTag(await requireOrg(), memberId, tag);
	void getMember(memberId).refresh();
	void getTags().refresh();
});
/** Bulk-tag members from the list's selection toolbar. Returns how many got the tag. */
export const bulkSetInactive = command(
	v.object({ memberIds: v.pipe(v.array(idSchema), v.minLength(1), v.maxLength(500)) }),
	async ({ memberIds }) => {
		const n = await svc.setMembersInactive(await requireOrg(), memberIds);
		void getMembers().refresh();
		return n;
	}
);

export const tagMembers = command(bulkTagInput, async ({ memberIds, tag }) => {
	const n = await svc.addTagToMembers(await requireOrg(), memberIds, tag);
	void getMembers().refresh();
	void getTags().refresh();
	return n;
});

/** Gift cards this member bought or redeemed. */
export const getMemberGiftCards = query(v.pipe(v.string(), v.minLength(1)), async (memberId) => {
	return giftcardSvc.listMemberGiftCards((await requireOrg()).orgId, memberId);
});

/** Grants comp classes to every selected member's active membership. */
export const bulkGrantCredits = command(
	v.object({
		memberIds: v.pipe(v.array(idSchema), v.minLength(1), v.maxLength(500)),
		count: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
	}),
	async ({ memberIds, count }) => {
		const r = await billingSvc.bulkGrantCredits(await requireOrg(), memberIds, count);
		void getMembers().refresh();
		return r;
	}
);
/** Merge a duplicate member into the survivor (admin-only — the loser is deleted). */
export const mergeMembers = command(memberMergeInput, async ({ keepId, dropId }) => {
	await svc.mergeMembers(await requireOrg('admin'), keepId, dropId);
	void getMembers().refresh();
	void getMember(keepId).refresh();
});
export const removeMemberTag = command(memberTagInput, async ({ memberId, tag }) => {
	await svc.removeMemberTag(await requireOrg(), memberId, tag);
	void getMember(memberId).refresh();
	void getTags().refresh();
});
export const getMember = query(idSchema, async (id) =>
	svc.getMember((await requireOrg()).orgId, id)
);

/** Confirm a free-trial request — books a comp'd seat and emails the member. */
export const approveTrial = command(
	v.object({ requestId: idSchema, memberId: idSchema }),
	async ({ requestId, memberId }) => {
		const r = await trialSvc.approveTrialRequest(await requireOrg(), requestId);
		void getMember(memberId).refresh();
		return r;
	}
);

/** Decline a free-trial request — member gets a polite no. */
export const declineTrial = command(
	v.object({ requestId: idSchema, memberId: idSchema }),
	async ({ requestId, memberId }) => {
		const r = await trialSvc.declineTrialRequest(await requireOrg(), requestId);
		void getMember(memberId).refresh();
		return r;
	}
);

/** Scrub a member's personal data (deletion requests, GDPR-style erasure). */
export const anonymizeMember = command(idSchema, async (memberId) => {
	const r = await svc.anonymizeMember(await requireOrg('admin'), memberId);
	void getMember(memberId).refresh();
	void getMembers().refresh();
	return r;
});

/** Push a pack's expiry out N days — "she paid before it lapsed" fixes. */
export const extendPack = command(
	v.object({
		membershipId: idSchema,
		days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))
	}),
	async ({ membershipId, days }) => {
		const r = await svc.extendPack(await requireOrg(), membershipId, days);
		void getMember(r.memberId).refresh();
		return r;
	}
);
export const createMember = command(memberInput, async (input) => {
	const m = await svc.createMember(await requireOrg(), input);
	void getMembers().refresh();
	return m;
});
export const importMembers = command(memberImportInput, async (rows) => {
	const r = await svc.importMembers(await requireOrg(), rows);
	void getMembers().refresh();
	return r;
});
export const updateMember = command(memberUpdate, async (input) => {
	const m = await svc.updateMember(await requireOrg(), input);
	void getMember(m!.id).refresh();
	void getMembers().refresh();
	return m;
});

/** The shareable claim link for attaching a member's login to the portal. */
export const getPortalInvite = query(idSchema, async (memberId) => {
	await requireOrg();
	return { url: `${appOrigin()}/portal/claim/${portalToken(memberId)}` };
});

export const getTodayCheckIns = query(async () => {
	const { orgId } = await requireOrg();
	const tz = (await settingsSvc.getSettings(orgId)).timezone;
	const since = zonedToUtc(`${localDate(new Date(), tz)}T00:00`, tz);
	return checkins.listCheckIns(orgId, { since });
});

/** Sessions starting today from now-30min onward — the kiosk "up next" strip. */
export const getUpNext = query(async () => {
	const { orgId } = await requireOrg();
	const tz = (await settingsSvc.getSettings(orgId)).timezone;
	const start = zonedToUtc(`${localDate(new Date(), tz)}T00:00`, tz);
	const end = new Date(start.getTime() + 86400_000);
	const rows = await sched.listSessions(orgId, start, end);
	const now = Date.now();
	return rows
		.filter((s) => !s.session.cancelledAt && s.session.startsAt.getTime() >= now - 30 * 60_000)
		.slice(0, 4);
});

/** Check-ins for one local day, optionally filtered by member/guest name. */
export const getCheckIns = query(
	v.object({
		date: v.pipe(v.string(), v.isoDate()),
		q: v.optional(v.string()),
		inside: v.optional(v.boolean()),
		guests: v.optional(v.boolean()),
		method: v.optional(v.picklist(['qr', 'manual'])),
		locationId: v.optional(idSchema),
		firstVisit: v.optional(v.boolean())
	}),
	async ({ date, q, inside, guests, method, locationId, firstVisit }) => {
		const { orgId } = await requireOrg();
		const tz = (await settingsSvc.getSettings(orgId)).timezone;
		const since = zonedToUtc(`${date}T00:00`, tz);
		const until = new Date(since.getTime() + 86400_000);
		return checkins.listCheckIns(orgId, {
			since,
			until,
			q,
			inside,
			guestsOnly: guests,
			method,
			locationId,
			firstVisit
		});
	}
);
export const recordCheckIn = command(checkInInput, async (input) => {
	const r = await checkins.recordCheckIn(await requireOrg(), input);
	void getTodayCheckIns().refresh();
	void getMember(r.member.id).refresh();
	return r;
});

/** Kiosk end-of-day: checks out everyone still inside (same rule the cron uses). */
export const checkOutAll = command(async () => {
	const { orgId } = await requireOrg();
	const n = await checkins.checkOutAll(orgId);
	void getTodayCheckIns().refresh();
	return n;
});

/** Staff marks a check-in row as over — the member left. */
export const checkOut = command(idSchema, async (checkInId) => {
	const ctx = await requireOrg();
	const row = await checkins.checkOut(ctx, checkInId);
	void getTodayCheckIns().refresh();
	void getMember(row.memberId).refresh();
	return row;
});

/** Desk undo for a mis-scan — deletes the row and reverts that day's auto-attend. */
export const voidCheckIn = command(idSchema, async (checkInId) => {
	const ctx = await requireOrg();
	const r = await checkins.voidCheckIn(ctx, checkInId);
	void getTodayCheckIns().refresh();
	return r;
});

export const logGuestVisit = command(guestVisitInput, async (input) => {
	const r = await checkins.recordGuestVisit(await requireOrg(), input);
	void getTodayCheckIns().refresh();
	void getMember(r.member.id).refresh();
	return r;
});

/** The signed URL used as a member's QR check-in code (also rendered server-side in the portal). */
export const getCheckInCode = query(idSchema, async (memberId) => {
	await requireOrg();
	return checkins.checkInToken(memberId);
});

/** Last few staff announcements — shown under the Members table and in the send dialog. */
export const getRecentAnnouncements = query(async () =>
	listRecentAnnouncements((await requireOrg()).orgId)
);

/** How many members the current audience selection would reach — live preview in the send dialog. */
export const getAnnouncementAudience = query(
	v.object({
		tag: v.optional(v.string()),
		planId: v.optional(v.string()),
		locationId: v.optional(v.string()),
		atRisk: v.optional(v.boolean()),
		inactive: v.optional(v.boolean()),
		recent: v.optional(v.boolean())
	}),
	async ({ tag, planId, locationId, atRisk, inactive, recent }) =>
		atRisk
			? (await atRiskMembers((await requireOrg()).orgId)).length
			: countAnnouncementAudience(
					(await requireOrg()).orgId,
					tag || undefined,
					planId || undefined,
					locationId || undefined,
					inactive,
					recent
				)
);

/** Sends the draft to the staff user's own inbox — a render preview before blasting. */
export const emailMeTest = command(announcementInput, async (input) => {
	const ctx = await requireOrg();
	return sendAnnouncementTest(ctx.orgId, ctx.userId, input.subject, input.message);
});

export const emailAllMembers = command(announcementInput, async (input) => {
	const ctx = await requireOrg();
	const memberIds = input.atRisk
		? (await atRiskMembers(ctx.orgId)).map((m) => m.memberId)
		: input.memberIds;
	const r = await sendAnnouncement(
		ctx.orgId,
		input.subject,
		input.message,
		memberIds,
		input.tag,
		input.planId,
		input.locationId,
		input.inactive,
		input.recent
	);
	void getRecentAnnouncements().refresh();
	return r;
});

/** Queues the draft for a future send time — the cron delivers it. */
export const scheduleEmail = command(scheduledAnnouncementInput, async (input) => {
	const ctx = await requireOrg();
	const r = await scheduleAnnouncement(ctx.orgId, ctx.userId, {
		subject: input.subject,
		message: input.message,
		sendAt: new Date(input.sendAt),
		tag: input.tag,
		planId: input.planId,
		locationId: input.locationId,
		atRisk: input.atRisk,
		inactive: input.inactive,
		recent: input.recent
	});
	void getRecentAnnouncements().refresh();
	return r;
});

/** Deletes a queued announcement before the cron sends it. */
export const cancelScheduledEmail = command(idSchema, async (id) => {
	await cancelScheduledAnnouncement((await requireOrg()).orgId, id);
	void getRecentAnnouncements().refresh();
});

/** Re-sends a sent announcement to recipients who never opened it. */
export const resendToNonOpeners = command(idSchema, async (id) => {
	const r = await resendAnnouncementToNonOpeners((await requireOrg()).orgId, id);
	void getRecentAnnouncements().refresh();
	return r;
});

// ------- recurring announcements -------

export const getRecurringEmails = query(async () =>
	listRecurringAnnouncements((await requireOrg()).orgId)
);

export const createRecurringEmail = command(recurringEmailInput, async (input) => {
	const ctx = await requireOrg();
	const r = await createRecurringAnnouncement(ctx.orgId, ctx.userId, input);
	void getRecurringEmails().refresh();
	return r;
});

export const deleteRecurringEmail = command(idSchema, async (id) => {
	const r = await deleteRecurringAnnouncement((await requireOrg()).orgId, id);
	void getRecurringEmails().refresh();
	return r;
});

// ------- lockers -------

export const getLockers = query(async () => lockerSvc.listLockers((await requireOrg()).orgId));
export const addLocker = command(lockerInput, async ({ label }) => {
	const r = await lockerSvc.addLocker((await requireOrg()).orgId, label);
	void getLockers().refresh();
	return r;
});
export const removeLocker = command(idSchema, async (id) => {
	const r = await lockerSvc.removeLocker(await requireOrg(), id);
	void getLockers().refresh();
	return r;
});
export const getMemberLocker = query(idSchema, async (memberId) =>
	lockerSvc.memberLocker((await requireOrg()).orgId, memberId)
);
export const assignLocker = command(
	v.object({ lockerId: idSchema, memberId: idSchema }),
	async (input) => {
		const r = await lockerSvc.assignLocker(await requireOrg(), input.lockerId, input.memberId);
		void Promise.all([getLockers().refresh(), getMemberLocker(input.memberId).refresh()]);
		return r;
	}
);
export const releaseLocker = command(
	v.object({ id: idSchema, memberId: idSchema }),
	async (input) => {
		const r = await lockerSvc.releaseLocker(await requireOrg(), input.id);
		void Promise.all([getLockers().refresh(), getMemberLocker(input.memberId).refresh()]);
		return r;
	}
);

// ------- member notes -------

/** Staff "Request payment" — emails the member their open balance + pay-online link (max 1/day). */
export const requestPayment = command(idSchema, async (memberId) =>
	requestPaymentNotice((await requireOrg()).orgId, memberId)
);

export const getMemberNotes = query(idSchema, async (memberId) =>
	svc.listMemberNotes((await requireOrg()).orgId, memberId)
);

/** Renders the announcement as the member will see it — the compose dialog's Preview. */
export const previewAnnouncement = command(
	v.object({ subject: v.string(), message: v.string() }),
	async ({ subject, message }) =>
		previewAnnouncementSvc((await requireOrg()).orgId, subject, message)
);

export const addMemberNote = command(memberNoteInput, async ({ memberId, body }) => {
	const r = await svc.addMemberNote(await requireOrg(), memberId, body);
	void getMemberNotes(memberId).refresh();
	return r;
});

export const deleteMemberNote = command(
	v.object({ noteId: idSchema, memberId: idSchema }),
	async ({ noteId, memberId }) => {
		await svc.deleteMemberNote(await requireOrg(), noteId);
		void getMemberNotes(memberId).refresh();
	}
);

// ---------- Incidents + signature requests ----------

export const logIncident = command(incidentInput, async (input) => {
	const r = await svc.logIncident(await requireOrg(), input);
	if (input.memberId) void getMember(input.memberId).refresh();
	return r;
});

export const resolveMemberIssue = command(
	v.object({ id: idSchema, memberId: idSchema }),
	async ({ id, memberId }) => {
		const r = await svc.resolveIssue(await requireOrg(), id);
		void getMember(memberId).refresh();
		return r;
	}
);

export const updateIncidentEntry = command(
	v.object({ ...incidentUpdate.entries, memberId: idSchema }),
	async ({ memberId, ...input }) => {
		const r = await svc.updateIncident(await requireOrg(), input);
		void getMember(memberId).refresh();
		return r;
	}
);

export const sendSignRequest = command(signRequestInput, async (input) => {
	const r = await svc.sendSignRequest(await requireOrg(), input);
	void getMember(input.memberId).refresh();
	return r;
});

export const voidSignRequest = command(
	v.object({ id: idSchema, memberId: idSchema }),
	async ({ id, memberId }) => {
		const r = await svc.voidSignRequest(await requireOrg(), id);
		void getMember(memberId).refresh();
		return r;
	}
);

/** Staff: assigned workouts on the member page. */
export const getMemberWorkouts = query(idSchema, async (memberId) =>
	workoutSvc.listMemberWorkouts((await requireOrg()).orgId, memberId)
);

export const addMemberWorkout = command(workoutInput, async ({ memberId, title, body }) => {
	const r = await workoutSvc.addWorkout(await requireOrg(), memberId, title, body);
	void getMemberWorkouts(memberId).refresh();
	return r;
});

export const updateMemberWorkout = command(workoutUpdate, async ({ id, title, body }) =>
	workoutSvc.updateWorkout(await requireOrg(), id, title, body)
);

export const deleteMemberWorkout = command(idSchema, async (id) =>
	workoutSvc.deleteWorkout(await requireOrg(), id)
);

/** Remaining classes on one pack membership — the transfer dialog's ceiling. */
export const getPackRemaining = query(idSchema, async (membershipId) =>
	svc.packRemaining((await requireOrg()).orgId, membershipId)
);

/** Staff: move pack credits to another member ("gift a friend 5 classes"). */
export const transferPackCredits = command(
	creditTransferInput,
	async ({ membershipId, toMemberId, credits }) => {
		const r = await svc.transferPackCredits(
			await requireOrg(),
			membershipId,
			{ memberId: toMemberId },
			credits
		);
		void getPackRemaining(membershipId).refresh();
		return r;
	}
);

/** PR wall: latest records for the lobby display, auto-refreshed by the page. */
export const getPrWall = query(async () => svc.prWall((await requireOrg()).orgId));

export const getLevels = query(async () => levelSvc.listLevels((await requireOrg()).orgId));

export const addLevel = command(levelInput, async (input) => {
	const ctx = await requireOrg('admin');
	const r = await levelSvc.addLevel(ctx.orgId, input.name, input.color);
	void getLevels().refresh();
	return r;
});

export const removeLevel = command(idSchema, async (id) => {
	const ctx = await requireOrg('admin');
	const r = await levelSvc.removeLevel(ctx.orgId, id);
	void getLevels().refresh();
	return r;
});

export const setMemberLevel = command(setLevelInput, async (input) => {
	const ctx = await requireOrg('admin');
	const r = await levelSvc.setMemberLevel(ctx, input.memberId, input.levelId);
	void getLevels().refresh();
	return r;
});

export const getAnnouncementTemplates = query(async () =>
	listAnnouncementTemplates((await requireOrg()).orgId)
);

export const saveAnnouncementTemplate = command(announcementTemplateInput, async (input) => {
	const ctx = await requireOrg();
	const r = await createAnnouncementTemplate(ctx.orgId, ctx.userId, input);
	void getAnnouncementTemplates().refresh();
	return r;
});

export const deleteAnnouncementTemplate = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	const r = await deleteAnnouncementTemplateSvc(ctx.orgId, id);
	void getAnnouncementTemplates().refresh();
	return r;
});

export const getLoanables = query(async () => loanSvc.listLoanables((await requireOrg()).orgId));

export const addLoanable = command(
	v.object({
		name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
		quantity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99))
	}),
	async (input) => {
		const ctx = await requireOrg('admin');
		const r = await loanSvc.addLoanable(ctx.orgId, input.name, input.quantity);
		void getLoanables().refresh();
		return r;
	}
);

export const removeLoanable = command(idSchema, async (id) => {
	const ctx = await requireOrg('admin');
	const r = await loanSvc.removeLoanable(ctx.orgId, id);
	void getLoanables().refresh();
	return r;
});

export const getMemberLoans = query(idSchema, async (memberId) =>
	loanSvc.memberLoans((await requireOrg()).orgId, memberId)
);

export const loanItem = command(
	v.object({ itemId: idSchema, memberId: idSchema }),
	async (input) => {
		const ctx = await requireOrg();
		const r = await loanSvc.loanItem(ctx, input.itemId, input.memberId);
		void getMemberLoans(input.memberId).refresh();
		return r;
	}
);

export const returnLoan = command(
	v.object({ loanId: idSchema, memberId: idSchema }),
	async (input) => {
		const ctx = await requireOrg();
		const r = await loanSvc.returnLoan(ctx, input.loanId);
		void getMemberLoans(input.memberId).refresh();
		return r;
	}
);

export const getPrograms = query(async () => progSvc.listPrograms((await requireOrg()).orgId));

export const saveProgram = command(
	v.object({
		id: v.optional(idSchema),
		name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
		weeks: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(52)),
		note: v.optional(v.pipe(v.string(), v.maxLength(500))),
		days: v.array(
			v.object({
				dayNo: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
				title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
				body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000))
			})
		)
	}),
	async (input) => {
		const ctx = await requireOrg();
		const r = await progSvc.saveProgram(ctx, input);
		void getPrograms().refresh();
		return r;
	}
);

export const removeProgram = command(idSchema, async (id) => {
	const ctx = await requireOrg('admin');
	const r = await progSvc.removeProgram(ctx, id);
	void getPrograms().refresh();
	return r;
});

export const getMemberPrograms = query(idSchema, async (memberId) =>
	progSvc.memberPrograms((await requireOrg()).orgId, memberId)
);

export const assignProgram = command(
	v.object({
		memberId: idSchema,
		programId: idSchema,
		startDate: v.pipe(v.string(), v.nonEmpty())
	}),
	async (input) => {
		const ctx = await requireOrg();
		const r = await progSvc.assignProgram(ctx, input.memberId, input.programId, input.startDate);
		void getMemberPrograms(input.memberId).refresh();
		return r;
	}
);

export const setProgramStatus = command(
	v.object({
		assignmentId: idSchema,
		memberId: idSchema,
		status: v.picklist(['active', 'done', 'stopped'])
	}),
	async (input) => {
		const ctx = await requireOrg();
		const r = await progSvc.setAssignmentStatus(ctx, input.assignmentId, input.status);
		void getMemberPrograms(input.memberId).refresh();
		return r;
	}
);
