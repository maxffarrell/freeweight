# Deploy on Hostinger VPS

## Status

`docker-compose.hostinger.yml` is a full app-plus-PostgreSQL deployment candidate,
not a verified Hostinger one-click deployment. The README button is provided as
an **untested deployment shortcut**, not a guarantee of a working deployment.
It imports the stack, but users still select/provision a VPS, configure DNS and
set persistent secrets before deploying.
No Hostinger account, purchase, or production deployment was used to validate it.

The [documented button](https://www.hostinger.com/support/deploy-on-hostinger-button/)
uses `https://www.hostinger.com/docker-hosting?compose_url=COMPOSE_FILE_URL`, not
`compose=`. The button targets
`https://raw.githubusercontent.com/maxffarrell/freeweight/main/docker-compose.hostinger.yml`
on main. When testing unpublished changes, use the raw file URL from the review
branch instead; the button always uses the merged main-branch configuration.
It must be a standalone Compose document. The button may take new customers through Hostinger checkout; VPS
charges depend on the selected plan.

## What the stack provisions

- Caddy HTTPS reverse proxy with persistent certificate/configuration volumes.
- The app, built from a pinned, existing repository revision using a remote Git
  build context. No local checkout, local `.env` file, or unpublished container
  image is assumed. Update the pinned SHA deliberately when upgrading.
- PostgreSQL on the internal Compose network, with a persistent `pgdata` volume
  and health check. PostgreSQL has no public port.
- A wired `DATABASE_URL`; the app waits for the database to become healthy.
- The existing Dockerfile startup command runs `node scripts/migrate.ts` before
  `node scripts/server.ts`. A failed migration prevents server startup.

## First deployment

1. Use a Hostinger VPS with Docker Manager. Import the candidate Compose file
   from a published review branch while testing, or main after merge.
2. Configure the project environment before deployment:
   - `POSTGRES_PASSWORD`: a persistent, random URL-safe hex password (for example,
     `openssl rand -hex 32`). The same value initializes Postgres and the app URL.
   - `BETTER_AUTH_SECRET`: a separate random value, at least 32 characters.
   - `APP_DOMAIN`: a public DNS hostname (for example `app.example.com`), without
     a scheme, port, or path. Its A/AAAA records must point to this VPS.
     The app origin is derived as `https://APP_DOMAIN`.
3. Keep these values across redeployments. Changing only the environment does
   not rotate the password in an existing PostgreSQL volume.
4. Ensure ports 80 and 443 are available and DNS points to the VPS. The included
   Caddy reverse proxy obtains HTTPS certificates automatically and persists them
   in named volumes. The app and database have no published host ports. Remove
   stale AAAA records if the VPS has no reachable IPv6 address.
5. Deploy the whole project. The app builds from source, then migrates the new DB.

## Remaining runtime acceptance checks

Hostinger documents Compose import and environment configuration, and Docker
[documents remote Git build contexts](https://docs.docker.com/reference/compose-file/build/).
Hostinger-specific handling of remote builds and interpolation is not yet tested.

- Import only this YAML into a fresh project, with no repository checkout or `.env`.
- Verify Hostinger supplies all required variables to Compose interpolation and
  builds the pinned Git context. Missing secrets and domain must fail closed.
- Confirm Postgres becomes healthy, migrations finish, and the app serves through
  HTTPS. Create a disposable account and exercise a database-backed operation.
- Restart/redeploy the project with the same secrets and verify the account and
  data persist.
- Verify port 5432 and the app's port 3000 are not exposed publicly.
- Test a failed migration: the app must not start on an incompatible schema.

Back up database volumes before upgrades. Never delete them to fix a deployment.
Rebuild after changing the pinned Git revision; pulling images alone does not
update a source-built app. This is VPS self-hosting, not managed PostgreSQL.
