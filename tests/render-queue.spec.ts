import { test, expect } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { enqueueRender, runNextRender } from '../server/render-queue';

const schema = `queue_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  application_name: schema,
  max: 5,
});
const owner = randomUUID();
test.beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await db.query(
    'CREATE TABLE seasons(id uuid PRIMARY KEY,owner_id uuid,status text,render_error text,updated_at timestamptz DEFAULT now())',
  );
  await db.query(await readFile('db/011_render_jobs.sql', 'utf8'));
});
test.afterEach(async () => {
  await db.query('TRUNCATE seasons CASCADE');
});
test.afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
async function draft() {
  const id = randomUUID();
  await db.query("INSERT INTO seasons(id,owner_id,status) VALUES($1,$2,'draft')", [id, owner]);
  return id;
}
test('render enqueue is atomic, owner-only and rejects duplicate submissions', async () => {
  const id = await draft();
  expect(await enqueueRender(db, id, randomUUID())).toBe(false);
  expect((await db.query('SELECT * FROM render_jobs')).rowCount).toBe(0);
  const results = await Promise.all([enqueueRender(db, id, owner), enqueueRender(db, id, owner)]);
  expect(results.sort()).toEqual([false, true]);
  expect((await db.query('SELECT state FROM render_jobs')).rows).toEqual([{ state: 'queued' }]);
  expect((await db.query('SELECT status FROM seasons WHERE id=$1', [id])).rows[0].status).toBe(
    'rendering',
  );
});
test('two workers cannot render the same job and a failure can be submitted again', async () => {
  const id = await draft();
  await enqueueRender(db, id, owner);
  let release!: () => void, claimed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const first = runNextRender(db, async () => {
    claimed();
    await gate;
    await db.query("UPDATE seasons SET status='failed' WHERE id=$1", [id]);
    return false;
  });
  await entered;
  try {
    expect(
      await runNextRender(db, async () => {
        throw new Error('duplicate');
      }),
    ).toBe(false);
  } finally {
    release();
  }
  expect(await first).toBe(true);
  expect((await db.query('SELECT state FROM render_jobs')).rows[0].state).toBe('failed');
  expect(await enqueueRender(db, id, owner)).toBe(true);
  expect(await runNextRender(db, async () => true)).toBe(true);
  expect((await db.query('SELECT state FROM render_jobs')).rows[0].state).toBe('done');
});
test('killing a worker rolls back its claim and another worker finishes the stored job', async () => {
  const id = await draft();
  await enqueueRender(db, id, owner);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/helpers/queue-crash-worker.ts'],
    {
      env: { ...process.env, QUEUE_TEST_SCHEMA: schema },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('CLAIMED')) resolve();
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Worker exited before claim: ${errors}`)));
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    expect((await db.query('SELECT state FROM render_jobs')).rows[0].state).toBe('queued');
    expect(await runNextRender(db, async () => true)).toBe(true);
    expect((await db.query('SELECT state FROM render_jobs')).rows[0].state).toBe('done');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('retry submitted during failure finalization cannot deadlock the worker', async () => {
  const id = await draft();
  await enqueueRender(db, id, owner);
  let release!: () => void, failed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const visible = new Promise<void>((resolve) => {
    failed = resolve;
  });
  const work = runNextRender(db, async () => {
    await db.query("UPDATE seasons SET status='failed' WHERE id=$1", [id]);
    failed();
    await gate;
    return false;
  });
  await visible;
  const retry = enqueueRender(db, id, owner);
  const both = Promise.allSettled([work, retry]);
  await expect
    .poll(async () =>
      Number(
        (
          await admin.query(
            "SELECT count(*) n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
            [schema],
          )
        ).rows[0].n,
      ),
    )
    .toBeGreaterThan(0);
  release();
  let timeout: ReturnType<typeof setTimeout>;
  const finished = await Promise.race([
    both.then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), 1500);
    }),
  ]);
  clearTimeout(timeout!);
  if (!finished) {
    await admin.query(
      "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
      [schema],
    );
  }
  await both;
  expect(finished).toBe(true);
  expect((await db.query('SELECT state FROM render_jobs')).rows[0].state).toBe('queued');
});
