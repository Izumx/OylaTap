import { test, expect } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { tokenHash, hashPassword } from '../server/auth';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const users: string[] = [];
test.afterAll(async () => {
  for (const id of users) await db.query('DELETE FROM users WHERE id=$1', [id]);
  await db.end();
});
test('email recovery honestly stays unavailable without delivery and fits RU/KK phone screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/recovery-status', (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Забыли пароль?', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('ещё не подключено');
  await expect(page.getByRole('button', { name: 'Отправить ссылку' })).toBeDisabled();
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/recovery-disabled-mobile-ru.png', fullPage: true });
  await page.getByRole('button', { name: 'Сменить язык' }).click();
  await expect(page.getByRole('heading', { name: 'Құпиясөзді ұмыттыңыз ба?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/recovery-disabled-mobile-kk.png', fullPage: true });
});
test('reset UI removes the token, verifies confirmation and logs in only with the new password', async ({
  page,
  playwright,
}) => {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex'),
    oldSession = randomBytes(32).toString('hex');
  const email = `${id}@readiness.example.test`;
  users.push(id);
  await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [
    id,
    'Тест восстановления',
    email,
    hashPassword('old-password-123'),
    'student',
  ]);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(oldSession), id],
  );
  await db.query(
    "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
    [tokenHash(token), id],
  );
  await page.goto(`/reset-password#token=${token}`);
  await expect(page).toHaveURL('/reset-password');
  const card = page.locator('.recovery-card');
  await card.getByLabel('Новый пароль', { exact: true }).fill('new-password-123');
  await card.getByLabel('Повторите пароль', { exact: true }).fill('different-password');
  await card.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(card.getByRole('alert')).toContainText('не совпадают');
  await card.getByLabel('Повторите пароль', { exact: true }).fill('new-password-123');
  await card.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(card.getByRole('status')).toContainText('Пароль изменён');
  const otherDevice = await playwright.request.newContext({
    baseURL: 'http://127.0.0.1:3100',
    extraHTTPHeaders: { Cookie: `oylatap_session=${oldSession}` },
  });
  expect((await otherDevice.get('/api/progress')).status()).toBe(401);
  await otherDevice.dispose();
  expect(
    (
      await page.request.post('/api/auth/login', { data: { email, password: 'old-password-123' } })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post('/api/auth/login', { data: { email, password: 'new-password-123' } })
    ).status(),
  ).toBe(200);
  await card.getByRole('link', { name: 'Запросить новую ссылку' }).click();
  await expect(page.getByRole('heading', { name: 'Забыли пароль?', exact: true })).toBeVisible();
  await expect(page.locator('.recovery-card form')).toBeVisible();
});

test('production PWA shows bilingual offline fallback and does not cache personal media', async ({
  browser,
}) => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  let child: ChildProcess | undefined;
  const context = await browser.newContext();
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'scripts/start.ts'], {
      env: { ...process.env, PORT: String(port), PASSWORD_RECOVERY_ENABLED: 'false' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout?.on('data', (chunk) => {
      logs += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      logs += chunk;
    });
    const base = `http://127.0.0.1:${port}`;
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${base}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 15000, message: 'Production server must start' },
      )
      .toBe(200);
    const page = await context.newPage();
    await page.goto(base);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await page.evaluate(() => localStorage.setItem('oylatap-locale', 'kk'));
    await context.setOffline(true);
    await page.goto(`${base}/library`);
    await expect(page.getByRole('heading', { name: 'Интернет байланысы жоқ' })).toBeVisible();
    await page.getByRole('button', { name: 'Русский', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Нет подключения', exact: true })).toBeVisible();
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await mkdir('.local/qa', { recursive: true });
    await page.screenshot({ path: '.local/qa/pwa-offline-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
});
