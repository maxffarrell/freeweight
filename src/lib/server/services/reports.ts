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
	lte,
	ne,
	notInArray,
	sql,
	count
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { error } from '@sveltejs/kit';
import type { OrgContext } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { emit } from './events.ts';
import { shiftHours } from '#lib/server/services/shifts.ts';
import { listChallenges } from '#lib/server/services/challenges.ts';
import {
	notificationLog,
	memberNps,
	activity,
	booking,
	charge,
	checkIn,
	classSession,
	classTemplate,
	classType,
	course,
	courseEnrollment,
	eventRegistration,
	expense,
	facilityResource,
	gymEvent,
	gymMember,
	gymSettings,
	location,
	locker,
	rota,
	shift,
	member,
	memberTag,
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
import { weekStreakLeaders } from './members.ts';

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
	// The tz must be embedded as a literal: a ${tz} param gives SELECT and
	// GROUP BY different param slots ($1 vs $5), which Postgres treats as
	// different expressions and rejects the GROUP BY.
	const tzLit = sql.raw(`'${tz.replaceAll("'", "''")}'`);
	const rows = await db
		.select({
			dow: sql<number>`extract(dow from ${classSession.startsAt} at time zone ${tzLit})`.mapWith(
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
		.groupBy(sql`extract(dow from ${classSession.startsAt} at time zone ${tzLit})`);
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
/**
 * Pack burn-down — how much of each sold punch-pass actually gets used.
 * issued = plan.classCredits + bonusCredits per pack membership; used =
 * bookings charged to it. Finished packs = expired or no longer active.
 */
async function packBurnDown(orgId: string) {
	const packs = await db
		.select({
			id: membership.id,
			status: membership.status,
			endsAt: membership.endsAt,
			issued: sql<number>`${plan.classCredits} + coalesce(${membership.bonusCredits}, 0)`.mapWith(
				Number
			),
			used: sql<number>`(select count(*) from ${booking} b join ${classSession} cs on cs.id = b.session_id where b.membership_id = ${outer(membership.id)} and b.status in ('booked','attended','no_show') and cs.cancelled_at is null)`.mapWith(
				Number
			)
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(plan.isPack, true)));
	const now = new Date();
	const finished = packs.filter((p) => p.status !== 'active' || (p.endsAt && p.endsAt < now));
	const active = packs.filter((p) => p.status === 'active' && (!p.endsAt || p.endsAt >= now));
	const pct = (u: number, i: number) => (i > 0 ? Math.min(100, Math.round((u / i) * 100)) : 0);
	const issuedF = finished.reduce((a, p) => a + p.issued, 0);
	const usedF = finished.reduce((a, p) => a + p.used, 0);
	const issuedA = active.reduce((a, p) => a + p.issued, 0);
	const usedA = active.reduce((a, p) => a + p.used, 0);
	return {
		finished: finished.length,
		active: active.length,
		finishedPct: pct(usedF, issuedF),
		activePct: pct(usedA, issuedA),
		unusedFinished: Math.max(0, issuedF - usedF)
	};
}

/** Latest month stamped as paid on the instructor-payroll card. */
export async function payrollPaidThrough(orgId: string) {
	const [row] = await db
		.select({
			month: sql<string>`${activity.data}->>'month'`,
			total: sql<number>`(${activity.data}->>'total')::int`.mapWith(Number),
			at: activity.createdAt
		})
		.from(activity)
		.where(
			and(
				eq(activity.organizationId, orgId),
				eq(activity.entityType, 'payroll'),
				eq(activity.action, 'payroll_paid')
			)
		)
		.orderBy(desc(activity.createdAt))
		.limit(1);
	return row ?? null;
}

/** Staff stamps the current month's instructor payroll as settled. */
export async function markPayrollPaid(ctx: OrgContext) {
	const month = new Date().toISOString().slice(0, 7);
	const existing = await payrollPaidThrough(ctx.orgId);
	if (existing?.month === month) error(409, `${month} is already marked paid`);
	const { total } = await instructorPayroll(ctx.orgId);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'payroll',
		entityId: month,
		action: 'payroll_paid',
		summary: `Instructor payroll for ${month} marked paid (${(total / 100).toFixed(2)})`,
		data: { month, total }
	});
	return { month, total };
}

/**
 * Wrong-plan hints — recurring-plan members visiting so little a pack/drop-in
 * would cost less, and pack members burning through classes so fast the
 * cheapest unlimited plan would save them money.
 */
export async function wrongPlan(orgId: string) {
	const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);
	// Monthly visit rate per member over the last 60 days.
	const visitRows = await db
		.select({
			memberId: checkIn.memberId,
			visits: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, sixtyDaysAgo)
			)
		)
		.groupBy(checkIn.memberId);
	const visits = new Map(visitRows.map((r) => [r.memberId, r.visits / 2])); // ~per-month
	const memberships = await db
		.select({
			memberId: membership.memberId,
			memberName: gymMember.name,
			planName: plan.name,
			amount: plan.amount,
			interval: plan.interval,
			isPack: plan.isPack
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.status, 'active')));
	// Cheapest class drop-in price and the cheapest unlimited-style plan.
	const [di] = await db
		.select({
			min: sql<number | null>`min(${classType.dropInPrice})`.mapWith((v) => (v ? Number(v) : null))
		})
		.from(classType)
		.where(
			and(
				eq(classType.organizationId, orgId),
				eq(classType.active, true),
				sql`${classType.dropInPrice} > 0`
			)
		);
	const plans = await db
		.select({ name: plan.name, amount: plan.amount, interval: plan.interval })
		.from(plan)
		.where(and(eq(plan.organizationId, orgId), eq(plan.active, true), eq(plan.isPack, false)))
		.orderBy(plan.amount);
	const dropIn = di?.min ?? 0;
	const cheapest = plans.find((p) => p.amount > 0) ?? null;
	const overpaying: {
		memberId: string;
		name: string;
		plan: string;
		monthly: number;
		alt: string;
	}[] = [];
	const upgrading: typeof overpaying = [];
	const monthlyOf = (amount: number, interval: string) =>
		(interval === 'year' ? amount / 12 : interval === 'week' ? amount * 4.33 : amount) / 100;
	for (const m of memberships) {
		const monthly = monthlyOf(m.amount, m.interval);
		const vpm = visits.get(m.memberId) ?? 0;
		if (!m.isPack && dropIn > 0 && monthly > 0 && vpm * (dropIn / 100) < monthly * 0.85) {
			overpaying.push({
				memberId: m.memberId,
				name: m.memberName,
				plan: m.planName,
				monthly: Math.round(monthly),
				alt: `~${vpm.toFixed(0)} visits/mo — drop-ins would cost ~$${Math.round(vpm * (dropIn / 100))}`
			});
		}
		if (
			m.isPack &&
			cheapest &&
			vpm * (dropIn / 100) > monthlyOf(cheapest.amount, cheapest.interval)
		) {
			upgrading.push({
				memberId: m.memberId,
				name: m.memberName,
				plan: m.planName,
				monthly: Math.round(vpm * (dropIn / 100)),
				alt: `~${vpm.toFixed(0)} visits/mo — ${cheapest.name} would be $${Math.round(monthlyOf(cheapest.amount, cheapest.interval))}/mo`
			});
		}
	}
	return {
		overpaying: overpaying.sort((a, b) => b.monthly - a.monthly).slice(0, 10),
		upgrading: upgrading.sort((a, b) => b.monthly - a.monthly).slice(0, 10)
	};
}

