import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/schedule.ts';
import * as pt from '#lib/server/services/pt.ts';
import * as res from '#lib/server/services/resources.ts';
import * as evt from '#lib/server/services/gym-events.ts';
import * as checkins from '#lib/server/services/checkins.ts';
import * as billingSvc from '#lib/server/services/billing.ts';
import { getMember, getTodayCheckIns } from './members.remote.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import {
	bookingInput,
	bookingUpdate,
	classTypeInput,
	classTypeUpdate,
	classVideoInput,
	closureInput,
	emailEventRosterInput,
	emailRosterInput,
	equipmentInput,
	equipmentUpdate,
	idSchema,
	instructorConflictInput,
	instructorHandoffInput,
	seriesBookingInput,
	sessionInput,
	sessionUpdate,
	eventInput,
	resourceInput,
	resourceUpdate,
	templateInput,
	templateUpdate,
	timeOffInput,
	availabilityInput,
	ptApproveInput
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

/** Facility equipment + service log (staff-managed). */
export const getEquipment = query(async () => res.listEquipment((await requireOrg()).orgId));
export const createEquipment = command(equipmentInput, async (input) => {
	const r = await res.createEquipment(await requireOrg(), input);
	void getEquipment().refresh();
	return r;
});
export const updateEquipment = command(equipmentUpdate, async (input) => {
	const r = await res.updateEquipment(await requireOrg(), input);
	void getEquipment().refresh();
	return r;
});
export const removeEquipment = command(idSchema, async (id) => {
	await res.deleteEquipment(await requireOrg(), id);
	void getEquipment().refresh();
});

/** Demand hints — class/weekday pairs running hot (add) or cold (drop), last 6 weeks. */
export const getScheduleHints = query(async () => {
	const { orgId } = await requireOrg();
	return svc.scheduleDemandHints(orgId, await tz());
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
/** Everything on one local day for the printable day sheet. */
export const getDaySheet = query(v.string(), async (date) =>
	svc.daySheet((await requireOrg()).orgId, date)
);

export const getSession = query(idSchema, async (id) =>
	svc.getSession((await requireOrg()).orgId, id)
);
export const getRoster = query(idSchema, async (id) =>
	svc.getRoster((await requireOrg()).orgId, id)
);

/** Staff re-seats a booking into another session of the same class. */
export const moveBooking = command(
	v.object({ bookingId: idSchema, sessionId: idSchema }),
	async ({ bookingId, sessionId }) => {
		const r = await svc.moveBooking(await requireOrg(), bookingId, sessionId);
		void getSessions().refresh();
		void getRoster(sessionId).refresh();
		return r;
	}
);

export const setBookingNote = command(
	v.object({
		bookingId: idSchema,
		sessionId: idSchema,
		note: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))
	}),
	async (input) => {
		const ctx = await requireOrg();
		const r = await svc.setBookingNote(ctx, input.bookingId, input.note);
		void getRoster(input.sessionId).refresh();
		return r;
	}
);
export const setCoachNote = command(
	v.object({
		bookingId: idSchema,
		sessionId: idSchema,
		note: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))
	}),
	async (input) => {
		const ctx = await requireOrg();
		const r = await svc.setCoachNote(ctx, input.bookingId, input.note);
		void getRoster(input.sessionId).refresh();
		return r;
	}
);
/** Flip a finished session's 'booked' rows to no_show now (fees + emails run
 * via the same path as the nightly sweep) — staff don't wait for the cron. */
