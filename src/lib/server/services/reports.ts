import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	notInArray,
	sql
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { shiftHours } from '#lib/server/services/shifts.ts';
import {
	activity,
	booking,
	charge,
	checkIn,
	classSession,
	classType,
	eventRegistration,
	expense,
	facilityResource,
	gymEvent,
	gymMember,
	gymSettings,
	location,
	member,
	membership,
	payment,
	plan,
	giftCard,
	recurringCharge,
	resourceBooking,
	sessionFeedback,
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

/**
 * Leads captured through the join-page lead form (`member.lead` activity events)
 * over the last 6 months, and how many now hold an active membership.
 */
async function leadStats(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 6);
	const rows = await db
		.select({ memberId: activity.entityId, at: activity.createdAt })
		.from(activity)
		.where(
			and(
				eq(activity.organizationId, orgId),
				eq(activity.entityType, 'member'),
				eq(activity.action, 'lead'),
				gte(activity.createdAt, since)
			)
		);
	const memberIds = [...new Set(rows.map((r) => r.memberId))];
	const converted = memberIds.length
		? await db
				.selectDistinct({ id: membership.memberId })
				.from(membership)
				.where(
					and(
						eq(membership.organizationId, orgId),
						eq(membership.status, 'active'),
						inArray(membership.memberId, memberIds)
					)
				)
		: [];
	const byMonth = new Map<string, number>();
	for (const r of rows) {
		const m = r.at.toISOString().slice(0, 7);
		byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
	}
	return {
		total: memberIds.length,
		converted: converted.length,
		byMonth: [...byMonth]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([month, leads]) => ({ month, leads }))
	};
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
			and(
				eq(payment.organizationId, orgId),
				isNull(payment.refundedAt),
				notInArray(payment.method, ['gift_card', 'credit']),
				gte(payment.paidAt, since)
			)
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
			kind: sql<string>`coalesce(${charge.kind}::text, 'unapplied')`,
			count: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.leftJoin(charge, eq(payment.chargeId, charge.id))
		.where(
			and(
				eq(payment.organizationId, orgId),
				isNull(payment.refundedAt),
				notInArray(payment.method, ['gift_card', 'credit']),
				gte(payment.paidAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.groupBy(sql`coalesce(${charge.kind}::text, 'unapplied')`)
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

/** Per-class-type economics over the last 30 days: sessions run, avg attendance,
 * drop-in revenue collected, and instructor cost (sessions × pay rate).
 * Membership revenue isn't attributable to one class, so margin counts
 * drop-in revenue only — a floor on true profitability. */
async function classProfitability(orgId: string) {
	const since = new Date(Date.now() - 30 * 86400_000);
	const rows = await db
		.select({
			className: classType.name,
			color: classType.color,
			payRate: classType.payRate,
			sessions: sql<number>`count(distinct ${classSession.id})`.mapWith(Number),
			attended:
				sql<number>`count(distinct ${booking.id}) filter (where ${booking.status} = 'attended')`.mapWith(
					Number
				),
			dropIn: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(booking, and(eq(booking.sessionId, classSession.id), ne(booking.status, 'cancelled')))
		.leftJoin(
			payment,
			and(
				eq(payment.chargeId, booking.chargeId),
				isNull(payment.refundedAt),
				notInArray(payment.method, ['gift_card', 'credit'])
			)
		)
		.where(
			and(
				eq(classSession.organizationId, orgId),
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, since),
				lt(classSession.startsAt, new Date())
			)
		)
		.groupBy(classType.name, classType.color, classType.payRate)
		.orderBy(desc(sql`count(distinct ${classSession.id})`));
	return rows.map((r) => {
		const cost = r.payRate ? r.sessions * r.payRate : null;
		return {
			...r,
			avgAttendance: r.sessions ? Math.round((r.attended / r.sessions) * 10) / 10 : 0,
			cost,
			margin: cost === null ? null : r.dropIn - cost
		};
	});
}

/**
 * Per-event signups and show rate over the last 90 days + upcoming —
 * waitlisted/cancelled registrations excluded; revenue = non-void signup charges.
 */
async function eventStats(orgId: string) {
	const evs = await db
		.select()
		.from(gymEvent)
		.where(
			and(
				eq(gymEvent.organizationId, orgId),
				isNull(gymEvent.cancelledAt),
				gte(gymEvent.startsAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.orderBy(desc(gymEvent.startsAt))
		.limit(20);
	const regs = await db
		.select({
			eventId: eventRegistration.eventId,
			status: eventRegistration.status,
			waitlisted: eventRegistration.waitlisted,
			amount: charge.amount,
			chargeStatus: charge.status
		})
		.from(eventRegistration)
		.leftJoin(charge, eq(eventRegistration.chargeId, charge.id))
		.where(
			and(eq(eventRegistration.organizationId, orgId), ne(eventRegistration.status, 'cancelled'))
		);
	const byEvent = new Map<string, { registered: number; attended: number; revenue: number }>();
	for (const r of regs) {
		if (r.waitlisted) continue;
		const e = byEvent.get(r.eventId) ?? { registered: 0, attended: 0, revenue: 0 };
		e.registered++;
		if (r.status === 'attended') e.attended++;
		if (r.chargeStatus !== 'void' && r.amount) e.revenue += r.amount;
		byEvent.set(r.eventId, e);
	}
	return evs.map((ev) => {
		const s = byEvent.get(ev.id) ?? { registered: 0, attended: 0, revenue: 0 };
		return {
			event: ev,
			...s,
			showRate: s.registered ? Math.round((s.attended / s.registered) * 100) : 0,
			past: ev.endsAt.getTime() < Date.now()
		};
	});
}

/** Fill rate by weekday (gym timezone) over the last 90 days — which days actually fill. */
async function fillByWeekday(orgId: string) {
	const [s] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = s?.timezone ?? 'UTC';
	// Reuse one sql fragment for select + groupBy — separate interpolations get
	// separate param slots, which Postgres treats as different expressions.
	const dowExpr = sql`extract(dow from ${classSession.startsAt} at time zone ${tz})`;
	const rows = await db
		.select({
			dow: sql<number>`${dowExpr}`.mapWith(Number),
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
		.groupBy(dowExpr);
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
export async function atRiskMembers(orgId: string) {
	const rows = await db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			lastVisit: sql<string | null>`max(${checkIn.checkedAt})`
		})
		.from(gymMember)
		.leftJoin(checkIn, eq(checkIn.memberId, gymMember.id))
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.status, 'active')))
		.groupBy(gymMember.id, gymMember.name, gymMember.email);
	const cutoff = Date.now() - 30 * 86400_000;
	return rows
		.map((r) => {
			const lastVisit = r.lastVisit ? new Date(r.lastVisit) : null;
			return {
				memberId: r.memberId,
				name: r.name,
				email: r.email,
				lastVisit,
				daysSince: lastVisit ? Math.floor((Date.now() - lastVisit.getTime()) / 86400_000) : null
			};
		})
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
	const hourExpr = sql`extract(hour from ${checkIn.checkedAt} at time zone ${tz})`;
	const rows = await db
		.select({
			hour: sql<number>`${hourExpr}`.mapWith(Number),
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
		.groupBy(hourExpr);
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
				sql<number>`count(*) filter (where exists (select 1 from ${waiver} w where w.member_id = ${gymMember.id} and w.text = ${s?.waiver ?? ''}))`.mapWith(
					Number
				)
		})
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.status, 'active')));
	return { required: !!s?.waiver, signed: row?.signed ?? 0, total: row?.total ?? 0 };
}

/** Gift cards: issued count/face value, how many redeemed, and the unredeemed
 * balance still on the books — a liability the gym owes in services. */
async function giftCardStats(orgId: string) {
	const [row] = await db
		.select({
			issued: sql<number>`count(*)`.mapWith(Number),
			issuedValue: sql<number>`coalesce(sum(${giftCard.amount}), 0)`.mapWith(Number),
			redeemed: sql<number>`count(*) filter (where ${giftCard.redeemedAt} is not null)`.mapWith(
				Number
			),
			active: sql<number>`count(*) filter (where ${giftCard.balance} > 0)`.mapWith(Number),
			outstanding: sql<number>`coalesce(sum(${giftCard.balance}), 0)`.mapWith(Number)
		})
		.from(giftCard)
		.where(eq(giftCard.organizationId, orgId));
	return {
		issued: row?.issued ?? 0,
		issuedValue: row?.issuedValue ?? 0,
		redeemed: row?.redeemed ?? 0,
		active: row?.active ?? 0,
		outstanding: row?.outstanding ?? 0
	};
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

/** Last-30d amenity bookings + utilization vs each resource's daily slot capacity. */
async function amenityStats(orgId: string) {
	const resources = await db
		.select()
		.from(facilityResource)
		.where(eq(facilityResource.organizationId, orgId))
		.orderBy(asc(facilityResource.name));
	if (!resources.length) return [];
	const since = new Date(Date.now() - 30 * 86400_000);
	const counts = await db
		.select({
			resourceId: resourceBooking.resourceId,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(resourceBooking)
		.where(
			and(
				eq(resourceBooking.organizationId, orgId),
				eq(resourceBooking.status, 'booked'),
				gte(resourceBooking.startsAt, since)
			)
		)
		.groupBy(resourceBooking.resourceId);
	const byId = new Map(counts.map((c) => [c.resourceId, c.n]));
	return resources.map((r) => {
		// Daily capacity = open-window minutes / slot length × per-slot capacity, × 30 days.
		const [fh, fm] = r.openFrom.split(':').map(Number);
		const [th, tm] = r.openTo.split(':').map(Number);
		const openMin = Math.max(0, th * 60 + (tm ?? 0) - (fh * 60 + (fm ?? 0)));
		const capacity30 = Math.floor(openMin / r.slotMin) * r.capacity * 30;
		const bookings = byId.get(r.id) ?? 0;
		return {
			id: r.id,
			name: r.name,
			kind: r.kind,
			bookings,
			util: capacity30 ? Math.min(100, Math.round((bookings / capacity30) * 100)) : 0
		};
	});
}

/**
 * Per-location breakdown for multi-branch gyms — member count, session
 * volume, fill and check-ins over the last 30 days. Empty for single-site
 * gyms (the card hides then).
 */
async function byLocation(orgId: string) {
	const locs = await db
		.select({ id: location.id, name: location.name })
		.from(location)
		.where(and(eq(location.organizationId, orgId), isNull(location.archivedAt)))
		.orderBy(asc(location.name));
	if (locs.length < 2) return [];
	const since = new Date(Date.now() - 30 * 86_400_000);
	return Promise.all(
		locs.map(async (l) => {
			const [[members], [sess], [checkins]] = await Promise.all([
				db
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(gymMember)
					.where(
						and(
							eq(gymMember.organizationId, orgId),
							eq(gymMember.locationId, l.id),
							eq(gymMember.status, 'active')
						)
					),
				db
					.select({
						sessions: sql<number>`count(*)`.mapWith(Number),
						booked:
							sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status in ('booked','attended','no_show'))), 0)`.mapWith(
								Number
							),
						noShows:
							sql<number>`coalesce(sum((select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'no_show')), 0)`.mapWith(
								Number
							),
						capacity: sql<number>`coalesce(sum(${classSession.capacity}), 0)`.mapWith(Number)
					})
					.from(classSession)
					.where(
						and(
							eq(classSession.organizationId, orgId),
							eq(classSession.locationId, l.id),
							gte(classSession.startsAt, since),
							lt(classSession.startsAt, new Date()),
							isNull(classSession.cancelledAt)
						)
					),
				db
					.select({ n: sql<number>`count(*)`.mapWith(Number) })
					.from(checkIn)
					.where(
						and(
							eq(checkIn.organizationId, orgId),
							eq(checkIn.locationId, l.id),
							gte(checkIn.checkedAt, since)
						)
					)
			]);
			return {
				id: l.id,
				name: l.name,
				members: members?.n ?? 0,
				sessions: sess?.sessions ?? 0,
				booked: sess?.booked ?? 0,
				noShows: sess?.noShows ?? 0,
				capacity: sess?.capacity ?? 0,
				checkIns: checkins?.n ?? 0
			};
		})
	);
}

/** Member star ratings over the last 90 days — per class and per instructor. */
async function classRatings(orgId: string) {
	const since = new Date(Date.now() - 90 * 86_400_000);
	const [byClass, byInstructor] = await Promise.all([
		db
			.select({
				name: classType.name,
				ratings: sql<number>`count(*)`.mapWith(Number),
				avg: sql<number>`round(avg(${sessionFeedback.rating})::numeric, 2)`.mapWith(Number)
			})
			.from(sessionFeedback)
			.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(sessionFeedback.organizationId, orgId), gte(sessionFeedback.createdAt, since)))
			.groupBy(classType.name)
			.orderBy(desc(sql`count(*)`)),
		db
			.select({
				name: user.name,
				ratings: sql<number>`count(*)`.mapWith(Number),
				avg: sql<number>`round(avg(${sessionFeedback.rating})::numeric, 2)`.mapWith(Number)
			})
			.from(sessionFeedback)
			.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
			.innerJoin(member, eq(classSession.instructorId, member.id))
			.innerJoin(user, eq(member.userId, user.id))
			.where(and(eq(sessionFeedback.organizationId, orgId), gte(sessionFeedback.createdAt, since)))
			.groupBy(user.name)
			.orderBy(desc(sql`count(*)`))
	]);
	const recent = await db
		.select({
			rating: sessionFeedback.rating,
			comment: sessionFeedback.comment,
			createdAt: sessionFeedback.createdAt,
			memberName: gymMember.name,
			className: classType.name
		})
		.from(sessionFeedback)
		.innerJoin(gymMember, eq(sessionFeedback.memberId, gymMember.id))
		.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(sessionFeedback.organizationId, orgId),
				gte(sessionFeedback.createdAt, since),
				sql`${sessionFeedback.comment} <> ''`
			)
		)
		.orderBy(desc(sessionFeedback.createdAt))
		.limit(6);
	return { byClass, byInstructor, recent };
}

/** Raw member-rating rows for the REST API — newest first, last 90 days. */
export async function listSessionFeedback(orgId: string) {
	const since = new Date(Date.now() - 90 * 86_400_000);
	return db
		.select({
			feedback: sessionFeedback,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(sessionFeedback)
		.innerJoin(gymMember, eq(sessionFeedback.memberId, gymMember.id))
		.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(sessionFeedback.organizationId, orgId), gte(sessionFeedback.createdAt, since)))
		.orderBy(desc(sessionFeedback.createdAt))
		.limit(500);
}

/** Expenses by month (YYYY-MM) over the last 12 months — feeds the P&L. */
async function expensesByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	return db
		.select({
			month: sql<string>`to_char(${expense.expenseOn}::date, 'YYYY-MM')`,
			total: sql<number>`sum(${expense.amountCents})`.mapWith(Number)
		})
		.from(expense)
		.where(
			and(
				eq(expense.organizationId, orgId),
				gte(expense.expenseOn, since.toISOString().slice(0, 10))
			)
		)
		.groupBy(sql`to_char(${expense.expenseOn}::date, 'YYYY-MM')`)
		.orderBy(asc(sql`to_char(${expense.expenseOn}::date, 'YYYY-MM')`));
}

/** All-time expense totals by category. */
async function expensesByCategory(orgId: string) {
	return db
		.select({
			category: expense.category,
			total: sql<number>`sum(${expense.amountCents})`.mapWith(Number)
		})
		.from(expense)
		.where(eq(expense.organizationId, orgId))
		.groupBy(expense.category)
		.orderBy(desc(sql`sum(${expense.amountCents})`));
}

/** Monthly-recurring run rate: active memberships (staff price override wins, packs
 * excluded) plus active recurring add-ons, each normalized to a monthly amount. */
export async function monthlyRecurring(orgId: string) {
	const toMonthly = (amount: number, interval: string) =>
		interval === 'week'
			? Math.round((amount * 52) / 12)
			: interval === 'year'
				? Math.round(amount / 12)
				: amount;
	const mems = await db
		.select({
			amount: membership.price,
			planAmount: plan.amount,
			interval: plan.interval
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, false)
			)
		);
	let membershipMrr = 0;
	for (const r of mems) membershipMrr += toMonthly(r.amount ?? r.planAmount, r.interval);
	const addons = await db
		.select({ amount: recurringCharge.amount, interval: recurringCharge.interval })
		.from(recurringCharge)
		.where(and(eq(recurringCharge.organizationId, orgId), eq(recurringCharge.active, true)));
	let addonMrr = 0;
	for (const r of addons) addonMrr += toMonthly(r.amount, r.interval);
	return {
		memberships: membershipMrr,
		addons: addonMrr,
		total: membershipMrr + addonMrr,
		activeMembers: mems.length
	};
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
		noShows,
		events,
		leads,
		amenities,
		staffShifts,
		locations,
		ratings,
		expenseMonths,
		expenseCategories,
		mrr,
		giftCards,
		profitability
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
		noShowByClass(orgId),
		eventStats(orgId),
		leadStats(orgId),
		amenityStats(orgId),
		shiftHours(orgId, {
			from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
			to: new Date().toISOString().slice(0, 10)
		}),
		byLocation(orgId),
		classRatings(orgId),
		expensesByMonth(orgId),
		expensesByCategory(orgId),
		monthlyRecurring(orgId),
		giftCardStats(orgId),
		classProfitability(orgId)
	]);
	const expByMonth = Object.fromEntries(expenseMonths.map((e) => [e.month, e.total]));
	const months = new Set([...revenue.map((r) => r.month), ...expenseMonths.map((e) => e.month)]);
	const pnl = {
		months: [...months].sort().map((m) => {
			const rev = revenue.find((r) => r.month === m)?.total ?? 0;
			const exp = expByMonth[m] ?? 0;
			return { month: m, revenue: rev, expenses: exp, net: rev - exp };
		}),
		byCategory: expenseCategories
	};
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
		noShows,
		events,
		leads,
		amenities,
		staffShifts,
		locations,
		ratings,
		pnl,
		mrr,
		giftCards,
		profitability
	};
}