/** Guest visits this month + the members bringing the most guests. */
async function guestStats(orgId: string) {
	const since = new Date();
	since.setDate(1);
	since.setHours(0, 0, 0, 0);
	const rows = await db
		.select({
			memberId: checkIn.memberId,
			name: gymMember.name,
			guests: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, since),
				sql`${checkIn.guestName} is not null`
			)
		)
		.groupBy(checkIn.memberId, gymMember.name)
		.orderBy(desc(sql`count(*)`));
	return {
		monthTotal: rows.reduce((a, r) => a + r.guests, 0),
		bringers: rows.slice(0, 8)
	};
}

/** Sessions in the next 14 days with people still on the waitlist. */
/** MRR lost this month — plan price of recurring memberships cancelled this month. */
async function lostMrr(orgId: string) {
	const monthStart = new Date();
	monthStart.setUTCDate(1);
	monthStart.setUTCHours(0, 0, 0, 0);
	const [row] = await db
		.select({
			lost: sql<number>`coalesce(sum(coalesce(${membership.price}, ${plan.amount})), 0)`.mapWith(
				Number
			),
			n: count().mapWith(Number)
		})
		.from(membership)
		.innerJoin(plan, eq(plan.id, membership.planId))
		.where(
			and(
				eq(membership.organizationId, orgId),
				isNotNull(membership.cancelledAt),
				gte(membership.cancelledAt, monthStart),
				eq(plan.isPack, false)
			)
		);
	return { lost: row?.lost ?? 0, n: row?.n ?? 0 };
}

/** This month's collected revenue per active member (ARPU). */
async function arpu(orgId: string) {
	const monthStart = new Date();
	monthStart.setUTCDate(1);
	monthStart.setUTCHours(0, 0, 0, 0);
	const [[pay], [mem]] = await Promise.all([
		db
			.select({ total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number) })
			.from(payment)
			.where(
				and(
					eq(payment.organizationId, orgId),
					isNull(payment.refundedAt),
					notInArray(payment.method, ['gift_card', 'credit']),
					gte(payment.paidAt, monthStart)
				)
			),
		db
			.select({ n: count().mapWith(Number) })
			.from(gymMember)
			.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.status, 'active')))
	]);
	return { collected: pay?.total ?? 0, members: mem?.n ?? 0 };
}

