import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	giftCard,
	gymMember,
	organization,
	payment
} from '#lib/server/db/schema.ts';
import { redeemGiftCard, sellGiftCard } from '#lib/server/services/giftcards.ts';

// Needs a seeded DATABASE_URL — skips cleanly in unit-test runs without one.
describe.skipIf(!process.env.DATABASE_URL)('gift cards (integration)', () => {
	it('sells, redeems, drains, and rejects reuse/bad codes', async () => {
		const [org] = await db.select().from(organization).limit(1);
		const [m] = await db.select().from(gymMember).limit(1);
		const ctx = { orgId: org!.id, userId: null } as never;

		const card = await sellGiftCard(ctx, { memberId: m!.id, amount: 5000, note: '' });
		expect(card.code).toMatch(/^GC-/);
		expect(card.balance).toBe(5000);

		// lowercase + spaces tolerated
		const r = await redeemGiftCard(org!.id, m!.id, card.code.toLowerCase());
		expect(r.applied).toBe(5000);

		const pays = await db.select().from(payment).where(eq(payment.reference, card.code));
		expect(pays.reduce((n, p) => n + p.amount, 0)).toBe(5000);
		for (const p of pays) expect(p.method).toBe('gift_card');

		const [after] = await db.select().from(giftCard).where(eq(giftCard.id, card.id));
		expect(after!.balance).toBe(0);
		expect(after!.redeemedByMemberId).toBe(m!.id);

		await expect(redeemGiftCard(org!.id, m!.id, card.code)).rejects.toThrow();
		await expect(redeemGiftCard(org!.id, m!.id, 'GC-XXXX-XXXX')).rejects.toThrow();

		await db.delete(payment).where(eq(payment.reference, card.code));
		await db.delete(giftCard).where(eq(giftCard.id, card.id));
		await db.delete(charge).where(eq(charge.description, `Gift card ${card.code}`));
	});
});
