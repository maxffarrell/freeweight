import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
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
	waiver,
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

/**
 * Member growth per month for the last 12 months: joins (member.createdAt) vs
 * cancellations (membership.updatedAt where status='cancelled').
 */
async function memberGrowthByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	const [joins, cancels] = await Promise.all([
		db
			.select({
				month: sql<string>`to_char(${gymMember.createdAt}, 'YYYY-MM')`,
				count: sql<number>`count(*)`.mapWith(Number)
			})
			.from(gymMember)
			.where(and(eq(gymMember.organizationId, orgId), gte(gymMember.createdAt, since)))
			.groupBy(sql`to_char(${gymMember.createdAt}, 'YYYY-MM')`),
		db
			.select({
				month: sql<string>`to_char(${membership.updatedAt}, 'YYYY-MM')`,
				count: sql<number>`count(*)`.mapWith(Number)
			})
			.from(membership)
			.where(
				and(
					eq(membership.organizationId, orgId),
					eq(membership.status, 'cancelled'),
					gte(membership.updatedAt, since)
				)
			)
			.groupBy(sql`to_char(${membership.updatedAt}, 'YYYY-MM')`)
	]);
	const joinedBy = new Map(joins.map((r) => [r.month, r.count]));
	const cancelledBy = new Map(cancels.map((r) => [r.month, r.count]));
	const months = new Set([...joinedBy.keys(), ...cancelledBy.keys()]);
	// Always show the current month even with no activity.
	months.add(new Date().toISOString().slice(0, 7));
	return [...months].sort().map((month) => ({
		month,
		joined: joinedBy.get(month) ?? 0,
		cancelled: cancelledBy.get(month) ?? 0
	}));
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

