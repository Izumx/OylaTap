import { mkdir, copyFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import {
  args,
  connect,
  quote,
  pgTool,
  verifyBackup,
  safePath,
  hashFile,
  fail,
} from './backup-common.mjs';

async function main() {
  const options = args(
    ['backup', 'verify', 'create-database', 'media-dir', 'pg-bin', 'help'],
    ['verify', 'help'],
  );
  if (options.help)
    return console.log(
      'Inspect: node scripts/restore.mjs --backup DIRECTORY --verify\nRestore: RESTORE_ADMIN_URL=... node scripts/restore.mjs --backup DIRECTORY --create-database NEW_NAME --media-dir NEW_DIRECTORY\nCreates a NEW database only. Refuses any existing database/media directory.',
    );
  if (!options.backup) throw new Error('--backup DIRECTORY is required');
  const backup = resolve(options.backup);
  const manifest = await verifyBackup(backup);
  if (options.verify)
    return console.log(
      `Verified backup: ${manifest.files.length} media files, ${manifest.references.length} references, database ${manifest.database.bytes} bytes; created ${manifest.createdAt || 'unknown'}`,
    );
  const name = options['create-database'];
  if (!name || !/^[a-z][a-z0-9_]{0,62}$/.test(name))
    throw new Error(
      '--create-database requires a NEW lowercase database name (letters, digits, underscores)',
    );
  if (!options['media-dir']) throw new Error('--media-dir requires a NEW separate directory');
  const media = resolve(options['media-dir']);
  try {
    await lstat(media);
    throw new Error('Target media directory already exists; refusing nonempty or existing target');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Resolve existing parent to prevent symlink aliases of original/backup paths.
  const parent = await realpath(resolve(media, '..'));
  const destination = join(parent, relative(resolve(media, '..'), media));
  const backupReal = await realpath(backup);
  const inside = (base, path) => {
    const rel = relative(base, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (inside(backupReal, destination) || inside(destination, backupReal))
    throw new Error('Target media directory must be separate from backup');
  for (const entry of manifest.files) {
    if (isAbsolute(entry.original || '') && inside(destination, resolve(entry.original)))
      throw new Error('Target media directory overlaps original media');
  }
  const adminUrl = process.env.RESTORE_ADMIN_URL;
  if (!adminUrl)
    throw new Error(
      'RESTORE_ADMIN_URL is required; DATABASE_URL is never used as a restore target',
    );
  const admin = await connect(adminUrl);
  let target;
  let created = false;
  try {
    const adminDatabase = (await admin.query('SELECT current_database() AS name')).rows[0].name;
    if (name === adminDatabase)
      throw new Error('Target database must be separate from admin database');
    if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
      throw new Error('Target database already exists; refusing nonempty or existing target');
    const targetUrl = new URL(adminUrl);
    targetUrl.pathname = '/' + name;
    // CREATE DATABASE atomically refuses a target created by another process.
    await admin.query(`CREATE DATABASE ${quote(name)} TEMPLATE template0`);
    created = true;
    await mkdir(destination, { recursive: false, mode: 0o700 });
    for (const entry of manifest.files) {
      const path = join(destination, entry.file);
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
      await copyFile(await safePath(backup, entry.file), path, 1);
      const copied = await hashFile(path);
      if (copied.sha256 !== entry.sha256 || copied.bytes !== entry.bytes)
        throw new Error(`Restored media checksum mismatch: ${entry.file}`);
    }
    await pgTool(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
        '--dbname',
        name,
        await safePath(backup, manifest.database.file),
      ],
      targetUrl.toString(),
      options['pg-bin'],
    );
    target = await connect(targetUrl.toString());
    await target.query('BEGIN');
    for (const ref of manifest.references) {
      const result = await target.query(
        `UPDATE public.${quote(ref.table)} SET ${quote(ref.column)}=$1 WHERE id::text=$2 AND ${quote(ref.column)}=$3`,
        [join(destination, ref.file), ref.id, ref.original],
      );
      if (result.rowCount !== 1)
        throw new Error(
          `Restored media reference did not match: ${ref.table}/${ref.column}/${ref.id}`,
        );
    }
    const count = (
      await target.query(
        `SELECT (SELECT count(*) FROM episodes WHERE media_path IS NOT NULL) + (SELECT count(*) FROM episodes WHERE voice_path IS NOT NULL) + (SELECT count(*) FROM retellings WHERE media_path IS NOT NULL) AS total`,
      )
    ).rows[0].total;
    if (Number(count) !== manifest.references.length)
      throw new Error('Restored database contains unaccounted media references');
    // Recheck archive after copying/restoring; do not declare success if it changed.
    await verifyBackup(backup);
    await target.query('COMMIT');
    console.log(
      `Restore verified: database ${name}; media ${destination}; ${manifest.references.length} paths rewritten.\nSet the application DATABASE_URL to this database and DATA_DIR to a new writable uploads directory when cutting over.`,
    );
  } catch (error) {
    if (target) await target.query('ROLLBACK').catch(() => {});
    if (created)
      console.error(
        `Incomplete isolated restore retained for inspection: database ${name}, directory ${destination}. Original database/media were not modified.`,
      );
    throw error;
  } finally {
    if (target) await target.end();
    await admin.end();
  }
}
main().catch(fail);
