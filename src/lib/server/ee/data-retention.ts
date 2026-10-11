/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { and, eq, isNotNull, lt, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	checkIn,
	gymMember,
	gymSettings,
	membership,
	notificationLog,
	outer
} from '#lib/server/db/schema.ts';
import { anonymizeMember } from '#lib/server/services/members.ts';
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

/**
 * Scrub PII of members with no visit in `months` months and no active
 * membership (GDPR erasure sweep). Used by the Settings button and the
 * nightly auto sweep when `anonymizeMonths` is set.
 */
export async function anonymizeInactive(orgId: string, months: number): Promise<number> {
	const cutoff = new Date(Date.now() - months * 30.4 * 86400_000);
	const cutoffDay = cutoff.toISOString().slice(0, 10);
	const stale = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				lt(gymMember.joinedAt, cutoffDay),
				isNotNull(gymMember.email),
				notExists(
					db
						.select({ one: sql`1` })
						.from(checkIn)
						.where(
							and(
								eq(checkIn.memberId, outer(gymMember.id)),
								sql`${checkIn.checkedAt} > ${cutoff.toISOString()}`
							)
						)
				),
				notExists(
					db
						.select({ one: sql`1` })
						.from(membership)
						.where(
							and(eq(membership.memberId, outer(gymMember.id)), eq(membership.status, 'active'))
						)
				)
			)
		)
		.limit(500);
	let done = 0;
	for (const row of stale) {
		try {
			await anonymizeMember({ orgId, userId: null }, row.id);
			done++;
		} catch {
			// one bad record shouldn't stop the sweep
		}
	}
	return done;
}

/** Cron step: auto-anonymize when the org configured `anonymizeMonths` (>0). */
export async function autoAnonymize(orgId: string): Promise<number> {
	if (!dataRetentionEnabled()) return 0;
	const [s] = await db
		.select({ months: gymSettings.anonymizeMonths })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.months) return 0;
	return anonymizeInactive(orgId, s.months);
}
