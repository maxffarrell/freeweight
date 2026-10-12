import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'Postgres connection string.' },
	BETTER_AUTH_SECRET: {
		description: 'Secret used to sign sessions. Use 32+ random characters in production.'
	},
	ORIGIN: {
		description:
			'Public origin, e.g. `https://gym.example.com`. Optional; derived from the request when unset.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_ENTERPRISE_KEY: {
		description:
			'Enterprise license key for paid administrative features. Basic SSO, passkeys and BYOK AI do not require a license.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_DEMO: {
		description:
			'Set to `true` for a public demo: visitors get a throwaway sample workspace (deleted after 24h), and sign-up, API access, webhooks, invites and uploads are disabled.',
		schema: (value) => value === 'true'
	},
	EMAIL_FROM: {
		description: 'Sender for notification emails, e.g. `Freeweight <no-reply@gym.example.com>`.',
		schema: (value) => value || undefined
	},
	RESEND_API_KEY: {
		description: 'Send email through Resend. Takes precedence over `SMTP_URL`.',
		schema: (value) => value || undefined
	},
	SMTP_URL: {
		description: 'Send email through SMTP, e.g. `smtps://user:pass@smtp.example.com:465`.',
		schema: (value) => value || undefined
	},
	STRIPE_SECRET_KEY: {
		description:
			'Stripe secret key. Lets members pay online with Stripe Checkout; money goes straight to Stripe, never through Freeweight.',
		schema: (value) => value || undefined
	},
	STRIPE_WEBHOOK_SECRET: {
		description:
			'Signing secret(s) for `/api/payments/stripe/webhook`. Comma-separate several (e.g. account and Connect endpoints).',
		schema: (value) => value || undefined
	},
	CRON_SECRET: {
		description:
			'Bearer token for `/api/cron`, which posts membership charges and reminders for every workspace. Vercel Cron sends it automatically.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_CLOUD: {
		description:
			'Set to `true` on Freeweight Cloud. Enables enterprise features and cloud-only behaviour.',
		schema: (value) => value === 'true'
	},
	FREEWEIGHT_AI_PROVIDER: {
		description:
			'model provider for AI features — `openai` (default; also any OpenAI-compatible endpoint like Ollama, OpenRouter or LiteLLM) or `anthropic`.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_AI_MODEL: {
		description:
			'model name for AI features. Defaults to `gpt-4o-mini` (openai) or `claude-sonnet-4-5` (anthropic).',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_AI_KEY: {
		description:
			'API key for the AI provider. Optional for an explicitly configured keyless local endpoint.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_AI_BASE_URL: {
		description:
			'override the provider endpoint, e.g. `http://localhost:11434` for Ollama or an OpenRouter/LiteLLM gateway URL.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_AI_DECISION_KEY: {
		description:
			'API key for structured decision calls (JSON the app consumes). OpenAI-spec `/chat/completions` only — no anthropic path. Falls back to `FREEWEIGHT_AI_KEY`.',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_AI_DECISION_MODEL: {
		description:
			'model for structured decision calls. Falls back to `FREEWEIGHT_AI_MODEL` (then `gpt-4o-mini`).',
		schema: (value) => value || undefined
	},
	FREEWEIGHT_AI_DECISION_BASE_URL: {
		description:
			'endpoint override for decision calls — must serve POST `/v1/chat/completions`. Falls back to `FREEWEIGHT_AI_BASE_URL` (then `https://api.openai.com`).',
		schema: (value) => value || undefined
	}
});
