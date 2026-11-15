import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { tokenHash } from '../server/auth';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const users: string[] = [],
  contexts: BrowserContext[] = [],
  seasons: string[] = [];
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
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  await context.addCookies([
    { name: 'oylatap_session', value: token, url: 'http://127.0.0.1:3100' },
  ]);
  contexts.push(context);
  return { id, context };
}
async function get(a: Actor, path: string) {
  const r = await a.context.request.get('/api' + path);
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  if (seasons.length) await db.query('DELETE FROM seasons WHERE id=ANY($1)', [seasons.splice(0)]);
  if (users.length) {
    await db.query('DELETE FROM classrooms WHERE teacher_id=ANY($1)', [users]);
    await db.query('DELETE FROM users WHERE id=ANY($1)', [users.splice(0)]);
  }
});
test.afterAll(async () => {
  await db.end();
});

test('migration adds hook tables, guest columns and new subjects', async ({ browser }) => {
  const cols = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE (table_name='seasons' AND column_name='kind') OR (table_name='users' AND column_name IN ('is_guest','last_seen_at'))`,
  );
  expect(cols.rows.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual([
    'seasons.kind',
    'users.is_guest',
    'users.last_seen_at',
  ]);
  const tables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name IN ('hook_runs','hook_guesses') ORDER BY table_name",
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(['hook_guesses', 'hook_runs']);
  const s = await actor(browser, 'Ученик');
  const physics = await get(s, '/curriculum?subject=physics');
  expect(physics.topics.length).toBeGreaterThan(0);
  expect(
    physics.topics.some((t: { title_ru: string }) => t.title_ru === 'Взаимодействие тел. Сила'),
  ).toBe(true);
});

async function hookSeason(ownerId: string, title = 'Почему мост не падает?') {
  const id = randomUUID(),
    episode = randomUUID();
  await db.query(
    `INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility,kind,topic_id,published_at)
     VALUES($1,$2,$3,'Загадка к уроку','physics','ru',7,'published','public','hook','40000000-0000-4000-8000-000000000901',now())`,
    [id, ownerId, title],
  );
  seasons.push(id);
  await db.query(
    "INSERT INTO episodes(id,season_id,position,title,script,duration,media_path,media_kind) VALUES($1,$2,0,$3,'Сценарий',27,'content/khanate-flow/oylatap-khanate-full-ru.mp4','uploaded')",
    [episode, id, title],
  );
  await db.query(
    `INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id,purpose)
     VALUES($1,$2,0,'Что не даёт мосту упасть?',$3,1,'Силы уравновешены.',$4,'hook')`,
    [randomUUID(), id, JSON.stringify(['Он тяжёлый', 'Силы уравновешены', 'Ветер']), episode],
  );
  return { id, episode };
}

test('published hook seasons stay out of catalog, today plan and recommendations', async ({
  browser,
}) => {
  const t = await actor(browser, 'Учитель', 'teacher');
  const s = await actor(browser, 'Ученик');
  const hook = await hookSeason(t.id);
  for (const path of ['/catalog', '/today', '/foryou']) {
    const body = JSON.stringify(await get(s, path));
    expect(body.includes(hook.id), path).toBe(false);
  }
});

async function post(a: Actor, path: string, data: unknown = {}) {
  const r = await a.context.request.post('/api' + path, { data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function status(a: Actor, method: 'get' | 'post', path: string, data: unknown = {}) {
  const r =
    method === 'get'
      ? await a.context.request.get('/api' + path)
      : await a.context.request.post('/api' + path, { data });
  return r.status();
}
async function hookClass(browser: Browser, studentNames = ['Айгерим', 'Данияр']) {
  const t = await actor(browser, 'Учитель', 'teacher');
  const students = [];
  for (const n of studentNames) students.push(await actor(browser, n));
  const c = await post(t, '/classes', { name: '7 А · Физика' });
  for (const s of students) await post(s, '/classes/join', { code: c.code });
  const hook = await hookSeason(t.id);
  const run = await post(t, `/classes/${c.id}/hook-runs`, {
    season_id: hook.id,
    lesson_at: '2099-01-01T10:00:00Z',
  });
  return { t, students, c, hook, run };
}

test('teacher launches a hook, students guess, votes stay hidden until the teacher shows them, reveal opens the answer', async ({
  browser,
}) => {
  const { t, students, c, hook, run } = await hookClass(browser);
  const [s1, s2] = students;
  expect(
    await status(t, 'post', `/classes/${c.id}/hook-runs`, {
      season_id: hook.id,
      lesson_at: '2099-01-01T10:00:00Z',
    }),
  ).toBe(409);
  await post(s1, `/hook-runs/${run.id}/guess`, {
    phase: 'before',
    answer: 1,
    confidence: 3,
    reason: 'Силы',
  });
  await post(s2, `/hook-runs/${run.id}/guess`, { phase: 'before', answer: 0, confidence: 1 });
  const mine = await get(s1, `/hook-runs/${run.id}`);
  expect(mine).not.toHaveProperty('correct');
  expect(mine).not.toHaveProperty('explanation');
  expect(mine).not.toHaveProperty('votes');
  expect(mine.answered).toBe(2);
  expect(mine.students).toBe(2);
  expect(mine.my_before.answer).toBe(1);
  expect(mine.revealed).toBe(false);
  let screen = await get(t, `/hook-runs/${run.id}/screen`);
  expect(screen.votes).toBeNull();
  expect(screen.correct).toBeNull();
  expect(screen.answered).toBe(2);
  screen = await post(t, `/hook-runs/${run.id}/show-votes`);
  expect(screen.votes).toEqual([1, 1, 0]);
  expect(screen.confident).toBe(1);
  expect(screen.correct).toBeNull();
  screen = await post(t, `/hook-runs/${run.id}/reveal`);
  expect(screen.correct).toBe(1);
  expect(screen.revealed).toBe(true);
  const after = await get(s1, `/hook-runs/${run.id}`);
  expect(after.revealed).toBe(true);
  expect(after.correct).toBe(1);
  expect(after.votes).toEqual([1, 1, 0]);
  expect(
    await status(s2, 'post', `/hook-runs/${run.id}/guess`, {
      phase: 'before',
      answer: 1,
      confidence: 2,
    }),
  ).toBe(409);
});

test('hook runs are private to the class', async ({ browser }) => {
  const { run } = await hookClass(browser, ['Айгерим']);
  const outsider = await actor(browser, 'Чужой ученик');
  const otherTeacher = await actor(browser, 'Чужой учитель', 'teacher');
  expect(await status(outsider, 'get', `/hook-runs/${run.id}`)).toBe(404);
  expect(
    await status(outsider, 'post', `/hook-runs/${run.id}/guess`, {
      phase: 'before',
      answer: 0,
      confidence: 2,
    }),
  ).toBe(404);
  for (const path of ['screen', 'results'])
    expect(await status(otherTeacher, 'get', `/hook-runs/${run.id}/${path}`)).toBe(404);
  for (const path of ['reveal', 'show-votes', 'restart'])
    expect(await status(otherTeacher, 'post', `/hook-runs/${run.id}/${path}`)).toBe(404);
  expect((await get(outsider, '/hook-runs')).length).toBe(0);
});

test('recheck maps shuffled options back and opens three days after reveal', async ({
  browser,
}) => {
  const { t, students, run } = await hookClass(browser, ['Айгерим']);
  const [s] = students;
  await post(s, `/hook-runs/${run.id}/guess`, { phase: 'before', answer: 0, confidence: 2 });
  await post(t, `/hook-runs/${run.id}/reveal`);
  const due = await db.query('SELECT recheck_at - revealed_at AS gap FROM hook_runs WHERE id=$1', [
    run.id,
  ]);
  expect(due.rows[0].gap.days).toBe(3);
  expect(
    await status(s, 'post', `/hook-runs/${run.id}/guess`, {
      phase: 'recheck',
      answer: 0,
      confidence: 2,
    }),
  ).toBe(409);
  await db.query("UPDATE hook_runs SET recheck_at=now()-interval '1 minute' WHERE id=$1", [run.id]);
  const open = await get(s, `/hook-runs/${run.id}`);
  expect(open.recheck_open).toBe(true);
  expect(open.recheck_options).not.toEqual(open.options);
  expect([...open.recheck_options].sort()).toEqual([...open.options].sort());
  const pick = open.recheck_options.indexOf(open.options[open.correct]);
  await post(s, `/hook-runs/${run.id}/guess`, { phase: 'recheck', answer: pick, confidence: 3 });
  const results = await get(t, `/hook-runs/${run.id}/results`);
  expect(results.students[0].recheck_answer).toBe(1);
  expect(results.summary.recheck_correct).toBe(1);
  expect(results.summary.before_correct).toBe(0);
});

test('restart clears guesses and reveal', async ({ browser }) => {
  const { t, students, run } = await hookClass(browser, ['Айгерим']);
  const [s] = students;
  await post(s, `/hook-runs/${run.id}/guess`, { phase: 'before', answer: 2, confidence: 1 });
  await post(t, `/hook-runs/${run.id}/reveal`);
  const screen = await post(t, `/hook-runs/${run.id}/restart`);
  expect(screen.answered).toBe(0);
  expect(screen.revealed).toBe(false);
  expect(screen.votes).toBeNull();
  await post(s, `/hook-runs/${run.id}/guess`, { phase: 'before', answer: 1, confidence: 3 });
});

test('empty class screen shows zeros', async ({ browser }) => {
  const { t, run } = await hookClass(browser, []);
  const screen = await get(t, `/hook-runs/${run.id}/screen`);
  expect(screen.answered).toBe(0);
  expect(screen.students).toBe(0);
  const results = await get(t, `/hook-runs/${run.id}/results`);
  expect(results.summary).toEqual({
    students: 0,
    watched: 0,
    answered: 0,
    before_correct: 0,
    recheck_answered: 0,
    recheck_correct: 0,
  });
  expect(results.students).toEqual([]);
});

async function guest(browser: Browser, code: string, name: string) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  contexts.push(context);
  const r = await context.request.post('/api/auth/guest', { data: { code, name } });
  expect(r.ok(), await r.text()).toBe(true);
  const me = (await (await context.request.get('/api/me')).json()).user;
  users.push(me.id);
  return { id: me.id as string, context, me };
}

test('guest joins a class by code and name and can place a bet', async ({ browser }) => {
  const { c, run } = await hookClass(browser, []);
  const g = await guest(browser, c.code, 'Айгерим');
  expect(g.me.role).toBe('student');
  expect(g.me.name).toBe('Айгерим');
  const runs = await get(g, '/hook-runs');
  expect(runs.map((r: { id: string }) => r.id)).toEqual([run.id]);
  await post(g, `/hook-runs/${run.id}/guess`, { phase: 'before', answer: 1, confidence: 2 });
  const bad = await g.context.request.post('/api/auth/guest', {
    data: { code: 'NOPE0000', name: 'Кто-то' },
  });
  expect(bad.status()).toBe(404);
});

test('stale guests are purged with their guesses', async ({ browser }) => {
  const { c, run, students } = await hookClass(browser, ['Обычный ученик']);
  const g = await guest(browser, c.code, 'Старый гость');
  await post(g, `/hook-runs/${run.id}/guess`, { phase: 'before', answer: 0, confidence: 2 });
  await db.query("UPDATE users SET last_seen_at=now()-interval '61 days' WHERE id=ANY($1)", [
    [g.id, students[0].id],
  ]);
  const { purgeGuests } = await import('../server/guests');
  expect(await purgeGuests()).toBeGreaterThanOrEqual(1);
  expect((await db.query('SELECT id FROM users WHERE id=$1', [g.id])).rowCount).toBe(0);
  expect((await db.query('SELECT 1 FROM hook_guesses WHERE user_id=$1', [g.id])).rowCount).toBe(0);
  expect((await db.query('SELECT id FROM users WHERE id=$1', [students[0].id])).rowCount).toBe(1);
});

test('thirty guests from one address can join', async ({ browser }) => {
  const { c } = await hookClass(browser, []);
  for (let i = 0; i < 30; i++) await guest(browser, c.code, `Гость ${i + 1}`);
  const n = await db.query('SELECT count(*)::int n FROM memberships WHERE class_id=$1', [c.id]);
  expect(n.rows[0].n).toBe(30);
});

test('guest joins from the invitation page with only a name', async ({ browser }) => {
  const { c } = await hookClass(browser, []);
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 390, height: 844 },
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/join/${c.code}`);
  await page.getByLabel('Твоё имя').fill('Айгерим');
  await page.getByRole('button', { name: 'Войти по имени' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
  const me = (await (await context.request.get('/api/me')).json()).user;
  users.push(me.id);
  expect(me.name).toBe('Айгерим');
});

