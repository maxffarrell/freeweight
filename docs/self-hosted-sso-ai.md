# Self-hosted SSO and BYOK AI

Basic SAML/OIDC SSO, passkeys and BYOK AI are part of the MIT core. They do
not require `FREEWEIGHT_ENTERPRISE_KEY` or a Cloud subscription.

## Sign-in

Serve the app over HTTPS, set `ORIGIN` to its public URL, and open Settings → Security tab.
Passkeys are per user. Workspace administrators can connect their own identity
provider; SSO preserves the existing organization membership and authorization checks.
Configure the provider's callback URL to match the app's public origin and provider ID.
The public demo blocks SSO and passkey configuration.

The existing settings form configures OIDC. SAML is also supported by the
Better Auth SSO API; the core does not impose an enterprise entitlement check.

## AI provider

Set these private environment variables on the server and restart the app.
No provider key or model usage is included; you pay your provider directly.
AI requests send the relevant input to the configured endpoint.

```dotenv
FREEWEIGHT_AI_PROVIDER=openai
FREEWEIGHT_AI_KEY=your-provider-key
FREEWEIGHT_AI_BASE_URL=https://api.openai.com
FREEWEIGHT_AI_MODEL=your-model
```

For Anthropic, set the provider to `anthropic` and supply its API key and model.
For a keyless local OpenAI-compatible endpoint such as Ollama, set the provider
to `openai`, an explicit base URL such as `http://localhost:11434`, and a model;
leave `FREEWEIGHT_AI_KEY` unset. The client appends `/v1/chat/completions`.

Structured calls use `FREEWEIGHT_AI_DECISION_KEY`, `FREEWEIGHT_AI_DECISION_BASE_URL`
and `FREEWEIGHT_AI_DECISION_MODEL`, falling back to the feature settings. They require
an OpenAI-compatible endpoint, so configure them separately when using Anthropic.
With no provider configured, AI calls return a configuration error, not a licensing error.

Paid report digests and other enterprise administrative workflows keep their
existing subscription requirements even when they use the core AI client.
