import { query } from '$app/server';
import { requireUser, getOrg } from '#lib/server/context.ts';
import { franchiseOverview } from '#lib/server/services/franchise.ts';

/** Cross-org rollup for owners/admins running more than one gym. */
export const getFranchise = query(async () => {
	const { user } = requireUser();
	const active = await getOrg();
	return { ...(await franchiseOverview(user.id)), activeId: active?.orgId ?? null };
});