test('teacher launches a hook from the class card in under a minute', async ({ browser }) => {
  const t = await actor(browser, 'Учитель', 'teacher');
  const c = await post(t, '/classes', { name: '7 Б · Загадки' });
  await hookSeason(t.id, 'Почему мост не падает? (UI)');
  const page = await t.context.newPage();
  await page.goto('/classes');
  const card = page.locator('.class-card', { hasText: '7 Б · Загадки' });
  await card.getByRole('button', { name: 'Загадка к уроку' }).click();
  const dialog = page.getByRole('dialog', { name: 'Загадка к уроку' });
  await dialog.getByRole('button', { name: /Почему мост не падает\? \(UI\)/ }).click();
  await dialog.getByLabel('Дата урока').fill('2099-03-02');
  await dialog.getByLabel('Время урока').fill('10:20');
  await dialog.getByRole('button', { name: 'Отправить классу' }).click();
  await expect(dialog).toBeHidden();
  const run = card.locator('.hook-run', { hasText: 'Почему мост не падает? (UI)' });
  await expect(run).toBeVisible();
  await expect(run.getByRole('link', { name: 'Экран класса' })).toBeVisible();
  await expect(run.getByRole('link', { name: 'Итоги' })).toBeVisible();
  const saved = await db.query('SELECT lesson_at FROM hook_runs WHERE class_id=$1', [c.id]);
  expect(saved.rowCount).toBe(1);
});

