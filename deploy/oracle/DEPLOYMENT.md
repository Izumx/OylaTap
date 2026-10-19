# Oracle ARM deployment

OylaTap runs at https://oylatap.144.24.202.61.sslip.io on the Ubuntu 24.04 Oracle A1 VM. Docker Compose owns three services: `proxy` (Caddy on 80/443), `web` (Node 22 and FFmpeg), and `db` (PostgreSQL 16). The database has no host port. The host paths are `/opt/oylatap/app`, `/opt/oylatap/data` and `/opt/oylatap/backups`. The former Zherkoz application was removed on 2026-10-18. A protected archive and database dump are retained under `/opt/deployment-backups/oylatap-initial` for recovery only.

## Configuration

Work from `/opt/oylatap/app`. The private `deploy/oracle/.env` contains `DOMAIN`, a random URL-safe `POSTGRES_PASSWORD`, and `EDGE_NETWORK=oylatap_edge`. Keep it mode 600 and never commit or print it. The independent `oylatap_edge` network and `oylatap_caddy_data`/`oylatap_caddy_config` volumes were created manually before the old proxy was removed. They are declared `external: true` so a Compose teardown cannot erase TLS certificates. The database volume is `oylatap_postgres16_data`; web media and backups are bind-mounted from the host and owned by UID 1000.

For a fresh host, create the edge network and certificate volumes before Compose. Supply a real DNS name and point it to the host, then set `DOMAIN` in `.env`. Prepare the host directories for UID 1000:

```sh
docker network create oylatap_edge
docker volume create oylatap_caddy_data
docker volume create oylatap_caddy_config
sudo install -d -m 750 -o 1000 -g 1000 /opt/oylatap/data /opt/oylatap/backups
cd /opt/oylatap/app
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml config --quiet
```

The image builds natively for ARM64. The Dockerfile installs FFmpeg, DejaVu fonts and PostgreSQL 16 client tools; `tsx` stays available for the production start and migration commands. The Dockerfile-specific ignore file excludes `.env`, `.local`, credentials, dependencies and backups from the build context. Runtime uses Secure cookies, `DEMO_MODE=false`, one trusted Caddy hop and disabled email recovery until SMTP is configured. The one CPU limit matches this VM.

## Initial installation

Run these commands only against a **new, empty OylaTap database**. Do not seed again after people start using the app. The short-lived seed container has demo mode enabled to create seven catalog seasons, including the Flow video; the running service does not have demo login enabled.

```sh
cd /opt/oylatap/app
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml build --pull web
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml up -d --wait db
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml run --rm --no-deps -T -e DEMO_MODE=true web npm run db:migrate
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml run --rm --no-deps -T -e DEMO_MODE=true web npm run db:seed
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml up -d --wait web proxy
```

Keep `deploy/oracle/Caddyfile` as the only Caddy site unless another domain is intentionally added. Caddy obtains and renews its certificate using the mounted certificate volume. Check DNS and inbound TCP 80/443. The web service has no public host port.

## Daily operation and updates

```sh
cd /opt/oylatap/app
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml ps
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml logs --tail=80 web proxy
curl -fsS https://oylatap.144.24.202.61.sslip.io/api/health
sudo systemctl list-timers oylatap-backup.timer
sudo systemctl show oylatap-backup.service -p Result -p ExecMainStatus
```

`oylatap-backup.timer` invokes `backup.sh` daily at 23:15 UTC (04:15 Kazakhstan time). It stops OylaTap web, captures and verifies the database plus referenced media, then starts web again, even when backup fails. Backups remain under `/opt/oylatap/backups`. See [BACKUPS.md](../../docs/BACKUPS.md) for a restore rehearsal into a new database. Protect and copy backups to a second location; off-host replication and retention are still manual.

Before updating code or migrations, run the backup service and check `Result=success`. Retain the previous image. Build the new image, apply migrations with web stopped, and start web. Do not reseed a live database. A code rollback after schema changes is safe only if the old image accepts the new schema; otherwise restore a verified snapshot to a fresh target.

```sh
sudo systemctl start oylatap-backup.service
sudo systemctl show oylatap-backup.service -p Result -p ExecMainStatus
cd /opt/oylatap/app
docker image tag oylatap:oracle-local oylatap:before-update
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml stop web
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml build --pull web
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml run --rm --no-deps -T web npm run db:migrate
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml up -d --wait web
```

After any update, verify HTTPS, sign-in, a private video, and a render job. Password recovery remains disabled until SMTP and actual delivery are configured. Physical phone and microphone checks are still required for wider rollout.
