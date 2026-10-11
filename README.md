<div align="center">

# Freeweight

**Open-source gym management that's fast and easy to use.**

Members, memberships, class scheduling, QR check-ins and billing, plus a member portal and a public join page — in a keyboard-friendly UI. Self-host for free, or use Freeweight Cloud.

[![Deploy on Vercel](https://img.shields.io/badge/Deploy%20on-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmaxffarrell%2Ffreeweight&env=DATABASE_URL,BETTER_AUTH_SECRET&envDescription=Postgres%20URL%20and%20a%2032%2B%20char%20random%20secret&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D)
[![Deploy on Railway](https://img.shields.io/badge/Deploy%20on-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fmaxffarrell%2Ffreeweight&plugins=postgresql&envs=BETTER_AUTH_SECRET&BETTER_AUTH_SECRETDesc=32%2B+random+characters)
[![Deploy on Render](https://img.shields.io/badge/Deploy%20on-Render-46E3B7?logo=render&logoColor=black)](https://render.com/deploy?repo=https://github.com/maxffarrell/freeweight)
[![Deploy on Koyeb](https://img.shields.io/badge/Deploy%20on-Koyeb-00D992?logo=koyeb&logoColor=black)](https://app.koyeb.com/deploy?name=freeweight&type=git&repository=github.com/maxffarrell/freeweight&branch=main&builder=dockerfile&ports=3000;http&env[BETTER_AUTH_SECRET]=&env[DATABASE_URL]=)
[![Deploy on DigitalOcean](https://img.shields.io/badge/Deploy%20on-DigitalOcean-0080FF?logo=digitalocean&logoColor=white)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/maxffarrell/freeweight/tree/main)
[![Deploy on Hostinger](https://img.shields.io/badge/Deploy%20on-Hostinger-673DE6?logo=hostinger&logoColor=white)](https://www.hostinger.com/vps/docker-hosting?compose=https%3A%2F%2Fraw.githubusercontent.com%2Fmaxffarrell%2Ffreeweight%2Fmain%2Fdocker-compose.yml)

</div>

## Features

- **Members**: searchable roster, statuses, locations, per-member balances and portal invite links
- **Memberships**: plans (monthly/weekly/yearly, signup fee, class credits) and member subscriptions; charges generated automatically
- **Schedule**: class types with colors, recurring session creation, capacity, waitlist with automatic promotion, instructors
- **Check-ins**: QR code per member (`fw1.` HMAC tokens), kiosk-style quick check-in, today's check-in feed
- **Billing**: charges, payments, member balances; Stripe Checkout/Connect for online card payments
- **Member portal**: QR check-in card, balances + pay online, upcoming classes, book/cancel sessions
- **Public join page** (`/j/[gym]`): gym info, listed plans, weekly schedule, anti-spam join form
- **Command palette** (<kbd>⌘K</kbd>), `d`/`m`/`s`/`c`/`b`/`p`/`t` nav shortcuts
- **REST API + API keys** (`fw_`), signed **webhooks** (`x-freeweight-signature`), and an MIT **SDK** in `packages/sdk`
- **Enterprise** (Cloud or `FREEWEIGHT_ENTERPRISE_KEY`): SAML & OIDC single sign-on, passkeys

Out of scope by design: payroll, workout programming, and access-control hardware. Webhooks + the REST API are the integration surface.

## Quick start

```sh
docker compose up -d db        # or bring your own Postgres
cp .env.example .env           # set DATABASE_URL and BETTER_AUTH_SECRET
pnpm install
pnpm db:migrate
pnpm dev
```

Open http://localhost:5173, create an account, then click **Explore with demo data**.

### Self-hosting

| Target       | How                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Docker       | `BETTER_AUTH_SECRET=$(openssl rand -hex 32) docker compose up -d`                                              |
| Railway      | Button above. Uses `railway.json` + `Dockerfile` with a Postgres plugin.                                       |
| Vercel       | Button above. Uses `@sveltejs/adapter-vercel` automatically when `VERCEL=1`. Migrations run during the build.  |
| Render       | Button above. `render.yaml` provisions a Docker web service and a Postgres database.                           |
| Koyeb        | Button above. Builds the `Dockerfile`; add a Postgres (Koyeb PostgreSQL or free Neon) and set `DATABASE_URL`.  |
| DigitalOcean | Button above. `.do/deploy.template.yaml` creates the app and a dev Postgres on App Platform.                   |
| Hostinger    | Button above or [docs/deploy-hostinger.md](docs/deploy-hostinger.md) (VPS Docker Manager).                     |
| Any VPS      | [docs/deploy-vps.md](docs/deploy-vps.md) — same compose file on a ~$4 Hetzner VM or Oracle's always-free tier. |
| Fly.io       | [docs/deploy-fly.md](docs/deploy-fly.md) — `fly launch` using `fly.toml`, scales to zero when idle.            |
| PikaPods     | Not yet in their app catalog — once submitted, a `Run on PikaPods` badge goes here (~$1.50/mo managed).        |

Environment variables are documented in [`src/env.ts`](src/env.ts).

## Scheduled jobs

Membership billing (creating the next period's charge and marking overdue charges) runs whenever someone opens the app. To run it on time every day, set `CRON_SECRET` and call `GET /api/cron` with `Authorization: Bearer $CRON_SECRET`. On Vercel, the cron in `vercel.json` does this for you. Elsewhere, use any scheduler, for example:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://gym.example.com/api/cron
```

## REST API

Keys are created in **Settings → API keys** and are org-scoped, with per-resource read/write grants. `GET /api/v1/openapi.json` serves a machine-readable spec.

```sh
curl -H "Authorization: Bearer fw_..." https://gym.example.com/api/v1/members
```

Webhooks (Settings → Webhooks) are signed with HMAC-SHA256 in `x-freeweight-signature` (Standard Webhooks style; see `packages/sdk`).

## License

AGPLv3 for the core. `ee/`/`src/lib/server/ee/` under the Freeweight Enterprise License (SAML/OIDC SSO, passkeys — free with `FREEWEIGHT_ENTERPRISE_KEY` or on Freeweight Cloud). `packages/sdk` is MIT.
