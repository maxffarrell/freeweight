import { passkey } from '@better-auth/passkey';
import { sso } from '@better-auth/sso';

/**
 * Basic SSO and passkeys are part of the AGPL core on every install.
 */
export const authPlugins = [
	sso({ organizationProvisioning: { disabled: false, defaultRole: 'member' } }),
	passkey({ rpName: 'Freeweight' })
] as const;
