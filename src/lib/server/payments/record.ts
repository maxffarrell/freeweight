import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { charge, gymMember, gymSettings, payment } from '#lib/server/db/schema.ts';
import { allocate } from '#lib/server/allocation.ts';
import { formatMoney } from '#lib/format.ts';
import { emit } from '#lib/server/services/events.ts';
import { notifyPaymentReceived } from '#lib/server/services/notifications.ts';

type OnlinePayment = {
	orgId: string;
	memberId: string;
	/** Minor units. */
	amount: number;
	method: (typeof payment.$inferInsert)['method'];
	/** Provider-unique payment ID; recording the same ID twice is a no-op. */
	externalId: string;
	provider: string;
};

/**
 * Records a provider-confirmed payment, applied to the member's open charges oldest-first.
 * Safe to call more than once for the same `externalId`.
 */
export async function recordOnlinePayment(p: OnlinePayment) {
	if (p.amount <= 0) return;
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, p.orgId), eq(gymMember.id, p.memberId)));
	if (!m) return;

	const rows = await db.transaction(async (tx) => {
		const open = await tx
			.select({
				id: charge.id,
				open: sql<number>`${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = "charge"."id"), 0)`.mapWith(
					Number
				)
			})
			.from(charge)
			.where(and(eq(charge.memberId, p.memberId), eq(charge.status, 'open')))
			.orderBy(asc(charge.dueDate), asc(charge.createdAt));
		const inserted = [];
		for (const [i, part] of allocate(p.amount, open).entries()) {
			const [row] = await tx
				.insert(payment)
				.values({
					organizationId: p.orgId,
					memberId: p.memberId,
					chargeId: part.chargeId,
					amount: part.amount,
					method: p.method,
					reference: p.externalId,
					notes: `Paid online with ${p.provider}`,
					// The unique index on the first part makes replayed webhooks a no-op.
					externalId: i === 0 ? p.externalId : `${p.externalId}:${i}`
				})
				.onConflictDoNothing()
				.returning();
			if (!row) return [];
			inserted.push(row);
		}
		return inserted;
	});
	const first = rows[0];
	if (!first) return;
	const [settings] = await db
		.select({ currency: gymSettings.currency })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, p.orgId));
	await emit({
		orgId: p.orgId,
		entityType: 'payment',
		entityId: first.id,
		action: 'recorded',
		summary: `${formatMoney(p.amount, settings?.currency ?? 'usd')} paid online with ${p.provider}`,
		data: {
			memberId: p.memberId,
			amount: p.amount,
			method: p.method,
			online: true,
			payments: rows.map((r) => r.id)
		}
	});
	notifyPaymentReceived(
		p.orgId,
		rows.map((r) => r.id),
		p.amount,
		p.method ?? 'card'
	).catch(() => {});
}
