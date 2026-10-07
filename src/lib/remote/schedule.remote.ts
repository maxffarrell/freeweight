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
	closureInput,
	emailRosterInput,
	idSchema,
	seriesBookingInput,
	sessionInput,
	sessionUpdate,
	templateInput,
	templateUpdate
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

/** Duplicates a viewed week's sessions into the next week (or a target week). */
export const copyWeek = command(
	v.object({
		week: v.pipe(v.string(), v.isoDate()),
		target: v.optional(v.pipe(v.string(), v.isoDate()))
	}),
	async (input) => {
		const r = await svc.copyWeek(await requireOrg(), await tz(), input.week, input.target);
		void getSessions().refresh();
		return r;
	}
);

export const getClosures = query(async () => svc.listClosures((await requireOrg()).orgId));
export const addClosure = command(closureInput, async (input) => {
	const c = await svc.addClosure(await requireOrg(), input);
	void getClosures().refresh();
	void getSessions().refresh();
	return c;
});
export const removeClosure = command(idSchema, async (id) => {
	const c = await svc.removeClosure(await requireOrg(), id);
	void getClosures().refresh();
	return c;
});

export const getInstructors = query(async () => svc.listInstructors((await requireOrg()).orgId));

export const getTemplates = query(async () => svc.listTemplates((await requireOrg()).orgId));
export const createTemplate = command(templateInput, async (input) =>
	svc.createTemplate(await requireOrg(), input)
);
export const updateTemplate = command(templateUpdate, async (input) =>
	svc.updateTemplate(await requireOrg(), input)
);
export const deleteTemplate = command(idSchema, async (id) =>
	svc.deleteTemplate(await requireOrg(), id)
);

/** Book a member into all upcoming sessions of a class type for the next N weeks. */
export const bookSeries = command(seriesBookingInput, async (input) => {
	const r = await svc.bookSeries(await requireOrg(), input);
	void getSessions().refresh();
	void getMember(input.memberId).refresh();
	return r;
});

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
