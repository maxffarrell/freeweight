import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireUser, getOrg } from '#lib/server/context.ts';
import {
	copyFranchiseMember as copyFranchiseMemberSvc,
	franchiseMemberSearch,
	franchiseOverview
} from '#lib/server/services/franchise.ts';

/** Cross-org rollup for owners/admins running more than one gym. */
export const getFranchise = query(async () => {
	const { user } = requireUser();
	const active = await getOrg();
	return { ...(await franchiseOverview(user.id)), activeId: active?.orgId ?? null };
});

/** Cross-org member lookup for the franchise page search box. */
export const searchFranchiseMembers = query(v.pipe(v.string(), v.maxLength(100)), async (q) => {
	const { user } = requireUser();
	return franchiseMemberSearch(user.id, q);
});

/** Copies a member record into another gym the caller administers. */
export const copyFranchiseMember = command(
	v.object({ memberId: v.pipe(v.string(), v.minLength(1)), targetOrgId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ memberId, targetOrgId }) => {
		const { user } = requireUser();
		return copyFranchiseMemberSvc(user.id, memberId, targetOrgId);
	}
);
