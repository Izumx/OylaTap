# OylaTap operations and pilot readiness

The Oracle pilot uses its own Caddy proxy, network, application and database. Zherkoz was removed on 2026-10-18; only its protected rollback archive remains. Deployment, update and rollback commands are in [the Oracle runbook](../deploy/oracle/DEPLOYMENT.md). Public origin: https://oylatap.144.24.202.61.sslip.io. Configuration and credentials stay outside Git.

## Durable video processing

Migration 011 stores render requests in PostgreSQL. Enqueue atomically changes the season to `rendering` and creates its queued job. Each worker holds a PostgreSQL job-row lock while rendering; `SKIP LOCKED` lets other workers process different jobs. A killed process loses its transaction and another worker can retry the queued job. This is at-least-once processing: an interrupted attempt may repeat computation. Unique temporary directories and atomic promotion isolate attempts; uploaded original clips remain intact.

One worker processes one job at a time per application process. Keep the database connection alive for the render duration; a database timeout or shutdown cancels child processes and leaves the queue retryable. Do not set an idle transaction timeout shorter than rendering time. Season status reports rendering/review/failed, with explicit author retry after a completed failed render. Unexpected worker exceptions roll back the claim and are retried. Monitor repeated failures in container logs rather than repeatedly submitting the same job.

## Backup and recovery

See [BACKUPS.md](BACKUPS.md) for checksums, snapshot consistency and restoration into a fresh database. Pause uploads, rendering and cleanup while copying media. The Oracle `backup.sh` stops only OylaTap web, leaves PostgreSQL running, produces and verifies a complete backup, and restarts web through an EXIT trap. The systemd timer runs daily at 23:15 UTC (04:15 in Kazakhstan), with up to two minutes of jitter. This causes a short maintenance interruption. Inspect failures with `systemctl status oylatap-backup.service` and `journalctl -u oylatap-backup.service`.

Backups stay under `/opt/oylatap/backups`. They contain personal data: restrict access and encrypt any off-host copies. Retention, off-host storage and independent failure alerts must be configured before wider rollout; the timer alone does not protect against losing this VM or running out of disk. Never delete the last verified backup. Deployment secrets require a separate protected recovery copy.

## Authentication and email

Demo login is disabled on the public deployment. HTTPS cookies are Secure, HttpOnly and SameSite=Lax. `TRUST_PROXY_HOPS=1` is enabled only for the private Docker service behind the single Caddy hop, allowing rate limits to distinguish client addresses. Do not expose that service directly without reviewing proxy trust.

[Password recovery](PASSWORD_RECOVERY.md) is implemented but disabled until SMTP is configured and a real delivery is verified. Status/UI disclose this limitation. Reset links are single-use, expire after 30 minutes and revoke sessions. A concurrent old-password login cannot survive the reset. A reset request acknowledgement is not proof that a message was delivered.

## Verification evidence and limits

On 2026-10-18, the local full Playwright suite passed 67 tests, and all six backup integrity/refusal tests passed. The TypeScript and Vite production build passed. An actual final snapshot was restored to a new database `oylatap_final_restore_20261018` with all 19 media paths rewritten and checksums verified. The earlier rehearsal also compared every restored table after path normalization. Dependency audit reported zero known production vulnerabilities at verification time.

The browser tests cover RU/KK recovery forms, token removal, session revocation, concurrent reset/login, process-kill queue recovery, mobile layouts and a production service-worker offline fallback. The service worker does not persist personal media; offline navigation displays an explicit bilingual fallback. Existing completed work remains server-side and becomes available after reconnecting.

The Oracle ARM image was built and exercised through the public HTTPS hostname on 2026-10-18. External browser checks passed for mobile video playback, the original 48-second Flow video, registration, Secure/HttpOnly cookies, session persistence after reload, password login, demo-login refusal, disabled recovery status, an actual queued FFmpeg render, class publication, assignment and student invitation access to private video. The owner/moderator login was also verified. Only the accounts, class, season and generated video belonging to this deployment test were removed afterwards. Zherkoz continued returning HTTP 200.

The first server backup, `20261018T174725Z`, passed verification with 19 media files and 19 references. Its systemd execution reported `Result=success` and `ExecMainStatus=0`; the daily timer is enabled. The VM currently has one CPU and about 6 GB RAM, so rendering concurrency stays one and the application CPU ceiling is one.

That server snapshot was also copied to the Windows workspace and restored into the fresh local database `oylatap_oracle_restore_20261018` with media under `.local/restored-oracle-20261018`. All 19 file checksums and rewritten media paths passed verification. The unchanged large Flow file was reused from the repository only after matching the server manifest checksum. This is a manually verified off-host copy; daily off-host replication remains unconfigured.

Physical Android/iPhone installation, microphone permission/recording, low-memory behavior and actual email delivery still require device/provider checks. AI drafting and text-to-speech require separately configured services; ordinary editing, uploaded narration and silent rendering work without them. The public pilot must also be checked through HTTPS after deployment; local tests alone do not prove proxy or ARM runtime behavior.
