import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { portalMembers } from '#lib/server/services/members.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const gyms = await portalMembers(locals.user!.id);
	if (!gyms.length)
		error(404, 'No member profile is linked to this account yet — ask your gym for a portal link.');
	const options = gyms.map((g) => ({
		memberId: g.member.id,
		gymName: g.orgName,
		label: g.dependent ? `${g.member.name} · ${g.orgName}` : g.orgName
	}));
	const memberId = url.searchParams.get('m') ?? gyms[0]!.member.id;
	return { options, memberId };
};
