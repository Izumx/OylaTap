import 'dotenv/config';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

const url = new URL(process.env.DATABASE_URL!);
const name = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+_e2e$/.test(name))
  throw new Error('Browser tests require a separate database with an _e2e suffix.');
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end();
}
for (const file of ['scripts/migrate.ts', 'tests/fixtures/seed-legacy.ts']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], {
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Test preparation failed: ${file}`);
}
await import('../server/index.js');
