import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymSettings, location, member, rota, shift, user } from '#lib/server/db/schema.ts';
import { emit } from '#lib/server/services/events.ts';
import { localMinutes, localWeekday, zonedToUtc } from '#lib/tz.ts';
import type { OrgContext } from '#lib/server/context.ts';

async function staffRow(ctx: OrgContext) {
	const m = await db
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(and(eq(member.userId, ctx.userId), eq(member.organizationId, ctx.orgId)))
		.limit(1);
	if (!m[0]) error(403, 'Not staff of this gym');
	return m[0];
}

/** The calling staff member's role + currently-open shift, if any. */
export async function myShift(ctx: OrgContext) {
	const m = await staffRow(ctx);
	const [open] = await db
		.select()
		.from(shift)
		.where(and(eq(shift.memberId, m.id), isNull(shift.clockedOutAt)))
		.orderBy(desc(shift.clockedInAt))
		.limit(1);
	return { memberId: m.id, role: m.role, shift: open ?? null };
}

export async function clockIn(
	ctx: OrgContext,
	input: { locationId?: string | null; note?: string }
) {
	const m = await staffRow(ctx);
	const [open] = await db
		.select({ id: shift.id })
		.from(shift)
		.where(and(eq(shift.memberId, m.id), isNull(shift.clockedOutAt)))
		.limit(1);
	if (open) error(409, 'Already clocked in — clock out first');
	const [row] = await db
		.insert(shift)
		.values({
			organizationId: ctx.orgId,
			memberId: m.id,
			locationId: input.locationId || null,
			note: input.note ?? ''
		})
		.returning();
	const [who] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, ctx.userId))
		.limit(1);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'shift',
		entityId: row.id,
		action: 'clock_in',
		summary: `${who?.name ?? 'Staff'} clocked in`
	});
	return row;
}

export async function clockOut(ctx: OrgContext) {
	const m = await staffRow(ctx);
	const [row] = await db
		.update(shift)
		.set({ clockedOutAt: new Date() })
		.where(
			and(eq(shift.memberId, m.id), eq(shift.organizationId, ctx.orgId), isNull(shift.clockedOutAt))
		)
		.returning();
	if (!row) error(409, 'No open shift to clock out of');
	const [who] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, ctx.userId))
		.limit(1);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'shift',
		entityId: row.id,
		action: 'clock_out',
		summary: `${who?.name ?? 'Staff'} clocked out`
	});
	return row;
}