export const markSessionNoShows = command(idSchema, async (sessionId) => {
	const n = await svc.markPastNoShows((await requireOrg()).orgId, sessionId);
	void getRoster(sessionId).refresh();
	return { marked: n };
});

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
/** Email everyone registered or waitlisted for an event — "venue moved" notes. */
export const emailEventRoster = command(
	emailEventRosterInput,
	async ({ eventId, subject, message }) => {
		const { orgId } = await requireOrg();
		const { rows } = await evt.eventRoster(orgId, eventId);
		const ids = rows.map((r) => r.registration.memberId);
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
	const [sessions, offs, outside, room] = await Promise.all([
		svc.instructorConflicts(orgId, input.instructorId, intervals, input.excludeSessionId),
		svc.instructorTimeOffConflicts(orgId, input.instructorId, intervals, tzName),
		svc.instructorAvailabilityConflicts(orgId, input.instructorId, intervals, tzName),
		input.locationId
			? svc.locationConflicts(orgId, input.locationId, intervals, input.excludeSessionId)
			: Promise.resolve([])
	]);
	return [
		...sessions.map((s) => ({ ...s, kind: 'session' as const })),
		...room
			.filter((r) => !sessions.some((s) => s.id === r.id))
			.map((r) => ({ ...r, className: `${r.className} — room in use`, kind: 'room' as const })),
		// Cap availability hints so they don't crowd out real session clashes on repeats.
		...outside.slice(0, 3).map((i, n) => ({
			id: `avail-${n}`,
			startsAt: i.start,
			endsAt: i.end,
			className: 'Outside availability',
			kind: 'availability' as const
		})),
		...offs
			.map((o) => ({
				id: `off-${o.startDate}`,
				startsAt: zonedToUtc(`${o.startDate}T00:00`, tzName),
				endsAt: zonedToUtc(`${o.endDate}T00:00`, tzName),
				className: `Time off${o.note ? ` — ${o.note}` : ''}`,
				kind: 'off' as const
			}))
			.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
			.slice(0, 6)
	];
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
/** Holiday freeze — pause every active plan until the given date. */
export const freezeAllMemberships = command(
	v.object({ until: v.pipe(v.string(), v.trim(), v.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')) }),
	async (input) => {
		const ctx = await requireOrg('admin');
		return billingSvc.freezeAllMemberships(ctx, input.until);
	}
);

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
export const getMyTeachingMonth = query(async () => svc.myTeachingMonth(await requireOrg()));
export const getTimeOff = query(async () => svc.myTimeOff(await requireOrg()));
export const getAvailability = query(async () => svc.myAvailability(await requireOrg()));

/** The instructor's own class ratings — "Your ratings" card on My classes. */
export const getMyRatings = query(async () => svc.myRatings(await requireOrg()));
export const setAvailability = command(availabilityInput, async (input) => {
	const r = await svc.setAvailability(await requireOrg(), input);
	void getAvailability().refresh();
	return r;
});
export const addTimeOff = command(timeOffInput, async (input) => {
	const r = await svc.addTimeOff(await requireOrg(), input);
	void Promise.all([getTimeOff().refresh(), getMyClasses().refresh()]);
	return r;
});
export const removeTimeOff = command(idSchema, async (id) => {
	await svc.removeTimeOff(await requireOrg(), id);
	void getTimeOff().refresh();
});

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

// ---------- PT (1:1) requests ----------

/** Pending PT requests across the org — for the My classes card. */
export const getPtRequests = query(async () => pt.myPtRequests(await requireOrg()));
export const approvePtRequest = command(ptApproveInput, async (input) => {
	const r = await pt.approvePtRequest(await requireOrg(), input.id, input.classTypeId, await tz(), {
		startsAt: input.startsAt
	});
	void getPtRequests().refresh();
	void getSessions().refresh();
	return r;
});
export const declinePtRequest = command(idSchema, async (id) => {
	const r = await pt.declinePtRequest(await requireOrg(), id);
	void getPtRequests().refresh();
	return r;
});

/** Desk undo for a no-show — frees the credit and voids the fee charge. */
export const forgiveNoShow = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	const r = await svc.forgiveNoShow(ctx, id, ctx.userId);
	void getRoster('').refresh();
	return r;
});

// ---------- Bookable resources (sauna, court, child care) ----------

export const getResources = query(async () => res.listResources((await requireOrg()).orgId));
export const createResource = command(resourceInput, async (input) => {
	const r = await res.createResource(await requireOrg(), input);
	void getResources().refresh();
	return r;
});
export const updateResource = command(resourceUpdate, async (input) => {
	const r = await res.updateResource(await requireOrg(), input);
	void getResources().refresh();
	return r;
});
export const getResourceBookings = query(async () =>
	res.listResourceBookings((await requireOrg()).orgId)
);
/** Staff cancel a member's amenity reservation. */
export const cancelAmenityBooking = command(idSchema, async (id) => {
	const r = await res.cancelResourceBooking((await requireOrg()).orgId, id);
	void getResourceBookings().refresh();
	return r;
});
/** Staff book an amenity slot for a member (desk reserves over the phone). */
export const bookAmenityForMember = command(
	v.object({
		memberId: idSchema,
		resourceId: idSchema,
		day: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		time: v.pipe(v.string(), v.regex(/^\d{2}:\d{2}$/)),
		note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)))
	}),
	async (input) => {
		const orgId = (await requireOrg()).orgId;
		const r = await res.bookResource(
			orgId,
			input.memberId,
			input.resourceId,
			input.day,
			input.time,
			input.note,
			await tz()
		);
		void getResourceBookings().refresh();
		return r;
	}
);

// ---------- Events (workshops, comps, bring-a-friend days) ----------

