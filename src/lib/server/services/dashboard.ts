import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	booking,
	challenge,
	challengeEntry,
	charge,
	checkIn,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	member,
	membership,
	payment,
	paymentProvider,
	plan,
	recurringCharge,
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
		.select({
			today: sql<number>`count(*)`.mapWith(Number),
			inNow: sql<number>`count(*) filter (where ${checkIn.checkedOutAt} is null)`.mapWith(Number)
		})
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

	// Member-requested cancel/pause actions waiting on staff.
	const pendingRequests = await db
		.select({
			memberId: gymMember.id,
			memberName: gymMember.name,
			planName: plan.name,
			kind: sql<
				'cancel' | 'pause'
			>`case when ${membership.cancelRequestedAt} is not null then 'cancel' else 'pause' end`,
			requestedAt: sql<Date>`coalesce(${membership.cancelRequestedAt}, ${membership.pauseRequestedAt})`,
			pauseUntil: membership.pauseUntil,
			requestReason: membership.requestReason
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				or(isNotNull(membership.cancelRequestedAt), isNotNull(membership.pauseRequestedAt))
			)
		)
		.orderBy(asc(sql`coalesce(${membership.cancelRequestedAt}, ${membership.pauseRequestedAt})`));

	// Members who asked staff to stop a recurring add-on — folded into the same
	// Needs-attention list with kind 'addon'.
	const addonRequests = await db
		.select({
			memberId: gymMember.id,
			memberName: gymMember.name,
			description: recurringCharge.description,
			requestedAt: recurringCharge.removalRequestedAt
		})
		.from(recurringCharge)
		.innerJoin(gymMember, eq(recurringCharge.memberId, gymMember.id))
		.where(
			and(
				eq(recurringCharge.organizationId, orgId),
				eq(recurringCharge.active, true),
				isNotNull(recurringCharge.removalRequestedAt)
			)
		)
		.orderBy(asc(recurringCharge.removalRequestedAt))
		.limit(50);

	// Upcoming sessions flagged as needing a substitute instructor.
	const coverNeeded = await db
		.select({
			id: classSession.id,
			startsAt: classSession.startsAt,
			className: classType.name,
			instructorName: user.name
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				isNotNull(classSession.coverRequestedAt),
				isNull(classSession.cancelledAt),
				gt(classSession.startsAt, new Date())
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(10);

	// Active members whose birthday lands in the next 7 days — the same list the
	// staff briefing emails.
	const dobRows = await db
		.select({ memberId: gymMember.id, memberName: gymMember.name, birthday: gymMember.birthday })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				isNotNull(gymMember.birthday)
			)
		);
	// Days until each member's next birthday from org-local `today`.
	const daysUntil = (birthday: string) => {
		const mmdd = birthday!.slice(5);
		const year = Number(today.slice(0, 4));
		const cand = `${year}-${mmdd}`;
		const target = cand >= today ? cand : `${year + 1}-${mmdd}`;
		return {
			days: Math.round((Date.parse(target) - Date.parse(today)) / 86400_000),
			when: target
		};
	};
	const birthdaysThisWeek = dobRows
		.map((r) => ({ ...r, ...daysUntil(r.birthday!) }))
		.filter((r) => r.days < 7)
		.sort((a, b) => a.days - b.days)
		.slice(0, 10);

	// Memberships whose term ends within the next 7 days — the same window the
	// renewal-reminder email uses, visible to staff at a glance.
	const renewalsThisWeek = await db
		.select({
			memberId: gymMember.id,
			memberName: gymMember.name,
			planName: plan.name,
			endsAt: membership.endsAt
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				isNotNull(membership.endsAt),
				gt(membership.endsAt, new Date()),
				lte(membership.endsAt, new Date(Date.now() + 7 * 86400_000))
			)
		)
		.orderBy(asc(membership.endsAt))
		.limit(10);

	// Challenges whose window includes today — joined count so staff can see
	// engagement without opening the members page.
	const liveChallenges = await db
		.select({
			id: challenge.id,
			name: challenge.name,
			goal: challenge.goal,
			endDate: challenge.endDate,
			joined: sql<number>`count(${challengeEntry.id})`.mapWith(Number)
		})
		.from(challenge)
		.leftJoin(challengeEntry, eq(challengeEntry.challengeId, challenge.id))
		.where(
			and(
				eq(challenge.organizationId, orgId),
				eq(challenge.active, true),
				lte(challenge.startDate, today),
				gte(challenge.endDate, today)
			)
		)
		.groupBy(challenge.id)
		.orderBy(asc(challenge.endDate))
		.limit(5);

	return {
		timezone: tz,
		currency: settings?.currency ?? 'usd',
		activeMembers: memberStats?.active ?? 0,
		newThisMonth: memberStats?.newThisMonth ?? 0,
		openTotal: openStats?.openTotal ?? 0,
		overdueTotal: openStats?.overdueTotal ?? 0,
		checkInsToday: checkInStats?.today ?? 0,
		inGymNow: checkInStats?.inNow ?? 0,
		mrr,
		todaySessions,
		recentActivity,
		recentMembers,
		pendingRequests: [
			...pendingRequests,
			...addonRequests.map((a) => ({
				memberId: a.memberId,
				memberName: a.memberName,
				planName: a.description,
				kind: 'addon' as const,
				requestedAt: a.requestedAt as Date,
				pauseUntil: null,
				requestReason: null
			}))
		],
		coverNeeded,
		birthdaysThisWeek,
		renewalsThisWeek,
		liveChallenges
	};
}

