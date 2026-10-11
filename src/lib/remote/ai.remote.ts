import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import { idSchema } from '#lib/schemas.ts';
import { db } from '#lib/server/db/index.ts';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
	charge,
	checkIn,
	gymMember,
	memberNote,
	gymSettings,
	membership,
	personalRecord,
	plan
} from '#lib/server/db/schema.ts';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';
import { aiAvailable, aiComplete, aiConfig, requireAi } from '#lib/server/ee/ai.ts';
import {
	draftAnnouncement,
	draftClassDescription,
	draftWinBack,
	generateProgram,
	gymInsights
} from '#lib/server/ee/ai-features.ts';

/**
 * Enterprise AI surfaces. The API key never crosses the wire — clients only see
 * booleans, and every call re-checks the license + provider on the server.
 */
export const getAiStatus = query(async () => {
	await requireOrg();
	return {
		licensed: isEnterpriseEnabled(),
		configured: aiAvailable(),
		provider: aiConfig()?.provider ?? null
	};
});

const aiDraftInput = v.object({
	goal: v.pipe(v.string(), v.trim(), v.nonEmpty('Describe the email'), v.maxLength(500)),
	audience: v.optional(v.pipe(v.string(), v.maxLength(100)))
});

/** Drafts an announcement subject + body from a one-line goal (staff review before sending). */
export const aiDraftEmail = command(aiDraftInput, async (input) => {
	const { org } = await requireOrg();
	requireAi();
	return draftAnnouncement(org.name, { goal: input.goal, audience: input.audience });
});

/** Dashboard insights — a handful of actionable bullets computed from live stats. */
export const getAiInsights = query(async () => {
	const { orgId } = await requireOrg();
	if (!isEnterpriseEnabled())
		return { licensed: false, configured: false, bullets: [] as string[] };
	if (!aiAvailable()) return { licensed: true, configured: false, bullets: [] as string[] };
	const [settings] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const bullets = await gymInsights(orgId, settings?.timezone ?? 'UTC');
	return { licensed: true, configured: true, bullets };
});

/** Win-back draft personalized from the member's real plan/visit stats. */
export const aiDraftWinBack = command(v.object({ memberId: v.string() }), async ({ memberId }) => {
	const { org, orgId } = await requireOrg();
	requireAi();
	const [m] = await db.select().from(gymMember).where(eq(gymMember.id, memberId));
	if (!m || m.organizationId !== orgId) return null;
	const [ms] = await db
		.select({ planName: plan.name })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.memberId, memberId), eq(membership.status, 'active')))
		.limit(1);
	const [stats] = await db
		.select({
			total: sql<number>`count(*)`.mapWith(Number),
			last: sql<Date | null>`max(${checkIn.checkedAt})`
		})
		.from(checkIn)
		.where(eq(checkIn.memberId, memberId));
	const daysAway = stats?.last ? Math.floor((Date.now() - stats.last.getTime()) / 86400_000) : null;
	return draftWinBack(org.name, {
		name: m.name,
		planName: ms?.planName ?? null,
		daysAway,
		totalVisits: stats?.total ?? 0
	});
});

/** One-sentence description for a class type (timetable/join page). */
export const aiDraftClassDescription = command(
	v.object({
		name: v.pipe(v.string(), v.trim(), v.nonEmpty('Name the class first'), v.maxLength(80)),
		durationMin: v.optional(v.number()),
		existing: v.optional(v.pipe(v.string(), v.maxLength(500)))
	}),
	async (input) => {
		const { org } = await requireOrg();
		requireAi();
		return {
			description: await draftClassDescription(org.name, {
				name: input.name,
				durationMin: input.durationMin ?? 60,
				existing: input.existing
			})
		};
	}
);

/** Generates a weekly workout-program skeleton for the staff program library. */
export const aiGenerateProgram = command(
	v.object({
		goal: v.pipe(v.string(), v.trim(), v.nonEmpty('Describe the goal'), v.maxLength(300)),
		weeks: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(52)),
		daysPerWeek: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(7))
	}),
	async (input) => {
		await requireOrg();
		requireAi();
		return generateProgram(input);
	}
);

/** AI churn-risk scoring — ranks the at-risk list with a reason + suggested action each. */
export const aiChurnAnalysis = query(async () => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) return { available: false, members: [] };
	const { atRiskMembers } = await import('#lib/server/services/reports.ts');
	const risk = (await atRiskMembers(orgId)).slice(0, 15);
	if (!risk.length) return { available: true, members: [] };
	const roster = risk
		.map(
			(m) => `- ${m.name}: last visit ${m.daysSince == null ? 'never' : `${m.daysSince} days ago`}`
		)
		.join('\n');
	const text = await aiComplete([
		{
			role: 'system',
			content:
				'You analyze gym member churn risk. Reply with ONLY a JSON array — no prose — of objects {"name": string, "risk": "high"|"medium", "reason": string (max 12 words), "action": string (max 12 words)}. One object per member, same order given.'
		},
		{ role: 'user', content: `Members at risk of churning:\n${roster}` }
	]);
	let parsed: { name: string; risk: string; reason: string; action: string }[] = [];
	try {
		const m = /\[[\s\S]*\]/.exec(text);
		if (m) parsed = JSON.parse(m[0]);
	} catch {
		parsed = [];
	}
	const members = risk.map((r, i) => {
		const p = parsed[i] ?? { risk: undefined, reason: undefined, action: undefined };
		return {
			memberId: r.memberId,
			name: r.name,
			daysSince: r.daysSince,
			risk: p.risk,
			reason: p.reason,
			action: p.action
		};
	});
	return { available: true, members };
});

