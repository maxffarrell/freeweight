import { createAuthClient } from 'better-auth/svelte';
import { organizationClient } from 'better-auth/client/plugins';
import { apiKeyClient } from '@better-auth/api-key/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { ssoClient } from '@better-auth/sso/client';

export const authClient = createAuthClient({
	plugins: [organizationClient(), apiKeyClient(), passkeyClient(), ssoClient()]
});
