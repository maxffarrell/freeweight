import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/billing.ts';
import * as gc from '#lib/server/services/giftcards.ts';
import * as recSvc from '#lib/server/services/recurring.ts';
import * as sched from '#lib/server/services/schedule.ts';
import { getMember } from './members.remote.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { requestAllPaymentNotices } from '#lib/server/services/notifications.ts';
import {
	bulkChargeInput,
	chargeInput,
	chargeUpdate,
	idSchema,
	membershipInput,
	grantCreditsInput,
	membershipUpdate,
	paymentInput,
	planInput,
	planUpdate,
	giftCardSale,
	promoCodeInput,
	recurringChargeInput,
	recurringChargeUpdate,
	promoCodeUpdate,
	saleInput,
	shopItemInput,
	shopItemUpdate,
	expenseInput
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

export const getPromoCodes = query(async () => svc.listPromoCodes((await requireOrg()).orgId));
export const createPromoCode = command(promoCodeInput, async (input) => {
	const p = await svc.createPromoCode(await requireOrg('admin'), input);
	void getPromoCodes().refresh();
	return p;
});
export const updatePromoCode = command(promoCodeUpdate, async (input) => {
	const p = await svc.updatePromoCode(await requireOrg('admin'), input);
	void getPromoCodes().refresh();
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
	const ctx = await requireOrg();
	const m = await svc.updateMembership(ctx, input);
	// A cancelled membership frees the member's upcoming spots — waitlists
	// promote off the back of each cancellation.
	if (m && input.status === 'cancelled')
		await sched.cancelUpcomingBookings(ctx, m.memberId).catch(() => {});
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
/** Posts a manual charge to every member with an active membership. */
export const bulkCharge = command(bulkChargeInput, async (input) => {
	const r = await svc.bulkCharge(await requireOrg('admin'), input);
	void getCharges().refresh();
	return r;
});
export const updateCharge = command(chargeUpdate, async (input) => {
	const c = await svc.updateCharge(await requireOrg(), input);
	void getCharges().refresh();
	void getMember(c.memberId).refresh();
	return c;
});

// ------- shop -------

export const getShopItems = query(async () => svc.listShopItems((await requireOrg()).orgId));

export const createShopItem = command(shopItemInput, async (input) => {
	const r = await svc.createShopItem(await requireOrg('admin'), input);
	void getShopItems().refresh();
	return r;
});

export const updateShopItem = command(shopItemUpdate, async (input) => {
	const r = await svc.updateShopItem(await requireOrg('admin'), input);
	void getShopItems().refresh();
	return r;
});

/** Front-desk sale — charge (or charge+payment) for a shop item. */
export const sellItem = command(saleInput, async (input) => {
	const r = await svc.sellItem(await requireOrg(), input);
	void getCharges().refresh();
	void getPayments().refresh();
	void getMember(input.memberId).refresh();
	void getPendingPickups().refresh();
	void getShopItems().refresh();
	return r;
});

export const getPendingPickups = query(async () => svc.pendingPickups((await requireOrg()).orgId));

/** Desk day-pass sale — posts the day's dropin charge for the member. */
export const sellDayPass = command(idSchema, async (memberId) => {
	const ctx = await requireOrg();
	const r = await svc.sellDayPass(ctx, memberId);
	void getCharges().refresh();
	void getMember(memberId).refresh();
	return r;
});

export const markPickedUp = command(idSchema, async (saleId) => {
	const r = await svc.markPickedUp(await requireOrg(), saleId);
	void getPendingPickups().refresh();
	return r;
});

// ------- recurring add-ons -------

export const getRecurring = query(async () => recSvc.listRecurring((await requireOrg()).orgId));

export const addRecurring = command(recurringChargeInput, async (input) => {
	const r = await recSvc.addRecurring(await requireOrg(), input);
	void getRecurring().refresh();
	return r;
});

export const updateRecurring = command(recurringChargeUpdate, async (input) => {
	const r = await recSvc.updateRecurring(await requireOrg(), input);
	void getRecurring().refresh();
	return r;
});

export const removeRecurring = command(idSchema, async (id) => {
	const r = await recSvc.removeRecurring(await requireOrg(), id);
	void getRecurring().refresh();
	return r;
});

// ------- gift cards -------

export const getGiftCards = query(async () => gc.listGiftCards((await requireOrg()).orgId));

/** Desk sale — creates the card code and posts the face value as an `other` charge on the buyer. */
export const sellGiftCard = command(giftCardSale, async (input) => {
	const r = await gc.sellGiftCard(await requireOrg(), input);
	void getGiftCards().refresh();
	void getCharges().refresh();
	void getMember(input.memberId).refresh();
	return r;
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
/** "Email all" on the aging card — balance-due emails to every member with an unpaid charge. */
export const requestAllPayments = command(async () =>
	requestAllPaymentNotices((await requireOrg()).orgId)
);

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

// ---------- Expenses ----------

export const getExpenses = query(async () => svc.listExpenses((await requireOrg()).orgId));

/** Admin: log an operating expense (rent, payroll, equipment…). */
export const addExpense = command(expenseInput, async (input) => {
	const row = await svc.addExpense(await requireOrg('admin'), input);
	void getExpenses().refresh();
	return row;
});

/** Admin: remove an expense row. */
export const removeExpense = command(idSchema, async (id) => {
	const row = await svc.removeExpense(await requireOrg('admin'), id);
	void getExpenses().refresh();
	return row;
});
