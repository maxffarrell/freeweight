import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/schedule.ts';
import * as checkins from '#lib/server/services/checkins.ts';
import { getMember, getTodayCheckIns } from './members.remote.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import {
	bookingInput,
	bookingUpdate,
	classTypeInput,
	classTypeUpdate,
	closureInput,
	emailRosterInput,
	idSchema,
	instructorConflictInput,
	instructorHandoffInput,
	seriesBookingInput,
	sessionInput,
	sessionUpdate,
	templateInput,
	templateUpdate
} from '#lib/schemas.ts';
import { sendAnnouncement } from '#lib/server/services/notifications.ts';
import { addDays, zonedToUtc } from '#lib/tz.ts';

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
export const getInstructorConflicts = query(instructorConflictInput, async (input) => {
	const { orgId } = await requireOrg();
	const tzName = await tz();
	const start = zonedToUtc(input.startsAt, tzName);
	const dates = [start];
	if (input.repeatUntil) {
		let day = input.startsAt.slice(0, 10);
		let guard = 0;
		while ((day = addDays(day, 7)) <= input.repeatUntil && guard++ < 52)
			dates.push(zonedToUtc(`${day}T${input.startsAt.slice(11, 16)}`, tzName));
	}
	const intervals = dates.map((d) => ({
		start: d,
		end: new Date(d.getTime() + input.durationMin * 60_000)
	}));
	return svc.instructorConflicts(orgId, input.instructorId, intervals, input.excludeSessionId);
});
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

/** Preview counts for the instructor-handoff dialog. */
export const getInstructorUpcoming = query(
	v.object({ instructorId: idSchema, classTypeId: v.optional(v.string()) }),
	async (input) => svc.instructorUpcoming((await requireOrg()).orgId, input)
);

/** Reassign or cancel every future session an instructor teaches, templates
 * included so they don't regenerate under the departed instructor. */
export const handoffInstructor = command(instructorHandoffInput, async (input) => {
	const r = await svc.instructorHandoff(await requireOrg(), await tz(), input);
	void getSessions().refresh();
	void getTemplates().refresh();
	return r;
});

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

/** Kiosk "Check in all" — one tap logs a visit for every booked member on the roster.
 * Members already inside are skipped so the pass can't check anyone out. */
export const checkInRoster = command(idSchema, async (sessionId) => {
	const r = await checkins.checkInRoster(await requireOrg(), sessionId);
	void getSession(sessionId).refresh();
	void getRoster(sessionId).refresh();
	void getTodayCheckIns().refresh();
	return r;
});

/** The instructor's own upcoming sessions — powers the "My classes" page. */
export const getMyClasses = query(async () => svc.myTeachingSessions(await requireOrg()));

/** Org-wide open cover requests — the "Needs cover" card on My classes. */
export const getCoverNeeded = query(async () => svc.sessionsNeedingCover(await requireOrg()));

/** Staff claims a cover request — they become the session's instructor. */
export const claimCover = command(idSchema, async (sessionId) => {
	const r = await svc.claimCover(await requireOrg(), await tz(), sessionId);
	void getSessions().refresh();
	void getSession(sessionId).refresh();
	void getCoverNeeded().refresh();
	void getMyClasses().refresh();
	return r;
});
