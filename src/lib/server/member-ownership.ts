import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { gymMember } from './db/schema.ts';

/** Billing references remain tenant-scoped even for inconsistent historical guardian rows. */
export async function billingPayer(
	orgId: string,
	memberId: string,
	guardianId: string | null,
	q: Pick<typeof db, 'select'> = db
) {
	const payerId = guardianId ?? memberId;
	const [payer] = await q
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, payerId)));
	if (!payer) error(404, 'Billing member not found');
	return payerId;
}