test('teacher sees results with names, confidence and reasons', async ({ browser }) => {
  const { t, students, c, run } = await hookClass(browser);
  await post(students[0], `/hook-runs/${run.id}/guess`, {
    phase: 'before',
    answer: 1,
    confidence: 3,
    reason: 'Силы тянут и толкают',
  });
  await post(students[1], `/hook-runs/${run.id}/guess`, {
    phase: 'before',
    answer: 0,
    confidence: 1,
  });
  const page = await t.context.newPage();
  await page.goto(`/classes/${c.id}/hooks/${run.id}`);
  await expect(page.getByText('Ответили 2 из 2')).toBeVisible();
  const row = page.locator('.hook-result-row', { hasText: 'Айгерим' });
  await expect(row).toContainText('уверен');
  await expect(row).toContainText('Силы тянут и толкают');
  await expect(page.locator('.hook-result-row', { hasText: 'Данияр' })).toContainText('наугад');
});

test('class screen updates answers live and reveals on click', async ({ browser }) => {
  const { t, students, c, run } = await hookClass(browser, ['Жансая Секретова']);
  const page = await t.context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/classes/${c.id}/hooks/${run.id}/screen`);
  await expect(page.getByRole('heading', { name: /мосту упасть/ })).toBeVisible();
  await expect(page.getByText('Ответили 0 из 1')).toBeVisible();
  await expect(page.locator('.screen-join')).toContainText(c.code);
  await expect(page.locator('.screen-join canvas, .screen-join img')).toBeVisible();
  await post(students[0], `/hook-runs/${run.id}/guess`, {
    phase: 'before',
    answer: 1,
    confidence: 3,
  });
  await expect(page.getByText('Ответили 1 из 1')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Показать голоса' }).click();
  await expect(page.locator('.screen-option').nth(1).locator('.screen-count')).toHaveText('1');
  await expect(page.getByText('уверенных: 1 из 1')).toBeVisible();
  await page.getByRole('button', { name: 'Раскрыть ответ' }).click();
  await expect(page.locator('.screen-option.correct')).toContainText('Силы уравновешены');
  await expect(page.getByRole('button', { name: 'Начать заново' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Жансая');
});

test('student bets before the lesson and sees the answer only after reveal', async ({ browser }) => {
  const { t, students, run } = await hookClass(browser, ['Асель']);
  const page = await students[0].context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/assignments');
  const card = page.locator('.hook-card');
  await expect(card).toContainText('Что не даёт мосту упасть?');
  await expect(card.locator('video')).toHaveCount(1);
  await card.getByRole('radio', { name: 'Силы уравновешены' }).check();
  await card.getByRole('radio', { name: 'уверен' }).check();
  await card.getByLabel('Почему? (необязательно)').fill('Тянут в разные стороны');
  await card.getByRole('button', { name: 'Поставить' }).click();
  await expect(card).toContainText('Ставка принята. Ответ — на уроке');
  await expect(page.locator('body')).not.toContainText('Силы уравновешены.');
  const saved = await db.query(
    "SELECT answer,confidence,reason FROM hook_guesses WHERE run_id=$1 AND phase='before'",
    [run.id],
  );
  expect(saved.rows).toEqual([{ answer: 1, confidence: 3, reason: 'Тянут в разные стороны' }]);
  await post(t, `/hook-runs/${run.id}/reveal`);
  await page.reload();
  await expect(card).toContainText('Ты угадал');
  await expect(card).toContainText('Силы уравновешены.');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