/** Per-plan average months a membership lasted before cancelling (last 12 months). */
async function tenureAtCancel(orgId: string) {
	const yr = new Date(Date.now() - 365 * 86400_000);
	const rows = await db
		.select({
			name: plan.name,
			n: count().mapWith(Number),
			avgDays:
				sql<number>`avg(extract(epoch from (${membership.cancelledAt} - ${membership.startsAt})) / 86400)`.mapWith(
					Number
				)
		})
		.from(membership)
		.innerJoin(plan, eq(plan.id, membership.planId))
		.where(
			and(
				eq(membership.organizationId, orgId),
				isNotNull(membership.cancelledAt),
				gte(membership.cancelledAt, sql`${yr.toISOString()}::timestamptz`)
			)
		)
		.groupBy(plan.name);
	return rows.sort((a, b) => a.avgDays - b.avgDays).slice(0, 8);
}

async function waitlistedNow(orgId: string) {
	return db
		.select({
			className: classType.name,
			startsAt: classSession.startsAt,
			waiting:
				sql<number>`(select count(*) from booking b where b.session_id = ${classSession.id} and b.status = 'waitlisted')`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, new Date()),
				lte(classSession.startsAt, new Date(Date.now() + 14 * 86400_000)),
				isNull(classSession.cancelledAt)
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(20)
		.then((rows) => rows.filter((r) => r.waiting > 0).slice(0, 5));
}

/** This month's check-ins split by member tenure — new (<30d) vs returning. */
async function newVsReturning(orgId: string) {
	const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
	const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
	const [r] = await db
		.select({
			newMembers:
				sql<number>`count(*) filter (where ${gymMember.joinedAt} >= ${cutoff}::timestamptz)`.mapWith(
					Number
				),
			returning:
				sql<number>`count(*) filter (where ${gymMember.joinedAt} < ${cutoff}::timestamptz)`.mapWith(
					Number
				),
			guests: sql<number>`count(*) filter (where ${checkIn.guestName} is not null)`.mapWith(Number)
		})
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.where(and(eq(checkIn.organizationId, orgId), sql`${checkIn.checkedAt} >= ${monthStart}`));
	return {
		newMembers: r?.newMembers ?? 0,
		returning: r?.returning ?? 0,
		guests: r?.guests ?? 0
	};
}

/** Members who joined via a referral link — how many became paying members. */
async function referralConversion(orgId: string) {
	const [r] = await db
		.select({
			referred: count(),
			paying: sql<number>`count(*) filter (where exists (
				select 1 from payment p
				join charge c on p.charge_id = c.id
				where c.member_id = ${gymMember.id} and c.kind = 'membership'
			))`.mapWith(Number)
		})
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), isNotNull(gymMember.referredByMemberId)));
	return { referred: r?.referred ?? 0, paying: r?.paying ?? 0 };
}

/** Revenue collected on membership charges per plan this month. */
async function planRevenue(orgId: string) {
	const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
	return db
		.select({
			planName: plan.name,
			collected: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number),
			payers: sql<number>`count(distinct ${charge.memberId})`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(charge, eq(payment.chargeId, charge.id))
		.innerJoin(membership, eq(charge.membershipId, membership.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.kind, 'membership'),
				sql`${payment.createdAt} >= ${monthStart}::date`
			)
		)
		.groupBy(plan.name)
		.orderBy(desc(sql`sum(${payment.amount})`));
}

/** Check-ins this month split by method — QR self-scan vs manual desk entry. */
async function checkInMethods(orgId: string) {
	const monthStart = `${new Date().toISOString().slice(0, 8)}01`;
	const rows = await db
		.select({ method: checkIn.method, n: count() })
		.from(checkIn)
		.where(and(eq(checkIn.organizationId, orgId), sql`${checkIn.checkedAt} >= ${monthStart}`))
		.groupBy(checkIn.method);
	const qr = rows.find((r) => r.method === 'qr')?.n ?? 0;
	const manual = rows.find((r) => r.method === 'manual')?.n ?? 0;
	return { qr, manual, total: qr + manual };
}

/** Member age distribution from stored birthdays (date-mode strings). */
async function ageDistribution(orgId: string) {
	const rows = await db
		.select({ birthday: gymMember.birthday })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				sql`${gymMember.birthday} is not null`
			)
		);
	const thisYear = new Date().getFullYear();
	const b = { u18: 0, y18_25: 0, y26_35: 0, y36_50: 0, over50: 0 };
	for (const r of rows) {
		const y = Number((r.birthday ?? '').slice(0, 4));
		if (!y) continue;
		const age = thisYear - y;
		if (age < 18) b.u18++;
		else if (age <= 25) b.y18_25++;
		else if (age <= 35) b.y26_35++;
		else if (age <= 50) b.y36_50++;
		else b.over50++;
	}
	return { known: rows.length, buckets: b };
}

/** Locker bank occupancy — assigned vs total, plus the members holding one. */
async function lockerStats(orgId: string) {
	const rows = await db
		.select({
			id: locker.id,
			label: locker.label,
			memberId: locker.memberId,
			memberName: gymMember.name
		})
		.from(locker)
		.leftJoin(gymMember, eq(locker.memberId, gymMember.id))
		.where(eq(locker.organizationId, orgId))
		.orderBy(locker.label);
	return {
		total: rows.length,
		assigned: rows.filter((r) => r.memberId).length,
		rows: rows.filter((r) => r.memberId).slice(0, 8)
	};
}

