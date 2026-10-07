# Agent notes

- Node 26, pnpm. SvelteKit 3: use `#lib/...` imports (no `$lib`), `$app/env/private` for env, config lives in `vite.config.ts`.
- Remote functions (`query`/`command`) and Svelte async (`await` in components) are enabled.
- Verify with `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Local DB: `DATABASE_URL` in `.env`; apply migrations with `node scripts/migrate.ts`.
- Domain: gyms — `gym_member` (member) + `plan`/`membership` + `class_type`/`class_session`/`booking` + `check_in` + `charge`/`payment`, all org-scoped. Staff auth is Better Auth orgs (`member`/`user`); portal members log in via HMAC claim links.