/**
 * Full audit feed for the Activity page: newest first, cursor-paginated by
 * `before` (createdAt of the last row on the previous page), optionally
 * filtered to one entityType. Actor names come from a left join on auth users.
 */
export async function listActivity(orgId: string, entityType?: string, before?: string) {
	return db
		.select({
			id: activity.id,
			entityType: activity.entityType,
			entityId: activity.entityId,
			action: activity.action,
			summary: activity.summary,
			createdAt: activity.createdAt,
			actorName: user.name
		})
		.from(activity)
		.leftJoin(user, eq(activity.actorId, user.id))
		.where(
			and(
				eq(activity.organizationId, orgId),
				entityType ? eq(activity.entityType, entityType) : undefined,
				before ? lt(activity.createdAt, new Date(before)) : undefined
			)
		)
		.orderBy(desc(activity.createdAt))
		.limit(51);
}

/** Distinct entity types present in the org's activity — feeds the page filter. */
export async function listActivityTypes(orgId: string) {
	const rows = await db
		.selectDistinct({ entityType: activity.entityType })
		.from(activity)
		.where(eq(activity.organizationId, orgId));
	return rows.map((r) => r.entityType).sort();
}

export interface ChecklistItem {
	key: string;
	label: string;
	done: boolean;
	href: string;
}

/**
 * Launch checklist for a new gym — a fixed list of setup steps with live `done`
 * flags. Returns null once dismissed or fully complete so the dashboard card
 * disappears on its own.
 */
export async function setupChecklist(orgId: string): Promise<ChecklistItem[] | null> {
	const [settings] = await db
		.select({
			address: gymSettings.address,
			timezone: gymSettings.timezone,
			logoDocumentId: gymSettings.logoDocumentId,
			waiver: gymSettings.waiver,
			setupDismissed: gymSettings.setupDismissed
		})
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	if (!settings || settings.setupDismissed) return null;

	const [[plans], [types], [sessions], [members], [staff], [providers]] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(plan)
			.where(eq(plan.organizationId, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(classType)
			.where(eq(classType.organizationId, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(classSession)
			.where(eq(classSession.organizationId, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(gymMember)
			.where(eq(gymMember.organizationId, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(member)
			.where(eq(member.organizationId, orgId)),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(paymentProvider)
			.where(and(eq(paymentProvider.organizationId, orgId), eq(paymentProvider.enabled, true)))
	]);

	const items: ChecklistItem[] = [
		{
			key: 'details',
			label: 'Set your address, phone and timezone',
			done: settings.address !== '' && settings.timezone !== 'UTC',
			href: '/settings'
		},
		{
			key: 'logo',
			label: 'Upload your logo',
			done: settings.logoDocumentId != null,
			href: '/settings'
		},
		{ key: 'plan', label: 'Create a membership plan', done: plans.n > 0, href: '/plans' },
		{
			key: 'class',
			label: 'Create a class type',
			done: types.n > 0,
			href: '/schedule'
		},
		{
			key: 'session',
			label: 'Schedule a session',
			done: sessions.n > 0,
			href: '/schedule'
		},
		{
			key: 'member',
			label: 'Add your first member',
			done: members.n > 0,
			href: '/members'
		},
		{
			key: 'waiver',
			label: 'Add your liability waiver',
			done: settings.waiver !== '',
			href: '/settings'
		},
		{
			key: 'payments',
			label: 'Connect a payment provider',
			done: providers.n > 0,
			href: '/settings'
		},
		{ key: 'staff', label: 'Invite your team', done: staff.n > 1, href: '/settings' }
	];
	return items.every((i) => i.done) ? null : items;
}

/** Any staff member can dismiss the launch checklist (org-wide flag). */
export async function dismissChecklist(orgId: string) {
	await db
		.update(gymSettings)
		.set({ setupDismissed: true })
		.where(eq(gymSettings.organizationId, orgId));
}
