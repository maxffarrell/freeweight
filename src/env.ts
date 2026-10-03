import { defineEnvVars } from '@sveltejs/kit/env';

// Keep the existing optional values: consumers provide their own fallbacks or report missing configuration.
export const variables = defineEnvVars({
	STRIPE_WEBHOOK_SECRET: { schema: (input) => input ?? '' },
	INKLESS_API_KEY: { schema: (input) => input ?? '' },
	STRIPE_SECRET_KEY: { schema: (input) => input ?? '' },
	POCKETBASE_URL: { schema: (input) => input ?? '' }
});
