/* @license Enterprise */

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
	memberTag,
	membership,
	organization,
	payment,
	plan
} from '#lib/server/db/schema.ts';
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
		classTypes,
		sessions,
		bookings,
		checkIns,
		charges,
		payments,
		activity: activityRows
	};
}
