/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activity, gymSettings, notificationLog } from '#lib/server/db/schema.ts';
import { hasFeature } from './license.ts';

export function dataRetentionEnabled() {
	return hasFeature('data-retention');
}

export function requireDataRetention() {
	if (!dataRetentionEnabled()) throw error(403, 'Data retention is an Enterprise feature');
}

/**
 * Daily cron step: when the org set a retention window, purge audit-trail
 * rows — the activity log and notification log — older than it. Operational
 * history (check-ins, bookings, charges) is never purged.
 * 0/unlicensed = keep everything.
 * Returns the number of rows removed.
 */
export async function purgeOldData(orgId: string): Promise<number> {
	if (!dataRetentionEnabled()) return 0;
	const [settings] = await db
		.select({ retentionDays: gymSettings.retentionDays })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!settings?.retentionDays) return 0;
	const cutoff = new Date(Date.now() - settings.retentionDays * 86400_000);
	const [act, nl] = await Promise.all([
		db
			.delete(activity)
			.where(and(eq(activity.organizationId, orgId), lt(activity.createdAt, cutoff)))
			.returning({ id: activity.id }),
		db
			.delete(notificationLog)
			.where(and(eq(notificationLog.organizationId, orgId), lt(notificationLog.createdAt, cutoff)))
			.returning({ id: notificationLog.id })
	]);
	return act.length + nl.length;
}
