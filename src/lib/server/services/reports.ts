import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	checkIn,
	classSession,
	classType,
	gymMember,
	membership,
	payment,
	plan,
	outer
} from '#lib/server/db/schema.ts';

/** Daily check-in counts for the last 30 days (includes zero days). */
async function checkInsByDay(orgId: string) {
	const rows = await db
		.select({
			day: sql<string>`to_char(${checkIn.checkedAt}, 'YYYY-MM-DD')`,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, new Date(Date.now() - 30 * 86400_000))
			)
		)
		.groupBy(sql`to_char(${checkIn.checkedAt}, 'YYYY-MM-DD')`);
	const byDay = new Map(rows.map((r) => [r.day, r.count]));
	const out = [];
	for (let i = 29; i >= 0; i--) {
		const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
		out.push({ day, count: byDay.get(day) ?? 0 });
	}
	return out;
}

/** New members per month for the last 12 months (joined_at, falling back to created_at). */
async function newMembersByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	return db
		.select({
			month: sql<string>`to_char(${gymMember.createdAt}, 'YYYY-MM')`,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), gte(gymMember.createdAt, since)))
		.groupBy(sql`to_char(${gymMember.createdAt}, 'YYYY-MM')`)
		.orderBy(asc(sql`to_char(${gymMember.createdAt}, 'YYYY-MM')`));
}

/** Collected revenue per month for the last 12 months. */
async function revenueByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	return db
		.select({
			month: sql<string>`to_char(${payment.paidAt}, 'YYYY-MM')`,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), gte(payment.paidAt, since)))
		.groupBy(sql`to_char(${payment.paidAt}, 'YYYY-MM')`)
		.orderBy(asc(sql`to_char(${payment.paidAt}, 'YYYY-MM')`));
}

/** Active membership count per plan. */
async function membershipsByPlan(orgId: string) {
	return db
		.select({
			planName: plan.name,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.status, 'active')))
		.groupBy(plan.name)
		.orderBy(desc(sql`count(*)`));
}

/** Fill rate per class type over the last 30 days: sessions run and average booked/capacity. */
async function fillByClass(orgId: string) {
	return db
		.select({
			className: classType.name,
			sessions: sql<number>`count(distinct ${classSession.id})`.mapWith(Number),
			booked:
				sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status in ('booked','attended','no_show'))), 0)`.mapWith(
					Number
				),
			capacity: sql<number>`coalesce(sum(${classSession.capacity}), 0)`.mapWith(Number)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, new Date(Date.now() - 30 * 86400_000)),
				lt(classSession.startsAt, new Date())
			)
		)
		.groupBy(classType.name)
		.orderBy(desc(sql`count(distinct ${classSession.id})`));
}

export async function getReports(orgId: string) {
	const [checkIns, members, revenue, plans, fill] = await Promise.all([
		checkInsByDay(orgId),
		newMembersByMonth(orgId),
		revenueByMonth(orgId),
		membershipsByPlan(orgId),
		fillByClass(orgId)
	]);
	return { checkIns, members, revenue, plans, fill };
}
