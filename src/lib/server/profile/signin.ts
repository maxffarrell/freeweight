import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import * as v from 'valibot';
import { appOrigin } from '#lib/server/email.ts';
import { profileHubUrl } from '#lib/server/profile/client.ts';
import { sharedProfile } from '#lib/profile.ts';

/**
 * Unified sign-in: "Continue with Leroa" against a Leroa Profile service.
 * The hub's OAuth + PKCE endpoints double as a plain OAuth provider; granting the
 * `identity` scope returns a stable subject and verified email for the account link.
 */
export const suiteProviderId = 'leroa';

const profileResponse = v.object({ profile: sharedProfile });

export function suiteSignInPlugins() {
	const hub = profileHubUrl();
	if (!hub) return [];
	return [
		genericOAuth({
			config: [
				{
					providerId: suiteProviderId,
					name: 'Leroa',
					clientId: appOrigin(),
					authorizationUrl: new URL('/id/authorize', hub).toString(),
					tokenUrl: new URL('/id/token', hub).toString(),
					pkce: true,
					scopes: ['identity', 'contact'],
					getUserInfo: async (tokens) => {
						const res = await fetch(new URL('/id/profile', hub), {
							headers: { authorization: `Bearer ${tokens.accessToken}` },
							signal: AbortSignal.timeout(10_000)
						});
						if (!res.ok) return null;
						const { profile } = v.parse(profileResponse, await res.json());
						const id = profile.identity;
						if (!id) return null;
						return {
							id: id.sub,
							sub: id.sub,
							email: id.email,
							name: id.name || undefined,
							emailVerified: id.emailVerified
						};
					}
				}
			]
		})
	];
}
