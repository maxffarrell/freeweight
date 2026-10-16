# Deploy on any VPS

Any Linux VM that can run Docker Compose works — a ~€4/month Hetzner CX22, Oracle Cloud's always-free ARM tier, a DigitalOcean droplet, or a bare Raspberry Pi. This is the cheapest way to run Freeweight short of a free tier.

1. Create a VM with Docker installed (Ubuntu 24.04 + `curl -fsSL https://get.docker.com | sh`).
2. Clone the source checkout (the Compose file builds its Dockerfile):

   ```sh
   git clone https://github.com/maxffarrell/freeweight.git
   cd freeweight
   cp .env.example .env
   ```

3. In `.env`, set `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` to separate outputs of `openssl rand -hex 32`, and set `ORIGIN=https://your-domain.example`. Keep this file private and persistent. Start it:

   ```sh
   docker compose up -d --build
   ```

   The `app` service runs migrations on start and listens on port 3000.

4. Point your domain at the VM and put a TLS reverse proxy in front — [Caddy](https://caddyserver.com) is the least work:

   ```
   your-domain.example {
       reverse_proxy localhost:3000
   }
   ```

5. Optional: set `CRON_SECRET` and schedule `GET /api/cron` daily with `Authorization: Bearer $CRON_SECRET` for billing and reminder emails. Add `RESEND_API_KEY` or `SMTP_URL` plus `EMAIL_FROM` to send real email.

Upgrades: update the source checkout, then `docker compose up -d --build`. Back up first. Existing database volumes retain their password: set `POSTGRES_PASSWORD` to the current password before upgrading; changing `.env` does not rotate it. If using a published image instead, explicitly configure a version tag or digest.
