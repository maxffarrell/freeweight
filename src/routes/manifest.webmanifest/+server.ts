import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/auth.schema.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';

/** PWA manifest — keeps the kiosk/portal installable on desk tablets and phones. */
export const GET: RequestHandler = async (event) => {
	let appName = 'Freeweight';
	const orgId = event.locals.session?.activeOrganizationId;
	if (orgId) {
		const [row] = await db
			.select({ name: organization.name, whiteLabel: gymSettings.whiteLabel })
			.from(organization)
			.leftJoin(gymSettings, eq(gymSettings.organizationId, organization.id))
			.where(eq(organization.id, orgId))
			.limit(1);
		if (row?.whiteLabel && isEnterpriseEnabled() && row.name) appName = row.name;
	}
	return new Response(
		JSON.stringify({
			name: appName,
			short_name: appName,
			description: 'Gym management — schedule, members, billing, kiosk check-in',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			orientation: 'any',
			background_color: '#09090b',
			theme_color: '#18181b',
			icons: [
				{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
				{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
				{ src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
			]
		}),
		{ headers: { 'content-type': 'application/manifest+json' } }
	);
};