/** Members bucketed by how many times they checked in this month — the
 * engagement distribution (0 = active members who haven't come in). */
async function visitFrequency(orgId: string) {
	const since = new Date();
	since.setDate(1);
	since.setHours(0, 0, 0, 0);
	const visits = await db
		.select({
			memberId: checkIn.memberId,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, since),
				isNull(checkIn.guestName)
			)
		)
		.groupBy(checkIn.memberId);
	const counts = new Map(visits.map((v) => [v.memberId, v.n]));
	const [active] = await db
		.select({ n: sql<number>`count(*)::int`.mapWith(Number) })
		.from(membership)
		.where(and(eq(membership.organizationId, orgId), eq(membership.status, 'active')));
	const buckets = { zero: 0, one: 0, few: 0, regular: 0, frequent: 0 };
	let seen = 0;
	for (const n of counts.values()) {
		seen++;
		if (n <= 1) buckets.one++;
		else if (n <= 3) buckets.few++;
		else if (n <= 7) buckets.regular++;
		else buckets.frequent++;
	}
	buckets.zero = Math.max(0, active.n - seen);
	return { total: active.n, buckets };
}

/**
 * Daily cron — keeps an "At risk" member tag in sync with the at-risk report
 * so staff can filter/segment on it without re-reading the report.
 */
export async function syncAtRiskTags(orgId: string) {
	const TAG = 'At risk';
	const risk = new Set((await atRiskMembers(orgId)).map((m) => m.memberId));
	const tagged = await db
		.select({ memberId: memberTag.memberId })
		.from(memberTag)
		.where(and(eq(memberTag.organizationId, orgId), eq(memberTag.tag, TAG)));
	const taggedSet = new Set(tagged.map((t) => t.memberId));
	const toAdd = [...risk].filter((id) => !taggedSet.has(id));
	const toDrop = [...taggedSet].filter((id) => !risk.has(id));
	if (toAdd.length)
		await db
			.insert(memberTag)
			.values(toAdd.map((memberId) => ({ organizationId: orgId, memberId, tag: TAG })))
			.onConflictDoNothing();
	if (toDrop.length)
		await db
			.delete(memberTag)
			.where(
				and(
					eq(memberTag.organizationId, orgId),
					eq(memberTag.tag, TAG),
					inArray(memberTag.memberId, toDrop)
				)
			);
	return { tagged: risk.size, added: toAdd.length, removed: toDrop.length };
}

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
	const tzLit = sql.raw(`'${tz.replaceAll("'", "''")}'`);
	const rows = await db
		.select({
			hour: sql<number>`extract(hour from ${checkIn.checkedAt} at time zone ${tzLit})`.mapWith(
				Number
			),
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
		.groupBy(sql`extract(hour from ${checkIn.checkedAt} at time zone ${tzLit})`);
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

/** Shop cost-of-goods by month (YYYY-MM) — cogsCents snapshotted on sales. */
async function cogsByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	return db
		.select({
			month: sql<string>`to_char(${charge.dueDate}::date, 'YYYY-MM')`,
			total: sql<number>`sum(${charge.cogsCents})`.mapWith(Number)
		})
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				gte(charge.dueDate, since.toISOString().slice(0, 10)),
				sql`${charge.cogsCents} is not null`,
				sql`${charge.status} != 'void'`
			)
		)
		.groupBy(sql`to_char(${charge.dueDate}::date, 'YYYY-MM')`)
		.orderBy(asc(sql`to_char(${charge.dueDate}::date, 'YYYY-MM')`));
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
		cogsMonths,
		mrr,
		giftCards,
		profitability,
		memberValue,
		planChurn,
		funnel,
		courses,
		nps,
		paused,
		covers,
		tags,
		never,
		renewals,
		heatmap,
		spenders,
		packBurn,
		waitlist,
		refunds,
		planMisfits,
		guests,
		payrollPaid,
		staffing,
		challengeList,
		saveOffers,
		visitFreq,
		lockers,
		ages,
		cim,
		planRev,
		refConv,
		nvr,
		wl,
		tenure,
		arpuNow,
		lost,
		streaks,
		rel
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
		cogsByMonth(orgId),
		monthlyRecurring(orgId),
		giftCardStats(orgId),
		classProfitability(orgId),
		memberLifetimeValue(orgId),
		churnByPlan(orgId),
		memberFunnel(orgId),
		courseStats(orgId),
		npsStats(orgId),
		pausedMemberships(orgId),
		coverScorecard(orgId),
		tagBreakdown(orgId),
		neverVisited(orgId),
		renewalForecast(orgId),
		checkinHeatmap(orgId),
		topSpenders(orgId),
		packBurnDown(orgId),
		waitlistConversion(orgId),
		refundsByMonth(orgId),
		wrongPlan(orgId),
		guestStats(orgId),
		payrollPaidThrough(orgId),
		rotaVsClocked(orgId),
		listChallenges(orgId),
		saveOfferStats(orgId),
		visitFrequency(orgId),
		lockerStats(orgId),
		ageDistribution(orgId),
		checkInMethods(orgId),
		planRevenue(orgId),
		referralConversion(orgId),
		newVsReturning(orgId),
		waitlistedNow(orgId),
		tenureAtCancel(orgId),
		arpu(orgId),
		lostMrr(orgId),
		weekStreakLeaders(orgId, 8),
		instructorReliability(orgId)
	]);
	const expByMonth = Object.fromEntries(expenseMonths.map((e) => [e.month, e.total]));
	const cogsByMonthMap = Object.fromEntries(cogsMonths.map((e) => [e.month, e.total]));
	const months = new Set([
		...revenue.map((r) => r.month),
		...expenseMonths.map((e) => e.month),
		...cogsMonths.map((e) => e.month)
	]);
	const pnl = {
		months: [...months].sort().map((m) => {
			const rev = revenue.find((r) => r.month === m)?.total ?? 0;
			const exp = expByMonth[m] ?? 0;
			const cogs = cogsByMonthMap[m] ?? 0;
			return { month: m, revenue: rev, expenses: exp, cogs, net: rev - exp - cogs };
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
		profitability,
		memberValue,
		planChurn,
		funnel,
		courses,
		nps,
		paused,
		covers,
		tags,
		never,
		renewals,
		heatmap,
		spenders,
		packBurn,
		waitlist,
		refunds,
		wrongPlan: planMisfits,
		guestStats: guests,
		payrollPaid,
		staffing,
		challenges: challengeList,
		saveOffers,
		visitFrequency: visitFreq,
		lockers,
		ages,
		checkInMethods: cim,
		planRevenue: planRev,
		referralConversion: refConv,
		newVsReturning: nvr,
		waitlistedNow: wl,
		tenureAtCancel: tenure,
		arpu: arpuNow,
		lostMrr: lost,
		streakLeaders: streaks,
		instructorReliability: rel
	};
}

/** Sessions taught vs cancelled per instructor over the last 90 days. */
async function instructorReliability(orgId: string) {
	const since = new Date(Date.now() - 90 * 86400_000);
	return db
		.select({
			instructorName: user.name,
			taught: sql<number>`count(*) filter (where ${classSession.cancelledAt} is null)`.mapWith(
				Number
			),
			cancelled:
				sql<number>`count(*) filter (where ${classSession.cancelledAt} is not null)`.mapWith(Number)
		})
		.from(classSession)
		.innerJoin(member, eq(classSession.instructorId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, since),
				lt(classSession.startsAt, new Date())
			)
		)
		.groupBy(user.name)
		.orderBy(desc(sql`count(*) filter (where ${classSession.cancelledAt} is not null)`))
		.limit(8);
}

