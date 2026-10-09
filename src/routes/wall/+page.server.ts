import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrg } from '#lib/server/context.ts';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login?next=/wall');
	const org = await getOrg();
	if (!org) redirect(303, '/onboarding');
	return { gymName: org.org.name };
};
