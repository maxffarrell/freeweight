import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrg } from '#lib/server/context.ts';
import { hasPortalMembership } from '#lib/server/services/portal.ts';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login?next=/kiosk');
	const org = await getOrg();
	if (!org) {
		if (await hasPortalMembership(locals.user.id)) redirect(303, '/portal');
		redirect(303, '/onboarding');
	}
	return { gymName: org.org.name };
};
