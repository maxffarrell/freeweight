import { query } from '$app/server';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/auth.schema.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { requireOrg } from '#lib/server/context.ts';
import { auditExportEnabled, exportOrgData } from '#lib/server/ee/audit-export.ts';
import { healthFormsEnabled } from '#lib/server/ee/health-forms.ts';
import { dataRetentionEnabled } from '#lib/server/ee/data-retention.ts';
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
