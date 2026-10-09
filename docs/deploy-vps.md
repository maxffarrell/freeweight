# Deploy on any VPS

Any Linux VM that can run Docker Compose works — a ~€4/month Hetzner CX22, Oracle Cloud's always-free ARM tier, a DigitalOcean droplet, or a bare Raspberry Pi. This is the cheapest way to run Freeweight short of a free tier.

1. Create a VM with Docker installed (Ubuntu 24.04 + `curl -fsSL https://get.docker.com | sh`).
2. Pull the compose file:

   ```sh
   curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/maxffarrell/freeweight/main/docker-compose.yml
   ```

3. Start it:

   ```sh
   BETTER_AUTH_SECRET=$(openssl rand -hex 32) ORIGIN=https://your-domain.example docker compose up -d
   ```

   The `app` service runs migrations on start and listens on port 3000.

4. Point your domain at the VM and put a TLS reverse proxy in front — [Caddy](https://caddyserver.com) is the least work:

   ```
   your-domain.example {
       reverse_proxy localhost:3000
   }
   ```

5. Optional: set `CRON_SECRET` and schedule `GET /api/cron` daily with `Authorization: Bearer $CRON_SECRET` for billing and reminder emails. Add `RESEND_API_KEY` or `SMTP_URL` plus `EMAIL_FROM` to send real email.

Upgrades: `docker compose pull && docker compose up -d` (uses the `ghcr.io/maxffarrell/freeweight` image), or `docker compose build --pull && docker compose up -d` from a checkout.
