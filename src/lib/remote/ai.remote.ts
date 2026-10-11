import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { and, eq, sql } from 'drizzle-orm';
import { checkIn, gymMember, gymSettings, membership, plan } from '#lib/server/db/schema.ts';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';
import { aiAvailable, aiConfig, requireAi } from '#lib/server/ee/ai.ts';
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
