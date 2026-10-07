import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { eq } from 'drizzle-orm';
import { gymSettings } from '#lib/server/db/schema.ts';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';
import { aiAvailable, aiConfig, requireAi } from '#lib/server/ee/ai.ts';
import { draftAnnouncement, gymInsights } from '#lib/server/ee/ai-features.ts';

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