async function npsStats(orgId: string) {
	const [[agg], recent] = await Promise.all([
		db
			.select({
				n: sql<number>`count(*)`.mapWith(Number),
				avg: sql<number>`coalesce(avg(${memberNps.score}), 0)`.mapWith(Number),
				promoters: sql<number>`count(*) filter (where ${memberNps.score} >= 9)`.mapWith(Number),
				detractors: sql<number>`count(*) filter (where ${memberNps.score} <= 6)`.mapWith(Number)
			})
			.from(memberNps)
			.where(eq(memberNps.organizationId, orgId)),
		db
			.select({
				score: memberNps.score,
				comment: memberNps.comment,
				createdAt: memberNps.createdAt,
				memberName: gymMember.name
			})
			.from(memberNps)
			.innerJoin(gymMember, eq(memberNps.memberId, gymMember.id))
			.where(eq(memberNps.organizationId, orgId))
			.orderBy(desc(memberNps.createdAt))
			.limit(10)
	]);
	const n = agg?.n ?? 0;
	return {
		n,
		avg: Math.round((agg?.avg ?? 0) * 10) / 10,
		score: n > 0 ? Math.round(((agg!.promoters - agg!.detractors) / n) * 100) : null,
		recent
	};
}

/** Cover-claim scorecard: per staff member, sessions they flagged for cover
 * vs sessions they picked up — who's reliable when the roster needs help. */
async function coverScorecard(orgId: string) {
	const rows = await db
		.select({
			userId: activity.actorId,
			name: user.name,
			requested:
				sql<number>`count(*) filter (where ${activity.action} = 'cover_requested')`.mapWith(Number),
			claimed: sql<number>`count(*) filter (where ${activity.action} = 'cover_claimed')`.mapWith(
				Number
			)
		})
		.from(activity)
		.innerJoin(user, eq(activity.actorId, user.id))
		.where(
			and(
				eq(activity.organizationId, orgId),
				eq(activity.entityType, 'session'),
				inArray(activity.action, ['cover_requested', 'cover_claimed'])
			)
		)
		.groupBy(activity.actorId, user.name)
		.orderBy(desc(sql`count(*) filter (where ${activity.action} = 'cover_claimed')`));
	return rows.map((r) => ({ name: r.name ?? 'Staff', requested: r.requested, claimed: r.claimed }));
}

