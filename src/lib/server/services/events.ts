import { outboundFetch } from '#lib/server/outbound-http.ts';
import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activity, webhook } from '#lib/server/db/schema.ts';

export type EventInput = {
	orgId: string;
	actorId?: string | null;
	entityType: string;
	entityId: string;
	action: string;
	summary: string;
	data?: Record<string, unknown>;
};

/** Records an activity entry and fans the event out to webhooks and integrations. */
export async function emit(e: EventInput) {
	const [row] = await db
		.insert(activity)
		.values({
			organizationId: e.orgId,
			actorId: e.actorId ?? null,
			entityType: e.entityType,
			entityId: e.entityId,
			action: e.action,
			summary: e.summary,
			data: e.data
		})
		.returning();

	const event = {
		id: row!.id,
		type: `${e.entityType}.${e.action}`,
		organizationId: e.orgId,
		entity: { type: e.entityType, id: e.entityId },
		summary: e.summary,
		data: e.data ?? {},
		createdAt: row!.createdAt.toISOString()
	};

	void deliverWebhooks(event).catch((err) => console.error('webhook delivery failed', err));
}

export type FreeweightEvent = {
	id: string;
	type: string;
	organizationId: string;
	entity: { type: string; id: string };
	summary: string;
	data: Record<string, unknown>;
	createdAt: string;
};

export function signPayload(secret: string, body: string) {
	return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function deliverWebhooks(event: FreeweightEvent) {
	const hooks = await db
		.select()
		.from(webhook)
		.where(and(eq(webhook.organizationId, event.organizationId), eq(webhook.enabled, true)));

	await Promise.allSettled(
		hooks
			.filter((h) => h.events.includes('*') || h.events.includes(event.type))
			.map(async (h) => {
				const body = JSON.stringify(event);
				let status = 0;
				try {
					const res = await outboundFetch(h.url, {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							'x-freeweight-event': event.type,
							'x-freeweight-signature': signPayload(h.secret, body)
						},
						body,
						signal: AbortSignal.timeout(10_000)
					});
					status = res.status;
				} finally {
					await db
						.update(webhook)
						.set({ lastDeliveryAt: new Date(), lastDeliveryStatus: status })
						.where(eq(webhook.id, h.id));
				}
			})
	);
}
