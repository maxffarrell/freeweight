import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	checkIn,
	classSession,
	classType,
	gymMember,
	gymSettings,
	member,
	membership,
	payment,
	plan,
	user,
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
		.where(
			and(eq(payment.organizationId, orgId), isNull(payment.refundedAt), gte(payment.paidAt, since))
		)
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

/**
 * Active members whose last check-in was 30+ days ago (or who have never checked in).
 * Churn signal — a follow-up list for the front desk, capped at 50.
 */
async function atRiskMembers(orgId: string) {
	const rows = await db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			lastVisit: sql<Date | null>`max(${checkIn.checkedAt})`
		})
		.from(gymMember)
		.leftJoin(checkIn, eq(checkIn.memberId, gymMember.id))
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.status, 'active')))
		.groupBy(gymMember.id, gymMember.name, gymMember.email);
	const cutoff = Date.now() - 30 * 86400_000;
	return rows
		.map((r) => ({
			memberId: r.memberId,
			name: r.name,
			email: r.email,
			lastVisit: r.lastVisit,
			daysSince: r.lastVisit ? Math.floor((Date.now() - r.lastVisit.getTime()) / 86400_000) : null
		}))
		.filter((r) => r.lastVisit === null || r.lastVisit.getTime() < cutoff)
		.sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999))
		.slice(0, 50);
}

/** Members with the most check-ins over the last 30 days (member visits only, no guests). */
async function topAttendees(orgId: string) {
	return db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			visits: sql<number>`count(${checkIn.id})`.mapWith(Number)
		})
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, new Date(Date.now() - 30 * 86400_000)),
				isNull(checkIn.guestName)
			)
		)
		.groupBy(gymMember.id, gymMember.name)
		.orderBy(desc(sql`count(${checkIn.id})`), gymMember.name)
		.limit(10);
}

/** Members who brought in the most signups via their referral link (all time). */
async function topReferrers(orgId: string) {
	const referrer = alias(gymMember, 'referrer');
	return db
		.select({
			memberId: referrer.id,
			name: referrer.name,
			joins: sql<number>`count(*)`.mapWith(Number)
		})
		.from(gymMember)
		.innerJoin(referrer, eq(gymMember.referredByMemberId, referrer.id))
		.where(and(eq(gymMember.organizationId, orgId), isNotNull(gymMember.referredByMemberId)))
		.groupBy(referrer.id, referrer.name)
		.orderBy(desc(sql`count(*)`), referrer.name)
		.limit(10);
}

/** Check-ins by hour of day (gym timezone) over the last 90 days — staffing signal. */
async function checkInsByHour(orgId: string) {
	const [s] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = s?.timezone ?? 'UTC';
	const rows = await db
		.select({
			hour: sql<number>`extract(hour from ${checkIn.checkedAt} at time zone ${tz})`.mapWith(Number),
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, new Date(Date.now() - 90 * 86400_000)),
				isNull(checkIn.guestName)
			)
		)
		.groupBy(sql`extract(hour from ${checkIn.checkedAt} at time zone ${tz})`);
	const byHour = new Map(rows.map((r) => [r.hour, r.count]));
	return Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) ?? 0 }));
}

/** Sessions taught per instructor over the last 30 days, with attendance outcomes. */
async function instructorStats(orgId: string) {
	return db
		.select({
			instructor: user.name,
			sessions: sql<number>`count(distinct ${classSession.id})`.mapWith(Number),
			attended:
				sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'attended')), 0)`.mapWith(
					Number
				),
			noShow:
				sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'no_show')), 0)`.mapWith(
					Number
				),
			booked:
				sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status in ('booked','attended','no_show'))), 0)`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(member, eq(classSession.instructorId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, new Date(Date.now() - 30 * 86400_000)),
				lt(classSession.startsAt, new Date())
			)
		)
		.groupBy(user.name)
		.orderBy(desc(sql`count(distinct ${classSession.id})`));
}

export async function getReports(orgId: string) {
	const [checkIns, members, revenue, plans, fill, atRisk, instructors, top, referrers, hours] =
		await Promise.all([
			checkInsByDay(orgId),
			newMembersByMonth(orgId),
			revenueByMonth(orgId),
			membershipsByPlan(orgId),
			fillByClass(orgId),
			atRiskMembers(orgId),
			instructorStats(orgId),
			topAttendees(orgId),
			topReferrers(orgId),
			checkInsByHour(orgId)
		]);
	return {
		checkIns,
		members,
		revenue,
		plans,
		fill,
		atRisk,
		instructors,
		top,
		referrers,
		hours
	};
}