/** Collected payments by method over the last 90 days (refunds excluded). */
async function paymentsByMethod(orgId: string) {
	return db
		.select({
			method: payment.method,
			count: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				isNull(payment.refundedAt),
				gte(payment.paidAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.groupBy(payment.method)
		.orderBy(desc(sql`sum(${payment.amount})`));
}

/** Collected payments by charge kind over the last 90 days ('unapplied' = payments not tied to a charge). */
async function revenueByKind(orgId: string) {
	return db
		.select({
			kind: sql<string>`coalesce(${charge.kind}, 'unapplied')`,
			count: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.leftJoin(charge, eq(payment.chargeId, charge.id))
		.where(
			and(
				eq(payment.organizationId, orgId),
				isNull(payment.refundedAt),
				gte(payment.paidAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.groupBy(sql`coalesce(${charge.kind}, 'unapplied')`)
		.orderBy(desc(sql`sum(${payment.amount})`));
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

/** No-show rate per class type over the last 90 days — which classes flake. */
async function noShowByClass(orgId: string) {
	const rows = await db
		.select({
			className: classType.name,
			color: classType.color,
			attended: sql<number>`count(*) filter (where ${booking.status} = 'attended')`.mapWith(Number),
			noShows: sql<number>`count(*) filter (where ${booking.status} = 'no_show')`.mapWith(Number)
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				inArray(booking.status, ['attended', 'no_show']),
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, new Date(Date.now() - 90 * 86400_000)),
				lt(classSession.startsAt, new Date())
			)
		)
		.groupBy(classType.name, classType.color)
		.orderBy(desc(sql`count(*) filter (where ${booking.status} = 'no_show')`));
	return rows.map((r) => ({
		...r,
		rate: r.attended + r.noShows ? Math.round((r.noShows / (r.attended + r.noShows)) * 100) : 0
	}));
}

/** Fill rate by weekday (gym timezone) over the last 90 days — which days actually fill. */
async function fillByWeekday(orgId: string) {
	const [s] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = s?.timezone ?? 'UTC';
	const rows = await db
		.select({
			dow: sql<number>`extract(dow from ${classSession.startsAt} at time zone ${tz})`.mapWith(
				Number
			),
			sessions: sql<number>`count(distinct ${classSession.id})`.mapWith(Number),
			booked:
				sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status in ('booked','attended','no_show'))), 0)`.mapWith(
					Number
				),
			capacity: sql<number>`coalesce(sum(${classSession.capacity}), 0)`.mapWith(Number)
		})
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, new Date(Date.now() - 90 * 86400_000)),
				lt(classSession.startsAt, new Date())
			)
		)
		.groupBy(sql`extract(dow from ${classSession.startsAt} at time zone ${tz})`);
	const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const byDow = new Map(rows.map((r) => [r.dow, r]));
	return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
		day: names[d],
		sessions: byDow.get(d)?.sessions ?? 0,
		booked: byDow.get(d)?.booked ?? 0,
		capacity: byDow.get(d)?.capacity ?? 0
	}));
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

/** Signups grouped by the join page's "How did you hear about us?" — marketing signal. */
async function leadSources(orgId: string) {
	return db
		.select({
			source: sql<string>`coalesce(${gymMember.referralSource}, 'Not answered')`,
			joins: sql<number>`count(*)`.mapWith(Number)
		})
		.from(gymMember)
		.where(eq(gymMember.organizationId, orgId))
		.groupBy(gymMember.referralSource)
		.orderBy(desc(sql`count(*)`))
		.limit(12);
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

/** Instructor pay owed for rated sessions taught this calendar month (class-type rate). */
async function instructorPayroll(orgId: string) {
	const rows = await db
		.select({
			instructor: user.name,
			sessions: sql<number>`count(*)`.mapWith(Number),
			pay: sql<number>`coalesce(sum(${classType.payRate}), 0)`.mapWith(Number)
		})
		.from(classSession)
		.innerJoin(member, eq(classSession.instructorId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				sql`${classSession.startsAt} >= date_trunc('month', now())`,
				lt(classSession.startsAt, new Date()),
				isNull(classSession.cancelledAt),
				isNotNull(classType.payRate)
			)
		)
		.groupBy(user.name)
		.orderBy(desc(sql`sum(${classType.payRate})`));
	return { rows, total: rows.reduce((a, r) => a + r.pay, 0) };
}

/** Per-session payroll detail for this month — the CSV export on the pay card. */
async function instructorPayrollDetail(orgId: string) {
	return db
		.select({
			instructor: user.name,
			className: classType.name,
			startsAt: classSession.startsAt,
			rate: classType.payRate,
			attended:
				sql<number>`(select count(*) from ${booking} b where b.session_id = ${classSession.id} and b.status = 'attended')`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(member, eq(classSession.instructorId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				sql`${classSession.startsAt} >= date_trunc('month', now())`,
				lt(classSession.startsAt, new Date()),
				isNull(classSession.cancelledAt),
				isNotNull(classType.payRate)
			)
		)
		.orderBy(asc(classSession.startsAt));
}

/**
 * Of memberships that started on a free-trial plan, how many became paying
 * members — still subscribed past the trial end, or cancelled only after it.
 */
async function trialConversion(orgId: string) {
	const [row] = await db
		.select({
			trials: sql<number>`count(*)`.mapWith(Number),
			converted:
				sql<number>`count(*) filter (where ${membership.cancelledAt} > ${membership.startsAt} + ${plan.trialDays} * interval '1 day' or (${membership.cancelledAt} is null and ${membership.startsAt} + ${plan.trialDays} * interval '1 day' < now()))`.mapWith(
					Number
				)
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), gt(plan.trialDays, 0)));
	return row;
}

/** Average visit length in minutes over the last 30 days, where a check-out was recorded. */
async function avgVisitMinutes(orgId: string) {
	const [row] = await db
		.select({
			minutes:
				sql<number>`round(avg(extract(epoch from (${checkIn.checkedOutAt} - ${checkIn.checkedAt})) / 60))`.mapWith(
					(v) => (v == null ? null : Number(v))
				),
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				isNotNull(checkIn.checkedOutAt),
				gte(checkIn.checkedAt, new Date(Date.now() - 30 * 86400_000))
			)
		);
	return { minutes: row?.minutes ?? null, visits: row?.count ?? 0 };
}

/**
 * Retention by join cohort: members who joined in each of the last 12 months
 * and how many still have status='active' today.
 */
async function retentionByCohort(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12, 1);
	since.setUTCHours(0, 0, 0, 0);
	return db
		.select({
			month: sql<string>`to_char(${gymMember.createdAt}, 'YYYY-MM')`,
			joined: sql<number>`count(*)`.mapWith(Number),
			active: sql<number>`count(*) filter (where ${gymMember.status} = 'active')`.mapWith(Number)
		})
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), gte(gymMember.createdAt, since)))
		.groupBy(sql`to_char(${gymMember.createdAt}, 'YYYY-MM')`)
		.orderBy(desc(sql`to_char(${gymMember.createdAt}, 'YYYY-MM')`));
}

/** Waiver coverage among active members; `required` is false when no waiver text is set. */
async function waiverStatus(orgId: string) {
	const [s] = await db
		.select({ waiver: gymSettings.waiver })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const [row] = await db
		.select({
			total: sql<number>`count(*)`.mapWith(Number),
			signed:
				sql<number>`count(*) filter (where exists (select 1 from ${waiver} w where w.member_id = ${gymMember.id}))`.mapWith(
					Number
				)
		})
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.status, 'active')));
	return { required: !!s?.waiver, signed: row?.signed ?? 0, total: row?.total ?? 0 };
}

/** Why members leave: stated reasons bucketed by end state (cancelled vs paused). */
async function churnReasons(orgId: string) {
	const rows = await db
		.select({
			reason: membership.endReason,
			status: membership.status,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(membership)
		.where(
			and(eq(membership.organizationId, orgId), sql`${membership.status} in ('cancelled','paused')`)
		)
		.groupBy(membership.endReason, membership.status)
		.orderBy(desc(sql`count(*)`));
	const byReason = new Map<string, { reason: string; cancelled: number; paused: number }>();
	for (const r of rows) {
		const reason = r.reason?.trim() || '(none given)';
		const cur = byReason.get(reason) ?? { reason, cancelled: 0, paused: 0 };
		if (r.status === 'paused') cur.paused += r.n;
		else cur.cancelled += r.n;
		byReason.set(reason, cur);
	}
	return [...byReason.values()].sort((a, b) => b.cancelled + b.paused - (a.cancelled + a.paused));
}

export async function getReports(orgId: string) {
	const [
		checkIns,
		members,
		revenue,
		methods,
		plans,
		fill,
		atRisk,
		instructors,
		top,
		referrers,
		hours,
		weekdays,
		payroll,
		trials,
		visit,
		retention,
		waivers,
		kinds,
		sources,
		payrollDetail,
		churn,
		noShows
	] = await Promise.all([
		checkInsByDay(orgId),
		memberGrowthByMonth(orgId),
		revenueByMonth(orgId),
		paymentsByMethod(orgId),
		membershipsByPlan(orgId),
		fillByClass(orgId),
		atRiskMembers(orgId),
		instructorStats(orgId),
		topAttendees(orgId),
		topReferrers(orgId),
		checkInsByHour(orgId),
		fillByWeekday(orgId),
		instructorPayroll(orgId),
		trialConversion(orgId),
		avgVisitMinutes(orgId),
		retentionByCohort(orgId),
		waiverStatus(orgId),
		revenueByKind(orgId),
		leadSources(orgId),
		instructorPayrollDetail(orgId),
		churnReasons(orgId),
		noShowByClass(orgId)
	]);
	return {
		checkIns,
		members,
		revenue,
		methods,
		plans,
		fill,
		atRisk,
		instructors,
		top,
		referrers,
		hours,
		weekdays,
		payroll,
		trials,
		visit,
		retention,
		waivers,
		kinds,
		sources,
		payrollDetail,
		churn,
		noShows
	};
}
