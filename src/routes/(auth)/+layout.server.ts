import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isEnterpriseEnabled } from '#lib/server/ee/license.ts';
import { isDemo } from '#lib/server/demo-mode.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/dashboard');
	return { enterprise: isEnterpriseEnabled(), demo: isDemo() };
};
