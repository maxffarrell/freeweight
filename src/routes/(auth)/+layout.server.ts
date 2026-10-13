import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isDemo } from '#lib/server/demo-mode.ts';
import { profileHubUrl } from '#lib/server/profile/client.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/dashboard');
	return { security: !isDemo(), demo: isDemo(), suite: !!profileHubUrl() };
};