/** Everyone with an open shift right now — dashboard "on shift" card. */
export async function onShiftNow(orgId: string) {
	return db
		.select({
			shift,
			staffName: user.name,
			locationName: location.name
		})
		.from(shift)
		.innerJoin(member, eq(shift.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.leftJoin(location, eq(shift.locationId, location.id))
		.where(and(eq(shift.organizationId, orgId), isNull(shift.clockedOutAt)))
		.orderBy(asc(shift.clockedInAt));
}

const DAY_MS = 86_400_000;

/** Shift rows inside [from, to) — `from`/`to` are `YYYY-MM-DD` gym-local bounds. */
export async function listShifts(orgId: string, range: { from: string; to: string }) {
	return db
		.select({
			shift,
			staffName: user.name,
			locationName: location.name
		})
		.from(shift)
		.innerJoin(member, eq(shift.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.leftJoin(location, eq(shift.locationId, location.id))
		.where(
			and(
				eq(shift.organizationId, orgId),
				gte(shift.clockedInAt, new Date(`${range.from}T00:00:00Z`)),
				lt(shift.clockedInAt, new Date(new Date(`${range.to}T00:00:00Z`).getTime() + DAY_MS))
			)
		)
		.orderBy(desc(shift.clockedInAt))
		.limit(500);
}

/** Per-staff hours rollup for Reports — open shifts count to now. */
export async function shiftHours(orgId: string, range: { from: string; to: string }) {
	const rows = await db
		.select({
			memberId: shift.memberId,
			staffName: user.name,
			shifts: sql<number>`count(*)`.mapWith(Number),
			minutes:
				sql<number>`coalesce(sum(extract(epoch from (coalesce(${shift.clockedOutAt}, now()) - ${shift.clockedInAt})) / 60), 0)`.mapWith(
					Number
				)
		})
		.from(shift)
		.innerJoin(member, eq(shift.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(shift.organizationId, orgId),
				gte(shift.clockedInAt, new Date(`${range.from}T00:00:00Z`)),
				lt(shift.clockedInAt, new Date(new Date(`${range.to}T00:00:00Z`).getTime() + DAY_MS))
			)
		)
		.groupBy(shift.memberId, user.name);
	return rows.sort((a, b) => b.minutes - a.minutes);
}

/**
 * Daily cron: a staff member who forgets to clock out inflates hours forever —
 * close any shift left open past the end of its own local day at 23:59 (org
 * timezone), same rule as `closeStaleCheckIns`.
 */
export async function closeStaleShifts(orgId: string) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = st?.timezone ?? 'UTC';
	const rows = await db
		.update(shift)
		.set({
			clockedOutAt: sql`((${shift.clockedInAt} at time zone ${tz})::date + time '23:59:59') at time zone ${tz}`
		})
		.where(
			and(
				eq(shift.organizationId, orgId),
				isNull(shift.clockedOutAt),
				sql`(${shift.clockedInAt} at time zone ${tz})::date < (now() at time zone ${tz})::date`
			)
		)
		.returning({ id: shift.id });
	return rows.length;
}

/** Admin: force-close a still-open shift (staff forgot to clock out). */
export async function closeShift(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(shift)
		.set({ clockedOutAt: new Date() })
		.where(and(eq(shift.id, id), eq(shift.organizationId, ctx.orgId), isNull(shift.clockedOutAt)))
		.returning();
	if (!row) error(404, 'No open shift with that id');
	return row;
}

/** Admin: correct a shift's times — `*At` fields are `YYYY-MM-DDTHH:mm` gym-local. */
export async function updateShift(
	ctx: OrgContext,
	input: { id: string; clockedInAt?: string; clockedOutAt?: string | null },
	tz: string
) {
	const [cur] = await db
		.select()
		.from(shift)
		.where(and(eq(shift.id, input.id), eq(shift.organizationId, ctx.orgId)))
		.limit(1);
	if (!cur) error(404, 'Shift not found');
	const clockedInAt = input.clockedInAt ? zonedToUtc(input.clockedInAt, tz) : cur.clockedInAt;
	const clockedOutAt =
		input.clockedOutAt === undefined
			? cur.clockedOutAt
			: input.clockedOutAt
				? zonedToUtc(input.clockedOutAt, tz)
				: null;
	if (clockedOutAt && clockedOutAt <= clockedInAt) error(400, 'Clock-out must be after clock-in');
	const [row] = await db
		.update(shift)
		.set({ clockedInAt, clockedOutAt })
		.where(eq(shift.id, cur.id))
		.returning();
	return row;
}

/** Admin: hard-delete a shift row (double clock-in, test entry). */
export async function deleteShift(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(shift)
		.where(and(eq(shift.id, id), eq(shift.organizationId, ctx.orgId)))
		.returning({ id: shift.id });
	if (!row) error(404, 'Shift not found');
	return { id: row.id };
}

/** Every rota window in the org, grouped by staff — the shift-log rota section. */
export async function listRota(orgId: string) {
	return db
		.select({ rota, staffName: user.name })
		.from(rota)
		.innerJoin(member, eq(rota.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(rota.organizationId, orgId))
		.orderBy(asc(user.name), asc(rota.weekday), asc(rota.startTime));
}

/** Admin: replace one staff member's weekly rota. */
export async function setRota(
	ctx: OrgContext,
	memberId: string,
	windows: { weekday: number; startTime: string; endTime: string }[]
) {
	const [target] = await db
		.select({ id: member.id, staffName: user.name })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.id, memberId), eq(member.organizationId, ctx.orgId)))
		.limit(1);
	if (!target) error(404, 'Staff member not found');
	for (const w of windows) {
		if (w.endTime <= w.startTime) error(400, 'Each rota window must end after it starts');
	}
	const rows = await db.transaction(async (tx) => {
		await tx
			.delete(rota)
			.where(and(eq(rota.organizationId, ctx.orgId), eq(rota.memberId, memberId)));
		if (!windows.length) return [];
		return tx
			.insert(rota)
			.values(windows.map((w) => ({ organizationId: ctx.orgId, memberId, ...w })))
			.returning();
	});
	const [who] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, ctx.userId))
		.limit(1);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'rota',
		entityId: memberId,
		action: 'update',
		summary: `${who?.name ?? 'Staff'} updated ${target.staffName}'s rota`
	});
	return rows;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Staff whose rota window covers *now* (org timezone) — dashboard "expected"
 * list alongside who's actually clocked in. `late` = 15+ min into the window
 * without a clock-in.
 */
export async function scheduledNow(orgId: string) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = st?.timezone ?? 'UTC';
	const now = new Date();
	const wd = localWeekday(now, tz);
	const mins = localMinutes(now, tz);
	const rows = await db
		.select({
			rota,
			staffName: user.name,
			clockedInAt: shift.clockedInAt
		})
		.from(rota)
		.innerJoin(member, eq(rota.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.leftJoin(shift, and(eq(shift.memberId, rota.memberId), isNull(shift.clockedOutAt)))
		.where(and(eq(rota.organizationId, orgId), eq(rota.weekday, wd)))
		.orderBy(asc(rota.startTime));
	return rows
		.filter((r) => toMin(r.rota.startTime) <= mins && mins < toMin(r.rota.endTime))
		.map((r) => ({
			memberId: r.rota.memberId,
			staffName: r.staffName,
			startTime: r.rota.startTime,
			endTime: r.rota.endTime,
			clockedInAt: r.clockedInAt,
			late: !r.clockedInAt && mins > toMin(r.rota.startTime) + 15
		}));
}
