/* @license Enterprise */

import { createHmac } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activity, gymMember, gymSettings, membership } from '#lib/server/db/schema.ts';
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
	event:
		| 'member.checked_in'
		| 'member.checked_out'
		| 'member.checkin_voided'
		| 'guest.checked_in'
		| 'member.checkin_flagged'
		| 'member.suspended'
		| 'member.reactivated'
		| 'member.provisioned',
	payload: Record<string, unknown>
) {
	if (!doorAccessEnabled()) return;
	try {
		const [s] = await db
			.select({ url: gymSettings.doorWebhookUrl, events: gymSettings.doorEvents })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1);
		if (!s?.url) return;
		// Event toggles — empty list means all events fire.
		if (
			s.events &&
			!s.events
				.split(',')
				.map((e) => e.trim())
				.includes(event)
		)
			return;
		const status = await postDoor(s.url, { event, ...payload });
		await db
			.update(gymSettings)
			.set({ doorLastEvent: event, doorLastStatus: status, doorLastAt: new Date() })
			.where(eq(gymSettings.organizationId, orgId));
	} catch (err) {
		console.error(`door webhook failed for ${orgId}`, err);
	}
}

/** HMAC-signed POST to the door endpoint — shared by events and bulk pushes.
 * Returns the HTTP status (0 on network/timeout error). */
async function postDoor(url: string, body: Record<string, unknown>): Promise<number> {
	const text = JSON.stringify(body);
	const signature = createHmac('sha256', BETTER_AUTH_SECRET).update(text).digest('hex');
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-freeweight-signature': signature
			},
			body: text,
			signal: AbortSignal.timeout(5_000)
		});
		return res.status;
	} catch {
		return 0;
	}
}

/**
 * Push the org's active-member roster to the door system — the standard
 * provisioning pattern for access control (Kisi/Brivo sync their grant
 * list from this). Manual from Settings; returns the member count sent.
 */
export async function syncDoorRoster(orgId: string): Promise<number> {
	requireDoorAccess();
	const [s] = await db
		.select({ url: gymSettings.doorWebhookUrl })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.url) throw error(400, 'Set the door webhook URL first');
	const members = await db
		.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				sql`exists (select 1 from ${membership} m where m.member_id = ${gymMember.id} and m.status = 'active')`
			)
		)
		.limit(2000);
	const rosterStatus = await postDoor(s.url, {
		event: 'roster.sync',
		sentAt: new Date().toISOString(),
		members
	});
	await db
		.update(gymSettings)
		.set({ doorLastEvent: 'roster.sync', doorLastStatus: rosterStatus, doorLastAt: new Date() })
		.where(eq(gymSettings.organizationId, orgId));
	await db.insert(activity).values({
		organizationId: orgId,
		entityType: 'door_access',
		entityId: 'roster',
		action: 'roster_sync',
		summary: `Door roster synced — ${members.length} active members pushed`,
		data: { members: members.length }
	});
	return members.length;
}

/** Provision a single member at the door system — staff "Push to door" on the
 * member page. Throws when there's no webhook URL or the member doesn't exist. */
export async function pushDoorMember(orgId: string, memberId: string) {
	requireDoorAccess();
	const [s] = await db
		.select({ url: gymSettings.doorWebhookUrl })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.url) throw error(400, 'Set the door webhook URL first');
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)))
		.limit(1);
	if (!m) throw error(404, 'Member not found');
	const provStatus = await postDoor(s.url, {
		event: 'member.provisioned',
		sentAt: new Date().toISOString(),
		member: m
	});
	await db
		.update(gymSettings)
		.set({
			doorLastEvent: 'member.provisioned',
			doorLastStatus: provStatus,
			doorLastAt: new Date()
		})
		.where(eq(gymSettings.organizationId, orgId));
	await db.insert(activity).values({
		organizationId: orgId,
		entityType: 'door_access',
		entityId: m.id,
		action: 'provisioned',
		summary: `${m.name} provisioned at the door`,
		data: { memberId: m.id }
	});
	return m.name;
}
