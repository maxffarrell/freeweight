import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { paymentProvider } from '#lib/server/db/schema.ts';
import type { ProviderRow } from './types.ts';

export async function providerRows(orgIds: string[]): Promise<ProviderRow[]> {
	if (!orgIds.length) return [];
	return db.select().from(paymentProvider).where(inArray(paymentProvider.organizationId, orgIds));
}

export async function providerRow(orgId: string, provider: string) {
	const [row] = await db
		.select()
		.from(paymentProvider)
		.where(and(eq(paymentProvider.organizationId, orgId), eq(paymentProvider.provider, provider)));
	return row ?? null;
}

export async function upsertProvider(
	orgId: string,
	provider: string,
	set: Partial<Pick<ProviderRow, 'enabled' | 'accountId' | 'accountReady'>>
) {
	await db
		.insert(paymentProvider)
		.values({ organizationId: orgId, provider, ...set })
		.onConflictDoUpdate({
			target: [paymentProvider.organizationId, paymentProvider.provider],
			set
		});
}
