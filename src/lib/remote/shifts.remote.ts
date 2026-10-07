import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/shifts.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { idSchema } from '#lib/schemas.ts';

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
