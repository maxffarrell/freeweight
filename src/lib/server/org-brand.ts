import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymSettings, organization } from '#lib/server/db/schema.ts';
import { appOrigin } from '#lib/server/email.ts';
import { isEnterpriseEnabled } from './features.ts';

/** Shared email branding — org name, logo, and the licensed white-label flag. */
export async function orgBrand(orgId: string) {
	const [o, s] = await Promise.all([
		db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, orgId))
			.limit(1),
		db
			.select({
				logoDocumentId: gymSettings.logoDocumentId,
				whiteLabel: gymSettings.whiteLabel,
				brandColor: gymSettings.brandColor
			})
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1)
	]);
	return {
		orgName: o[0]?.name ?? 'your gym',
		logoUrl: s[0]?.logoDocumentId ? `${appOrigin()}/api/logo/${s[0].logoDocumentId}` : undefined,
		whiteLabel: !!(s[0]?.whiteLabel && isEnterpriseEnabled()),
		brandColor: s[0]?.whiteLabel && isEnterpriseEnabled() ? s[0].brandColor : ''
	};
}
