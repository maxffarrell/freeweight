import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/schedule.ts';
import { getMember } from './members.remote.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import {
	bookingInput,
	bookingUpdate,
	classTypeInput,
	classTypeUpdate,
	emailRosterInput,
	idSchema,
	sessionInput,
	sessionUpdate,
	templateInput
} from '#lib/schemas.ts';
import { sendAnnouncement } from '#lib/server/services/notifications.ts';

const tz = async () => {
	const { orgId } = await requireOrg();
	return (await getSettings(orgId)).timezone;
};

export const getClassTypes = query(async () => svc.listClassTypes((await requireOrg()).orgId));
export const createClassType = command(classTypeInput, async (input) => {
	const c = await svc.createClassType(await requireOrg(), input);
	void getClassTypes().refresh();
	return c;
});
export const updateClassType = command(classTypeUpdate, async (input) => {
	const c = await svc.updateClassType(await requireOrg(), input);
	void getClassTypes().refresh();
	return c;
});

/** Sessions within `[from, to]` ISO dates; defaults to the next 14 days. */
export const getSessions = query(
	v.optional(v.object({ from: v.optional(v.string()), to: v.optional(v.string()) })),
	async (opts) => {
		const { orgId } = await requireOrg();
		const from = opts?.from ? new Date(`${opts.from}T00:00:00Z`) : new Date();
		const to = opts?.to
			? new Date(`${opts.to}T00:00:00Z`)
			: new Date(from.getTime() + 14 * 86400_000);
		return svc.listSessions(orgId, from, to);
	}
);
export const getSession = query(idSchema, async (id) =>
	svc.getSession((await requireOrg()).orgId, id)
);
export const getRoster = query(idSchema, async (id) =>
	svc.getRoster((await requireOrg()).orgId, id)
);
/** Email everyone booked or waitlisted on a session — "AC is out tonight" notes. */
export const emailSessionRoster = command(
	emailRosterInput,
	async ({ sessionId, subject, message }) => {
		const { orgId } = await requireOrg();
		const roster = await svc.getRoster(orgId, sessionId);
		const ids = roster
			.filter((r) => r.booking.status === 'booked' || r.booking.status === 'waitlisted')
			.map((r) => r.booking.memberId);
		if (!ids.length) return { sent: 0, total: 0 };
		return sendAnnouncement(orgId, subject, message, ids);
	}
);
export const createSession = command(sessionInput, async (input) => {
	const s = await svc.createSession(await requireOrg(), await tz(), input);
	void getSessions().refresh();
	return s;
});
export const updateSession = command(sessionUpdate, async (input) => {
	const s = await svc.updateSession(await requireOrg(), await tz(), input);
	void getSessions().refresh();
	void getSession(s!.id).refresh();
	return s;
});

export const getInstructors = query(async () => svc.listInstructors((await requireOrg()).orgId));

export const getTemplates = query(async () => svc.listTemplates((await requireOrg()).orgId));
export const createTemplate = command(templateInput, async (input) =>
	svc.createTemplate(await requireOrg(), input)
);
export const deleteTemplate = command(idSchema, async (id) =>
	svc.deleteTemplate(await requireOrg(), id)
);

export const bookSession = command(bookingInput, async (input) => {
	const b = await svc.bookSession(await requireOrg(), input);
	void getSessions().refresh();
	void getSession(input.sessionId).refresh();
	void getRoster(input.sessionId).refresh();
	void getMember(input.memberId).refresh();
	return b;
});
export const updateBooking = command(bookingUpdate, async (input) => {
	const b = await svc.updateBooking(await requireOrg(), input);
	void getSessions().refresh();
	void getSession(b.sessionId).refresh();
	void getRoster(b.sessionId).refresh();
	void getMember(b.memberId).refresh();
	return b;
});
