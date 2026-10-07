import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/billing.ts';
import { getMember } from './members.remote.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import {
	chargeInput,
	chargeUpdate,
	idSchema,
	membershipInput,
	grantCreditsInput,
	membershipUpdate,
	paymentInput,
	planInput,
	planUpdate
} from '#lib/schemas.ts';

export const getPlans = query(async () => svc.listPlans((await requireOrg()).orgId));
export const createPlan = command(planInput, async (input) => {
	const p = await svc.createPlan(await requireOrg('admin'), input);
	void getPlans().refresh();
	return p;
});
export const updatePlan = command(planUpdate, async (input) => {
	const p = await svc.updatePlan(await requireOrg('admin'), input);
	void getPlans().refresh();
	return p;
});

export const getMemberships = query(
	v.optional(v.object({ status: v.optional(v.array(v.string())) })),
	async (opts) => svc.listMemberships((await requireOrg()).orgId, opts?.status)
);
export const createMembership = command(membershipInput, async (input) => {
	const m = await svc.createMembership(await requireOrg(), input);
	void getMemberships().refresh();
	void getCharges().refresh();
	void getMember(input.memberId).refresh();
	return m;
});
export const updateMembership = command(membershipUpdate, async (input) => {
	const m = await svc.updateMembership(await requireOrg(), input);
	void getMemberships().refresh();
	void getMember(m.memberId).refresh();
	return m;
});

/** Grant comp classes on top of the plan's credit cap (this period / this pack). */
export const grantCredits = command(grantCreditsInput, async ({ membershipId, count }) => {
	const m = await svc.grantCredits(await requireOrg(), membershipId, count);
	void getMemberships().refresh();
	void getMember(m.memberId).refresh();
	return m;
});

export const getCharges = query(
	v.optional(v.object({ status: v.optional(v.string()) })),
	async (opts) => svc.listCharges((await requireOrg()).orgId, opts?.status)
);
export const addCharge = command(chargeInput, async (input) => {
	const c = await svc.addCharge(await requireOrg(), input);
	void getCharges().refresh();
	void getMember(input.memberId).refresh();
	return c;
});
export const updateCharge = command(chargeUpdate, async (input) => {
	const c = await svc.updateCharge(await requireOrg(), input);
	void getCharges().refresh();
	void getMember(c.memberId).refresh();
	return c;
});

export const getPayments = query(async () => svc.listPayments((await requireOrg()).orgId));
export const recordPayment = command(paymentInput, async (input) => {
	const p = await svc.recordPayment(await requireOrg(), input);
	void getPayments().refresh();
	void getCharges().refresh();
	void getMember(input.memberId).refresh();
	return p;
});

/** Refunds a recorded payment — reopens the charge it covered and emails the member. */
export const refundPayment = command(idSchema, async (id) => {
	const p = await svc.refundPayment(await requireOrg(), id);
	void getPayments().refresh();
	void getCharges().refresh();
	void getMember(p.memberId).refresh();
	return p;
});

export const getMemberBalance = query(idSchema, async (memberId) =>
	svc.memberBalance((await requireOrg()).orgId, memberId)
);

export const getCurrency = query(async () => {
	const { orgId } = await requireOrg();
	return (await getSettings(orgId)).currency;
});
