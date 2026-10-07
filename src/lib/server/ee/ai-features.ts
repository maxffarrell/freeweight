/* @license Enterprise */

import { and, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	checkIn,
	classSession,
	classType,
	gymMember,
	membership,
	payment
} from '#lib/server/db/schema.ts';
import { localDate } from '#lib/tz.ts';
import { aiComplete, aiJson } from './ai.ts';

/**
 * Drafts an announcement email for staff to review before sending. The member
 * merge tags `{name}`/`{first_name}` are part of the product and the model is
 * told to use them instead of inventing personalization.
 */
export async function draftAnnouncement(
	orgName: string,
	opts: { goal: string; audience?: string }
): Promise<{ subject: string; body: string }> {
	const out = await aiJson<{ subject: string; body: string }>([
		{
			role: 'user',
			content: `You write concise, friendly announcement emails for a gym called "${orgName}".

Write an email for this goal: ${opts.goal}
${opts.audience ? `Audience: ${opts.audience}` : 'Audience: all members'}

Rules:
- Return JSON {"subject": "...", "body": "..."}.
- Plain-text body (line breaks are preserved); no markdown, no HTML, no emoji unless the goal asks for it.
- Keep it under ~120 words, direct and warm — like a good front-desk note.
- Open with a greeting that uses the merge tag {first_name} or {name} (the app replaces it per member).
- End with the gym's name, no invented sender names, links, phone numbers or unsubscribe text.`
		}
	]);
	return { subject: out.subject.trim(), body: out.body.trim() };
}

/** 3-5 actionable observations generated from live gym stats (Enterprise AI). */
export async function gymInsights(orgId: string, tz: string): Promise<string[]> {
	const today = localDate(new Date(), tz);
	const d30 = new Date(Date.now() - 30 * 86400_000);

	const [members] = await db
		.select({
			active: sql<number>`count(*) filter (where ${gymMember.status} = 'active')`.mapWith(Number),
			newMonth:
				sql<number>`count(*) filter (where ${gymMember.joinedAt} >= ${today.slice(0, 8) + '01'})`.mapWith(
					Number
				)
		})
		.from(gymMember)
		.where(eq(gymMember.organizationId, orgId));

	// At-risk = active members with no check-in in the last 30 days.
	const [recentVisitors] = await db
		.select({ n: sql<number>`count(distinct ${checkIn.memberId})`.mapWith(Number) })
		.from(checkIn)
		.where(and(eq(checkIn.organizationId, orgId), gte(checkIn.checkedAt, d30)));
	const atRisk = (members?.active ?? 0) - (recentVisitors?.n ?? 0);

	const visits = await db
		.select({
			last: sql<number>`count(*) filter (where ${checkIn.checkedAt} >= ${new Date(Date.now() - 7 * 86400_000)})`.mapWith(
				Number
			),
			prior:
				sql<number>`count(*) filter (where ${checkIn.checkedAt} >= ${new Date(Date.now() - 14 * 86400_000)} and ${checkIn.checkedAt} < ${new Date(Date.now() - 7 * 86400_000)})`.mapWith(
					Number
				)
		})
		.from(checkIn)
		.where(eq(checkIn.organizationId, orgId));

	const [revenue] = await db
		.select({
			last: sql<number>`coalesce(sum(${payment.amount}) filter (where ${payment.paidAt} >= ${d30}), 0)`.mapWith(
				Number
			),
			prior:
				sql<number>`coalesce(sum(${payment.amount}) filter (where ${payment.paidAt} >= ${new Date(Date.now() - 60 * 86400_000)} and ${payment.paidAt} < ${d30}), 0)`.mapWith(
					Number
				)
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				sql`${payment.refundedAt} is null`,
				ne(payment.method, 'gift_card')
			)
		);

	const [fill] = await db
		.select({
			booked: sql<number>`count(*) filter (where ${booking.status} = 'booked')`.mapWith(Number),
			seats: sql<number>`coalesce(sum(${classSession.capacity}), 0)`.mapWith(Number)
		})
		.from(classSession)
		.leftJoin(booking, and(eq(booking.sessionId, classSession.id), ne(booking.status, 'cancelled')))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				gte(classSession.startsAt, d30),
				lt(classSession.startsAt, new Date()),
				isNull(classSession.cancelledAt)
			)
		);

	const noShowRows = await db
		.select({
			typeName: classType.name,
			noShows: sql<number>`count(*) filter (where ${booking.status} = 'no_show')`.mapWith(Number),
			total: sql<number>`count(*)`.mapWith(Number)
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				gte(classSession.startsAt, d30),
				lt(classSession.startsAt, new Date()),
				ne(booking.status, 'cancelled')
			)
		)
		.groupBy(classType.name)
		.having(sql`count(*) filter (where ${booking.status} = 'no_show') > 0`)
		.orderBy(sql`count(*) filter (where ${booking.status} = 'no_show') desc`)
		.limit(3);

	const [ends] = await db
		.select({
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(membership)
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'cancelled'),
				gte(membership.cancelledAt, d30)
			)
		);

	const stats = {
		active_members: members?.active ?? 0,
		joined_this_month: members?.newMonth ?? 0,
		inactive_30d: atRisk,
		check_ins_last_7d: visits[0]?.last ?? 0,
		check_ins_prior_7d: visits[0]?.prior ?? 0,
		revenue_last_30d_cents: revenue?.last ?? 0,
		revenue_prior_30d_cents: revenue?.prior ?? 0,
		class_booked_last_30d: fill?.booked ?? 0,
		class_seats_last_30d: fill?.seats ?? 0,
		top_no_show_classes: noShowRows.map((r) => `${r.typeName} (${r.noShows}/${r.total})`),
		cancelled_memberships_last_30d: ends?.count ?? 0
	};

	const out = await aiJson<{ insights: string[] }>(
		[
			{
				role: 'user',
				content: `You are a gym-operations analyst. Here is live data from a gym-management system:

${JSON.stringify(stats, null, 2)}

Return JSON {"insights": [...]} with 3-5 short, specific, actionable observations (each 1-2 sentences, no more than 25 words each). Prioritize things the owner can act on this week: trends (up/down vs prior period), segments at risk, underperforming classes, revenue movement. If a number is 0 or unremarkable, don't mention it. No generic advice, no disclaimers.`
			}
		],
		800
	);
	return Array.isArray(out.insights) ? out.insights.filter((s) => typeof s === 'string') : [];
}

/** Full member-facing workout plan generator — portal EE surface. */
export async function workoutPlan(
	memberName: string,
	goals: { goal: string; daysPerWeek: number; minutesPerSession: number; notes?: string }
): Promise<{ title: string; plan: string }> {
	const text = await aiComplete(
		[
			{
				role: 'system',
				content:
					'You are a personal trainer writing a simple weekly workout plan. Safety first: include a one-line caveat to warm up and stop on pain. Plain text, day-by-day bullets, no markdown tables.'
			},
			{
				role: 'user',
				content: `Member: ${memberName}\nGoal: ${goals.goal}\nAvailability: ${goals.daysPerWeek} days/week, ~${goals.minutesPerSession} minutes per session\n${goals.notes ? `Notes/limitations: ${goals.notes}` : ''}\n\nWrite a one-week plan with a short title, then each day's session as a few exercises with sets/reps.`
			}
		],
		1500
	);
	const nl = text.indexOf('\n');
	return {
		title:
			nl > 0
				? text
						.slice(0, nl)
						.replace(/^#+\s*/, '')
						.trim()
				: 'Workout plan',
		plan: nl > 0 ? text.slice(nl + 1).trim() : text
	};
}
