import { BETTER_AUTH_SECRET, ORIGIN, FREEWEIGHT_DEMO } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { apiKey } from '@better-auth/api-key';
import { db } from '#lib/server/db/index.ts';
import { enterprisePlugins } from '#lib/server/ee/auth.ts';
import { appOrigin, sendEmail } from '#lib/server/email.ts';
import { renderEmail } from '#lib/server/email-template.ts';

export const auth = betterAuth({
	appName: 'Freeweight',
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	session: {
		...(FREEWEIGHT_DEMO ? { expiresIn: 8 * 60, disableSessionRefresh: true } : {}),
		cookieCache: { enabled: !FREEWEIGHT_DEMO, maxAge: 60 }
	},
	// Deploy targets (Railway, Vercel, Docker via scripts/server.ts) all provide x-forwarded-for.
	advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
	plugins: [
		organization({
			allowUserToCreateOrganization: true,
			async sendInvitationEmail({ id, email, role, organization, inviter }) {
				await sendEmail({
					to: email,
					subject: `${inviter.user.name} invited you to ${organization.name} on Freeweight`,
					...renderEmail({
						orgName: organization.name,
						heading: `Join ${organization.name} on Freeweight`,
						lines: [`${inviter.user.name} (${inviter.user.email}) invited you to join as ${role}.`],
						action: { label: 'Accept invitation', url: `${appOrigin()}/invite/${id}` }
					})
				});
			}
		}),
		apiKey({ references: 'organization', defaultPrefix: 'fw_', enableMetadata: true }),
		...enterprisePlugins,
		sveltekitCookies(getRequestEvent) // must be last
	]
});

export type Auth = typeof auth;
