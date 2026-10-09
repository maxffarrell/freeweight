import { error } from '@sveltejs/kit';
import { and, asc, eq, lte } from 'drizzle-orm';
import type * as v from 'valibot';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	expense,
	gymMember,
	recurringCharge,
	recurringExpense
} from '#lib/server/db/schema.ts';
import { emit } from '#lib/server/services/events.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { formatMoney } from '#lib/format.ts';
import { localDate } from '#lib/tz.ts';
import * as s from '#lib/schemas.ts';
import type { OrgContext } from '#lib/server/context.ts';

export async function listRecurring(orgId: string) {
	return db
		.select({ rec: recurringCharge, memberName: gymMember.name })
		.from(recurringCharge)
		.innerJoin(gymMember, eq(recurringCharge.memberId, gymMember.id))
		.where(eq(recurringCharge.organizationId, orgId))
		.orderBy(asc(gymMember.name))
		.limit(500);
}

/** Adds a recurring add-on (PT package, towel service) — cron posts a charge each period. */
export async function addRecurring(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.recurringChargeInput>
) {
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(recurringCharge)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			description: input.description,
			amount: input.amount,
			interval: input.interval,
			nextDue: input.nextDue
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'recurring_charge',
		entityId: row!.id,
		action: 'created',
		summary: `Recurring ${input.description} (${formatMoney(input.amount)}/${input.interval})`,
		data: { memberId: input.memberId }
	});
	return row;
}

export async function updateRecurring(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.recurringChargeUpdate>
) {
	const [row] = await db
		.update(recurringCharge)
		.set({
			...(input.active !== undefined ? { active: input.active } : {}),
			...(input.nextDue ? { nextDue: input.nextDue } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(recurringCharge.id, input.id), eq(recurringCharge.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Not found');
	return row;
}

export async function removeRecurring(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(recurringCharge)
		.where(and(eq(recurringCharge.id, id), eq(recurringCharge.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Not found');
	return row;
}

function advance(due: string, interval: string) {
	const d = new Date(`${due}T00:00:00Z`);
	if (interval === 'week') d.setUTCDate(d.getUTCDate() + 7);
	else if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
	else d.setUTCMonth(d.getUTCMonth() + 1);
	return d.toISOString().slice(0, 10);
}

/**
 * Cron: posts an `other` charge for every due period of every active
 * recurring add-on (catch-up posts each missed period, capped at 6), then
 * advances nextDue. Same idempotence model as membership billing — the
 * due stamp marks which period a charge covers.
 */
export async function postDueRecurring(orgId: string) {
	const today = localDate(new Date(), (await getSettings(orgId)).timezone);
	const rows = await db
		.select()
		.from(recurringCharge)
		.where(
			and(
				eq(recurringCharge.organizationId, orgId),
				eq(recurringCharge.active, true),
				lte(recurringCharge.nextDue, today)
			)
		);
	let posted = 0;
	for (const r of rows) {
		let due = r.nextDue;
		for (let i = 0; i < 6 && due <= today; i++) {
			await db.insert(charge).values({
				organizationId: orgId,
				memberId: r.memberId,
				kind: 'other',
				description: `${r.description} (recurring)`,
				amount: r.amount,
				dueDate: due
			});
			posted++;
			due = advance(due, r.interval);
		}
		await db
			.update(recurringCharge)
			.set({ nextDue: due, updatedAt: new Date() })
			.where(eq(recurringCharge.id, r.id));
	}
	return posted;
}

// ---------- Recurring expenses (rent, software, insurance) ----------

export async function listRecurringExpenses(orgId: string) {
	return db
		.select()
		.from(recurringExpense)
		.where(eq(recurringExpense.organizationId, orgId))
		.orderBy(asc(recurringExpense.nextDue))
		.limit(200);
}

export async function addRecurringExpense(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.recurringExpenseInput>
) {
	const [row] = await db
		.insert(recurringExpense)
		.values({
			organizationId: ctx.orgId,
			label: input.label,
			category: input.category,
			amountCents: input.amountCents,
			interval: input.interval,
			nextDue: input.nextDue
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'recurring_expense',
		entityId: row!.id,
		action: 'created',
		summary: `Recurring expense ${input.label} (${formatMoney(input.amountCents)}/${input.interval})`
	});
	return row;
}

export async function updateRecurringExpense(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.recurringExpenseUpdate>
) {
	const [row] = await db
		.update(recurringExpense)
		.set({
			...(input.active !== undefined ? { active: input.active } : {}),
			...(input.nextDue ? { nextDue: input.nextDue } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(recurringExpense.id, input.id), eq(recurringExpense.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Not found');
	return row;
}

export async function removeRecurringExpense(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(recurringExpense)
		.where(and(eq(recurringExpense.id, id), eq(recurringExpense.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Not found');
	return row;
}

/** Cron: posts an `expense` row for every due period of every active recurring expense. */
export async function postDueRecurringExpenses(orgId: string) {
	const today = localDate(new Date(), (await getSettings(orgId)).timezone);
	const rows = await db
		.select()
		.from(recurringExpense)
		.where(
			and(
				eq(recurringExpense.organizationId, orgId),
				eq(recurringExpense.active, true),
				lte(recurringExpense.nextDue, today)
			)
		);
	let posted = 0;
	for (const r of rows) {
		let due = r.nextDue;
		for (let i = 0; i < 6 && due <= today; i++) {
			await db.insert(expense).values({
				organizationId: orgId,
				label: `${r.label} (recurring)`,
				category: r.category,
				amountCents: r.amountCents,
				expenseOn: due
			});
			posted++;
			due = advance(due, r.interval);
		}
		await db
			.update(recurringExpense)
			.set({ nextDue: due, updatedAt: new Date() })
			.where(eq(recurringExpense.id, r.id));
	}
	return posted;
}
