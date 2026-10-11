/* @license Enterprise */

import { FREEWEIGHT_CLOUD, FREEWEIGHT_ENTERPRISE_KEY } from '$app/env/private';

export type EnterpriseFeature =
	| 'sso'
	| 'passkeys'
	| 'ai'
	| 'custom-fields'
	| 'white-label'
	| 'audit-export'
	| 'health-forms'
	| 'kiosk-pin'
	| 'payroll-export'
	| 'data-retention'
	| 'door-access'
	| 'report-digests';

/**
 * Enterprise features are enabled on Freeweight Cloud, or on self-hosted installs
 * with a license key. Key validation is intentionally minimal until the license
 * server exists; see ee/README.md.
 */
export function isEnterpriseEnabled(): boolean {
	return FREEWEIGHT_CLOUD === true || !!FREEWEIGHT_ENTERPRISE_KEY;
}

export function hasFeature(_feature: EnterpriseFeature): boolean {
	return isEnterpriseEnabled();
}
