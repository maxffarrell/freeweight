import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import { providers, getProvider } from '#lib/server/payments/index.ts';
import { providerRows, upsertProvider } from '#lib/server/payments/settings.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { idSchema } from '#lib/schemas.ts';

export const getPaymentProviders = query(async () => {
	const { orgId } = await requireOrg('admin');
	const settings = await getSettings(orgId);
	const rows = await providerRows([orgId]);
	return providers.map((p) => {
		const row = rows.find((r) => r.provider === p.id) ?? null;
		return {
			id: p.id,
			name: p.name,
			description: p.description,
			configured: p.configured(),
			enabled: row?.enabled ?? false,
			ready: p.ready(row),
			hint: p.setupHint(row),
			env: p.env,
			webhookPath: `/api/payments/${p.id}/webhook`,
			webhookEvents: p.webhookEvents,
			webhookNote: p.webhookNote,
			accountId: row?.accountId ?? null,
			accountReady: row?.accountReady ?? false,
			canConnect: !!p.account,
			supportsCurrency: p.supportsCurrency(settings.currency)
		};
	});
});

export const toggleProvider = command(
	v.object({ id: idSchema, enabled: v.boolean() }),
	async ({ id, enabled }) => {
		const ctx = await requireOrg('admin');
		const p = getProvider(id);
		if (!p || !p.configured()) return;
		await upsertProvider(ctx.orgId, id, { enabled });
		void getPaymentProviders().refresh();
	}
);

/** Starts Stripe Connect onboarding for the workspace; returns the URL to send the owner to. */
export const connectProvider = command(idSchema, async (id) => {
	const ctx = await requireOrg('admin');
	const p = getProvider(id);
	if (!p?.account) return null;
	const row = (await providerRows([ctx.orgId])).find((r) => r.provider === id) ?? null;
	const url = await p.account.connect(ctx, row);
	void getPaymentProviders().refresh();
	return { url };
});

export const refreshProvider = command(idSchema, async (id) => {
	const ctx = await requireOrg('admin');
	const p = getProvider(id);
	const row = (await providerRows([ctx.orgId])).find((r) => r.provider === id);
	if (p?.account && row?.accountId) {
		const ready = await p.account.refresh(row as typeof row & { accountId: string });
		await upsertProvider(ctx.orgId, id, { accountReady: ready });
	}
	void getPaymentProviders().refresh();
});
