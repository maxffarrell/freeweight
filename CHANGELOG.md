# freeweight

## 0.1.4

### Patch Changes

- 5134345: Require patched Node.js runtimes for CVE-2026-111497 and rebuild containers with Node.js 26.12.1.

## 0.1.3

### Patch Changes

- 44a6d34: Fix demo deployment for releases merged by a GitHub App account.
- d91f2ca: Validate portal claim and persistent member links before database access, bind tenant timezones in SQL, and require explicit self-hosted database credentials.

## 0.1.2

### Patch Changes

- 2fa96a7: Link every public demo account to a sample portal profile in its own workspace so the admin sidebar portal opens successfully.

## 0.1.1

### Patch Changes

- d429c64: Close resource permission, tenant reference, and public data exposure gaps found in the release audit.

## 0.1.0

### Minor Changes

- 14d4fcf: Include basic SAML/OIDC SSO, passkeys and BYOK AI in the AGPL self-hosted core without an enterprise license. Preserve paid administrative feature gates and public demo restrictions.

### Patch Changes

- c909af2: Harden tenant authorization, public responses and webhook delivery; add security regressions and self-hosting readiness guidance. Basic SSO, passkeys and BYOK AI remain in the free core.

## 0.0.3

### Patch Changes

- ed4b91f: Release current main updates to the public demo.

## 0.0.2

### Patch Changes

- 8bf1a49: Add Changesets-driven demo releases with fixed eight-minute sessions and countdown banners.
