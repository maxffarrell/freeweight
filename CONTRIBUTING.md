# Contributing

Use Node 26 and pnpm 12.4.1. Follow the repository's `AGENTS.md`. Start from a feature branch, keep changes focused, and include a regression test for behavior changes.

Follow the README development setup. Before submitting a pull request run `pnpm check`, `pnpm lint`, `pnpm test` and `pnpm build`. Database tests require a disposable migrated PostgreSQL database. CI also validates migrations and the Docker image on a hosted runner.

The application core is licensed under [MIT](LICENSE-MIT.txt); see [LICENSE](LICENSE) and any file or directory license overrides. SDK packages use their own licenses. Preserve these boundaries. Basic SSO, passkeys and BYOK AI remain part of the free self-hosted core.

Never commit real credentials or local `.env` files. Keep [.env.example](.env.example) placeholder-only; use obviously fake test fixtures and disposable local/CI credentials. Report vulnerabilities privately using [SECURITY.md](SECURITY.md), not public issues.
