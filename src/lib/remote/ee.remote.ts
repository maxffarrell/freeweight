import { query } from '$app/server';
import { getRequestEvent } from '$app/server';
import { and, eq, isNotNull, lt, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/auth.schema.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { requireOrg } from '#lib/server/context.ts';
import { auditExportEnabled, exportOrgData } from '#lib/server/ee/audit-export.ts';
import { healthFormsEnabled } from '#lib/server/ee/health-forms.ts';
import { dataRetentionEnabled, requireDataRetention } from '#lib/server/ee/data-retention.ts';
import {
	doorAccessEnabled,
	fireDoorWebhook,
	requireDoorAccess
} from '#lib/server/ee/door-access.ts';
import { anonymizeMember } from '#lib/server/services/members.ts';
import { checkIn, gymMember, membership, outer } from '#lib/server/db/schema.ts';
import { command } from '$app/server';
import * as v from 'valibot';
import {
	exportPayroll,
	listAccessLog,
	payrollExportEnabled
} from '#lib/server/ee/payroll-export.ts';
import { customFieldsEnabled } from '#lib/server/ee/custom-fields.ts';
import { hasFeature } from '#lib/server/ee/license.ts';

/** Feature flags for the current install — drives every gated surface in one round-trip. */
export const getEntitlements = query(async () => {
	await requireOrg();
	return {
		customFields: customFieldsEnabled(),
		whiteLabel: hasFeature('white-label'),
		auditExport: auditExportEnabled(),
		healthForms: healthFormsEnabled(),
		kioskPin: hasFeature('kiosk-pin'),
		payrollExport: payrollExportEnabled(),
		dataRetention: dataRetentionEnabled(),
		doorAccess: doorAccessEnabled(),
		reportDigests: hasFeature('report-digests'),
		ai: hasFeature('ai')
	};
});

/** Full-org JSON dump for compliance/backup. Unlicensed installs get {licensed:false}. */
export const getOrgDataExport = query(async () => {
	const { orgId } = await requireOrg('admin');
	if (!auditExportEnabled()) return { licensed: false, data: null };
	return { licensed: true, data: await exportOrgData(orgId) };
});

/** Branding for the error page — org name when the install is white-labelled. Never throws. */
export const getErrorBranding = query(async () => {
	const fallback = { appName: 'Freeweight', hideBranding: false };
	try {
		const orgId = getRequestEvent().locals.session?.activeOrganizationId;
		if (!orgId) return fallback;
		const [row] = await db
			.select({ name: organization.name, whiteLabel: gymSettings.whiteLabel })
			.from(organization)
			.leftJoin(gymSettings, eq(gymSettings.organizationId, organization.id))
			.where(eq(organization.id, orgId))
			.limit(1);
		if (!row?.whiteLabel || !hasFeature('white-label')) return fallback;
		return { appName: row.name, hideBranding: true };
	} catch {
		return fallback;
	}
});

/** Monthly pay run for payroll providers — CSV on the Reports page. */
export const getPayrollExport = query(async () => {
	const { orgId } = await requireOrg('admin');
	if (!payrollExportEnabled()) return { licensed: false, data: null };
	return { licensed: true, data: await exportPayroll(orgId) };
});

/** Staff sign-in access log for the audit view (audit-export flag). */
export const getAccessLog = query(async () => {
	const { orgId } = await requireOrg('admin');
	if (!auditExportEnabled()) return { licensed: false, rows: [] };
	return { licensed: true, rows: await listAccessLog(orgId) };
});

/** Test ping to the org's door webhook — proves the integration from Settings. */
export const testDoorWebhook = command(async () => {
	const { orgId } = await requireOrg('admin');
	requireDoorAccess();
	await fireDoorWebhook(orgId, {
		memberId: 'test',
		memberName: 'Test member',
		checkedAt: new Date().toISOString(),
		locationId: null
	});
	return { ok: true };
});

/** Bulk GDPR anonymize — scrubs members with no visit in 24+ months. */
export const anonymizeInactiveMembers = command(
	v.object({ months: v.optional(v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(120))) }),
	async (input) => {
		const ctx = await requireOrg('admin');
		requireDataRetention();
		const cutoff = new Date(Date.now() - (input.months ?? 24) * 30.4 * 86400_000);
		const cutoffDay = cutoff.toISOString().slice(0, 10);
		const stale = await db
			.select({ id: gymMember.id })
			.from(gymMember)
			.where(
				and(
					eq(gymMember.organizationId, ctx.orgId),
					lt(gymMember.joinedAt, cutoffDay),
					isNotNull(gymMember.email),
					notExists(
						db
							.select({ one: sql`1` })
							.from(checkIn)
							.where(
								and(
									eq(checkIn.memberId, outer(gymMember.id)),
									sql`${checkIn.checkedAt} > ${cutoff}`
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
				await anonymizeMember(ctx, row.id);
				done++;
			} catch {
				// keep going — one bad record shouldn't stop the sweep
			}
		}
		return { anonymized: done };
	}
);
