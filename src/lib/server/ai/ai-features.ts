import { and, eq, gte, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	checkIn,
	classSession,
	classType,
	gymMember,
	gymSettings,
	membership,
	notificationLog,
	payment
} from '#lib/server/db/schema.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import { localDate } from '#lib/tz.ts';
import { sendEmail } from '#lib/server/email.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import * as v from 'valibot';
import { orgBrand } from '../org-brand.ts';
import { aiComplete, aiDecision, aiDecisionAvailable } from './ai.ts';

/** Decision-call schemas — the structured JSON shapes the app consumes. */
const draftEmailSchema = v.object({ subject: v.string(), body: v.string() });
const insightsSchema = v.object({ insights: v.array(v.string()) });
const programSchema = v.object({
	name: v.string(),
	days: v.array(v.object({ title: v.string(), body: v.string() }))
});

/**
 * Drafts an announcement email for staff to review before sending. The member
 * merge tags `{name}`/`{first_name}` are part of the product and the model is
 * told to use them instead of inventing personalization.
 */
export async function draftAnnouncement(
	orgName: string,
	opts: { goal: string; audience?: string }
): Promise<{ subject: string; body: string }> {
	const out = await aiDecision(draftEmailSchema, [
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

/** 3-5 actionable observations generated from live gym stats (BYOK AI). */
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
				notInArray(payment.method, ['gift_card', 'credit'])
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

	const out = await aiDecision(
		insightsSchema,
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
	return out.insights.filter((s) => s.trim().length > 0);
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

/**
 * Personalized win-back email for one member — staff review before sending.
 * Uses only real member facts so the model can't invent personalization.
 */
export async function draftWinBack(
	orgName: string,
	member: {
		name: string;
		planName: string | null;
		daysAway: number | null;
		totalVisits: number;
	}
): Promise<{ subject: string; body: string }> {
	const out = await aiDecision(draftEmailSchema, [
		{
			role: 'user',
			content: `You write concise, friendly win-back emails for a gym called "${orgName}".

Member facts (use only these — do not invent offers, names, links or numbers):
- Name: ${member.name} (address them with the merge tag {first_name})
- Membership plan: ${member.planName ?? 'none on record'}
- Days since last visit: ${member.daysAway ?? 'never visited'}
- Lifetime check-ins: ${member.totalVisits}

Write a win-back email nudging them to come back — warm, zero guilt-tripping, one clear ask (book a class or drop in).

Rules:
- Return JSON {"subject": "...", "body": "..."}.
- Plain-text body under ~90 words; no markdown, HTML, or emoji.
- Open with a greeting using {first_name}; end with the gym's name only.
- No invented discounts, deadlines, sender names, links, phone numbers or unsubscribe text.`
		}
	]);
	return { subject: out.subject.trim(), body: out.body.trim() };
}

/** One-line public-page description for a class type. */
export async function draftClassDescription(
	orgName: string,
	c: { name: string; durationMin: number; existing?: string }
): Promise<string> {
	const text = await aiComplete([
		{
			role: 'system',
			content:
				'You write one-sentence class descriptions for a gym timetable. Factual, energetic, no hype words like "amazing" or emojis.'
		},
		{
			role: 'user',
			content: `Gym: "${orgName}". Class: "${c.name}", ${c.durationMin} minutes.${c.existing ? ` Current description: "${c.existing}" — improve it.` : ''}\n\nOne sentence, ~15-20 words, what the class is and who it's for. Plain text only.`
		}
	]);
	return text.trim().replace(/^["']|["']$/g, '');
}

/** Generates a workout-program skeleton for the staff program library. */
export async function generateProgram(opts: {
	goal: string;
	weeks: number;
	daysPerWeek: number;
}): Promise<{ name: string; days: { title: string; body: string }[] }> {
	const out = await aiDecision(
		programSchema,
		[
			{
				role: 'system',
				content:
					'You are a personal trainer designing weekly gym programs. Safety first — sensible volume and progressions.'
			},
			{
				role: 'user',
				content: `Goal: ${opts.goal}
The program repeats weekly for ${opts.weeks} weeks, ${opts.daysPerWeek} training days per week.

Return JSON {"name": "short program name", "days": [{"title": "Day 1 — focus", "body": "exercises, sets x reps, one per line"}]} with exactly ${opts.daysPerWeek} days. Each day's body is 3-6 exercises as plain lines, no markdown.`
			}
		],
		1500
	);
	return {
		name: out.name.trim() || 'Generated program',
		days: out.days.map((d, i) => ({
			title: d.title.trim() || `Day ${i + 1}`,
			body: d.body.trim()
		}))
	};
}

/**
 * Weekly AI insights — Mondays (org tz), owners/admins get the gymInsights
 * bullets by email. Deduped per week via notification_log 'ai_insights'.
 */
export async function sendWeeklyInsights(orgId: string): Promise<number> {
	if (!aiDecisionAvailable()) return 0;
	const [s] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const tz = s?.timezone ?? 'UTC';
	const today = localDate(new Date(), tz);
	if (new Date(`${today}T12:00:00Z`).getDay() !== 1) return 0;
	const bullets = await gymInsights(orgId, tz);
	if (bullets.length === 0) return 0;
	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	const brand = await orgBrand(orgId);
	let sent = 0;
	for (const st of staff) {
		const [row] = await db
			.insert(notificationLog)
			.values({
				organizationId: orgId,
				kind: 'ai_insights',
				entityId: today,
				recipient: st.email
			})
			.onConflictDoNothing()
			.returning({ id: notificationLog.id });
		if (!row) continue;
		await sendEmail({
			to: st.email,
			subject: `${brand.orgName} — this week, at a glance`,
			...renderEmail({
				orgName: brand.orgName,
				logoUrl: brand.logoUrl,
				whiteLabel: brand.whiteLabel,
				heading: 'This week, at a glance',
				lines: bullets
			})
		});
		sent++;
	}
	return sent;
}

/** Staff reply draft for a member-submitted issue report. */
export async function draftIssueReply(
	orgName: string,
	member: { name: string },
	issueText: string
): Promise<{ subject: string; body: string }> {
	const out = await aiDecision(draftEmailSchema, [
		{
			role: 'user',
			content: `You write short, human reply emails for a gym called "${orgName}".

A member (${member.name}) reported this issue at the front desk portal:
"${issueText}"

Write a reply acknowledging it and saying the team is on it — warm, brief, no promises you can't keep.

Rules:
- Return JSON {"subject": "...", "body": "..."}.
- Plain-text body under ~80 words; no markdown, HTML, or emoji.
- Open with a greeting using {first_name}; end with the gym's name only.
- No invented timelines, compensation, names, links or phone numbers.`
		}
	]);
	return { subject: out.subject.trim(), body: out.body.trim() };
}

/** Pre-class instructor brief — who is coming and who needs attention. */
export async function rosterBrief(
	orgName: string,
	facts: {
		className: string;
		when: string;
		instructor: string | null;
		booked: number;
		capacity: number | null;
		waitlisted: number;
		firstTimers: string[];
		medicalFlags: string[];
	}
): Promise<string> {
	const text = await aiComplete(
		[
			{
				role: 'system',
				content:
					'You write 2-3 sentence pre-class briefs for gym instructors. Say who is coming, name first-timers so they get a welcome, name health-flagged members so the instructor checks in on them privately, and note a full waitlist. Direct, warm, no markdown or emoji.'
			},
			{
				role: 'user',
				content: `Gym: ${orgName}. Class: ${facts.className} at ${facts.when}${facts.instructor ? `, instructor ${facts.instructor}` : ''}. Booked ${facts.booked}${facts.capacity ? `/${facts.capacity}` : ''}, waitlisted ${facts.waitlisted}. First-timers: ${facts.firstTimers.length ? facts.firstTimers.join(', ') : 'none'}. Health-flagged: ${facts.medicalFlags.length ? facts.medicalFlags.join(', ') : 'none'}.`
			}
		],
		300
	);
	return text.trim();
}

/** Portal "Your month" — friendly 2-3 sentence recap of the member's recent
 * training from real stats. Runs under the ai flag + configured provider. */
export async function memberMonthSummary(
	orgName: string,
	facts: {
		memberName: string;
		visits30: number;
		totalVisits: number;
		topClass: string | null;
		topClassCount: number;
		classesBooked30: number;
		prs30: number;
		streakWeeks: number;
	}
): Promise<string> {
	const text = await aiComplete(
		[
			{
				role: 'system',
				content:
					"You write a 2-3 sentence 'your month' recap addressed to a gym member ('you'). Celebrate wins briefly, name their top class when there is one, and end with one forward-looking nudge. Warm, concrete, no markdown or emoji."
			},
			{
				role: 'user',
				content: `Gym: ${orgName}. Member: ${facts.memberName.split(' ')[0]}. Last 30 days: ${facts.visits30} check-ins, ${facts.classesBooked30} classes attended, ${facts.prs30} personal records. Top class: ${facts.topClass ? `${facts.topClass} (${facts.topClassCount}x)` : 'none'}. Current streak: ${facts.streakWeeks} weeks. Lifetime visits: ${facts.totalVisits}.`
			}
		],
		220
	);
	return text.trim();
}
