# Security policy

Freeweight is pre-1.0 software. Security fixes target the current main branch and the newest release; older releases are not maintained separately.

## Reporting a vulnerability

Please report through [GitHub private vulnerability reporting](https://github.com/maxffarrell/freeweight/security/advisories/new). Do not include exploit details, credentials or customer data in public issues. If private reporting is unavailable, open an issue requesting a private reporting channel without disclosing the vulnerability.

Include the affected revision, installation mode, prerequisites, a minimal reproduction and expected behavior. Use disposable test data. A source review or passing CI is not a guarantee of production safety.

## Operating an installation

Use HTTPS, persistent authentication secrets, restricted database access and tested backups. Keep dependencies and releases current. Enable demo mode only on a separate disposable installation. Basic SSO, passkeys and BYOK AI are available in the self-hosted core; operators must configure their identity and model providers.

Tenant-configured webhooks and integrations accept public HTTP(S) destinations without redirects. For a trusted private integration, an installation operator may set `OUTBOUND_PRIVATE_ORIGINS` to comma-separated exact origins (scheme, host and port). This grants those tenants access to the allowlisted endpoint; keep the list narrow. Local operator-configured BYOK endpoints retain their own configuration.

Forwarded client IPs are accepted only from exact socket peer IPs configured in `TRUSTED_PROXY_IPS`. Configure a trusted reverse proxy to replace client-supplied forwarding headers; leave the variable unset for direct access.
