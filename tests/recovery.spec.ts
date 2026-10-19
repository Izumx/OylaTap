import { test, expect } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { verifyPassword, tokenHash, hashPassword } from '../server/auth';
import { trustedAppUrl, smtpResetSender } from '../server/mail';

const schema = `recovery_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool, server: Server, base: string;
const messages: { to: string; url: string }[] = [];
let failedDeliveries = 0;
const userId = randomUUID();
const email = `${userId}@example.test`;
async function send(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'attacker.example' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function requestToken() {
  const before = messages.length;
  await send('/password-reset/request', { email, language: 'kk' });
  await expect.poll(() => messages.length).toBe(before + 1);
  return new URL(messages.at(-1)!.url).hash.slice('#token='.length);
}
test.beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: schema,
    options: `-c search_path=${schema}`,
  });
  await pool.query(
    'CREATE TABLE users(id uuid PRIMARY KEY,email text UNIQUE,password_hash text,language text); CREATE TABLE sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES users(id),expires_at timestamptz)',
  );
  await pool.query(await readFile('db/010_password_reset.sql', 'utf8'));
  await pool.query("INSERT INTO users VALUES($1,$2,'old-hash','ru')", [userId, email]);
  const { recoveryRouter } = await import('../server/recovery');
  const app = express();
  app.use(express.json());
  app.use('/disabled', recoveryRouter({ pool, sender: null, appUrl: 'https://school.example' }));
  app.use(
    '/failed',
    recoveryRouter({
      pool,
      appUrl: 'https://school.example',
      sender: {
        send: async () => {
          failedDeliveries++;
          throw new Error('transport unavailable');
        },
      },
    }),
  );
  app.use(
    recoveryRouter({
      pool,
      appUrl: 'https://school.example',
      sender: {
        send: async (message) => {
          messages.push(message);
        },
      },
    }),
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  if (pool) await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
test('requests do not reveal account existence and use trusted origin with hashed tokens', async () => {
  const known = await send('/password-reset/request', { email });
  const unknown = await send('/password-reset/request', { email: 'unknown@example.test' });
  expect(known).toEqual(unknown);
  expect(known.status).toBe(202);
  await expect.poll(() => messages.length).toBeGreaterThan(0);
  expect(Object.keys(known.body)).toEqual(['ok', 'message']);
  const url = new URL(messages.at(-1)!.url);
  expect(url.origin).toBe('https://school.example');
  expect(url.pathname).toBe('/reset-password');
  const token = url.hash.slice('#token='.length);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (
      await pool.query('SELECT token_hash FROM password_resets WHERE token_hash=$1', [
        tokenHash(token),
      ])
    ).rowCount,
  ).toBe(1);
  expect(JSON.stringify(known.body)).not.toContain(token);
});
test('reset changes password once and revokes all sessions and other reset links', async () => {
  const previous = await requestToken();
  const token = await requestToken();
  await pool.query(
    "INSERT INTO sessions VALUES('first',$1,now()+interval '1 day'),('second',$1,now()+interval '1 day')",
    [userId],
  );
  expect(
    (await send('/password-reset/confirm', { token, password: 'new-password-123' })).status,
  ).toBe(200);
  expect(
    verifyPassword(
      'new-password-123',
      (await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId])).rows[0]
        .password_hash,
    ),
  ).toBe(true);
  expect((await pool.query('SELECT * FROM sessions WHERE user_id=$1', [userId])).rowCount).toBe(0);
  for (const invalid of [token, previous])
    expect(
      (await send('/password-reset/confirm', { token: invalid, password: 'another-password' }))
        .status,
    ).toBe(400);
});
test('expired links and invalid passwords cannot change the password', async () => {
  const token = await requestToken();
  expect((await send('/password-reset/confirm', { token, password: 'short' })).status).toBe(400);
  await pool.query(
    "UPDATE password_resets SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash(token)],
  );
  expect(
    (await send('/password-reset/confirm', { token, password: 'another-password' })).status,
  ).toBe(400);
});
test('concurrent use permits exactly one password update', async () => {
  const token = await requestToken();
  const results = await Promise.all([
    send('/password-reset/confirm', { token, password: 'first-password' }),
    send('/password-reset/confirm', { token, password: 'second-password' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
});

test('unconfigured recovery is explicitly unavailable and rejects unsafe origins', async () => {
  expect(await (await fetch(`${base}/disabled/recovery-status`)).json()).toEqual({
    enabled: false,
  });
  expect((await send('/disabled/password-reset/request', { email })).status).toBe(503);
  for (const url of [
    'https://evil.example/path',
    'https://user:password@school.example',
    'http://school.example',
    'https://school.example?redirect=evil',
  ])
    expect(trustedAppUrl(url)).toBeUndefined();
  expect(
    smtpResetSender({
      PASSWORD_RECOVERY_ENABLED: 'false',
      SMTP_HOST: 'smtp.example',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM: 'mail@example.test',
    }),
  ).toBeUndefined();
});

test('SMTP failure keeps the generic response and removes undelivered token', async () => {
  await pool.query('DELETE FROM password_resets');
  const result = await send('/failed/password-reset/request', { email });
  expect(result.status).toBe(202);
  expect(Object.keys(result.body)).toEqual(['ok', 'message']);
  await expect.poll(() => failedDeliveries).toBe(1);
  // Wait for asynchronous cleanup after the sender has actually attempted delivery.
  await expect
    .poll(
      async () =>
        (await pool.query('SELECT count(*)::int AS count FROM password_resets')).rows[0].count,
    )
    .toBe(0);
});

test('an old-password login queued behind reset cannot create a surviving session', async () => {
  const authModule = await import('../server/auth');
  expect('authenticateWithPassword' in authModule).toBe(true);
  const authenticate = (
    authModule as typeof authModule & {
      authenticateWithPassword: (
        pool: pg.Pool,
        email: string,
        password: string,
      ) => Promise<unknown>;
    }
  ).authenticateWithPassword;
  await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
    userId,
    hashPassword('old-password-123'),
  ]);
  const token = await requestToken();
  const blocker = await pool.connect();
  let reset: Promise<Awaited<ReturnType<typeof send>>> | undefined;
  let login: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    reset = send('/password-reset/confirm', { token, password: 'replacement-password' });
    await expect
      .poll(
        async () =>
          (
            await admin.query(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%JOIN password_resets%'",
              [schema],
            )
          ).rows[0].count,
      )
      .toBe(1);
    login = authenticate(pool, email, 'old-password-123');
    await expect
      .poll(
        async () =>
          (
            await admin.query(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
              [schema],
            )
          ).rows[0].count,
      )
      .toBe(2);
    await blocker.query('COMMIT');
    expect((await reset).status).toBe(200);
    expect(await login).toBeNull();
    expect((await pool.query('SELECT * FROM sessions WHERE user_id=$1', [userId])).rowCount).toBe(
      0,
    );
    expect(await authenticate(pool, email, 'replacement-password')).toBeTruthy();
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.allSettled([reset, login].filter(Boolean));
  }
});
