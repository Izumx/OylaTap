import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import 'dotenv/config';
import pg from 'pg';
import { hashPassword, tokenHash } from '../server/auth';

const baseURL = 'http://127.0.0.1:3100';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const seed = '10000000-0000-4000-8000-000000000001';
const users: string[] = [];
const contexts: BrowserContext[] = [];
let historicalDay = 0;
type Actor = { id: string; token: string; context: BrowserContext };

async function device(browser: Browser, token: string) {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: 'oylatap_session', value: token, url: baseURL }]);
  contexts.push(context);
  return context;
}

async function actor(browser: Browser, role: 'student' | 'teacher'): Promise<Actor> {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  // These fixtures bypass registration only; requests still use normal server auth.
  // The existing MVP suite separately covers account registration and roles.
  await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [
    id,
    'Проверка дневной сессии',
    `${id}@example.test`,
    hashPassword(randomUUID()),
    role,
  ]);
  users.push(id);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), id],
  );
  return { id, token, context: await device(browser, token) };
}

async function post(a: Actor, path: string, data: unknown = {}) {
  const response = await a.context.request.post(`/api${path}`, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function plan(a: Actor, suffix = '') {
  const response = await a.context.request.get(`/api/today${suffix}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function season(teacher: Actor, size = 5) {
  const id = randomUUID();
  const {
    rows: [media],
  } = await db.query(
    'SELECT media_path FROM episodes WHERE season_id=$1 ORDER BY position LIMIT 1',
    [seed],
  );
  // Reuse a playable file in fixtures; no generation, upload, or mutation of the file.
  await db.query(
    "INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility,source_name) VALUES($1,$2,'Проверка продолжения темы','Временная тема для проверки маршрута','kz-history','ru',7,'published','class','Тестовая фикстура')",
    [id, teacher.id],
  );
  const episodes: string[] = [];
  for (let i = 0; i < size; i++) {
    const episode = randomUUID();
    episodes.push(episode);
    await db.query(
      'INSERT INTO episodes(id,season_id,position,title,script,duration,media_path) VALUES($1,$2,$3,$4,$5,12,$6)',
      [
        episode,
        id,
        i,
        `Серия ${i + 1}`,
        'Причины и последствия помогают понять тему.',
        media.media_path,
      ],
    );
    await db.query(
      `INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id) VALUES($1,$2,$3,'Что помогает понять тему?','["Причины и последствия","Только дата"]',0,'Важно связать причины и последствия.',$4)`,
      [randomUUID(), id, i, episode],
    );
  }
  return { id, episodes };
}

async function classroom(teacher: Actor, student: Actor) {
  const c = await post(teacher, '/classes', { name: 'Класс дневной сессии' });
  await post(student, '/classes/join', { code: c.code });
  return c;
}

async function setTopic(teacher: Actor, classId: string, seasonId: string) {
  const result = await teacher.context.request.patch(`/api/classes/${classId}/topic`, {
    data: { season_id: seasonId },
  });
  expect(result.ok()).toBe(true);
}

async function finish(student: Actor, ids: string[]) {
  for (const id of ids) {
    await post(student, `/episodes/${id}/complete`);
    await post(student, `/episodes/${id}/check`, { answer: 0 });
  }
}

async function nextDay(student: Actor) {
  // Move only this fixture's stored daily key into the past. Server time, real users,
  // completions and answer dates are untouched; no test-only clock override is exposed.
  await db.query(
    "UPDATE daily_sessions SET session_date=DATE '2000-01-01'+$2::int WHERE user_id=$1 AND session_date=(now() AT TIME ZONE 'Asia/Qyzylorda')::date",
    [student.id, historicalDay++],
  );
}

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  for (const id of users) {
    await db.query('DELETE FROM seasons WHERE owner_id=$1', [id]);
    await db.query('DELETE FROM classrooms WHERE teacher_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
  await db.end();
});

test('daily portion stays fixed across concurrent requests, devices, reload and completed goals', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const topic = await season(teacher),
    c = await classroom(teacher, student);
  await setTopic(teacher, c.id, topic.id);
  const plans = await Promise.all(Array.from({ length: 5 }, () => plan(student)));
  for (const p of plans) expect(p.episode_ids).toEqual(topic.episodes.slice(0, 3));
  const {
    rows: [date],
  } = await db.query("SELECT (now() AT TIME ZONE 'Asia/Qyzylorda')::date::text date");
  expect(plans[0].session_date).toBe(date.date);
  const secondDevice = await device(browser, student.token);
  await finish(student, plans[0].episode_ids);
  const again = await (await secondDevice.request.get('/api/today')).json();
  expect(again.episode_ids).toEqual(plans[0].episode_ids);
  expect(again.session_complete).toBe(true);
  expect(again.next_episode.id).toBe(topic.episodes[3]);
  expect(
    (await db.query('SELECT count(*)::int n FROM daily_sessions WHERE user_id=$1', [student.id]))
      .rows[0].n,
  ).toBe(1);
  const page = await secondDevice.newPage();
  await page.goto('/');
  await expect(page.locator('.session-end')).toBeInViewport({ ratio: 0.95 });
  await expect(page.getByRole('heading', { name: 'Цель дня выполнена' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Продолжить тему сейчас' })).toHaveAttribute(
    'href',
    `/watch/${topic.id}?episode=3`,
  );
  await expect(page.locator('.tomorrow-topic')).toContainText('Серия 4');
  await page.reload();
  await expect(page.locator('.session-end')).toBeInViewport({ ratio: 0.95 });
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/daily-session-end-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.session-end')).toBeInViewport({ ratio: 0.95 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Продолжить тему сейчас' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('link', { name: 'Продолжить тему сейчас' })).toBeInViewport();
  await page.screenshot({ path: '.local/qa/daily-session-end-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Сменить язык' }).click();
  await expect(page.getByRole('heading', { name: 'Күндік мақсат орындалды' })).toBeVisible();
  await expect(page.locator('.tomorrow-topic')).toContainText('4-серия');
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/daily-session-end-kazakh.png' });
});

test('following days advance a five-episode topic, carry unfinished work and preserve teacher priority after completion', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const topic = await season(teacher),
    c = await classroom(teacher, student);
  await setTopic(teacher, c.id, topic.id);
  await finish(student, (await plan(student)).episode_ids);
  await nextDay(student);
  const second = await plan(student);
  expect(second.episode_ids).toEqual(topic.episodes.slice(3));
  expect(second.route_done).toBe(3);
  expect(second.goal).toBe(2);
  await finish(student, [topic.episodes[3]]);
  await nextDay(student);
  const third = await plan(student);
  expect(third.episode_ids).toEqual([topic.episodes[4]]);
  await finish(student, third.episode_ids);
  expect((await plan(student)).next_step).toBe('quiz');
  await nextDay(student);
  const review = await plan(student);
  expect(review.season_id).toBe(topic.id);
  expect(review.topic_source).toBe('class');
  expect(review.is_review).toBe(true);
  expect(review.route_done).toBe(5);
  expect(review.session_complete).toBe(true);
  expect(review.next_step).toBe('quiz');
});

test('watching and a correct answer are separate signals, and legacy progress is reused', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const topic = await season(teacher),
    c = await classroom(teacher, student);
  await setTopic(teacher, c.id, topic.id);
  await finish(student, [topic.episodes[0]]);
  await db.query("UPDATE micro_answers SET created_at=now()-interval '10 days' WHERE user_id=$1", [
    student.id,
  ]);
  await post(student, `/episodes/${topic.episodes[1]}/complete`);
  await post(student, `/episodes/${topic.episodes[2]}/check`, { answer: 0 });
  const p = await plan(student);
  expect(p.episode_ids).toEqual(topic.episodes.slice(1, 4));
  expect(p.correct_ids).toEqual([topic.episodes[2]]);
  expect(p.completed_ids).toEqual([]);
  expect(p.session_complete).toBe(false);
  expect(p.route_done).toBe(1);
  await post(student, `/episodes/${topic.episodes[2]}/complete`);
  expect((await plan(student)).completed_ids).toEqual([topic.episodes[2]]);
  await nextDay(student);
  expect((await plan(student)).episode_ids).toEqual([
    topic.episodes[1],
    topic.episodes[3],
    topic.episodes[4],
  ]);
});

test('submitted old assignments do not hide unfinished work; finishing does not replace the current portion today', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const topic = await season(teacher, 3),
    later = await season(teacher, 2);
  const c = await classroom(teacher, student);
  for (const [id, date] of [
    [seed, '2001-01-01T12:00:00Z'],
    [topic.id, '2099-01-01T12:00:00Z'],
    [later.id, '2099-01-02T12:00:00Z'],
  ])
    await post(teacher, '/assignments', { class_id: c.id, season_id: id, due_at: date });
  const seeded = await (await student.context.request.get(`/api/seasons/${seed}`)).json();
  for (const ep of seeded.episodes) await post(student, `/episodes/${ep.id}/complete`);
  await post(student, `/seasons/${seed}/attempts`, { answers: [0, 1, 0] });
  const active = await plan(student);
  expect(active.season_id).toBe(topic.id);
  expect(active.topic_source).toBe('assignment');
  expect(active.class_name).toBe(c.name);
  await finish(student, active.episode_ids);
  // Any submitted test counts as submission, not a claim of mastery.
  await post(student, `/seasons/${topic.id}/attempts`, { answers: [1, 1, 1] });
  expect((await plan(student)).season_id).toBe(topic.id);
  await nextDay(student);
  expect((await plan(student)).season_id).toBe(later.id);
});

test('explicit teacher changes override personal and frozen topics, modes stay separate, and revoked access is rechecked', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const first = await season(teacher),
    second = await season(teacher, 4);
  const preferences = await student.context.request.patch('/api/learning-preferences', {
    data: {
      current_season_id: seed,
      interests: [],
      reminder_enabled: false,
      reminder_time: '17:00',
    },
  });
  expect(preferences.ok()).toBe(true);
  expect((await plan(student)).topic_source).toBe('personal');
  const c = await classroom(teacher, student);
  await setTopic(teacher, c.id, first.id);
  expect((await plan(student)).season_id).toBe(first.id);
  expect((await plan(student, '?mode=free')).season_id).toBe(seed);
  await setTopic(teacher, c.id, second.id);
  expect((await plan(student)).season_id).toBe(second.id);
  await db.query('DELETE FROM memberships WHERE user_id=$1 AND class_id=$2', [student.id, c.id]);
  expect((await plan(student)).season_id).toBe(seed);
  expect((await student.context.request.get(`/api/seasons/${second.id}`)).status()).toBe(404);
});

test('daily UI resumes unfinished series, explains the source on a phone and keeps the early test available', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const topic = await season(teacher),
    c = await classroom(teacher, student);
  await setTopic(teacher, c.id, topic.id);
  const p = await plan(student);
  await finish(student, [p.episode_ids[0]]);
  const page = await student.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect
    .poll(() =>
      page.locator('.feed-scroll').evaluate((el) => Math.round(el.scrollTop / el.clientHeight)),
    )
    .toBe(1);
  await expect(page.locator('.feed-slide').nth(1).locator('.video-context')).toContainText(
    'От учителя',
  );
  await page.getByRole('button', { name: 'Проверить себя', exact: true }).click();
  await page.getByRole('button', { name: 'Пройти тест', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Проверь понимание' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.locator('.feed-scroll').evaluate((el) => {
    el.scrollTop = 3 * el.clientHeight;
  });
  await expect(page.getByRole('button', { name: 'Вернуться к сериям сессии' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к сериям сессии' }).click();
  await expect
    .poll(() =>
      page.locator('.feed-scroll').evaluate((el) => Math.round(el.scrollTop / el.clientHeight)),
    )
    .toBe(1);
  const video = page.locator('.feed-slide video').nth(1);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.15;
  });
  const question = page.getByRole('dialog', { name: 'Один вопрос — и дальше' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'A Причины и последствия' }).click();
  await question.getByRole('button', { name: 'Проверить', exact: true }).click();
  await question.getByRole('button', { name: 'Дальше по маршруту' }).click();
  await page.reload();
  await expect
    .poll(() =>
      page.locator('.feed-scroll').evaluate((el) => Math.round(el.scrollTop / el.clientHeight)),
    )
    .toBe(2);
  expect((await plan(student)).episode_ids).toEqual(p.episode_ids);
  expect(errors).toEqual([]);
});

test('returning to an open tab refreshes a new day or a changed teacher topic', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser, 'student');
  const first = await season(teacher),
    second = await season(teacher, 4);
  const c = await classroom(teacher, student);
  await setTopic(teacher, c.id, first.id);
  const initial = await plan(student);
  await finish(student, initial.episode_ids);
  const page = await student.context.newPage();
  await page.goto('/');
  await expect(page.locator('.session-end')).toBeInViewport({ ratio: 0.95 });
  await nextDay(student);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.feed-slide video')).toHaveCount(2);
  await expect(page.locator('.feed-slide video').first()).toHaveAttribute('aria-label', 'Серия 4');
  await setTopic(teacher, c.id, second.id);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.feed-slide video')).toHaveCount(3);
  await expect(page.locator('.feed-slide .subject-badge').first()).toHaveAttribute(
    'href',
    `/learn/${second.id}`,
  );
});
