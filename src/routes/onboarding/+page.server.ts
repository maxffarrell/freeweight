import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrg } from '#lib/server/context.ts';
import { isDemo } from '#lib/server/demo-mode.ts';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	if (isDemo()) redirect(303, '/dashboard');
	if (await getOrg()) redirect(303, '/dashboard');
	return { name: locals.user.name };
};
