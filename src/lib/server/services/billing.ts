import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, getTableColumns, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	gymMember,
	gymSettings,
	membership,
	payment,
	plan,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { formatMoney, todayISO } from '#lib/format.ts';
import { addDays } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Plans ----------

export async function listPlans(orgId: string) {
	return db
		.select({
			...getTableColumns(plan),
			activeMembers:
				sql<number>`(select count(*) from ${membership} m where m.plan_id = ${outer(plan.id)} and m.status = 'active')`.mapWith(
					Number
				)
		})
		.from(plan)
		.where(eq(plan.organizationId, orgId))
		.orderBy(asc(plan.amount));
}

export async function getPlan(orgId: string, id: string) {
	const [row] = await db
		.select()
		.from(plan)
		.where(and(eq(plan.organizationId, orgId), eq(plan.id, id)));
	if (!row) error(404, 'Plan not found');
	return row;
}

export async function createPlan(ctx: OrgContext, input: v.InferOutput<typeof s.planInput>) {
	const [row] = await db
		.insert(plan)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description,
			amount: input.amount,
			interval: input.interval,
			signupFee: input.signupFee,
			classCredits: input.classCredits ?? null,
			listed: input.listed,
			active: input.active
		})
		.returning();
	return row;
}

export async function updatePlan(ctx: OrgContext, input: v.InferOutput<typeof s.planUpdate>) {
	const { id, ...set } = input;
	const [row] = await db
		.update(plan)
		.set(set)
		.where(and(eq(plan.organizationId, ctx.orgId), eq(plan.id, id)))
		.returning();
	if (!row) error(404, 'Plan not found');
	return row;
}

// ---------- Memberships ----------

/** Adds the interval to a date, on the same calendar day for month/year. */
function nextPeriod(startISO: string, interval: 'week' | 'month' | 'year') {
	if (interval === 'week') return addDays(startISO, 7);
	const d = new Date(`${startISO}T00:00:00Z`);
	if (interval === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
	else d.setUTCFullYear(d.getUTCFullYear() + 1);
	return d.toISOString().slice(0, 10);
}

export async function listMemberships(orgId: string, status?: string[]) {
	return db
		.select({
			membership,
			memberName: gymMember.name,
			planName: plan.name,
			amount: plan.amount,
			interval: plan.interval
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				status?.length
					? sql`${outer(membership.status)} in (${sql.join(
							status.map((x) => sql`${x}`),
							sql`, `
						)})`
					: undefined
			)
		)
		.orderBy(desc(membership.createdAt));
}

export async function getMembership(orgId: string, id: string) {
	const [row] = await db
		.select({ membership, memberName: gymMember.name, plan: plan })
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.id, id)));
	if (!row) error(404, 'Membership not found');
	return row;
}

/**
 * Starts a membership: posts the signup fee and the first period's charge,
 * and schedules the next recurring charge.
 */
export async function createMembership(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.membershipInput>
) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const p = await getPlan(ctx.orgId, input.planId);

	const start = input.startsAt ?? todayISO();
	const [row] = await db
		.insert(membership)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			planId: input.planId,
			startsAt: new Date(`${start}T00:00:00Z`),
			nextChargeAt: new Date(`${nextPeriod(start, p.interval)}T00:00:00Z`)
		})
		.returning();

	if (p.signupFee > 0) {
		await db.insert(charge).values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			membershipId: row!.id,
			kind: 'signup',
			description: `Signup fee — ${p.name}`,
			dueDate: start,
			amount: p.signupFee
		});
	}
	if (p.amount > 0) {
		await postMembershipCharge(ctx.orgId, row!.id, start, p);
	}
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'membership',
		entityId: row!.id,
		action: 'created',
		summary: `${m.name} → ${p.name}`
	});
	return row;
}

/** Posts the recurring charge for one period. Idempotent via the period unique index. */
async function postMembershipCharge(
	orgId: string,
	membershipId: string,
	periodStart: string,
	p: { name: string; amount: number }
) {
	await db
		.insert(charge)
		.values({
			organizationId: orgId,
			memberId: (
				await db
					.select({ memberId: membership.memberId })
					.from(membership)
					.where(eq(membership.id, membershipId))
			)[0]!.memberId,
			membershipId,
			kind: 'membership',
			description: `${p.name} — period starting ${periodStart}`,
			periodStart,
			dueDate: periodStart,
			amount: p.amount
		})
		.onConflictDoNothing();
}

export async function updateMembership(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.membershipUpdate>
) {
	const [row] = await db
		.update(membership)
		.set({
			status: input.status,
			cancelledAt: input.status === 'cancelled' ? new Date() : null,
			nextChargeAt: input.status === 'active' ? undefined : null
		})
		.where(and(eq(membership.organizationId, ctx.orgId), eq(membership.id, input.id)))
		.returning();
	if (!row) error(404, 'Membership not found');
	return row;
}

/**
 * Posts membership charges that have come due and rolls `nextChargeAt` forward.
 * Runs from /api/cron and opportunistically when staff open the app.
 */
export async function runBilling(orgId: string) {
	const now = new Date();
	const due = await db
		.select({ membership, plan })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				lt(membership.nextChargeAt, now)
			)
		);
	let posted = 0;
	for (const { membership: m, plan: p } of due) {
		if (!m.nextChargeAt) continue;
		let period = m.nextChargeAt.toISOString().slice(0, 10);
		// Catch up on any missed periods (install was offline).
		while (new Date(`${period}T00:00:00Z`) < now) {
			if (p.amount > 0) await postMembershipCharge(orgId, m.id, period, p);
			posted++;
			period = nextPeriod(period, p.interval);
		}
		await db
			.update(membership)
			.set({ nextChargeAt: new Date(`${period}T00:00:00Z`) })
			.where(eq(membership.id, m.id));
	}
	return posted;
}