/** One workout-of-the-day for a session — staff review before saving. */
export const aiGenerateWod = command(
	v.object({ className: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)) }),
	async ({ className }) => {
		await requireOrg();
		requireAi();
		const text = await aiComplete([
			{
				role: 'system',
				content:
					'You write gym workouts. Reply with ONLY the workout text — 3-6 lines, plain text, no intro, no markdown headers.'
			},
			{ role: 'user', content: `Write one workout-of-the-day suitable for a "${className}" class.` }
		]);
		return { workout: text.slice(0, 2000) };
	}
);

/** Coach-facing progress summary — visits, PRs and tenure distilled to a note. */
export const aiMemberProgress = command(idSchema, async (memberId) => {
	const { orgId } = await requireOrg();
	requireAi();
	const [m] = await db
		.select({ name: gymMember.name, joinedAt: gymMember.joinedAt })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)))
		.limit(1);
	if (!m) error(404, 'Member not found');
	const since = new Date(Date.now() - 90 * 86400_000);
	const [visits] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, since)
			)
		);
	const prs = await db
		.select({
			label: personalRecord.label,
			value: personalRecord.value,
			on: personalRecord.recordedOn
		})
		.from(personalRecord)
		.where(and(eq(personalRecord.organizationId, orgId), eq(personalRecord.memberId, memberId)))
		.orderBy(desc(personalRecord.recordedOn), desc(personalRecord.createdAt))
		.limit(5);
	const text = await aiComplete([
		{
			role: 'system',
			content:
				'You are a coach writing a 3-4 sentence progress note about a gym member for staff. Be concrete: use the numbers given, note trends, and end with one suggestion. No headers, no bullets.'
		},
		{
			role: 'user',
			content: `Member: ${m.name}, joined ${m.joinedAt}. Check-ins in last 90 days: ${visits?.n ?? 0}. Latest personal records: ${prs.length ? prs.map((p) => `${p.label} ${p.value} (${p.on})`).join('; ') : 'none on file'}.`
		}
	]);
	return { summary: text };
});

/** Staff ops brief on a member — plan, attendance, billing, recent notes in
 * 4-5 sentences. Different from the progress note (fitness-focused): this is
 * the "what's the story here" a desk lead reads before a call. */
export const aiMemberBrief = command(idSchema, async (memberId) => {
	const { orgId } = await requireOrg();
	requireAi();
	const [m] = await db
		.select({ name: gymMember.name, joinedAt: gymMember.joinedAt, status: gymMember.status })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)))
		.limit(1);
	if (!m) error(404, 'Member not found');
	const [ms] = await db
		.select({ name: plan.name, status: membership.status, amount: plan.amount })
		.from(membership)
		.innerJoin(plan, eq(plan.id, membership.planId))
		.where(and(eq(membership.memberId, memberId), eq(membership.status, 'active')))
		.limit(1);
	const since30 = new Date(Date.now() - 30 * 86400_000);
	const [v30] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, memberId),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, since30)
			)
		);
	const [owe] = await db
		.select({ n: sql<number>`coalesce(sum(${charge.amount}),0)`.mapWith(Number) })
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.memberId, memberId),
				eq(charge.status, 'open')
			)
		);
	const notes = await db
		.select({ body: memberNote.body, at: memberNote.createdAt })
		.from(memberNote)
		.where(and(eq(memberNote.organizationId, orgId), eq(memberNote.memberId, memberId)))
		.orderBy(desc(memberNote.createdAt))
		.limit(3);
	const text = await aiComplete([
		{
			role: 'system',
			content:
				'You are writing a 4-5 sentence ops brief about a gym member for front-desk staff before they pick up the phone. Cover plan, attendance trend, money owed, and anything notable in recent staff notes. Be direct and factual.'
		},
		{
			role: 'user',
			content: `Member: ${m.name} (${m.status}), joined ${m.joinedAt}. Plan: ${ms ? `${ms.name} $${(ms.amount / 100).toFixed(0)}/mo (${ms.status})` : 'none'}. Visits last 30d: ${v30?.n ?? 0}. Open balance: $${((owe?.n ?? 0) / 100).toFixed(2)}. Recent staff notes: ${notes.length ? notes.map((n) => n.body.slice(0, 120)).join(' | ') : 'none'}.`
		}
	]);
	return { brief: text };
});

/** Three subject-line variants for an announcement body (Enterprise ai). */
export const aiSubjectVariants = command(v.object({ body: v.string() }), async ({ body }) => {
	const { org } = await requireOrg();
	requireAi();
	const text = await aiComplete(
		[
			{
				role: 'system',
				content:
					'You write gym announcement subject lines. Reply with ONLY a JSON array of 3 short subject lines (each under 60 chars) — no prose. Match the gym tone: direct, warm, no emoji.'
			},
			{
				role: 'user',
				content: `Gym: ${org.name}. Announcement body:\n${body.slice(0, 1500)}`
			}
		],
		300
	);
	let variants: string[] = [];
	try {
		const m = /\[[\s\S]*\]/.exec(text);
		if (m) variants = (JSON.parse(m[0]) as string[]).slice(0, 3).map((s) => String(s).trim());
	} catch {
		variants = [];
	}
	return { variants: variants.filter(Boolean) };
});
