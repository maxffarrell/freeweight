import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/signup?next=${encodeURIComponent(url.pathname)}`);
	return { id: params.id, email: locals.user.email };
};
