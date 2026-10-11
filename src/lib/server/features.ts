import { FREEWEIGHT_CLOUD, FREEWEIGHT_ENTERPRISE_KEY } from '$app/env/private';

export type Feature =
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
 * with a license key. Subscription validation is not yet implemented.
 * Basic SSO, passkeys and BYOK AI are core features on every install.
 */
export function isEnterpriseEnabled(): boolean {
	return FREEWEIGHT_CLOUD === true || !!FREEWEIGHT_ENTERPRISE_KEY;
}

export function hasFeature(feature: Feature): boolean {
	if (feature === 'sso' || feature === 'passkeys' || feature === 'ai') return true;
	return isEnterpriseEnabled();
}
