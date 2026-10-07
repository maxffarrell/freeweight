/* @license Enterprise */

import { passkey } from '@better-auth/passkey';
import { sso } from '@better-auth/sso';

/**
 * Plugins are always registered so the database schema is identical across
 * editions; requests are gated in `gateEnterpriseAuth` when no license is present.
 */
export const enterprisePlugins = [
	sso({ organizationProvisioning: { disabled: false, defaultRole: 'member' } }),
	passkey({ rpName: 'Freeweight' })
] as const;

const GATED_PREFIXES = ['/api/auth/sso', '/api/auth/passkey'];

export function isEnterpriseAuthPath(pathname: string): boolean {
	return GATED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
