import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { claimPortal, portalTokenMemberId } from '#lib/server/services/portal.ts';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	portalTokenMemberId(params.token);
	if (!locals.user) redirect(303, `/signup?next=${encodeURIComponent(url.pathname)}`);
	await claimPortal(params.token, locals.user.id);
	redirect(303, '/portal');
};
