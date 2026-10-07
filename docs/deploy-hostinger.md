# Deploy on Hostinger

Freeweight runs on any Hostinger **VPS** using the Docker Manager (Docker Compose) template.

1. Create a VPS with the **Docker** OS template (Ubuntu 24.04 with Docker).
2. Open **Docker Manager → Compose → Create project from URL** and paste:
   `https://raw.githubusercontent.com/maxffarrell/freeweight/main/docker-compose.yml`
3. Set environment variables:
   - `BETTER_AUTH_SECRET` – output of `openssl rand -hex 32`
   - `ORIGIN` – your public URL, e.g. `https://gym.example.com`
4. Deploy. Freeweight listens on port 3000; point your domain at the VPS and enable HTTPS from **Domains → SSL**.

Upgrades: in Docker Manager choose **Pull & redeploy**. Migrations run automatically on start.
