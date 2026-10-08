import { query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { franchiseOverview } from '#lib/server/services/franchise.ts';

/** Cross-org rollup for owners/admins running more than one gym. */
export const getFranchise = query(async () => {
	const { user } = requireUser();
	return franchiseOverview(user.id);
});
