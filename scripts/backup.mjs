import { mkdir, copyFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { args, connect, quote, hashFile, pgTool, verifyBackup, fail } from './backup-common.mjs';

async function main() {
  const options = args(['output', 'source-root', 'pg-bin', 'help'], ['help']);
  if (options.help)
    return console.log(
      'node scripts/backup.mjs --output NEW_DIRECTORY [--source-root APP_WORKING_DIRECTORY] [--pg-bin DIRECTORY]\nReads DATABASE_URL from environment/.env. Blocks writes while taking the snapshot and copying media.',
    );
  if (!options.output) throw new Error('--output NEW_DIRECTORY is required');
  const output = resolve(options.output);
  const root = resolve(options['source-root'] || '.');
  // Exclusive creation prevents accidentally replacing an earlier backup.
  await mkdir(output, { recursive: false, mode: 0o700 });
  await mkdir(join(output, 'media'), { mode: 0o700 });
  const client = await connect(process.env.DATABASE_URL);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL lock_timeout = '15s'");
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows;
    if (!tables.length) throw new Error('Source database has no application tables');
    await client.query(
      `LOCK TABLE ${tables.map((t) => 'public.' + quote(t.tablename)).join(',')} IN SHARE MODE`,
    );
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0]
      .snapshot;
    const references = (
      await client.query(`SELECT 'episodes' AS table, 'media_path' AS column, id::text, media_path AS original FROM episodes WHERE media_path IS NOT NULL
      UNION ALL SELECT 'episodes','voice_path',id::text,voice_path FROM episodes WHERE voice_path IS NOT NULL
      UNION ALL SELECT 'retellings','media_path',id::text,media_path FROM retellings WHERE media_path IS NOT NULL`)
    ).rows;
    const originals = [
      ...new Set([
        ...references.map((r) => r.original),
        'content/khanate-flow/oylatap-khanate-full-ru.mp4',
      ]),
    ];
    const files = [];
    const sources = [];
    for (const [index, original] of originals.entries()) {
      const source = resolve(root, original);
      if (!(await lstat(source)).isFile())
        throw new Error(`Missing or unsafe source media: ${original}`);
      if (
        ['.env', '.dump', '.sql'].includes(extname(source).toLowerCase()) ||
        /(^|[\\/])\.env(?:\.|$)/i.test(source)
      )
        throw new Error(`Refusing secret/config media path: ${original}`);
      const file = `media/${String(index + 1).padStart(6, '0')}${/^\.[a-z0-9]{1,8}$/i.test(extname(source)) ? extname(source).toLowerCase() : '.bin'}`;
      const before = await hashFile(source);
      await copyFile(source, join(output, file));
      const copied = await hashFile(join(output, file));
      if (before.sha256 !== copied.sha256 || before.bytes !== copied.bytes)
        throw new Error(`Source media changed during backup: ${original}`);
      files.push({ original, file, ...copied });
      sources.push({ source: await realpath(source), ...copied });
    }
    await pgTool(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--snapshot',
        snapshot,
        '--file',
        join(output, 'database.dump'),
      ],
      process.env.DATABASE_URL,
      options['pg-bin'],
    );
    for (const source of sources) {
      if ((await hashFile(source.source)).sha256 !== source.sha256)
        throw new Error(`Source media changed during backup: ${source.source}`);
    }
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      strategy:
        'public-table SHARE locks + exported repeatable-read snapshot; source media hashes checked before/after',
      database: { file: 'database.dump', ...(await hashFile(join(output, 'database.dump'))) },
      files,
      references: references.map((ref) => ({
        ...ref,
        file: files.find((f) => f.original === ref.original).file,
      })),
    };
    await writeFile(join(output, 'manifest.pending.json'), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await client.query('COMMIT');
    await rename(join(output, 'manifest.pending.json'), join(output, 'manifest.json'));
    await verifyBackup(output);
    console.log(
      `Backup verified: ${output}\n${files.length} media files; ${references.length} database media references; database SHA-256 ${manifest.database.sha256}`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch(fail);
