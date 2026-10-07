import { error } from '@sveltejs/kit';
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	sql
} from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	gymMember,
	gymSettings,
	membership,
	payment,
	plan,
	promoCode,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import {
	notifyChargePosted,
	notifyMembershipResumed,
	notifyMembershipSuspended,
	notifyPaymentReceived,
	notifyPaymentRefunded,
	notifyPlanChanged,
	notifyPlanPriceChange
} from './notifications.ts';
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
			isPack: input.isPack,
			packDays: input.isPack ? (input.packDays ?? null) : null,
			trialDays: input.trialDays,
			guestPasses: input.guestPasses ?? null,
			commitmentMonths: input.commitmentMonths ?? null,
			listed: input.listed,
			active: input.active
		})
		.returning();
	return row;
}

export async function updatePlan(ctx: OrgContext, input: v.InferOutput<typeof s.planUpdate>) {
	const { id, ...set } = input;
	const [old] = await db
		.select()
		.from(plan)
		.where(and(eq(plan.organizationId, ctx.orgId), eq(plan.id, id)));
	const [row] = await db
		.update(plan)
		.set(set)
		.where(and(eq(plan.organizationId, ctx.orgId), eq(plan.id, id)))
		.returning();
	if (!row) error(404, 'Plan not found');

	// An amount change silently reprices the next charge for every active member
	// on the plan without a price override — email them the new rate.
	if (old && set.amount !== undefined && set.amount !== old.amount && !row.isPack) {
		const affected = await db
			.select({ memberId: membership.memberId })
			.from(membership)
			.where(
				and(
					eq(membership.organizationId, ctx.orgId),
					eq(membership.planId, id),
					eq(membership.status, 'active'),
					isNull(membership.price)
				)
			);
		notifyPlanPriceChange(
			ctx.orgId,
			row.name,
			affected.map((a) => a.memberId),
			old.amount,
			row.amount,
			row.interval
		).catch(() => {});
	}
	return row;
}

// ---------- Promo codes ----------

export type PromoDiscount = {
	code: string;
	percentOff: number | null;
	amountOff: number | null;
};

export async function listPromoCodes(orgId: string) {
	return db
		.select()
		.from(promoCode)
		.where(eq(promoCode.organizationId, orgId))
		.orderBy(asc(promoCode.code));
}

export async function createPromoCode(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.promoCodeInput>
) {
	if ((input.percentOff == null) === (input.amountOff == null))
		error(400, 'Set either percent off or amount off');
	const [row] = await db
		.insert(promoCode)
		.values({
			organizationId: ctx.orgId,
			code: input.code.toUpperCase(),
			percentOff: input.percentOff ?? null,
			amountOff: input.amountOff ?? null,
			maxUses: input.maxUses ?? null,
			expiresAt: input.expiresAt ?? null
		})
		.onConflictDoNothing()
		.returning();
	if (!row) error(409, 'That code already exists');
	return row;
}

export async function updatePromoCode(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.promoCodeUpdate>
) {
	const [row] = await db
		.update(promoCode)
		.set({ active: input.active })
		.where(and(eq(promoCode.organizationId, ctx.orgId), eq(promoCode.id, input.id)))
		.returning();
	if (!row) error(404, 'Promo code not found');
	return row;
}

/** The promo row if the code can be redeemed right now, else 404/410. */
export async function redeemablePromo(orgId: string, code: string) {
	const [row] = await db
		.select()
		.from(promoCode)
		.where(and(eq(promoCode.organizationId, orgId), eq(promoCode.code, code.trim().toUpperCase())))
		.limit(1);
	if (!row || !row.active) error(400, 'Invalid promo code');
	if (row.expiresAt && row.expiresAt < todayISO()) error(400, 'Promo code has expired');
	if (row.maxUses != null && row.timesUsed >= row.maxUses)
		error(400, 'Promo code has been fully used');
	return row;
}

/** Counts a successful redemption. */
export async function markPromoUsed(orgId: string, id: string) {
	await db
		.update(promoCode)
		.set({ timesUsed: sql`${promoCode.timesUsed} + 1` })
		.where(and(eq(promoCode.organizationId, orgId), eq(promoCode.id, id)));
}

/**
 * Distributes a promo across the up-front amounts (signup fee, then first charge):
 * percent off applies per-charge; a flat amount is consumed in order.
 */
export function promoApply(promo: PromoDiscount, state: { left: number | null }, amount: number) {
	if (promo.percentOff != null)
		return Math.max(0, amount - Math.round((amount * promo.percentOff) / 100));
	if (state.left != null) {
		const d = Math.min(state.left, amount);
		state.left -= d;
		return amount - d;
	}
	return amount;
}

