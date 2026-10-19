import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const cli = resolve('scripts/restore.mjs');
const hash = (s) => createHash('sha256').update(s).digest('hex');
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'oylatap-backup-'));
  try {
    const manifest = {
      version: 1,
      database: { file: 'database.dump', bytes: 4, sha256: hash('dump') },
      files: [
        { file: 'media/000001.mp4', bytes: 5, sha256: hash('video'), original: 'source.mp4' },
      ],
      references: [
        {
          table: 'episodes',
          column: 'media_path',
          id: 'sample',
          original: 'source.mp4',
          file: 'media/000001.mp4',
        },
      ],
    };
    await mkdir(join(dir, 'media'));
    await writeFile(join(dir, 'database.dump'), 'dump');
    await writeFile(join(dir, manifest.files[0].file), 'video');
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    await run(dir, manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const verify = (dir) =>
  spawnSync(process.execPath, [cli, '--backup', dir, '--verify'], { encoding: 'utf8' });
test('verifies complete backup without database access', async () =>
  fixture(async (dir) => {
    const result = verify(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified/);
  }));
test('refuses corrupt media', async () =>
  fixture(async (dir) => {
    await writeFile(join(dir, 'media/000001.mp4'), 'other');
    const result = verify(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hash|checksum/i);
  }));
test('refuses missing media', async () =>
  fixture(async (dir) => {
    await rm(join(dir, 'media/000001.mp4'));
    const result = verify(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing|ENOENT/i);
  }));
test('refuses path traversal before touching database', async () =>
  fixture(async (dir, manifest) => {
    manifest.files[0].file = '../outside.mp4';
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = verify(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe|path/i);
  }));
test('refuses a reference without an archived file', async () =>
  fixture(async (dir, manifest) => {
    manifest.references[0].file = 'media/missing.mp4';
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = verify(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reference/i);
  }));
test('refuses an existing media directory before connecting to any database', async () =>
  fixture(async (dir) => {
    const destination = join(dir, 'existing');
    await mkdir(destination);
    await writeFile(join(destination, 'keep.txt'), 'preserve');
    const result = spawnSync(
      process.execPath,
      [cli, '--backup', dir, '--create-database', 'new_database', '--media-dir', destination],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RESTORE_ADMIN_URL: 'postgresql://invalid:invalid@127.0.0.1:1/invalid',
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
  }));