// ---------- Charges & payments ----------

export async function listCharges(orgId: string, status?: string) {
	return db
		.select({
			charge,
			memberName: gymMember.name,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.innerJoin(gymMember, eq(charge.memberId, gymMember.id))
		.where(
			and(eq(charge.organizationId, orgId), status ? eq(charge.status, status as never) : undefined)
		)
		.orderBy(desc(charge.dueDate));
}

export async function addCharge(ctx: OrgContext, input: v.InferOutput<typeof s.chargeInput>) {
	const [row] = await db
		.insert(charge)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			kind: input.kind,
			description: input.description ?? null,
			amount: input.amount,
			dueDate: input.dueDate
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'charge',
		entityId: row!.id,
		action: 'created',
		summary: `Charge of ${formatMoney(input.amount)} added`
	});
	return row;
}

export async function updateCharge(ctx: OrgContext, input: v.InferOutput<typeof s.chargeUpdate>) {
	const { id, ...set } = input;
	const [row] = await db
		.update(charge)
		.set(set)
		.where(and(eq(charge.organizationId, ctx.orgId), eq(charge.id, id)))
		.returning();
	if (!row) error(404, 'Charge not found');
	return row;
}

/** Records a payment and applies it to the member's open charges oldest-first. */
export async function recordPayment(ctx: OrgContext, input: v.InferOutput<typeof s.paymentInput>) {
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');

	let remaining = input.amount;
	const rows = await db.transaction(async (tx) => {
		const out = [];
		if (input.chargeId) {
			const [row] = await tx
				.insert(payment)
				.values({
					organizationId: ctx.orgId,
					memberId: input.memberId,
					chargeId: input.chargeId,
					amount: input.amount,
					method: input.method,
					reference: input.reference ?? null,
					notes: input.notes ?? null,
					recordedBy: ctx.userId
				})
				.returning();
			out.push(row!);
			remaining = 0;
		} else {
			const open = await tx
				.select({
					id: charge.id,
					open: sql<number>`${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
						Number
					)
				})
				.from(charge)
				.where(and(eq(charge.memberId, input.memberId), eq(charge.status, 'open')))
				.orderBy(asc(charge.dueDate), asc(charge.createdAt));
			for (const c of open) {
				if (remaining <= 0) break;
				if (c.open <= 0) continue;
				const take = Math.min(c.open, remaining);
				const [row] = await tx
					.insert(payment)
					.values({
						organizationId: ctx.orgId,
						memberId: input.memberId,
						chargeId: c.id,
						amount: take,
						method: input.method,
						reference: input.reference ?? null,
						notes: input.notes ?? null,
						recordedBy: ctx.userId
					})
					.returning();
				out.push(row!);
				remaining -= take;
			}
		}
		if (remaining > 0) {
			const [row] = await tx
				.insert(payment)
				.values({
					organizationId: ctx.orgId,
					memberId: input.memberId,
					chargeId: null,
					amount: remaining,
					method: input.method,
					reference: input.reference ?? null,
					notes: input.notes ?? null,
					recordedBy: ctx.userId
				})
				.returning();
			out.push(row!);
		}
		// Mark fully-covered charges paid.
		await tx.execute(sql`
			update ${charge} c set status = 'paid', updated_at = now()
			where c.organization_id = ${ctx.orgId} and c.status = 'open'
			  and (select coalesce(sum(p.amount), 0) from ${payment} p where p.charge_id = c.id) >= c.amount
		`);
		return out;
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'payment',
		entityId: rows[0]!.id,
		action: 'recorded',
		summary: `${formatMoney(input.amount)} from ${m.name}`,
		data: { memberId: input.memberId, method: input.method }
	});
	return rows[0];
}

export async function listPayments(orgId: string) {
	return db
		.select({ payment, memberName: gymMember.name })
		.from(payment)
		.innerJoin(gymMember, eq(payment.memberId, gymMember.id))
		.where(eq(payment.organizationId, orgId))
		.orderBy(desc(payment.paidAt))
		.limit(200);
}

/** Open balance in minor units (positive = owed). */
export async function memberBalance(orgId: string, memberId: string) {
	const [row] = await db
		.select({
			balance:
				sql<number>`coalesce(sum(case when ${outer(charge.status)} = 'open' then ${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0) else 0 end), 0) - coalesce((select sum(p2.amount) from ${payment} p2 where p2.member_id = ${memberId} and p2.charge_id is null), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.memberId, memberId)));
	return row?.balance ?? 0;
}

/** Monthly recurring revenue in minor units (normalized to a 30-day month). */
export async function monthlyRecurring(orgId: string) {
	const [row] = await db
		.select({
			mrr: sql<number>`coalesce(sum(case ${outer(plan.interval)} when 'week' then ${outer(plan.amount)} * 4.33 when 'month' then ${outer(plan.amount)} when 'year' then ${outer(plan.amount)} / 12 end), 0)`.mapWith(
				Number
			)
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.status, 'active')));
	return Math.round(row?.mrr ?? 0);
}

export async function getCurrency(orgId: string) {
	const [row] = await db
		.select({ currency: gymSettings.currency })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	return row?.currency ?? 'usd';
}

/** Recent payments for the billing page, scoped to a window. */
export async function paymentsBetween(orgId: string, from: Date, to: Date) {
	return db
		.select({ payment, memberName: gymMember.name })
		.from(payment)
		.innerJoin(gymMember, eq(payment.memberId, gymMember.id))
		.where(
			and(eq(payment.organizationId, orgId), gte(payment.paidAt, from), lt(payment.paidAt, to))
		)
		.orderBy(desc(payment.paidAt));
}
