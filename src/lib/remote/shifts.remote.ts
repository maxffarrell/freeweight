import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/shifts.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { idSchema, rotaInput } from '#lib/schemas.ts';

const tz = async () => (await getSettings((await requireOrg()).orgId)).timezone;

export const getMyShift = query(async () => svc.myShift(await requireOrg()));

export const getOnShift = query(async () => svc.onShiftNow((await requireOrg()).orgId));

/** Last 30 days of shift records for the dashboard log dialog. */
export const getShiftLog = query(async () =>
	svc.listShifts((await requireOrg()).orgId, {
		from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
		to: new Date().toISOString().slice(0, 10)
	})
);

export const closeShift = command(idSchema, async (id) => {
	const row = await svc.closeShift(await requireOrg('admin'), id);
	void getShiftLog().refresh();
	void getOnShift().refresh();
	return row;
});

const localDateTime = v.pipe(v.string(), v.isoDateTime('Use YYYY-MM-DDTHH:mm'));

export const updateShift = command(
	v.object({
		id: idSchema,
		clockedInAt: v.optional(localDateTime),
		clockedOutAt: v.optional(v.nullable(localDateTime))
	}),
	async (input) => {
		const ctx = await requireOrg('admin');
		const st = await svc.updateShift(ctx, input, await tz());
		void getShiftLog().refresh();
		return st;
	}
);

export const deleteShift = command(idSchema, async (id) => {
	const out = await svc.deleteShift(await requireOrg('admin'), id);
	void getShiftLog().refresh();
	return out;
});

export const clockIn = command(
	v.object({
		locationId: v.optional(v.nullable(idSchema)),
		note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120)))
	}),
	async (input) => {
		const row = await svc.clockIn(await requireOrg(), input);
		void getMyShift().refresh();
		void getOnShift().refresh();
		return row;
	}
);

export const clockOut = command(async () => {
	const row = await svc.clockOut(await requireOrg());
	void getMyShift().refresh();
	void getOnShift().refresh();
	return row;
});

/** Everyone's weekly rota windows — staff can see the schedule. */
export const getRota = query(async () => svc.listRota((await requireOrg()).orgId));

/** Staff whose rota says they should be working right now. */
export const getScheduledNow = query(async () => svc.scheduledNow((await requireOrg()).orgId));

export const setRota = command(rotaInput, async (input) => {
	const ctx = await requireOrg('admin');
	const rows = await svc.setRota(ctx, input.memberId, input.windows);
	void getRota().refresh();
	void getScheduledNow().refresh();
	return rows;
});

/** Admin: set a staff member's hourly desk rate in cents (null clears). */
export const setStaffRate = command(
	v.object({
		memberId: idSchema,
		hourlyRateCents: v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000_000))
		)
	}),
	async (input) => {
		const row = await svc.setStaffRate(
			await requireOrg('admin'),
			input.memberId,
			input.hourlyRateCents
		);
		return row;
	}
);

// ---------- Desk checklist ----------

export const getDeskChecklist = query(async () => svc.deskChecklist((await requireOrg()).orgId));

export const toggleDeskTask = command(
	v.object({ taskId: idSchema, done: v.boolean() }),
	async (input) => {
		await svc.toggleDeskTask(await requireOrg(), input.taskId, input.done);
		void getDeskChecklist().refresh();
	}
);

/** Admin: add a desk task. */
export const addDeskTask = command(
	v.object({ label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)) }),
	async (input) => {
		const row = await svc.createDeskTask(await requireOrg('admin'), input.label);
		void getDeskChecklist().refresh();
		return row;
	}
);

/** Admin: remove a desk task (its completion history goes with it). */
export const removeDeskTask = command(idSchema, async (id) => {
	const row = await svc.removeDeskTask(await requireOrg('admin'), id);
	void getDeskChecklist().refresh();
	return row;
});
