import { query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import { auditExportEnabled, exportOrgData } from '#lib/server/ee/audit-export.ts';
import { customFieldsEnabled } from '#lib/server/ee/custom-fields.ts';
import { hasFeature } from '#lib/server/ee/license.ts';

/** Feature flags for the current install — drives every gated surface in one round-trip. */
export const getEntitlements = query(async () => {
	await requireOrg();
	return {
		customFields: customFieldsEnabled(),
		whiteLabel: hasFeature('white-label'),
		auditExport: auditExportEnabled(),
		ai: hasFeature('ai')
	};
});

/** Full-org JSON dump for compliance/backup. Unlicensed installs get {licensed:false}. */
export const getOrgDataExport = query(async () => {
	const { orgId } = await requireOrg('admin');
	if (!auditExportEnabled()) return { licensed: false, data: null };
	return { licensed: true, data: await exportOrgData(orgId) };
});
