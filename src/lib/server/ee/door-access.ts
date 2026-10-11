/* @license Enterprise */

import { createHmac } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { hasFeature } from './license.ts';

export function doorAccessEnabled() {
	return hasFeature('door-access');
}

export function requireDoorAccess() {
	if (!doorAccessEnabled()) throw error(403, 'Door access is an Enterprise feature');
}

/**
 * Fire-and-forget POST to the org's door webhook (Kisi/Brivo-style access
 * systems) after a successful check-in. Body is HMAC-signed with the app
 * secret so the receiver can verify provenance. Never blocks the scan and
 * never throws — a door outage must not break check-in.
 */
export async function fireDoorWebhook(
	orgId: string,
	event: 'member.checked_in' | 'member.checked_out' | 'member.checkin_voided',
	payload: { memberId: string; memberName: string; checkedAt: string; locationId: string | null }
) {
	if (!doorAccessEnabled()) return;
	try {
		const [s] = await db
			.select({ url: gymSettings.doorWebhookUrl })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1);
		if (!s?.url) return;
		const body = JSON.stringify({ event, ...payload });
		const signature = createHmac('sha256', BETTER_AUTH_SECRET).update(body).digest('hex');
		await fetch(s.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-freeweight-signature': signature
			},
			body,
			signal: AbortSignal.timeout(5_000)
		});
	} catch (err) {
		console.error(`door webhook failed for ${orgId}`, err);
	}
}
