import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { equipmentLoan, gymMember, loanableItem } from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import type { OrgContext } from '#lib/server/context.ts';

/** Items + how many are currently out. */
export async function listLoanables(orgId: string) {
	return db
		.select({
			item: loanableItem,
			out: sql<number>`count(${equipmentLoan.id}) filter (where ${equipmentLoan.returnedAt} is null)`.mapWith(
				Number
			)
		})
		.from(loanableItem)
		.leftJoin(equipmentLoan, eq(equipmentLoan.itemId, loanableItem.id))
		.where(eq(loanableItem.organizationId, orgId))
		.groupBy(loanableItem.id)
		.orderBy(asc(loanableItem.name));
}

export async function addLoanable(orgId: string, name: string, quantity: number) {
	const [row] = await db
		.insert(loanableItem)
		.values({ organizationId: orgId, name, quantity })
		.returning();
	return row;
}

export async function removeLoanable(orgId: string, id: string) {
	const [row] = await db
		.delete(loanableItem)
		.where(and(eq(loanableItem.id, id), eq(loanableItem.organizationId, orgId)))
		.returning({ id: loanableItem.id });
	if (!row) error(404, 'Item not found');
	return { ok: true };
}

export async function memberLoans(orgId: string, memberId: string) {
	return db
		.select({ loan: equipmentLoan, itemName: loanableItem.name })
		.from(equipmentLoan)
		.innerJoin(loanableItem, eq(equipmentLoan.itemId, loanableItem.id))
		.where(and(eq(equipmentLoan.organizationId, orgId), eq(equipmentLoan.memberId, memberId)))
		.orderBy(desc(equipmentLoan.outAt));
}

export async function loanItem(ctx: OrgContext, itemId: string, memberId: string) {
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, ctx.orgId)));
	if (!m) error(404, 'Member not found');
	return db.transaction(async (tx) => {
		const [item] = await tx
			.select()
			.from(loanableItem)
			.where(and(eq(loanableItem.id, itemId), eq(loanableItem.organizationId, ctx.orgId)))
			.for('update');
		if (!item) error(404, 'Item not found');
		const [{ out }] = await tx
			.select({ out: sql<number>`count(*)`.mapWith(Number) })
			.from(equipmentLoan)
			.where(and(eq(equipmentLoan.itemId, itemId), isNull(equipmentLoan.returnedAt)));
		if ((out ?? 0) >= item.quantity) error(409, `No ${item.name} left to lend`);
		const [row] = await tx
			.insert(equipmentLoan)
			.values({ organizationId: ctx.orgId, itemId, memberId })
			.returning();
		emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'member',
			entityId: memberId,
			action: 'updated',
			summary: `Checked out ${item.name}`
		});
		return row;
	});
}

export async function returnLoan(ctx: OrgContext, loanId: string) {
	const [row] = await db
		.update(equipmentLoan)
		.set({ returnedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(equipmentLoan.id, loanId),
				eq(equipmentLoan.organizationId, ctx.orgId),
				isNull(equipmentLoan.returnedAt)
			)
		)
		.returning();
	if (!row) error(404, 'Loan not found');
	emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: row.memberId,
		action: 'updated',
		summary: 'Equipment returned'
	});
	return { ok: true };
}
