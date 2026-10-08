import { and, asc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	checkIn,
	classSession,
	gymMember,
	gymSettings,
	member,
	organization,
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
	const weekEnd = new Date(Date.now() + 7 * 86_400_000);
	const now = new Date();

	const gyms = await Promise.all(
		orgs.map(async (o) => {
			const [[members], [revenue], [checkIns], [sessions], [settings], mrr] = await Promise.all([
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
			return {
				...o,
				currency: settings?.currency ?? 'usd',
				members: members?.n ?? 0,
				mrr: mrr.total,
				monthRevenue: revenue?.total ?? 0,
				monthCheckIns: checkIns?.n ?? 0,
				sessionsNext7: sessions?.n ?? 0
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
