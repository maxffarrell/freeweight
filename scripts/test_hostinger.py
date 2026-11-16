"""Validate the standalone Hostinger stack without provisioning infrastructure.

Run: DOCKER_COMPOSE=/path/to/docker-compose python3 scripts/test_hostinger.py
Defaults to `docker compose`. Requires Compose 2.24+; no daemon is needed.
"""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = json.loads((ROOT / "package.json").read_text())["name"]
COMPOSE = shlex.split(os.environ.get("DOCKER_COMPOSE", "docker compose"))
FIXTURES = {
    "APP_DOMAIN": "app.example.test",
    "POSTGRES_PASSWORD": "0123456789abcdef0123456789abcdef",
    "BETTER_AUTH_SECRET": "abcdef0123456789abcdef0123456789abcdef",
}


def config(values):
    env = {k: v for k, v in os.environ.items() if k not in FIXTURES}
    env.update(values)
    return subprocess.run(
        COMPOSE + ["--env-file", "/dev/null", "-f", str(ROOT / "docker-compose.hostinger.yml"), "config", "--format", "json"],
        env=env, capture_output=True, text=True,
    )


class HostingerStack(unittest.TestCase):
    def test_required_settings_fail_closed(self):
        for key in FIXTURES:
            with self.subTest(key=key):
                result = config({k: v for k, v in FIXTURES.items() if k != key})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(key, result.stderr)

    def test_complete_stack(self):
        result = config(FIXTURES)
        self.assertEqual(result.returncode, 0, result.stderr)
        doc = json.loads(result.stdout)
        services = doc["services"]
        app, db, proxy = (services[k] for k in ("app", "db", "proxy"))
        self.assertEqual(set(services), {"app", "db", "proxy"})
        context = app["build"]["context"]
        self.assertRegex(context, rf"^https://github.com/maxffarrell/{APP}\.git#[0-9a-f]{{40}}$")
        self.assertNotIn("env_file", app)
        self.assertNotIn("ports", app)
        self.assertNotIn("ports", db)
        self.assertEqual(app["depends_on"]["db"]["condition"], "service_healthy")
        self.assertIn("pg_isready", " ".join(db["healthcheck"]["test"]))
        self.assertEqual(app["environment"]["DATABASE_URL"], f"postgres://{APP}:{FIXTURES['POSTGRES_PASSWORD']}@db:5432/{APP}")
        self.assertEqual(db["environment"]["POSTGRES_PASSWORD"], FIXTURES["POSTGRES_PASSWORD"])
        self.assertEqual(app["environment"]["ORIGIN"], "https://app.example.test")
        self.assertEqual(app["environment"]["BETTER_AUTH_SECRET"], FIXTURES["BETTER_AUTH_SECRET"])
        self.assertEqual(proxy["command"], ["caddy", "reverse-proxy", "--from", "app.example.test", "--to", "app:3000"])
        self.assertEqual({p["target"] for p in proxy["ports"]}, {80, 443})
        self.assertTrue({"pgdata", "caddy_data", "caddy_config"}.issubset(doc["volumes"]))
        self.assertTrue(any(v["type"] == "volume" and v["target"] == "/var/lib/postgresql" for v in db["volumes"]))
        self.assertIn('node scripts/migrate.ts && node scripts/server.ts', (ROOT / "Dockerfile").read_text())
        if APP == "tredaro":
            self.assertTrue(any(v["source"] == "uploads" and v["target"] == "/app/data" for v in app["volumes"]))
            self.assertIn("chown -R node:node /app/data", (ROOT / "Dockerfile").read_text())


if __name__ == "__main__":
    unittest.main()
