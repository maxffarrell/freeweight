import { eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/auth.schema.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { isEnterpriseEnabled } from '#lib/server/features.ts';
import { portalMembers } from '#lib/server/services/members.ts';
import { syncIfStale } from '#lib/server/profile/client.ts';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	void syncIfStale(locals.user.id);
	const gyms = await portalMembers(locals.user.id);
	const memberId = url.searchParams.get('m');
	const pick = gyms.find((g) => g.member.id === memberId) ?? gyms[0];
	let brand = { whiteLabel: false, logoDocumentId: null as string | null, orgName: '' };
	if (pick) {
		const [o, s] = await Promise.all([
			db
				.select({ name: organization.name })
				.from(organization)
				.where(eq(organization.id, pick.member.organizationId))
				.limit(1),
			db
				.select({
					whiteLabel: gymSettings.whiteLabel,
					logoDocumentId: gymSettings.logoDocumentId
				})
				.from(gymSettings)
				.where(eq(gymSettings.organizationId, pick.member.organizationId))
				.limit(1)
		]);
		brand = {
			whiteLabel: !!s[0]?.whiteLabel && isEnterpriseEnabled(),
			logoDocumentId: s[0]?.logoDocumentId ?? null,
			orgName: o[0]?.name ?? pick.orgName
		};
	}
	return { user: { name: locals.user.name, email: locals.user.email }, brand };
};
