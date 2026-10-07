import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/members.ts';
import * as checkins from '#lib/server/services/checkins.ts';
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
	memberUpdate
} from '#lib/schemas.ts';
import { listRecentAnnouncements, sendAnnouncement } from '#lib/server/services/notifications.ts';
import * as settingsSvc from '#lib/server/services/settings.ts';
import { localDate, zonedToUtc } from '#lib/tz.ts';

export const getMembers = query(
	v.optional(
		v.object({
			q: v.optional(v.string()),
			tag: v.optional(v.string()),
			status: v.optional(v.picklist(['active', 'inactive']))
		})
	),
	async (opts) => svc.listMembers((await requireOrg()).orgId, opts?.q, opts?.tag, opts?.status)
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

export const emailAllMembers = command(announcementInput, async (input) => {
	const r = await sendAnnouncement(
		(await requireOrg()).orgId,
		input.subject,
		input.message,
		input.memberIds,
		input.tag
	);
	void getRecentAnnouncements().refresh();
	return r;
});

// ------- member notes -------

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