export const promoState = (promo: PromoDiscount) => ({ left: promo.amountOff });

// ---------- Memberships ----------

/** Adds the interval to a date, on the same calendar day for month/year. */
export function nextPeriod(startISO: string, interval: 'week' | 'month' | 'year') {
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
	ctx: { orgId: string; userId?: string | null },
	input: v.InferOutput<typeof s.membershipInput>,
	promo?: PromoDiscount
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
			// Packs bill once up front and expire packDays later; no recurring charge.
			// Trial: first recurring charge lands at the end of the free days.
			nextChargeAt: p.isPack
				? null
				: new Date(
						`${p.trialDays > 0 ? addDays(start, p.trialDays) : nextPeriod(start, p.interval)}T00:00:00Z`
					),
			endsAt:
				p.isPack && p.packDays
					? new Date(new Date(`${start}T00:00:00Z`).getTime() + p.packDays * 86400_000)
					: null
		})
		.returning();

	const payerId = m.guardianId ?? input.memberId;
	const forDependent = payerId !== input.memberId ? ` — ${m.name}` : '';
	// A promo discounts the up-front total: signup fee first, then the first charge.
	const pState = promo ? promoState(promo) : null;
	const signupAmount = promo ? promoApply(promo, pState!, p.signupFee) : p.signupFee;
	if (signupAmount > 0) {
		await db.insert(charge).values({
			organizationId: ctx.orgId,
			memberId: payerId,
			membershipId: row!.id,
			kind: 'signup',
			description: `Signup fee — ${p.name}${forDependent}${promo ? ` (${promo.code})` : ''}`,
			dueDate: start,
			amount: signupAmount
		});
	}
	// During a trial the first period charge is deferred to trial end.
	if (p.amount > 0 && (!p.trialDays || p.isPack)) {
		const firstAmount = promo ? promoApply(promo, pState!, p.amount) : p.amount;
		await postMembershipCharge(ctx.orgId, row!.id, start, p, firstAmount, promo?.code);
	}
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
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
	p: { name: string; amount: number },
	amount?: number,
	promoCodeStr?: string
) {
	const [ms] = await db
		.select({
			memberId: membership.memberId,
			price: membership.price,
			guardianId: gymMember.guardianId,
			memberName: gymMember.name
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.where(eq(membership.id, membershipId));
	const payerId = ms!.guardianId ?? ms!.memberId;
	// A staff price override bills instead of the plan's list price.
	const chargeAmount = amount ?? ms!.price ?? p.amount;
	if (chargeAmount <= 0) return;
	const [row] = await db
		.insert(charge)
		.values({
			organizationId: orgId,
			memberId: payerId,
			membershipId,
			kind: 'membership',
			description: `${p.name} — period starting ${periodStart}${payerId !== ms!.memberId ? ` — ${ms!.memberName}` : ''}${promoCodeStr ? ` (${promoCodeStr})` : ''}`,
			periodStart,
			dueDate: periodStart,
			amount: chargeAmount
		})
		.onConflictDoNothing()
		.returning();
	// Inserted (not a re-run) → let the member know they owe.
	if (row) notifyChargePosted(orgId, row.id).catch(() => {});
}

export async function updateMembership(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.membershipUpdate>
) {
	const [current] = await db
		.select({ status: membership.status, planId: membership.planId })
		.from(membership)
		.where(and(eq(membership.organizationId, ctx.orgId), eq(membership.id, input.id)));
	if (!current) error(404, 'Membership not found');

	// Staff plan change: moves the membership to another plan; the new price
	// applies from the next charge (no proration).
	let newPlan: { id: string; name: string } | null = null;
	if (input.planId && input.planId !== current.planId) {
		const p = await getPlan(ctx.orgId, input.planId);
		if (!p.active || p.isPack) error(404, 'Plan not available');
		newPlan = p;
	}

	// Pausing/cancelling stops billing. Resuming restarts it one plan interval out —
	// leaving nextChargeAt null on resume would bill the member never again.
	let nextChargeAt: Date | null | undefined;
	if (input.status === 'active' && current.status !== 'active') {
		const [p] = await db
			.select({ interval: plan.interval })
			.from(plan)
			.where(eq(plan.id, current.planId));
		nextChargeAt = new Date(`${nextPeriod(todayISO(), p?.interval ?? 'month')}T00:00:00Z`);
	} else if (input.status && input.status !== 'active') {
		nextChargeAt = null;
	}
	const set: Partial<typeof membership.$inferInsert> = {};
	if (input.status) {
		set.status = input.status;
		set.cancelledAt = input.status === 'cancelled' ? new Date() : null;
		set.nextChargeAt = nextChargeAt ?? null;
		set.frozenUntil = input.status === 'paused' ? (input.resumeAt ?? null) : null;
		// Any status change resolves (or supersedes) a pending pause request.
		set.pauseRequestedAt = null;
		set.pauseUntil = null;
		set.requestReason = null;
	}
	if (input.status === 'cancelled' || input.clearCancelRequest) set.cancelRequestedAt = null;
	if (input.clearPauseRequest) {
		set.pauseRequestedAt = null;
		set.pauseUntil = null;
	}
	// Any status change or request resolution clears the member's stated reason.
	if (input.status || input.clearCancelRequest || input.clearPauseRequest) {
		set.requestReason = null;
	}
	if (newPlan) set.planId = newPlan.id;
	if (input.price !== undefined) set.price = input.price;
	const [row] = await db
		.update(membership)
		.set(set)
		.where(and(eq(membership.organizationId, ctx.orgId), eq(membership.id, input.id)))
		.returning();
	if (!row) error(404, 'Membership not found');
	if (newPlan) {
		const [oldPlan] = await db
			.select({ name: plan.name })
			.from(plan)
			.where(eq(plan.id, current.planId));
		await emit({
			orgId: ctx.orgId,
			entityType: 'membership',
			entityId: row.id,
			action: 'plan_changed',
			summary: `Plan changed from ${oldPlan?.name ?? '?'} to ${newPlan.name}`
		});
		notifyPlanChanged(ctx.orgId, row.id, oldPlan?.name ?? '?').catch(() => {});
	}
	if (input.price !== undefined) {
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId ?? null,
			entityType: 'membership',
			entityId: row.id,
			action: 'updated',
			summary: input.price == null ? 'Custom price cleared' : `Custom price set to ${input.price}`
		});
	}
	return row;
}

