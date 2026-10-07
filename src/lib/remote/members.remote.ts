import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/members.ts';
import * as checkins from '#lib/server/services/checkins.ts';
import * as sched from '#lib/server/services/schedule.ts';
import { portalToken } from '#lib/server/services/portal.ts';
import { appOrigin } from '#lib/server/email.ts';
import {
	announcementInput,
	checkInInput,
	guestVisitInput,
	idSchema,
	memberImportInput,
	memberInput,
	memberNoteInput,
	memberTagInput,
	memberUpdate,
	scheduledAnnouncementInput
} from '#lib/schemas.ts';
import {
	cancelScheduledAnnouncement,
	countAnnouncementAudience,
	listRecentAnnouncements,
	requestPaymentNotice,
	scheduleAnnouncement,
	sendAnnouncement,
	sendAnnouncementTest
} from '#lib/server/services/notifications.ts';
import * as settingsSvc from '#lib/server/services/settings.ts';
import { localDate, zonedToUtc } from '#lib/tz.ts';

export const getMembers = query(
	v.optional(
		v.object({
			q: v.optional(v.string()),
			tag: v.optional(v.string()),
			status: v.optional(v.picklist(['active', 'inactive'])),
			planId: v.optional(v.string()),
			sort: v.optional(v.picklist(['name', 'joined', 'lastVisit', 'balance']))
		})
	),
	async (opts) =>
		svc.listMembers(
			(await requireOrg()).orgId,
			opts?.q,
			opts?.tag,
			opts?.status,
			opts?.planId,
			opts?.sort
		)
);
/** Distinct tags in use — feeds the members-page filter and the member-page autocomplete. */
export const getTags = query(async () => svc.listTags((await requireOrg()).orgId));
export const addMemberTag = command(memberTagInput, async ({ memberId, tag }) => {
	await svc.addMemberTag(await requireOrg(), memberId, tag);
	void getMember(memberId).refresh();
	void getTags().refresh();
});
export const removeMemberTag = command(memberTagInput, async ({ memberId, tag }) => {
	await svc.removeMemberTag(await requireOrg(), memberId, tag);
	void getMember(memberId).refresh();
	void getTags().refresh();
});
export const getMember = query(idSchema, async (id) =>
	svc.getMember((await requireOrg()).orgId, id)
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
	v.object({ date: v.pipe(v.string(), v.isoDate()), q: v.optional(v.string()) }),
	async ({ date, q }) => {
		const { orgId } = await requireOrg();
		const tz = (await settingsSvc.getSettings(orgId)).timezone;
		const since = zonedToUtc(`${date}T00:00`, tz);
		const until = new Date(since.getTime() + 86400_000);
		return checkins.listCheckIns(orgId, { since, until, q });
	}
);
export const recordCheckIn = command(checkInInput, async (input) => {
	const r = await checkins.recordCheckIn(await requireOrg(), input);
	void getTodayCheckIns().refresh();
	void getMember(r.member.id).refresh();
	return r;
});

/** Staff marks a check-in row as over — the member left. */
export const checkOut = command(idSchema, async (checkInId) => {
	const ctx = await requireOrg();
	const row = await checkins.checkOut(ctx, checkInId);
	void getTodayCheckIns().refresh();
	void getMember(row.memberId).refresh();
	return row;
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
	v.object({ tag: v.optional(v.string()), planId: v.optional(v.string()) }),
	async ({ tag, planId }) =>
		countAnnouncementAudience((await requireOrg()).orgId, tag || undefined, planId || undefined)
);

/** Sends the draft to the staff user's own inbox — a render preview before blasting. */
export const emailMeTest = command(announcementInput, async (input) => {
	const ctx = await requireOrg();
	return sendAnnouncementTest(ctx.orgId, ctx.userId, input.subject, input.message);
});

export const emailAllMembers = command(announcementInput, async (input) => {
	const r = await sendAnnouncement(
		(await requireOrg()).orgId,
		input.subject,
		input.message,
		input.memberIds,
		input.tag,
		input.planId
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
		planId: input.planId
	});
	void getRecentAnnouncements().refresh();
	return r;
});

/** Deletes a queued announcement before the cron sends it. */
export const cancelScheduledEmail = command(idSchema, async (id) => {
	await cancelScheduledAnnouncement((await requireOrg()).orgId, id);
	void getRecentAnnouncements().refresh();
});

// ------- member notes -------

/** Staff "Request payment" — emails the member their open balance + pay-online link (max 1/day). */
export const requestPayment = command(idSchema, async (memberId) =>
	requestPaymentNotice((await requireOrg()).orgId, memberId)
);

export const getMemberNotes = query(idSchema, async (memberId) =>
	svc.listMemberNotes((await requireOrg()).orgId, memberId)
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
