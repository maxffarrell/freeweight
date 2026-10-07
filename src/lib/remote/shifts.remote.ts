import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/shifts.ts';
import { idSchema } from '#lib/schemas.ts';

export const getMyShift = query(async () => svc.myShift(await requireOrg()));

export const getOnShift = query(async () => svc.onShiftNow((await requireOrg()).orgId));

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