/** Per-course stats: enrollees, sessions held, attendance rate, revenue posted. */
async function courseStats(orgId: string) {
	return db
		.select({
			id: course.id,
			name: course.name,
			startsOn: course.startsOn,
			endsOn: course.endsOn,
			enrollees:
				sql<number>`(select count(*) from ${courseEnrollment} e where e.course_id = ${outer(course.id)})`.mapWith(
					Number
				),
			sessions:
				sql<number>`(select count(*) from ${classSession} s join ${classTemplate} t on t.id = s.template_id where t.course_id = ${outer(course.id)})`.mapWith(
					Number
				),
			attendancePct: sql<
				number | null
			>`(select round(100.0 * count(*) filter (where b.status = 'attended') / nullif(count(*) filter (where b.status in ('attended','no_show')),0)) from ${booking} b join ${classSession} s2 on s2.id = b.session_id join ${classTemplate} t2 on t2.id = s2.template_id where t2.course_id = ${outer(course.id)})`,
			revenue:
				sql<number>`coalesce((select sum(c.amount) from ${charge} c join ${courseEnrollment} e2 on e2.charge_id = c.id where e2.course_id = ${outer(course.id)} and c.status <> 'void'), 0)`.mapWith(
					Number
				)
		})
		.from(course)
		.where(eq(course.organizationId, orgId))
		.orderBy(desc(course.createdAt))
		.limit(20);
}

/**
 * Acquisition funnel: leads captured -> members on file -> members who trialed
 * -> active paying members -> members still active 90+ days after joining.
 */
async function memberFunnel(orgId: string) {
	const [{ n: leads }] = await db
		.select({ n: sql<number>`count(distinct ${activity.entityId})`.mapWith(Number) })
		.from(activity)
		.where(
			and(
				eq(activity.organizationId, orgId),
				eq(activity.entityType, 'member'),
				eq(activity.action, 'lead')
			)
		);
	const [{ n: members }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(gymMember)
		.where(eq(gymMember.organizationId, orgId));
	const [{ n: trialed }] = await db
		.select({ n: sql<number>`count(distinct ${membership.memberId})`.mapWith(Number) })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), gt(plan.trialDays, 0)));
	const [{ n: paying }] = await db
		.select({ n: sql<number>`count(distinct ${membership.memberId})`.mapWith(Number) })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, false)
			)
		);
	const [{ n: retained }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				lt(gymMember.createdAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return { leads, members, trialed, paying, retained };
}

/**
 * Member lifetime value: total collected all time, split per active member and
 * per member-month of paying history. Excludes refunded payments and
 * gift-card/credit redemptions (same exclusion as revenueByMonth).
 */
async function memberLifetimeValue(orgId: string) {
	const [rev] = await db
		.select({
			total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number),
			payingMembers: sql<number>`count(distinct ${payment.memberId})`.mapWith(Number)
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				isNull(payment.refundedAt),
				notInArray(payment.method, ['gift_card', 'credit'])
			)
		);
	const [mem] = await db
		.select({ active: sql<number>`count(*)`.mapWith(Number) })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.status, 'active')));
	const total = rev?.total ?? 0;
	const active = mem?.active ?? 0;
	const paying = rev?.payingMembers ?? 0;
	return {
		total,
		activeMembers: active,
		payingMembers: paying,
		avgPerActive: active ? Math.round(total / active) : 0,
		avgPerPayer: paying ? Math.round(total / paying) : 0
	};
}

/**
 * Memberships cancelled in the last 90 days per plan, with each plan's
 * currently-active count — which plans churn hardest.
 */
async function churnByPlan(orgId: string) {
	const since = new Date(Date.now() - 90 * 86400_000).toISOString();
	const rows = await db
		.select({
			planName: plan.name,
			active: sql<number>`count(*) filter (where ${membership.status} = 'active')`.mapWith(Number),
			cancelled:
				sql`count(*) filter (where ${membership.status} = 'cancelled' and ${membership.updatedAt} >= ${since}::timestamptz)`.mapWith(
					Number
				)
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(plan.isPack, false)))
		.groupBy(plan.id, plan.name)
		.orderBy(
			desc(
				sql`count(*) filter (where ${membership.status} = 'cancelled' and ${membership.updatedAt} >= ${since}::timestamptz)`
			)
		);
	return rows.filter((r) => r.active + r.cancelled > 0);
}

/**
 * Currently paused memberships — who's on ice, which plan, and when they
 * auto-resume (frozenUntil) or asked to stay out until (pauseUntil).
 */
async function pausedMemberships(orgId: string) {
	return db
		.select({
			memberName: gymMember.name,
			planName: plan.name,
			frozenUntil: membership.frozenUntil,
			pauseUntil: membership.pauseUntil,
			pausedAt: membership.updatedAt
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.status, 'paused')))
		.orderBy(asc(membership.frozenUntil), asc(gymMember.name))
		.limit(50);
}

