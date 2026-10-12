# Contributing

Use Node 26 and pnpm 12.4.1. Follow the repository's `AGENTS.md`. Start from a feature branch, keep changes focused, and include a regression test for behavior changes.

Follow the README development setup. Before submitting a pull request run `pnpm check`, `pnpm lint`, `pnpm test` and `pnpm build`. Database tests require a disposable migrated PostgreSQL database. CI also validates migrations and the Docker image on a hosted runner.

The application core is licensed under AGPL-3.0; see `LICENSE` and any file or directory license overrides. SDK packages use their own licenses. Preserve these boundaries. Basic SSO, passkeys and BYOK AI remain part of the free self-hosted core.

Report vulnerabilities privately as described in `SECURITY.md`.
