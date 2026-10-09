import { and, asc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	checkIn,
	classSession,
	membership,
	plan,
	gymMember,
	gymSettings,
	member,
	organization,
	outer,
	payment
} from '#lib/server/db/schema.ts';
import { monthlyRecurring } from '#lib/server/services/reports.ts';

/**
 * Brand-level rollup across every org the user owns or administers —
 * the multi-gym "franchise" view. Each row is one gym with the same
 * headline numbers the dashboard shows: active members, MRR, this
 * month's collected revenue and check-ins, and sessions on the books
 * for the next 7 days.
 */
export async function franchiseOverview(userId: string) {
	const orgs = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			role: member.role
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(and(eq(member.userId, userId), inArray(member.role, ['owner', 'admin'])))
		.orderBy(asc(organization.name));

	const monthStart = new Date();
	monthStart.setUTCDate(1);
	monthStart.setUTCHours(0, 0, 0, 0);
	const prevMonthStart = new Date(monthStart);
	prevMonthStart.setUTCMonth(prevMonthStart.getUTCMonth() - 1);
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
	const weekEnd = new Date(Date.now() + 7 * 86_400_000);
	const now = new Date();

	const gyms = await Promise.all(
		orgs.map(async (o) => {
			const [
				[members],
				[revenue],
				[prevRevenue],
				[newMembers],
				[checkIns],
				[sessions],
				[settings],
				mrr
			] = await Promise.all([
				db
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(gymMember)
					.where(and(eq(gymMember.organizationId, o.id), eq(gymMember.status, 'active'))),
				db
					.select({ total: sql<number>`sum(${payment.amount})`.mapWith(Number) })
					.from(payment)
					.where(
						and(
							eq(payment.organizationId, o.id),
							isNull(payment.refundedAt),
							notInArray(payment.method, ['gift_card', 'credit']),
							gte(payment.paidAt, monthStart)
						)
					),
				db
					.select({ total: sql<number>`sum(${payment.amount})`.mapWith(Number) })
					.from(payment)
					.where(
						and(
							eq(payment.organizationId, o.id),
							isNull(payment.refundedAt),
							notInArray(payment.method, ['gift_card', 'credit']),
							gte(payment.paidAt, prevMonthStart),
							lt(payment.paidAt, monthStart)
						)
					),
				db
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(gymMember)
					.where(
						and(
							eq(gymMember.organizationId, o.id),
							gte(gymMember.joinedAt, thirtyDaysAgo.toISOString().slice(0, 10))
						)
					),
				db
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(checkIn)
					.where(and(eq(checkIn.organizationId, o.id), gte(checkIn.checkedAt, monthStart))),
				db
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(classSession)
					.where(
						and(
							eq(classSession.organizationId, o.id),
							isNull(classSession.cancelledAt),
							gte(classSession.startsAt, now),
							lt(classSession.startsAt, weekEnd)
						)
					),
				db
					.select({ currency: gymSettings.currency })
					.from(gymSettings)
					.where(eq(gymSettings.organizationId, o.id)),
				monthlyRecurring(o.id)
			]);

			// Drill-down detail: seats booked for next-7d sessions, members
			// holding open (unpaid) charges, and the plan mix by membership.
			const [seats] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(booking)
				.innerJoin(classSession, eq(booking.sessionId, classSession.id))
				.where(
					and(
						eq(classSession.organizationId, o.id),
						isNull(classSession.cancelledAt),
						eq(booking.status, 'booked'),
						gte(classSession.startsAt, now),
						lt(classSession.startsAt, weekEnd)
					)
				);
			const [debtors] = await db
				.select({
					n: sql<number>`count(distinct ${charge.memberId})`.mapWith(Number)
				})
				.from(charge)
				.where(and(eq(charge.organizationId, o.id), eq(charge.status, 'open')));
			const planMix = await db
				.select({
					name: plan.name,
					members: sql<number>`count(*)`.mapWith(Number)
				})
				.from(membership)
				.innerJoin(plan, eq(membership.planId, plan.id))
				.where(
					and(
						eq(membership.organizationId, o.id),
						eq(membership.status, 'active'),
						eq(plan.isPack, false)
					)
				)
				.groupBy(plan.id, plan.name)
				.orderBy(sql`count(*) desc`, asc(plan.name))
				.limit(5);

			return {
				...o,
				currency: settings?.currency ?? 'usd',
				members: members?.n ?? 0,
				mrr: mrr.total,
				monthRevenue: revenue?.total ?? 0,
				prevMonthRevenue: prevRevenue?.total ?? 0,
				newMembers30: newMembers?.n ?? 0,
				monthCheckIns: checkIns?.n ?? 0,
				sessionsNext7: sessions?.n ?? 0,
				seatsBooked7: seats?.n ?? 0,
				debtors: debtors?.n ?? 0,
				planMix
			};
		})
	);

	return {
		gyms,
		totals: {
			members: gyms.reduce((s, g) => s + g.members, 0),
			monthCheckIns: gyms.reduce((s, g) => s + g.monthCheckIns, 0),
			sessionsNext7: gyms.reduce((s, g) => s + g.sessionsNext7, 0)
		}
	};
}

/**
 * Find a member by email/name across every org the caller owns or administers —
 * "which of my gyms is this person a member of".
 */
export async function franchiseMemberSearch(userId: string, q: string) {
	const orgs = await db
		.select({ id: organization.id, name: organization.name })
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(and(eq(member.userId, userId), inArray(member.role, ['owner', 'admin'])));
	if (!orgs.length || q.trim().length < 2) return [];
	const orgIds = orgs.map((o) => o.id);
	const pattern = `%${q.trim().toLowerCase().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
	const rows = await db
		.select({
			orgId: gymMember.organizationId,
			memberId: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			status: gymMember.status,
			memberships:
				sql<number>`(select count(*) from ${membership} ms where ms.member_id = ${outer(gymMember.id)} and ms.status = 'active')`.mapWith(
					Number
				)
		})
		.from(gymMember)
		.where(
			and(
				inArray(gymMember.organizationId, orgIds),
				sql`(lower(${gymMember.email}) like ${pattern} escape '\\' or lower(${gymMember.name}) like ${pattern} escape '\\')`
			)
		)
		.orderBy(asc(gymMember.name))
		.limit(20);
	const orgName = new Map(orgs.map((o) => [o.id, o.name]));
	return rows.map((r) => ({ ...r, orgName: orgName.get(r.orgId) ?? '' }));
}
