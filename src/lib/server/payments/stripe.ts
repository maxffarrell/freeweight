import Stripe from 'stripe';
import { error } from '@sveltejs/kit';
import { FREEWEIGHT_CLOUD, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { paymentProvider, user } from '#lib/server/db/schema.ts';
import { appOrigin } from '#lib/server/email.ts';
import { and, eq } from 'drizzle-orm';
import { recordOnlinePayment } from './record.ts';
import { providerRow, upsertProvider } from './settings.ts';
import { secretList } from './standard-webhooks.ts';
import type { PaymentProvider } from './types.ts';

let client: Stripe | undefined;

const configured = () => !!STRIPE_SECRET_KEY && !!STRIPE_WEBHOOK_SECRET;

function api() {
	if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
	client ??= new Stripe(STRIPE_SECRET_KEY, { appInfo: { name: 'Freeweight' } });
	return client;
}

function verify(body: string, signature: string): Stripe.Event | null {
	for (const secret of secretList(STRIPE_WEBHOOK_SECRET)) {
		try {
			return Stripe.webhooks.constructEvent(body, signature, secret);
		} catch {
			// try the next secret
		}
	}
	return null;
}

async function onCheckoutPaid(event: Stripe.Event, session: Stripe.Checkout.Session) {
	if (session.payment_status !== 'paid' || !session.amount_total) return;
	const orgId = session.metadata?.freeweightOrgId;
	const memberId = session.metadata?.freeweightMemberId;
	if (!orgId || !memberId) return;
	// Only accept events from the account this workspace actually takes payments with.
	const row = await providerRow(orgId, 'stripe');
	if ((event.account ?? null) !== (row?.accountId ?? null)) return;
	const intent =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent?.id;
	await recordOnlinePayment({
		orgId,
		memberId,
		amount: session.amount_total,
		// Bank debits complete later through `async_payment_succeeded`; cards complete immediately.
		method: 'stripe',
		externalId: intent ?? session.id,
		provider: 'Stripe'
	});
}

/**
 * Stripe Checkout. Self-hosted installs can take payments into the install's own Stripe
 * account; on Freeweight Cloud each workspace connects its own account (Stripe Connect, Standard).
 */
export const stripeProvider: PaymentProvider = {
	id: 'stripe',
	name: 'Stripe',
	payLabel: 'Pay by card or bank',
	description:
		'Members pay by card or bank transfer through Stripe Checkout. Money goes straight to your Stripe account.',
	env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
	webhookEvents: [
		'checkout.session.completed',
		'checkout.session.async_payment_succeeded',
		'account.updated'
	],
	webhookNote:
		'For connected accounts, add the endpoint again with "Listen to events on Connected accounts".',
	configured,
	ready(row) {
		if (!configured()) return false;
		if (row?.accountId) return row.accountReady;
		return !FREEWEIGHT_CLOUD;
	},
	setupHint(row) {
		if (row?.accountId && !row.accountReady) return 'Finish setting up your Stripe account first.';
		if (!row?.accountId && FREEWEIGHT_CLOUD) return 'Connect a Stripe account first.';
		return null;
	},
	supportsCurrency: () => true,

	async checkout(i) {
		const metadata = {
			freeweightOrgId: i.orgId,
			freeweightMemberId: i.memberId
		};
		const session = await api().checkout.sessions.create(
			{
				mode: 'payment',
				line_items: [
					{
						quantity: 1,
						price_data: {
							currency: i.currency.toLowerCase(),
							unit_amount: i.amount,
							product_data: { name: i.description }
						}
					}
				],
				customer_email: i.email ?? undefined,
				client_reference_id: i.memberId,
				metadata,
				payment_intent_data: { metadata },
				success_url: `${appOrigin()}/portal?paid=1`,
				cancel_url: `${appOrigin()}/portal`
			},
			i.row?.accountId ? { stripeAccount: i.row.accountId } : undefined
		);
		if (!session.url) error(502, 'Stripe did not return a checkout link');
		return session.url;
	},

	async handleWebhook(body, headers) {
		const signature = headers.get('stripe-signature');
		const event = signature ? verify(body, signature) : null;
		if (!event) return false;
		switch (event.type) {
			case 'checkout.session.completed':
			case 'checkout.session.async_payment_succeeded':
				await onCheckoutPaid(event, event.data.object);
				break;
			case 'account.updated': {
				const account = event.data.object;
				await db
					.update(paymentProvider)
					.set({ accountReady: account.charges_enabled })
					.where(
						and(eq(paymentProvider.provider, 'stripe'), eq(paymentProvider.accountId, account.id))
					);
				break;
			}
		}
		return true;
	},

	account: {
		async connect(ctx, row) {
			let accountId = row?.accountId;
			if (!accountId) {
				const [me] = await db
					.select({ email: user.email })
					.from(user)
					.where(eq(user.id, ctx.userId));
				const account = await api().accounts.create({
					type: 'standard',
					email: me?.email,
					business_profile: { name: ctx.org.name },
					metadata: { freeweightOrgId: ctx.orgId }
				});
				accountId = account.id;
				await upsertProvider(ctx.orgId, 'stripe', { accountId, accountReady: false });
			}
			const base = `${appOrigin()}/settings/payments`;
			const link = await api().accountLinks.create({
				account: accountId,
				type: 'account_onboarding',
				refresh_url: `${base}?connect=retry`,
				return_url: `${base}?connect=done`
			});
			return link.url;
		},
		async refresh(row) {
			return (await api().accounts.retrieve(row.accountId)).charges_enabled;
		}
	}
};
