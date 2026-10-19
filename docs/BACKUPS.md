# Database and media recovery

OylaTap needs both a PostgreSQL backup and the files referenced by the database. A database dump alone does not contain uploaded videos, recorded voices, retellings, or the repository Flow lesson. These scripts back up `episodes.media_path`, `episodes.voice_path`, `retellings.media_path`, and `content/khanate-flow/oylatap-khanate-full-ru.mp4`. Unreferenced uploads, temporary renders, thumbnails, original Flow scene downloads, and `.env` are excluded. Keep source code, deployment configuration and secrets in their own protected recovery process.

Use Node 22.12+ with the project dependencies installed and PostgreSQL client tools compatible with the server. `pg_dump` must be at least the server's major version; rehearse with the same major version for dump and restore. Set `PG_BIN` to the directory containing `pg_dump` and `pg_restore`, pass `--pg-bin`, or put the tools on `PATH`. Windows also detects `C:\Program Files\PostgreSQL\16\bin`. These scripts use native PostgreSQL tools; Docker is not required and there is no automatic Docker fallback. Run from the repository root so `.env` and relative media paths resolve correctly. For an application launched from another working directory, pass `--source-root` with that directory.

## Create a backup

Set `DATABASE_URL` in the environment or the project's `.env`; the value is never written to the backup. Authentication is passed to PostgreSQL tools through process environment variables, never through a shell or command arguments. SSL settings in a URL's `sslmode` query parameter and ordinary libpq environment settings are supported. Configure connection timeouts and trusted CA files for your environment.

```powershell
New-Item -ItemType Directory -Force .local/backups | Out-Null
node scripts/backup.mjs --output .local/backups/2026-10-18
node scripts/restore.mjs --backup .local/backups/2026-10-18 --verify
```

```sh
mkdir -p .local/backups
node scripts/backup.mjs --output .local/backups/2026-10-18
node scripts/restore.mjs --backup .local/backups/2026-10-18 --verify
```

The output directory must not exist. A successful backup is a portable directory containing a custom-format `database.dump`, numbered files under `media/`, and `manifest.json`. The manifest maps each row/column and original path to its archived relative filename and records byte sizes and SHA-256 hashes. It contains no database connection string or secret environment file. Copy the complete directory as a unit. A failed attempt retains its incomplete output for diagnosis; an absent `manifest.json` means it is not a completed backup. Use a different output name for a retry.

The backup transaction holds SHARE locks on all existing public application tables and exports one repeatable-read snapshot to `pg_dump`. Reads continue, while database writes wait. Lock acquisition fails after 15 seconds instead of waiting indefinitely. The locks remain held through media copying and dump generation, so plan a maintenance window appropriate to database/media size. The backup role needs SELECT on all dumped objects and permission for these table locks; the database owner is suitable. The script does not insert, update, or delete source rows.

Files are hashed before copying and checked again before finishing. Missing files, changed files, permissions errors and a failed dump fail the whole operation. PostgreSQL locks cannot stop an external process changing a file or a schema outside the locked public tables. For a production consistency guarantee, pause uploads, render workers, cleanup and schema migrations for the backup window, or use a coordinated filesystem/database snapshot. No script that copies ordinary files can guarantee a consistent backup while arbitrary external writers mutate those files. Resume writers after the backup completes. Do not use an app deployment/migration window for a backup.

`--verify` reads and hashes the full dump and every archived media file, validates reference coverage, and rejects traversal paths and symbolic links. It needs no database access and makes no changes. It checks integrity, not dump SQL semantics or authenticity. Use the restore rehearsal below to prove database recovery. A malicious actor able to replace both the dump and manifest can create matching hashes; restore only trusted backups.

## Rehearse restoration into an isolated target

Restoration **always creates a new database** from `template0`. It refuses every existing database, even an empty one, and every existing media directory. There is no overwrite, clean or force mode. Supply `RESTORE_ADMIN_URL` explicitly; the restore target is never taken from `DATABASE_URL` or `.env`. Its account must have CREATEDB and sufficient privileges to restore the dumped objects/extensions. The selected admin database must differ from the target name.

```powershell
$env:RESTORE_ADMIN_URL='postgresql://recovery_user:YOUR_PASSWORD@127.0.0.1:5432/postgres'
node scripts/restore.mjs --backup .local/backups/2026-10-18 --create-database oylatap_restore_check_20261018 --media-dir .local/restored-media-20261018
Remove-Item Env:RESTORE_ADMIN_URL
```

```sh
export RESTORE_ADMIN_URL='postgresql://recovery_user:YOUR_PASSWORD@127.0.0.1:5432/postgres'
node scripts/restore.mjs --backup .local/backups/2026-10-18 --create-database oylatap_restore_check_20261018 --media-dir .local/restored-media-20261018
unset RESTORE_ADMIN_URL
```

Use a secret manager or protected environment file to supply real credentials; avoid recording secrets in shell history. The parent of the new media directory must already exist. All archive paths and hashes are validated before any database creation. Media is copied exclusively into the new directory and its hashes checked. `pg_restore` runs in a single transaction, without original owners or ACLs. The new objects belong to the recovery account. A second transaction rewrites **every** captured path, including relative paths, to the new media location, checks that each row matched, and checks total reference coverage. This also makes Windows-to-Linux or Linux-to-Windows restoration independent of old absolute paths. No original file is replaced.

On failure after target creation, the isolated database/directory are retained and clearly reported. Do not use that target for serving users. Investigate it, then explicitly drop only that rehearsal database and remove only that rehearsal directory, or retry with another new name. The script deliberately does not automatically delete databases.

For a real recovery, first inspect the new database with SQL and play representative uploaded, rendered, voice and retelling media using a separate application instance. Check user/authentication behavior, row counts, migrations, ownership and least-privilege grants. Set that instance's `DATABASE_URL` to the new database and `DATA_DIR` to a fresh writable uploads directory. Restored files can remain in the isolated media directory because row paths are rewritten. Transfer ownership/grant privileges to the intended application role using your deployment's role policy before cutover. The scripts do not start an app, change `.env`, switch traffic, run migrations, or modify the original database.

## Operations and retention

Schedule backups according to your acceptable data-loss window and repeat the isolated rehearsal after schema, storage or deployment changes. Keep several dated generations and an encrypted copy outside the application host, with restricted access. The dump contains personal data and authentication/session records; treat the entire backup as sensitive even though `.env` is excluded. Linux creation modes restrict directory access; apply equivalent Windows ACLs on the backup location. Hash verification is useful after transfer. Keep encryption keys and restore credentials in a separate recovery channel. Monitor failed runs and available disk space; preserve previous good generations until a newer one has passed verification and rehearsal.

Backup validation regression checks are independent of the live server:

```sh
node --test scripts/backup-tests.mjs
```

The local readiness rehearsal on 2026-10-18 created `.local/backups/readiness-20261018` with 19 media files and 19 database path references. Its database dump SHA-256 is `f2d35ea7a4927898de77f0e29ad0fa15ce32f12d1989d4e65a507e20e7415f51`. It was restored into `oylatap_restore_check_20261018_2330` and `.local/restored-media-20261018`. These are local rehearsal artifacts, not an off-host retention service. A production operator must configure backup scheduling, encrypted off-host storage and alerting.