/** Staff-granted comp classes on top of the plan's classCredits (this period / this pack). */
export async function grantCredits(ctx: OrgContext, membershipId: string, count: number) {
	const [row] = await db
		.update(membership)
		.set({ bonusCredits: sql`${membership.bonusCredits} + ${count}` })
		.where(and(eq(membership.organizationId, ctx.orgId), eq(membership.id, membershipId)))
		.returning({ id: membership.id, memberId: membership.memberId });
	if (!row) error(404, 'Membership not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'membership',
		entityId: row.id,
		action: 'updated',
		summary: `Granted ${count} comp class${count === 1 ? '' : 'es'}`
	});
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
				inArray(membership.status, ['active', 'suspended']),
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
	await resumeFrozenMemberships(orgId);
	return posted;
}

/**
 * Dunning: active memberships with an open charge older than `suspendAfterDays`
 * (gym setting; unset = off) become 'suspended' — booking requires an active
 * membership, so this cuts class access while billing keeps accruing. Runs in
 * the daily cron; `recordPayment` flips them back once nothing is overdue.
 */
export async function suspendDelinquentMembers(orgId: string) {
	const [st] = await db
		.select({ days: gymSettings.suspendAfterDays })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	if (!st?.days) return 0;
	const cutoff = addDays(todayISO(), -st.days);
	const rows = await db
		.select({ id: membership.id, memberId: membership.memberId })
		.from(membership)
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				sql`exists (select 1 from ${charge} c
					where c.member_id = ${membership.memberId} and c.organization_id = ${orgId}
					and c.status = 'open' and c.due_date < ${cutoff})`
			)
		);
	for (const r of rows) {
		await db.update(membership).set({ status: 'suspended' }).where(eq(membership.id, r.id));
		await emit({
			orgId,
			entityType: 'membership',
			entityId: r.id,
			action: 'suspended',
			summary: 'Membership suspended for non-payment',
			data: { memberId: r.memberId }
		});
	}
	if (rows.length)
		notifyMembershipSuspended(
			orgId,
			rows.map((r) => r.memberId)
		).catch(() => {});
	return rows.length;
}

/** After a payment, a suspended membership with nothing left overdue reactivates. */
async function unsuspendPaidUp(orgId: string, memberId: string) {
	const [overdue] = await db
		.select({ id: charge.id })
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.memberId, memberId),
				eq(charge.status, 'open'),
				lt(charge.dueDate, todayISO())
			)
		)
		.limit(1);
	if (overdue) return;
	await db
		.update(membership)
		.set({ status: 'active' })
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, memberId),
				eq(membership.status, 'suspended')
			)
		);
}

