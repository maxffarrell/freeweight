import type { OrgContext } from '#lib/server/context.ts';
import type { paymentProvider } from '#lib/server/db/schema.ts';

export type ProviderRow = typeof paymentProvider.$inferSelect;

export type CheckoutInput = {
	orgId: string;
	memberId: string;
	email: string | null;
	/** Minor units. */
	amount: number;
	currency: string;
	description: string;
	row: ProviderRow | null;
};

/**
 * An online payment provider. The provider moves the money; Freeweight only starts checkout
 * and records the payment when the provider's signed webhook confirms it.
 */
export type PaymentProvider = {
	id: string;
	name: string;
	/** Button label in the member portal. */
	payLabel: string;
	description: string;
	/** Server environment variables that make the provider available. */
	env: string[];
	webhookEvents: string[];
	webhookNote?: string;
	/** Checkout has no return URL, so it opens in a new tab. */
	newTab?: boolean;
	configured(): boolean;
	/** Whether this workspace can take payments with the provider right now. */
	ready(row: ProviderRow | null): boolean;
	/** What is still needed before the provider can be turned on, if anything. */
	setupHint(row: ProviderRow | null): string | null;
	supportsCurrency(currency: string): boolean;
	/** Returns the provider-hosted checkout URL. */
	checkout(input: CheckoutInput): Promise<string>;
	/** Verifies and handles a webhook delivery. Returns `false` when the signature is invalid. */
	handleWebhook(body: string, headers: Headers): Promise<boolean>;
	/** Providers where each workspace connects its own account. */
	account?: {
		connect(ctx: OrgContext, row: ProviderRow | null): Promise<string>;
		/** Re-reads from the provider whether the account can take payments. */
		refresh(row: ProviderRow & { accountId: string }): Promise<boolean>;
	};
};
