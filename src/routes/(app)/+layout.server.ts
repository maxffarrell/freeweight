import { isDemo } from '#lib/server/demo-mode.ts';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getOrg } from '#lib/server/context.ts';
import { hasPortalMembership } from '#lib/server/services/portal.ts';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	const org = await getOrg();
	if (!org) {
		if (await hasPortalMembership(locals.user.id)) redirect(303, '/portal');
		redirect(303, '/onboarding');
	}
	return {
		demoExpiresAt: isDemo() ? (locals.session?.expiresAt.getTime() ?? null) : null,
		demoServerNow: Date.now(),
		demo: isDemo(),
		user: { name: locals.user.name, email: locals.user.email, image: locals.user.image ?? null },
		org: { name: org.org.name, id: org.org.id, slug: org.org.slug }
	};
};
