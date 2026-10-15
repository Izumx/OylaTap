import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tokenHash } from '../server/auth';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const seed = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const users: string[] = [],
  contexts: BrowserContext[] = [];
type Actor = { id: string; context: BrowserContext };
async function actor(browser: Browser, name: string, role = 'student'): Promise<Actor> {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [
    id,
    name,
    `${id}@example.test`,
    'fixture-no-password-login',
    role,
  ]);
  users.push(id);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), id],
  );
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await context.addCookies([
    { name: 'oylatap_session', value: token, url: 'http://127.0.0.1:3000' },
  ]);
  contexts.push(context);
  return { id, context };
}
async function get(a: Actor, path: string) {
  const r = await a.context.request.get('/api' + path);
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function post(a: Actor, path: string, data: unknown) {
  const r = await a.context.request.post('/api' + path, { data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function classroom(t: Actor, s: Actor, name = '7 А · Проверка отчёта', season = seed) {
  const c = await post(t, '/classes', { name });
  await post(s, '/classes/join', { code: c.code });
  await post(t, '/assignments', {
    class_id: c.id,
    season_id: season,
    due_at: '2099-01-01T12:00:00Z',
  });
  return c;
}
async function answers(season = seed) {
  return (
    await db.query(
      "SELECT correct,jsonb_array_length(options) n FROM questions WHERE season_id=$1 AND purpose='final' ORDER BY position",
      [season],
    )
  ).rows;
}
async function attempt(s: Actor, correct: boolean, season = seed) {
  const q = await answers(season);
  return post(s, `/seasons/${season}/attempts`, {
    answers: q.map((q) => (correct ? q.correct : (q.correct + 1) % q.n)),
  });
}
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  // Remove dependent student rows before the reviewing teacher to honor reviewed_by.
  for (const id of users) await db.query('DELETE FROM retellings WHERE user_id=$1', [id]);
  for (const id of users.splice(0)) {
    await db.query('DELETE FROM classrooms WHERE teacher_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
});
test.afterAll(async () => {
  await db.end();
});

test('teacher sees latest, previous and best scores; practice and duplicate classes do not inflate mistakes', async ({
  browser,
}) => {
  const t = await actor(browser, 'Учитель отчётов', 'teacher'),
    s = await actor(browser, 'Кира');
  const c = await classroom(t, s);
  await classroom(t, s, 'Вторая группа того же ученика');
  await attempt(s, true);
  const low = await attempt(s, false);
  const correct = await answers();
  await post(s, `/attempts/${low.id}/practice`, { answers: correct.map((q) => q.correct) });
  const overview = await get(t, '/results/overview');
  expect(overview.rows).toHaveLength(2);
  expect(overview.rows[0]).toMatchObject({
    latest_score: 0,
    previous_score: 100,
    test_score: 100,
    latest_attempt_id: low.id,
  });
  expect(overview.rows[0]).not.toHaveProperty('results_snapshot');
  expect(overview.counts).toMatchObject({ learners: 1, help: 1 });
  expect(overview.coverage).toEqual({ available: 1, total: 1 });
  expect(overview.mistakes).toHaveLength(3);
  expect(overview.mistakes.every((q: any) => q.wrong === 1 && q.answered === 1)).toBe(true);
  const saved = await get(t, `/results/attempts/${low.id}?class_id=${c.id}`);
  expect(saved.results).toEqual(low.results);
  await attempt(s, true);
  expect((await get(t, '/results/overview')).mistakes).toEqual([]);
  expect(await get(t, '/results?focus=help')).toEqual([]);
  expect((await get(t, `/results/attempts/${low.id}?class_id=${c.id}`)).results).toEqual(
    saved.results,
  );
});

test('class, topic, name and queue filters match CSV and record failed microquestions as started', async ({
  browser,
}) => {
  const t = await actor(browser, 'Учитель фильтров', 'teacher'),
    s = await actor(browser, 'Кира'),
    other = await actor(browser, 'Марат');
  const c = await classroom(t, s),
    c2 = await classroom(t, other, '7 Б · Другой класс', second);
  await post(t, '/assignments', {
    class_id: c.id,
    season_id: second,
    due_at: '2099-01-01T12:00:00Z',
  });
  await attempt(s, false);
  await attempt(other, true, second);
  const query = new URLSearchParams({ class_id: c.id, season_id: seed, q: 'Кир', focus: 'help' });
  const list = await get(t, `/results?${query}`);
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe('Кира');
  const csv = await t.context.request.get(`/api/results.csv?${query}`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain('Кира');
  expect(text).not.toContain('Марат');
  expect(text).not.toContain('Другой класс');
  expect(text.split('\r\n')).toHaveLength(2);
  expect(text).toContain('Последний тест %;Предыдущий тест %;Лучший тест %');
  expect(await get(t, '/results?q=%25')).toHaveLength(0);
  expect((await t.context.request.get('/api/results?class_id=invalid')).status()).toBe(400);
  const fresh = await actor(browser, 'Ещё не начал');
  await post(fresh, '/classes/join', { code: c2.code });
  expect(
    (await get(t, `/results?class_id=${c2.id}&focus=not_started`)).map((r: any) => r.user_id),
  ).toEqual([fresh.id]);
  const micro = (
    await db.query(
      "SELECT id,episode_id,correct FROM questions WHERE season_id=$1 AND purpose='micro' ORDER BY position LIMIT 1",
      [second],
    )
  ).rows[0];
  await db.query(
    'INSERT INTO micro_answers(id,user_id,episode_id,question_id,answer,passed) VALUES($1,$2,$3,$4,$5,false)',
    [randomUUID(), fresh.id, micro.episode_id, micro.id, (micro.correct + 1) % 3],
  );
  expect(await get(t, `/results?class_id=${c2.id}&focus=not_started`)).toHaveLength(0);
  expect(
    (await get(t, `/results?class_id=${c2.id}&focus=awaiting_test`)).map((r: any) => r.user_id),
  ).toEqual([fresh.id]);
});

test('report detail enforces teacher, class membership and assignment access and handles old missing reviews', async ({
  browser,
  request,
}) => {
  const t = await actor(browser, 'Учитель доступа', 'teacher'),
    s = await actor(browser, 'Ученик доступа'),
    stranger = await actor(browser, 'Другой учитель', 'teacher');
  const c = await classroom(t, s);
  const a = await attempt(s, false);
  for (const endpoint of [
    '/results',
    '/results/overview',
    '/results.csv',
    `/results/attempts/${a.id}?class_id=${c.id}`,
  ]) {
    expect((await request.get('/api' + endpoint)).status()).toBe(401);
    expect((await s.context.request.get('/api' + endpoint)).status()).toBe(403);
  }
  expect(
    (await stranger.context.request.get(`/api/results/attempts/${a.id}?class_id=${c.id}`)).status(),
  ).toBe(404);
  expect(await get(stranger, `/results?class_id=${c.id}`)).toEqual([]);
  const q = await answers();
  const practice = await post(s, `/attempts/${a.id}/practice`, {
    answers: q.map((q) => q.correct),
  });
  expect(
    (await t.context.request.get(`/api/results/attempts/${practice.id}?class_id=${c.id}`)).status(),
  ).toBe(404);
  await db.query('DELETE FROM memberships WHERE class_id=$1 AND user_id=$2', [c.id, s.id]);
  expect(
    (await t.context.request.get(`/api/results/attempts/${a.id}?class_id=${c.id}`)).status(),
  ).toBe(404);
  await post(s, '/classes/join', { code: c.code });
  await db.query('DELETE FROM assignments WHERE class_id=$1', [c.id]);
  expect(
    (await t.context.request.get(`/api/results/attempts/${a.id}?class_id=${c.id}`)).status(),
  ).toBe(404);
  await post(t, '/assignments', {
    class_id: c.id,
    season_id: second,
    due_at: '2099-01-01T12:00:00Z',
  });
  const old = randomUUID();
  await db.query(
    "INSERT INTO attempts(id,user_id,season_id,answers,score,total,kind) VALUES($1,$2,$3,'[]',1,3,'legacy')",
    [old, s.id, second],
  );
  const overview = await get(t, '/results/overview');
  expect(overview.coverage).toEqual({ available: 0, total: 1 });
  expect(overview.rows[0].latest_score).toBe(33);
  expect(overview.mistakes).toEqual([]);
  expect((await get(t, `/results/attempts/${old}?class_id=${c.id}`)).results).toEqual([]);
});

test('teacher reviews the pending retelling from the queue and feedback persists for the student', async ({
  browser,
}) => {
  const t = await actor(browser, 'Учитель пересказа', 'teacher'),
    s = await actor(browser, 'Ученик пересказа');
  const c = await classroom(t, s);
  await classroom(t, s, 'Вторая группа пересказа');
  const recording = randomUUID();
  // No real child recording is used. The existing audio-flow test covers recording/playback.
  await db.query(
    "INSERT INTO retellings(id,user_id,season_id,media_path,mime_type,transcript) VALUES($1,$2,$3,'fixture-not-an-audio-file','audio/webm','Причины связаны с последствиями.')",
    [recording, s.id, seed],
  );
  expect((await get(t, '/results/overview')).counts.review).toBe(1);
  const page = await t.context.newPage();
  await page.goto(`/results?class_id=${c.id}&focus=review`);
  await page
    .locator('tbody')
    .getByRole('button', { name: 'Проверить пересказ', exact: true })
    .click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Ваша оценка, 0–100').fill('75');
  await modal
    .getByLabel('Что получилось и что повторить')
    .fill('Причины названы верно. Добавь конкретный пример последствия.');
  await modal.getByRole('button', { name: 'Сохранить отзыв', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Здесь пока нет работ' })).toBeVisible();
  await page.reload();
  expect((await get(t, '/results/overview')).counts.review).toBe(0);
  const stored = (
    await db.query('SELECT teacher_score,feedback,reviewed_by FROM retellings WHERE id=$1', [
      recording,
    ])
  ).rows[0];
  expect(stored).toMatchObject({ teacher_score: 75, reviewed_by: t.id });
  const studentPage = await s.context.newPage();
  await studentPage.goto('/profile');
  await expect(studentPage.locator('.retelling-card')).toContainText('75%');
  await expect(studentPage.locator('.retelling-card')).toContainText('Добавь конкретный пример');
});

test('teacher dashboard keeps filters and reviews after reload and works on a narrow phone in both languages', async ({
  browser,
}) => {
  const t = await actor(browser, 'Айгерим · проверка', 'teacher'),
    s = await actor(browser, 'Кира · тестовые данные');
  const c = await classroom(t, s);
  await attempt(s, true);
  const low = await attempt(s, false);
  const page = await t.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/results?class_id=${c.id}&season_id=${seed}`);
  await expect(page.locator('tbody')).toContainText('Предыдущий: 100%');
  await expect(page.locator('.common-mistake')).toHaveCount(3);
  expect((await page.locator('.common-mistake').first().boundingBox())!.width).toBeGreaterThan(220);
  await expect(page.getByRole('link', { name: 'Скачать CSV' })).toHaveAttribute(
    'href',
    `/api/results.csv?class_id=${c.id}&season_id=${seed}`,
  );
  await page.getByRole('button', { name: 'Ответы ученика', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(low.results[0].prompt);
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Ответ ученика:');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Разобрать ошибки', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Разобрать ошибки', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/teacher-report-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await page.locator('.common-mistake').first().boundingBox())!.width).toBeGreaterThan(220);
  await expect(page.locator('tbody')).toContainText('Кира');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/teacher-report-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Сменить язык', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сыныптың жағдайы' })).toBeVisible();
  await page.getByRole('button', { name: 'Оқушы жауаптары', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Оқушының жауабы:');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
