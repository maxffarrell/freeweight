import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	booking,
	charge,
	checkIn,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	member,
	payment,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { monthlyRecurring } from './billing.ts';
import { localDate, zonedToUtc } from '#lib/tz.ts';

/** KPIs and today's schedule for the dashboard. */
export async function dashboard(orgId: string) {
	const [settings] = await db
		.select()
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = settings?.timezone ?? 'UTC';
	const today = localDate(new Date(), tz);
	const dayStart = zonedToUtc(`${today}T00:00`, tz);
	const dayEnd = new Date(dayStart.getTime() + 86400_000);

	const [memberStats] = await db
		.select({
			active: sql<number>`count(*) filter (where ${outer(gymMember.status)} = 'active')`.mapWith(
				Number
			),
			newThisMonth:
				sql<number>`count(*) filter (where ${outer(gymMember.joinedAt)} >= ${today.slice(0, 8) + '01'})`.mapWith(
					Number
				)
		})
		.from(gymMember)
		.where(eq(gymMember.organizationId, orgId));

	const [openStats] = await db
		.select({
			openTotal:
				sql<number>`coalesce(sum(${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)) filter (where ${outer(charge.status)} = 'open'), 0)`.mapWith(
					Number
				),
			overdueTotal:
				sql<number>`coalesce(sum(${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)) filter (where ${outer(charge.status)} = 'open' and ${outer(charge.dueDate)} < ${today}), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(eq(charge.organizationId, orgId));

	const [checkInStats] = await db
		.select({ today: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, dayStart),
				lt(checkIn.checkedAt, dayEnd)
			)
		);

	const mrr = await monthlyRecurring(orgId);

	const todaySessions = await db
		.select({
			id: classSession.id,
			name: classType.name,
			color: classType.color,
			startsAt: classSession.startsAt,
			capacity: classSession.capacity,
			locationName: location.name,
			instructorName: user.name,
			booked:
				sql<number>`(select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status in ('booked','attended'))`.mapWith(
					Number
				),
			waitlisted:
				sql<number>`(select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'waitlisted')`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, dayStart),
				lt(classSession.startsAt, dayEnd)
			)
		)
		.orderBy(asc(classSession.startsAt));

	const recentActivity = await db
		.select()
		.from(activity)
		.where(eq(activity.organizationId, orgId))
		.orderBy(desc(activity.createdAt))
		.limit(12);

	const recentMembers = await db
		.select({ id: gymMember.id, name: gymMember.name, status: gymMember.status })
		.from(gymMember)
		.where(eq(gymMember.organizationId, orgId))
		.orderBy(desc(gymMember.createdAt))
		.limit(6);

	return {
		timezone: tz,
		currency: settings?.currency ?? 'usd',
		activeMembers: memberStats?.active ?? 0,
		newThisMonth: memberStats?.newThisMonth ?? 0,
		openTotal: openStats?.openTotal ?? 0,
		overdueTotal: openStats?.overdueTotal ?? 0,
		checkInsToday: checkInStats?.today ?? 0,
		mrr,
		todaySessions,
		recentActivity,
		recentMembers
	};
}