/**
 * Member counts per tag (active members) — how the desk's labels distribute.
 */
async function tagBreakdown(orgId: string) {
	return db
		.select({
			tag: memberTag.tag,
			n: sql<number>`count(distinct ${memberTag.memberId})`.mapWith(Number)
		})
		.from(memberTag)
		.innerJoin(gymMember, eq(memberTag.memberId, gymMember.id))
		.where(and(eq(memberTag.organizationId, orgId), eq(gymMember.status, 'active')))
		.groupBy(memberTag.tag)
		.orderBy(desc(sql`count(distinct ${memberTag.memberId})`))
		.limit(20);
}

/**
 * Active members who have never checked in, newest joiners first — the "signed
 * up but never showed" list the desk should call before they churn quietly.
 */
async function neverVisited(orgId: string) {
	return db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			joinedAt: gymMember.joinedAt,
			email: gymMember.email
		})
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				sql`not exists (select 1 from ${checkIn} c where c.member_id = ${gymMember.id})`
			)
		)
		.orderBy(desc(gymMember.createdAt))
		.limit(25);
}

/**
 * Expected renewals over the next 90 days, bucketed by month — active, billed
 * memberships grouped on their next charge date at the plan price (or the
 * member's price override).
 */
async function renewalForecast(orgId: string) {
	return db
		.select({
			month: sql<string>`to_char(${membership.nextChargeAt}, 'YYYY-MM')`,
			n: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`coalesce(sum(coalesce(${membership.price}, ${plan.amount})), 0)`.mapWith(
				Number
			)
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(membership.noBill, false),
				isNotNull(membership.nextChargeAt),
				gte(membership.nextChargeAt, new Date()),
				lte(membership.nextChargeAt, new Date(Date.now() + 90 * 86_400_000))
			)
		)
		.groupBy(sql`to_char(${membership.nextChargeAt}, 'YYYY-MM')`)
		.orderBy(sql`to_char(${membership.nextChargeAt}, 'YYYY-MM')`);
}

/**
 * Check-ins over the last 90 days bucketed by weekday × hour in the org's
 * timezone — the gym's traffic heatmap.
 */
async function checkinHeatmap(orgId: string) {
	const [s] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const tz = s?.timezone ?? 'UTC';
	const tzLit = sql.raw(`'${tz.replaceAll("'", "''")}'`);
	const since = new Date(Date.now() - 90 * 86_400_000);
	return db
		.select({
			dow: sql<number>`extract(dow from ${checkIn.checkedAt} at time zone ${tzLit})::int`.mapWith(
				Number
			),
			hour: sql<number>`extract(hour from ${checkIn.checkedAt} at time zone ${tzLit})::int`.mapWith(
				Number
			),
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(and(eq(checkIn.organizationId, orgId), gte(checkIn.checkedAt, since)))
		.groupBy(sql`1, 2`);
}

/**
 * Top-spending members — lifetime collected payments per member, plus the
 * average across every member who has paid. Answers "who's worth the most".
 */
async function topSpenders(orgId: string) {
	const rows = await db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(gymMember, eq(payment.memberId, gymMember.id))
		.where(and(eq(payment.organizationId, orgId), isNull(payment.refundedAt)))
		.groupBy(gymMember.id, gymMember.name)
		.orderBy(desc(sql`sum(${payment.amount})`))
		.limit(10);
	const [agg] = await db
		.select({
			payers: sql<number>`count(distinct ${payment.memberId})`.mapWith(Number),
			total: sql<number>`coalesce(sum(${payment.amount}),0)`.mapWith(Number)
		})
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), isNull(payment.refundedAt)));
	return {
		rows,
		payers: agg?.payers ?? 0,
		avg: agg?.payers ? Math.round(agg.total / agg.payers) : 0
	};
}

/**
 * Waitlist outcomes per class over the last 90 days: bookings promoted off the
 * waitlist (from the notification log) vs members still queued — shows whether a
 * full class's waitlist actually converts or is a dead end.
 */