export const getEvents = query(async () => evt.listEvents((await requireOrg()).orgId));
export const createEvent = command(eventInput, async (input) => {
	const tzName = await tz();
	const startsAt = zonedToUtc(input.startsAt, tzName);
	const r = await evt.createEvent(await requireOrg(), {
		...input,
		startsAt,
		endsAt: new Date(startsAt.getTime() + input.durationMin * 60_000)
	});
	void getEvents().refresh();
	return r;
});
export const getEventRoster = query(idSchema, async (id) =>
	evt.eventRoster((await requireOrg()).orgId, id)
);
/** Staff register a member into an event (posts the signup charge). */
export const registerMemberForEvent = command(
	v.object({ eventId: idSchema, memberId: idSchema }),
	async ({ eventId, memberId }) => {
		const r = await evt.registerForEvent((await requireOrg()).orgId, memberId, eventId);
		void getEvents().refresh();
		void getEventRoster(eventId).refresh();
		return r;
	}
);
/** Staff cancel a registration (voids an unpaid signup charge). */
export const cancelEventRegistration = command(idSchema, async (id) => {
	const r = await evt.cancelRegistration((await requireOrg()).orgId, id);
	void getEvents().refresh();
	void getEventRoster(r.eventId).refresh();
});
/** Cancel an event — voids unpaid signup charges and emails every registrant. */
export const cancelEvent = command(idSchema, async (id) => {
	const r = await evt.cancelEvent((await requireOrg()).orgId, id);
	void getEvents().refresh();
	void getEventRoster(id).refresh();
	return r;
});
/** Mark/unmark a registered member as attended at the event. */
export const setEventAttended = command(
	v.object({ eventId: idSchema, id: idSchema, attended: v.boolean() }),
	async ({ eventId, id, attended }) => {
		const r = await evt.setEventAttended((await requireOrg()).orgId, id, attended);
		void getEventRoster(eventId).refresh();
		return r;
	}
);

// ---------- Courses (multi-week priced programs) ----------
import * as crs from '#lib/server/services/courses.ts';
import { courseInput, slotGenInput } from '#lib/schemas.ts';

export const getCourses = query(async () => crs.listCourses((await requireOrg()).orgId));
export const getCourseRoster = query(idSchema, async (id) =>
	crs.courseRoster((await requireOrg()).orgId, id)
);
export const createCourse = command(courseInput, async (input) => {
	const r = await crs.createCourse(await requireOrg('admin'), input);
	void getCourses().refresh();
	return r;
});
export const removeCourse = command(idSchema, async (id) => {
	await crs.removeCourse(await requireOrg('admin'), id);
	void getCourses().refresh();
});

/** Staff enrolls a member into a course (paid courses post the signup charge). */
export const enrollMemberInCourse = command(
	v.object({ courseId: idSchema, memberId: idSchema }),
	async ({ courseId, memberId }) => {
		const r = await crs.enrollCourse((await requireOrg()).orgId, memberId, courseId);
		void getCourseRoster(courseId).refresh();
		void getCourses().refresh();
		return r;
	}
);

/** Staff removes a member from a course (frees the seat, promotes the waitlist). */
export const unenrollCourseMember = command(
	v.object({ courseId: idSchema, enrollmentId: idSchema }),
	async ({ courseId, enrollmentId }) => {
		const r = await crs.cancelCourseEnrollment((await requireOrg()).orgId, enrollmentId);
		void getCourseRoster(courseId).refresh();
		void getCourses().refresh();
		return r;
	}
);

/** Publishes bookable sessions inside an instructor's availability windows. */
export const generateOpenSlots = command(slotGenInput, async (input) => {
	const r = await svc.generateSlots(await requireOrg('admin'), input);
	return r;
});

// ---------- Movement video library ----------

export const getClassVideos = query(async () => svc.listClassVideos((await requireOrg()).orgId));

export const addClassVideo = command(classVideoInput, async (input) => {
	const r = await svc.addClassVideo(await requireOrg(), input);
	void getClassVideos().refresh();
	return r;
});

export const deleteClassVideo = command(idSchema, async (id) => {
	const r = await svc.deleteClassVideo(await requireOrg(), id);
	void getClassVideos().refresh();
	return r;
});

export const getClassTypeQuals = query(async () =>
	svc.listClassTypeQuals((await requireOrg()).orgId)
);

export const setClassTypeQuals = command(
	v.object({ classTypeId: idSchema, memberIds: v.array(idSchema) }),
	async (input) => {
		const r = await svc.setClassTypeQuals(await requireOrg(), input.classTypeId, input.memberIds);
		void getClassTypeQuals().refresh();
		return r;
	}
);
