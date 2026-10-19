import { createReadStream } from 'node:fs';
import { lstat, realpath, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, isAbsolute, relative, win32 } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
export function args(allowed, flags = []) {
  const result = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/, '');
    if (!process.argv[i].startsWith('--') || !allowed.includes(key))
      throw new Error(`Unknown option: ${process.argv[i]}`);
    if (result[key] !== undefined) throw new Error(`Duplicate option: --${key}`);
    if (flags.includes(key)) result[key] = true;
    else {
      if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--'))
        throw new Error(`--${key} requires a value`);
      result[key] = process.argv[++i];
    }
  }
  return result;
}
export async function hashFile(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}
export async function safePath(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    isAbsolute(name) ||
    win32.isAbsolute(name) ||
    name.split('/').some((p) => !p || p === '.' || p === '..' || p.includes(':'))
  )
    throw new Error(`Unsafe archive path: ${name}`);
  const base = await realpath(root);
  let path = base;
  for (const part of name.split('/')) {
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Unsafe symbolic link: ${name}`);
  }
  if (!(await lstat(path)).isFile() || relative(base, await realpath(path)).startsWith('..'))
    throw new Error(`Unsafe file path: ${name}`);
  return path;
}
export async function verifyBackup(root) {
  const manifest = JSON.parse(await readFile(await safePath(root, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== 1 ||
    !manifest.database ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.references)
  )
    throw new Error('Unsupported or invalid manifest');
  const paths = new Set();
  for (const entry of [manifest.database, ...manifest.files]) {
    if (
      typeof entry.file !== 'string' ||
      paths.has(entry.file) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error('Invalid or duplicate manifest file');
    paths.add(entry.file);
    const actual = await hashFile(await safePath(root, entry.file));
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256)
      throw new Error(`Checksum/hash mismatch: ${entry.file}`);
  }
  const media = new Set(manifest.files.map((f) => f.file));
  const seen = new Set();
  for (const ref of manifest.references) {
    const key = `${ref.table}/${ref.column}/${ref.id}`;
    if (
      !['episodes/media_path', 'episodes/voice_path', 'retellings/media_path'].includes(
        `${ref.table}/${ref.column}`,
      ) ||
      typeof ref.id !== 'string' ||
      typeof ref.original !== 'string' ||
      !media.has(ref.file) ||
      seen.has(key)
    )
      throw new Error('Invalid or missing media reference');
    seen.add(key);
  }
  return manifest;
}
export async function connect(url) {
  if (!url) throw new Error('Database URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
export async function pgTool(name, argv, url, bin) {
  const parsed = new URL(url);
  const env = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '15',
  };
  if (parsed.searchParams.has('sslmode')) env.PGSSLMODE = parsed.searchParams.get('sslmode');
  let executable = name;
  if (bin || process.env.PG_BIN)
    executable = join(
      bin || process.env.PG_BIN,
      name + (process.platform === 'win32' ? '.exe' : ''),
    );
  else if (process.platform === 'win32') {
    const local = `C:/Program Files/PostgreSQL/16/bin/${name}.exe`;
    try {
      await access(local);
      executable = local;
    } catch {
      /* use PATH */
    }
  }
  await new Promise((ok, fail) => {
    const child = spawn(executable, ['--no-password', ...argv], {
      env,
      stdio: ['ignore', 'inherit', 'pipe'],
      windowsHide: true,
    });
    let error = '';
    child.stderr.on('data', (part) => {
      error += part.toString();
    });
    child.on('error', () =>
      fail(
        new Error(
          `Cannot execute ${name}; install matching PostgreSQL client tools and set PG_BIN`,
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? ok()
        : fail(
            new Error(
              `${name} failed (${code}): ${error.replaceAll(env.PGPASSWORD || '\0', '[redacted]')}`,
            ),
          ),
    );
  });
}
export function fail(error) {
  console.error(`Backup/restore failed: ${error.message}`);
  process.exitCode = 1;
}
