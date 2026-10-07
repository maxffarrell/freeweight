import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/schedule.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import {
	bookingInput,
	bookingUpdate,
	classTypeInput,
	classTypeUpdate,
	idSchema,
	sessionInput,
	sessionUpdate
} from '#lib/schemas.ts';

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

export const bookSession = command(bookingInput, async (input) => {
	const b = await svc.bookSession(await requireOrg(), input);
	void getSessions().refresh();
	void getSession(input.sessionId).refresh();
	void getRoster(input.sessionId).refresh();
	return b;
});
export const updateBooking = command(bookingUpdate, async (input) => {
	const b = await svc.updateBooking(await requireOrg(), input);
	void getSessions().refresh();
	return b;
});