/**
 * Paused memberships whose freeze date has passed flip back to active and restart
 * billing one plan interval out. Runs inside runBilling (daily cron).
 */
async function resumeFrozenMemberships(orgId: string) {
	const rows = await db
		.select({ id: membership.id, interval: plan.interval })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'paused'),
				lte(membership.frozenUntil, todayISO())
			)
		);
	for (const r of rows) {
		const nextCharge = nextPeriod(todayISO(), r.interval);
		await db
			.update(membership)
			.set({
				status: 'active',
				frozenUntil: null,
				nextChargeAt: new Date(`${nextCharge}T00:00:00Z`)
			})
			.where(eq(membership.id, r.id));
		notifyMembershipResumed(orgId, r.id, nextCharge).catch(() => {});
	}
	return rows.length;
}

// ---------- Charges & payments ----------

export async function listCharges(orgId: string, status?: string) {
	return db
		.select({
			charge,
			memberName: gymMember.name,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)`.mapWith(
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
		actorId: ctx.userId ?? null,
		entityType: 'charge',
		entityId: row!.id,
		action: 'created',
		summary: `Charge of ${formatMoney(input.amount)} added`
	});
	return row;
}

/**
 * Posts one manual charge to every member holding an active membership —
 * annual facility fees, rate adjustments. Each member gets one charge
 * regardless of how many active memberships they hold.
 */
export async function bulkCharge(ctx: OrgContext, input: v.InferOutput<typeof s.bulkChargeInput>) {
	const members = await db
		.select({ memberId: membership.memberId })
		.from(membership)
		.where(and(eq(membership.organizationId, ctx.orgId), eq(membership.status, 'active')))
		.groupBy(membership.memberId);
	if (!members.length) return { posted: 0 };
	const rows = await db
		.insert(charge)
		.values(
			members.map((m) => ({
				organizationId: ctx.orgId,
				memberId: m.memberId,
				kind: 'other' as const,
				description: input.description,
				amount: input.amount,
				dueDate: input.dueDate
			}))
		)
		.returning({ id: charge.id });
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'charge',
		entityId: rows[0]!.id,
		action: 'bulk_created',
		summary: `"${input.description}" posted to ${rows.length} member${rows.length === 1 ? '' : 's'}`
	});
	return { posted: rows.length };
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
					open: sql<number>`${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)`.mapWith(
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
			  and (select coalesce(sum(p.amount), 0) from ${payment} p where p.charge_id = c.id and p.refunded_at is null) >= c.amount
		`);
		return out;
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'payment',
		entityId: rows[0]!.id,
		action: 'recorded',
		summary: `${formatMoney(input.amount)} from ${m.name}`,
		data: { memberId: input.memberId, method: input.method }
	});
	notifyPaymentReceived(
		ctx.orgId,
		rows.map((r) => r.id),
		input.amount,
		input.method
	).catch(() => {});
	unsuspendPaidUp(ctx.orgId, input.memberId).catch(() => {});
	return rows[0];
}

/**
 * Marks a payment refunded: it stops counting toward the charge it covered and
 * toward revenue; a charge it fully paid reopens to 'open'. Provider refunds
 * (Stripe) must be issued in the provider dashboard first — this only records it.
 */
export async function refundPayment(ctx: OrgContext, paymentId: string) {
	const [p] = await db
		.select()
		.from(payment)
		.where(and(eq(payment.id, paymentId), eq(payment.organizationId, ctx.orgId)));
	if (!p) error(404, 'Payment not found');
	if (p.refundedAt) error(409, 'Payment already refunded');
	await db.transaction(async (tx) => {
		await tx.update(payment).set({ refundedAt: new Date() }).where(eq(payment.id, p.id));
		if (p.chargeId)
			await tx.execute(sql`
				update ${charge} c set status = 'open', updated_at = now()
				where c.id = ${p.chargeId} and c.status = 'paid'
				  and (select coalesce(sum(p2.amount), 0) from ${payment} p2
				       where p2.charge_id = c.id and p2.refunded_at is null) < c.amount
			`);
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'payment',
		entityId: p.id,
		action: 'refunded',
		summary: `Refunded ${formatMoney(p.amount)}`,
		data: { memberId: p.memberId }
	});
	notifyPaymentRefunded(ctx.orgId, p.id).catch(() => {});
	return p;
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
				sql<number>`coalesce(sum(case when ${outer(charge.status)} = 'open' then ${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0) else 0 end), 0) - coalesce((select sum(p2.amount) from ${payment} p2 where p2.member_id = ${memberId} and p2.charge_id is null and p2.refunded_at is null), 0)`.mapWith(
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
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, false)
			)
		);
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
