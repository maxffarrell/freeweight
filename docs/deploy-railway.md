# Railway app + database template

Status: template setup specification, not a published or end-to-end verified deploy button.
A repository import alone does not provision PostgreSQL. Do not restore a README
button until a real Railway template contains both services and passes the checks below.

## Maintainer setup

In Railway's [template editor](https://docs.railway.com/templates/create), create
one template with these two services. Creating the template is separate from
deploying billable services. Do not copy production secrets or production data.

### Postgres

- Name: `Postgres` (the app reference below depends on this exact name).
- Image: `postgres:18-alpine`.
- Persistent volume mount: `/var/lib/postgresql` (PostgreSQL 18's parent data directory).
- No public TCP proxy or HTTP domain is required.
- Variables:

```dotenv
POSTGRES_USER=freeweight
POSTGRES_DB=freeweight
POSTGRES_PASSWORD=${{secret(64, "abcdef0123456789")}}
DATABASE_URL=postgresql://${{POSTGRES_USER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{POSTGRES_DB}}
```

The hex password needs no URL escaping. Generate it once per template deployment,
not each container start, and preserve it across restarts.

### App

- Source: `https://github.com/maxffarrell/freeweight`, branch `main`.
- Build with the root `Dockerfile`; no custom build command.
- Use the Dockerfile's default command. It applies `scripts/migrate.ts` before
  starting `scripts/server.ts`; do not replace it with a server-only command.
- Generate an HTTPS Railway domain with target port `3000`.
- Health check: `/healthz`, timeout `120` seconds.
- Restart on failure, to recover if PostgreSQL has not finished initializing.
- One replica for initial deployment.
- Variables:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
BETTER_AUTH_SECRET=${{secret(64, "abcdef0123456789")}}
ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
PORT=3000
HOST=0.0.0.0
PROTOCOL_HEADER=x-forwarded-proto
```

Leave demo mode, cloud flags, enterprise keys and optional provider credentials
unset. Email delivery, payment providers, OAuth, AI and external cron scheduling
are separate opt-in integrations, not services this template provisions.

Configure these settings in the template itself. `railway.json` is only the
legacy single-service configuration; it does not create a database. Railway's
[current migration documentation](https://docs.railway.com/infrastructure-as-code)
says new services cannot opt into it and existing files stop being read on
December 1, 2026. A `.railway/railway.ts` file is a CLI-applied project definition,
not a substitute for a template URL in a deploy button.

## Release gate

Before adding a button, use an authorized disposable project with a clean database:

1. Open the actual template URL in the deploy flow. Confirm both services and the
   persistent database volume are included, all references resolve, and users do
   not need to supply an external database or an authentication secret.
2. Deploy, recording the app commit and template URL. Confirm a successful build,
   successful migration log and healthy `/healthz` response over HTTPS.
3. Create a synthetic account and workspace, sign out and sign back in, and
   create/read a representative record. Health alone does not verify authentication.
4. Restart/redeploy the app and database without replacing the volumes. Confirm
   the record remains, migration reruns succeed, and the auth secret is unchanged.
5. Verify the app domain and `ORIGIN` agree and the database is not exposed publicly.
6. Only then use Railway's generated share URL for the README badge. Never invent
   a template ID or replace the template link with `/new?template=<repository>`.

Live deployment incurs provider charges and requires account access. No live
deployment or persistence test is implied by checking this file into the repository.

References: [template creation](https://docs.railway.com/templates/create),
[template sharing](https://docs.railway.com/templates/publish-and-share),
[variables](https://docs.railway.com/variables/reference),
[volumes](https://docs.railway.com/volumes).
