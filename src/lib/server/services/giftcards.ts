import { outer } from '#lib/server/db/schema.ts';
import { randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { aliasedTable } from 'drizzle-orm';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type * as v from 'valibot';
import { db } from '#lib/server/db/index.ts';
import { charge, giftCard, gymMember, payment } from '#lib/server/db/schema.ts';
import { allocate } from '#lib/server/allocation.ts';
import { emit } from '#lib/server/services/events.ts';
import { addCharge } from '#lib/server/services/billing.ts';
import { formatMoney } from '#lib/format.ts';
import * as s from '#lib/schemas.ts';
import type { OrgContext } from '#lib/server/context.ts';

// Unambiguous alphabet for desk-typed codes: no 0/O, 1/I/L, or vowels.
const ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
function newCode() {
	const b = randomBytes(8);
	const c = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
	return `GC-${c.slice(0, 4)}-${c.slice(4)}`;
}

/**
 * Sells a gift card to a member: creates the card and posts the face value
 * as an `other` charge on the buyer (that's where revenue lands — redemption
 * payments are method 'gift_card' and excluded from revenue sums).
 */
export async function sellGiftCard(ctx: OrgContext, input: v.InferOutput<typeof s.giftCardSale>) {
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');

	let card;
	for (let attempt = 0; attempt < 5 && !card; attempt++) {
		const [row] = await db
			.insert(giftCard)
			.values({
				organizationId: ctx.orgId,
				code: newCode(),
				amount: input.amount,
				balance: input.amount,
				purchaserMemberId: m.id,
				note: input.note
			})
			.onConflictDoNothing({ target: [giftCard.organizationId, giftCard.code] })
			.returning();
		card = row;
	}
	if (!card) error(500, 'Could not allocate a card code — try again');

	await addCharge(ctx, {
		memberId: m.id,
		kind: 'other',
		description: `Gift card ${card.code}`,
		amount: input.amount,
		dueDate: new Date().toISOString().slice(0, 10)
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'gift_card',
		entityId: card.id,
		action: 'sold',
		summary: `Gift card ${card.code} (${formatMoney(input.amount)}) sold to ${m.name}`,
		data: { memberId: m.id, amount: input.amount }
	});
	return card;
}

/** Cards a member bought or redeemed — for the member detail page. */
export async function listMemberGiftCards(orgId: string, memberId: string) {
	return db
		.select({ card: giftCard })
		.from(giftCard)
		.where(
			and(
				eq(giftCard.organizationId, orgId),
				or(eq(giftCard.purchaserMemberId, memberId), eq(giftCard.redeemedByMemberId, memberId))
			)
		)
		.orderBy(desc(giftCard.createdAt))
		.limit(20);
}

export async function listGiftCards(orgId: string) {
	const redeemer = aliasedTable(gymMember, 'redeemer');
	return db
		.select({
			card: giftCard,
			purchaserName: gymMember.name,
			redeemerName: redeemer.name
		})
		.from(giftCard)
		.leftJoin(gymMember, eq(giftCard.purchaserMemberId, gymMember.id))
		.leftJoin(redeemer, eq(giftCard.redeemedByMemberId, redeemer.id))
		.where(eq(giftCard.organizationId, orgId))
		.orderBy(desc(giftCard.createdAt))
		.limit(100);
}

/**
 * Redeems a card onto a member's account: drains the balance across their
 * open charges oldest-first (`gift_card`-method payments), leftover becomes
 * unapplied credit (`charge_id = null`) — the same shape `recordPayment`
 * produces. Whole card drains on first redemption; the member keeps the
 * credit on their account rather than tracking a card balance.
 */
export async function redeemGiftCard(orgId: string, memberId: string, rawCode: string) {
	const code = rawCode.trim().toUpperCase().replace(/\s+/g, '');
	let cardId = '';
	const applied = await db.transaction(async (tx) => {
		const [card] = await tx
			.select()
			.from(giftCard)
			.where(and(eq(giftCard.organizationId, orgId), eq(giftCard.code, code)))
			.for('update');
		if (!card || card.balance <= 0) error(400, 'That code is not valid or has nothing left on it');
		cardId = card.id;

		const open = await tx
			.select({
				id: charge.id,
				open: sql<number>`${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.organization_id = ${outer(charge.organizationId)} and p.member_id = ${outer(charge.memberId)} and p.refunded_at is null), 0)`.mapWith(
					Number
				)
			})
			.from(charge)
			.where(
				and(
					eq(charge.organizationId, orgId),
					eq(charge.memberId, memberId),
					eq(charge.status, 'open')
				)
			)
			.orderBy(asc(charge.dueDate), asc(charge.createdAt));
		for (const part of allocate(card.balance, open)) {
			await tx.insert(payment).values({
				organizationId: orgId,
				memberId,
				chargeId: part.chargeId,
				amount: part.amount,
				method: 'gift_card',
				reference: card.code,
				notes: 'Gift card redemption'
			});
		}
		await tx
			.update(giftCard)
			.set({
				balance: 0,
				redeemedByMemberId: memberId,
				redeemedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(giftCard.id, card.id));
		// Same coverage flip as recordPayment — charges now fully covered become 'paid'.
		await tx.execute(sql`
			update ${charge} c set status = 'paid', updated_at = now()
			where c.organization_id = ${orgId} and c.member_id = ${memberId} and c.status = 'open'
			  and (select coalesce(sum(p.amount), 0) from ${payment} p where p.charge_id = c.id and p.organization_id = c.organization_id and p.member_id = c.member_id and p.refunded_at is null) >= c.amount
		`);
		return card.balance;
	});
	await emit({
		orgId,
		entityType: 'gift_card',
		entityId: cardId,
		action: 'redeemed',
		summary: `Gift card ${code} (${formatMoney(applied)}) redeemed`,
		data: { memberId, amount: applied }
	});
	return { applied };
}
