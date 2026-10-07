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
	memberUpdate
} from '#lib/schemas.ts';
import { sendAnnouncement } from '#lib/server/services/notifications.ts';

export const getMembers = query(v.optional(v.object({ q: v.optional(v.string()) })), async (opts) =>
	svc.listMembers((await requireOrg()).orgId, opts?.q)
);
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
	const since = new Date();
	since.setHours(0, 0, 0, 0);
	return checkins.listTodayCheckIns(orgId, since);
});
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

export const emailAllMembers = command(announcementInput, async (input) =>
	sendAnnouncement((await requireOrg()).orgId, input.subject, input.message, input.memberIds)
);
