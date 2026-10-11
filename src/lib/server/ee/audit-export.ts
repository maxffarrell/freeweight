/* @license Enterprise */

import { createHmac } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	booking,
	charge,
	checkIn,
	classSession,
	classType,
	gymMember,
	location,
	memberField,
	memberFieldValue,
	memberTag,
	membership,
	organization,
	payment,
	plan
} from '#lib/server/db/schema.ts';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { localDate } from '#lib/tz.ts';
import { notificationLog } from '#lib/server/db/schema.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { hasFeature } from './license.ts';

export function auditExportEnabled(): boolean {
	return hasFeature('audit-export');
}

/** Throws 403 when the install isn't licensed for compliance exports. */
export function requireAuditExport(): void {
	if (!auditExportEnabled()) throw error(403, 'Data export is an Enterprise feature');
}

/**
 * Full-org data dump for compliance/backup: one JSON object containing every
 * member-facing table in stable order. Table keys mirror the REST resource
 * names so downstream tooling can map onto the API.
 */
export async function exportOrgData(orgId: string) {
	requireAuditExport();
	const [
		org,
		locations,
		members,
		plans,
		memberships,
		memberTags,
		memberFields,
		memberFieldValues,
		classTypes,
		sessions,
		bookings,
		checkIns,
		charges,
		payments,
		activityRows
	] = await Promise.all([
		db.select().from(organization).where(eq(organization.id, orgId)),
		db
			.select()
			.from(location)
			.where(eq(location.organizationId, orgId))
			.orderBy(asc(location.name)),
		db
			.select()
			.from(gymMember)
			.where(eq(gymMember.organizationId, orgId))
			.orderBy(asc(gymMember.name)),
		db.select().from(plan).where(eq(plan.organizationId, orgId)).orderBy(asc(plan.name)),
		db.select().from(membership).where(eq(membership.organizationId, orgId)),
		db.select().from(memberTag).where(eq(memberTag.organizationId, orgId)),
		db.select().from(memberField).where(eq(memberField.organizationId, orgId)),
		db.select().from(memberFieldValue).where(eq(memberFieldValue.organizationId, orgId)),
		db.select().from(classType).where(eq(classType.organizationId, orgId)),
		db.select().from(classSession).where(eq(classSession.organizationId, orgId)),
		db.select().from(booking).where(eq(booking.organizationId, orgId)),
		db.select().from(checkIn).where(eq(checkIn.organizationId, orgId)),
		db.select().from(charge).where(eq(charge.organizationId, orgId)),
		db.select().from(payment).where(eq(payment.organizationId, orgId)),
		db
			.select()
			.from(activity)
			.where(eq(activity.organizationId, orgId))
			.orderBy(asc(activity.createdAt))
	]);

	return {
		exportedAt: new Date().toISOString(),
		organization: org[0] ?? null,
		locations,
		members,
		plans,
		memberships,
		memberTags,
		memberFields,
		memberFieldValues,
		classTypes,
		sessions,
		bookings,
		checkIns,
		charges,
		payments,
		activity: activityRows
	};
}

/**
 * Weekly auto-export (Mondays, org tz): POST the full org JSON to the
 * configured export webhook — keeps an external warehouse/backup in sync.
 * Deduped via notification_log so a re-fired cron never double-posts.
 */
export async function sendWeeklyExport(orgId: string): Promise<number> {
	if (!auditExportEnabled()) return 0;
	const [s] = await db
		.select({ url: gymSettings.exportWebhookUrl, timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.url) return 0;
	const today = localDate(new Date(), s.timezone ?? 'UTC');
	if (new Date(today + 'T12:00:00Z').getUTCDay() !== 1) return 0;
	const [row] = await db
		.insert(notificationLog)
		.values({ organizationId: orgId, kind: 'auto_export', entityId: today, recipient: s.url })
		.onConflictDoNothing()
		.returning({ id: notificationLog.id });
	if (!row) return 0;
	return postExport(orgId, s.url);
}

/** POST the full org export to the configured webhook — shared by cron and "send now". */
async function postExport(orgId: string, url: string): Promise<number> {
	try {
		const body = JSON.stringify(await exportOrgData(orgId));
		const signature = createHmac('sha256', BETTER_AUTH_SECRET).update(body).digest('hex');
		await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-freeweight-signature': signature },
			body,
			signal: AbortSignal.timeout(15_000)
		});
		return 1;
	} catch (err) {
		console.error(`export webhook failed for ${orgId}`, err);
		return 0;
	}
}

/** On-demand "send now" — bypasses the Monday gate and dedupe. 0 when no URL set. */
export async function sendExportNow(orgId: string): Promise<number> {
	if (!auditExportEnabled()) return 0;
	const [s] = await db
		.select({ url: gymSettings.exportWebhookUrl })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.url) return 0;
	return postExport(orgId, s.url);
}