export async function waitlistConversion(orgId: string) {
	const cutoff = new Date(Date.now() - 90 * 24 * 3600_000);
	const [promoted, queued] = await Promise.all([
		db
			.select({ name: classType.name, n: sql<number>`count(*)`.mapWith(Number) })
			.from(notificationLog)
			.innerJoin(booking, eq(notificationLog.entityId, booking.id))
			.innerJoin(classSession, eq(booking.sessionId, classSession.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(
				and(
					eq(notificationLog.organizationId, orgId),
					eq(notificationLog.kind, 'waitlist_promoted'),
					gte(notificationLog.createdAt, cutoff)
				)
			)
			.groupBy(classType.name),
		db
			.select({ name: classType.name, n: sql<number>`count(*)`.mapWith(Number) })
			.from(booking)
			.innerJoin(classSession, eq(booking.sessionId, classSession.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(
				and(
					eq(booking.organizationId, orgId),
					eq(booking.status, 'waitlisted'),
					gte(booking.createdAt, cutoff)
				)
			)
			.groupBy(classType.name)
	]);
	const byName = new Map<string, { promoted: number; queued: number }>();
	for (const r of promoted) byName.set(r.name, { promoted: r.n, queued: 0 });
	for (const r of queued) {
		const row = byName.get(r.name) ?? { promoted: 0, queued: 0 };
		row.queued = r.n;
		byName.set(r.name, row);
	}
	return [...byName.entries()]
		.map(([name, v]) => ({
			name,
			...v,
			pct: Math.round((100 * v.promoted) / (v.promoted + v.queued))
		}))
		.sort((a, b) => b.promoted + b.queued - (a.promoted + a.queued));
}

/** Refunded payments grouped by month + method — revenue nets them out, this shows what went back. */
export async function refundsByMonth(orgId: string) {
	const rows = await db
		.select({
			month: sql<string>`to_char(${payment.refundedAt}, 'YYYY-MM')`,
			method: payment.method,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number),
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), isNotNull(payment.refundedAt)))
		.groupBy(sql`to_char(${payment.refundedAt}, 'YYYY-MM')`, payment.method)
		.orderBy(desc(sql`to_char(${payment.refundedAt}, 'YYYY-MM')`));
	const byMonth = new Map<
		string,
		{ total: number; n: number; methods: { method: string; total: number }[] }
	>();
	for (const r of rows) {
		const row = byMonth.get(r.month) ?? { total: 0, n: 0, methods: [] };
		row.total += r.total;
		row.n += r.n;
		row.methods.push({ method: r.method, total: r.total });
		byMonth.set(r.month, row);
	}
	return [...byMonth.entries()].map(([month, v]) => ({ month, ...v }));
}

/** Desk staffing — rota'd (scheduled) vs clocked (actual) hours this month per staff member. */
export async function rotaVsClocked(orgId: string) {
	const month = new Date().toISOString().slice(0, 7);
	const monthStart = new Date(`${month}-01T00:00:00Z`);
	const today = new Date().toISOString().slice(0, 10);
	const [rotaRows, shiftRows] = await Promise.all([
		db
			.select({
				memberId: rota.memberId,
				weekday: rota.weekday,
				startTime: rota.startTime,
				endTime: rota.endTime,
				name: user.name
			})
			.from(rota)
			.innerJoin(member, eq(rota.memberId, member.id))
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(rota.organizationId, orgId)),
		db
			.select({
				memberId: shift.memberId,
				clockedInAt: shift.clockedInAt,
				clockedOutAt: shift.clockedOutAt
			})
			.from(shift)
			.where(and(eq(shift.organizationId, orgId), gte(shift.clockedInAt, monthStart)))
	]);
	const days: string[] = [];
	for (
		let d = new Date(monthStart);
		d.toISOString().slice(0, 7) === month && d.toISOString().slice(0, 10) <= today;
		d.setUTCDate(d.getUTCDate() + 1)
	) {
		days.push(d.toISOString().slice(0, 10));
	}
	const byMember = new Map<string, { name: string; rotaMin: number; clockedMin: number }>();
	const mins = (t: string) => {
		const [h, m2] = t.split(':').map(Number);
		return h * 60 + (m2 || 0);
	};
	for (const r of rotaRows) {
		const row = byMember.get(r.memberId) ?? { name: r.name, rotaMin: 0, clockedMin: 0 };
		const span = Math.max(0, mins(r.endTime) - mins(r.startTime));
		for (const d of days) {
			if (new Date(`${d}T12:00:00Z`).getUTCDay() === r.weekday) row.rotaMin += span;
		}
		byMember.set(r.memberId, row);
	}
	for (const s2 of shiftRows) {
		const row = byMember.get(s2.memberId) ?? { name: '(removed)', rotaMin: 0, clockedMin: 0 };
		const end = s2.clockedOutAt ?? new Date();
		row.clockedMin += Math.max(0, (end.getTime() - s2.clockedInAt.getTime()) / 60000);
		byMember.set(s2.memberId, row);
	}
	return [...byMember.values()]
		.map((v) => ({
			name: v.name,
			rotaHrs: Math.round(v.rotaMin / 6) / 10,
			clockedHrs: Math.round(v.clockedMin / 6) / 10,
			deltaHrs: Math.round((v.clockedMin - v.rotaMin) / 6) / 10
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Save-offer uptake — members who took the stay-instead offer, per month, and who stayed. */
export async function saveOfferStats(orgId: string) {
	const rows = await db
		.select({
			month: sql<string>`to_char(${membership.saveOfferAt}, 'YYYY-MM')`,
			taken: sql<number>`count(*)`.mapWith(Number),
			stayed:
				sql<number>`count(*) filter (where ${membership.status} in ('active','paused'))`.mapWith(
					Number
				)
		})
		.from(membership)
		.where(and(eq(membership.organizationId, orgId), isNotNull(membership.saveOfferAt)))
		.groupBy(sql`to_char(${membership.saveOfferAt}, 'YYYY-MM')`)
		.orderBy(desc(sql`to_char(${membership.saveOfferAt}, 'YYYY-MM')`));
	return rows;
}
