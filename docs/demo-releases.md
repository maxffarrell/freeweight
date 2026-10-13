# Releases and demo deployment

1. Include a changeset with changes you want in a release: `pnpm changeset`, select `freeweight`, choose patch/minor/major, and describe the change.
2. Merge feature PRs into main. Changesets creates or updates **Version packages**, collecting release notes and a version bump. Ordinary commits do not deploy.
3. Merge **Version packages** when ready. The release workflow detects the app version change, validates code and migrations on GitHub, builds and publishes a linux/amd64 GHCR image, publishes a GitHub Release, and separately deploys its immutable digest to the demo VPS. Release publication does not depend on demo deployment succeeding.

The app remains private on npm. This flow versions the app; it does not publish an npm package. Internal vendored UI packages are excluded from Changesets. The bootstrap changeset produces the first Version packages PR after this setup merges; the setup merge itself does not deploy.

## Normal self-hosted releases and CI

The **CI and release** workflow validates pull requests with type checks, lint, database migrations, application tests, release safeguard tests, and a Docker build. Merging a version PR publishes the generic application image to GHCR and creates the GitHub Release. The separate `deploy` job manages only the public demo; its credentials and environment are not required by the `release` job.

The same image supports normal installations and demos. Demo mode is disabled by default. Leave `FREEWEIGHT_DEMO` unset or set it to `false` for a normal installation; set it to `true` only for a demo. The normal Compose configuration leaves it unset. The demo banner and demo session expiry are enabled only in demo mode. CI validates with demo mode explicitly disabled.

## Deployment

GitHub environment `demo` stores a dedicated `DEMO_SSH_KEY`. Its forced SSH command can deploy only this app or run a harmless `probe`; it cannot open a shell, forward ports, or deploy the other apps. The pinned SSH host keys are in `scripts/release/known_hosts`. Existing VPS `.env` secrets, Compose configuration, named database volumes, Caddy hosts and shared CPU guard are retained.

GHCR images are tagged `v<version>` and `sha-<commit>`; deployment uses the digest, authenticated with the short-lived job token. No build runs on the VPS or developer laptop. Registry credentials are sent over SSH stdin and stored only in a temporary root-only Docker configuration, removed after pulling.

Deployments serialize across all three apps on the VPS. The previous image receives a rollback tag; after stopping the app, a root-only database dump is saved under `/opt/demos/backups/freeweight`. The new app applies migrations at startup. Public HTTPS login, demo workspace creation, banner countdown, fixed 480-second expiry and expiry rejection, database health, Caddy and CPU guard are verified. Verification uses HTTP/SSR, not a visual browser. On failure, the previous image and pre-release database dump are restored automatically; the GitHub job fails. If restoring the database fails, the app remains stopped and operator recovery is required. Database volumes are never removed. Restoring a pre-release dump discards writes from the short verification window.

## Retry and maintenance

For a failed release, rerun its failed GitHub Actions jobs after fixing infrastructure. To redeploy an existing release, use Actions → CI and release → Run workflow, with its tag (for example `v0.0.2`). A version cannot be reused for a different commit. For source fixes, add another changeset and merge the next version PR.

Backups and rollback images are retained deliberately; review disk usage and prune old copies only after confirming a stable release. The VPS helper is installed by an administrator at `/usr/local/sbin/deploy-demo-release`; changes to `scripts/release/deploy-server.py` require administrator installation and are not automatically executed with root privileges. Validate it with `python3 scripts/release/test_release.py`.

The environment permits workflows from main. No approval gate is added: merging the version PR is the release decision. GitHub Actions must be allowed to create pull requests under repository Actions settings.

## Initial setup (administrator)

Before the first version PR is merged, install the reviewed deploy-server.py helper as `/usr/local/sbin/deploy-demo-release` (root-owned, mode 700), add one restricted forced-command SSH key per app, create the GitHub `demo` environment with a main-branch deployment policy, store its app-specific key as `DEMO_SSH_KEY`, and allow GitHub Actions to create pull requests. The three app-specific key commands are `/usr/local/sbin/deploy-demo-release leroa`, `... tredaro`, and `... freeweight`; use OpenSSH's `restrict` option. Never use a shared unrestricted root key in GitHub. Test each new key with the `probe` command before enabling releases. This initial access setup requires explicit owner approval.
