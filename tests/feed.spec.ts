import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import 'dotenv/config';
import pg from 'pg';
import { hashPassword, tokenHash } from '../server/auth';

// Concept 3.0: the endless "For you" feed, authors people follow and soft breaks.
const baseURL = 'http://127.0.0.1:3100';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const seed = '10000000-0000-4000-8000-000000000001';
const users: string[] = [];
const contexts: BrowserContext[] = [];
type Actor = { id: string; context: BrowserContext };

async function actor(
  browser: Browser,
  role: 'student' | 'teacher' | 'creator',
  name = 'Проверка ленты',
): Promise<Actor> {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  // Grade 11 keeps these fixtures ahead of the grade 7 demo seasons in the ranking.
  await db.query(
    'INSERT INTO users(id,name,email,password_hash,role,grade) VALUES($1,$2,$3,$4,$5,11)',
    [id, name, `${id}@example.test`, hashPassword(randomUUID()), role],
  );
  users.push(id);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), id],
  );
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: 'oylatap_session', value: token, url: baseURL }]);
  contexts.push(context);
  return { id, context };
}
async function get(a: Actor | BrowserContext, path: string) {
  const r = await ('context' in a ? a.context : a).request.get('/api' + path);
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function post(a: Actor, path: string, data: unknown = {}) {
  const r = await a.context.request.post('/api' + path, { data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
// A published public season built from the demo MP4: no rendering, the file is not changed.
async function season(owner: Actor, title: string, size: number, status = 'published') {
  const id = randomUUID();
  const {
    rows: [media],
  } = await db.query(
    'SELECT media_path FROM episodes WHERE season_id=$1 ORDER BY position LIMIT 1',
    [seed],
  );
  await db.query(
    `INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility,source_name,published_at)
     VALUES($1,$2,$3,'Временная тема для проверки ленты','algebra','ru',11,$4,'public','Тестовая фикстура',now())`,
    [id, owner.id, title, status],
  );
  const episodes: string[] = [];
  for (let i = 0; i < size; i++) {
    const episode = randomUUID();
    episodes.push(episode);
    await db.query(
      'INSERT INTO episodes(id,season_id,position,title,script,duration,media_path) VALUES($1,$2,$3,$4,$5,12,$6)',
      [episode, id, i, `${title}: серия ${i + 1}`, 'Короткое объяснение.', media.media_path],
    );
    await db.query(
      `INSERT INTO questions(id,season_id,position,purpose,prompt,options,correct,explanation,episode_id)
       VALUES($1,$2,$3,'micro','Что главное?','["Идея","Ничего"]',0,'Главное — идея.',$4)`,
      [randomUUID(), id, i, episode],
    );
  }
  return { id, episodes };
}
// Walks the endless feed until the server has nothing new, as the client does.
async function walk(a: Actor) {
  const shown: string[] = [];
  const reasons = new Map<string, string>();
  for (let page = 0; page < 100; page++) {
    const batch = await post(a, '/foryou', { exclude: shown });
    if (batch.exhausted) {
      expect(batch.items).toEqual([]);
      return { shown, reasons };
    }
    expect(batch.items.length).toBeGreaterThan(0);
    expect(batch.items.length).toBeLessThanOrEqual(8);
    for (const item of batch.items) {
      shown.push(item.episode_id);
      reasons.set(item.episode_id, item.reason);
    }
  }
  throw new Error('The feed never reported that nothing new is left');
}

test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  for (const id of users) {
    await db.query('DELETE FROM seasons WHERE owner_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
  await db.end();
});

test('"For you" comes in batches without repeats, keeps series order and then offers a rewatch', async ({
  browser,
}) => {
  const author = await actor(browser, 'creator', 'Автор длинной серии'),
    student = await actor(browser, 'student');
  const long = await season(author, 'Длинная серия', 5);

  const { shown } = await walk(student);
  expect(new Set(shown).size).toBe(shown.length);
  // Every episode of the series appears exactly once, in order.
  const order = shown.filter((id) => long.episodes.includes(id));
  expect(order).toEqual(long.episodes);

  // Watched and understood: the series comes back only as a labelled rewatch.
  for (const id of long.episodes) {
    await post(student, `/episodes/${id}/complete`);
    await post(student, `/episodes/${id}/check`, { answer: 0 });
  }
  const again = await walk(student);
  expect(again.shown.filter((id) => long.episodes.includes(id))).toEqual(long.episodes);
  for (const id of long.episodes)
    expect(again.reasons.get(id)).toBe('Ещё раз: лучшее из просмотренного');
  // The list of shown episodes is bounded.
  const tooMany = await student.context.request.post('/api/foryou', {
    data: { exclude: Array.from({ length: 501 }, () => randomUUID()) },
  });
  expect(tooMany.status()).toBe(400);
});

test('learners follow authors one way, and followed authors rank first with a reason', async ({
  browser,
}) => {
  const author = await actor(browser, 'creator', 'Айгерим Геометрия'),
    other = await actor(browser, 'creator', 'Другой автор'),
    student = await actor(browser, 'student'),
    classmate = await actor(browser, 'student');
  const followed = await season(author, 'Тема любимого автора', 2);
  await season(author, 'Черновик автора', 1, 'draft');
  await season(other, 'Тема другого автора', 2);

  // Only people who publish have a page; learners and guests cannot be followed.
  expect((await student.context.request.get(`/api/authors/${classmate.id}`)).status()).toBe(404);
  const toLearner = await student.context.request.post(`/api/authors/${classmate.id}/follow`, {
    data: { following: true },
  });
  expect(toLearner.status()).toBe(404);
  const self = await author.context.request.post(`/api/authors/${author.id}/follow`, {
    data: { following: true },
  });
  expect(self.status()).toBe(400);
  const guest = await browser.newContext({ baseURL });
  contexts.push(guest);
  const anonymous = await guest.request.post(`/api/authors/${author.id}/follow`, {
    data: { following: true },
  });
  expect(anonymous.status()).toBe(401);

  expect(await post(student, `/authors/${author.id}/follow`, { following: true })).toEqual({
    following: true,
    followers: 1,
  });
  // Following twice does not count twice.
  await post(student, `/authors/${author.id}/follow`, { following: true });
  const page = await get(guest, `/authors/${author.id}`);
  expect(page).toMatchObject({ name: 'Айгерим Геометрия', followers: 1, following: false });
  expect(page.seasons.map((s: any) => s.title)).toEqual(['Тема любимого автора']);
  expect(page).not.toHaveProperty('email');

  const feed = await get(student, '/foryou');
  expect(feed.items[0].season_id).toBe(followed.id);
  expect(feed.items[0].reason).toBe('Автор, на которого ты подписан');
  expect((await get(student, `/seasons/${followed.id}`)).owner_followed).toBe(true);

  expect(await post(student, `/authors/${author.id}/follow`, { following: false })).toEqual({
    following: false,
    followers: 0,
  });
  const after = await get(student, '/foryou');
  expect(after.items.find((x: any) => x.season_id === followed.id)?.reason).not.toBe(
    'Автор, на которого ты подписан',
  );
});

test('the endless feed keeps loading, follows an author from a video and allows skipping the question', async ({
  browser,
}) => {
  const author = await actor(browser, 'creator', 'Нурлан Алгебра'),
    student = await actor(browser, 'student');
  await season(author, 'Бесконечная лента', 3);
  const page = await student.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.feed-tabs > button').first()).toHaveText('Для тебя');
  await expect(page.locator('.feed-tabs > button.active')).toHaveText('Для тебя');
  await expect(page.locator('.feed-session-label')).toContainText('Подобрано для тебя');

  // Following from the video marks every clip of the author.
  const slide = page.locator('.feed-slide', { hasText: 'Бесконечная лента' }).first();
  await expect(slide.locator('.creator')).toContainText('Нурлан Алгебра');
  await slide.getByRole('button', { name: 'Подписаться' }).click();
  await expect(slide.getByRole('button', { name: 'Вы подписаны' })).toBeVisible();
  const stored = await db.query('SELECT author_id FROM author_follows WHERE user_id=$1', [
    student.id,
  ]);
  expect(stored.rows).toEqual([{ author_id: author.id }]);

  // The question after a video can be skipped and moves on to the next clip.
  const position = () =>
    page.locator('.feed-scroll').evaluate((el) => Math.round(el.scrollTop / el.clientHeight));
  const at = await position();
  const video = page.locator('.feed-slide').nth(at).locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.15;
  });
  const question = page.getByRole('dialog', { name: 'Один вопрос — и дальше' });
  await question.getByRole('button', { name: 'Пропустить вопрос' }).click();
  await expect(question).toBeHidden();
  await expect.poll(position).toBe(at + 1);

  // Scrolling to the end brings more clips instead of a final screen.
  const before = await page.locator('.feed-slide video').count();
  await page.locator('.feed-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => page.locator('.feed-slide video').count()).toBeGreaterThan(before);
  await expect(page.locator('.session-end')).toHaveCount(0);

  // The author page opens from the video.
  await page.locator('.feed-scroll').evaluate((el) => el.scrollTo(0, 0));
  await page
    .locator('.feed-slide', { hasText: 'Бесконечная лента' })
    .first()
    .getByRole('link', { name: /Нурлан Алгебра/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Нурлан Алгебра' })).toBeVisible();
  await expect(page.locator('.author-stats')).toContainText('1 подписчик');
  await expect(page.getByRole('button', { name: 'Вы подписаны' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a soft break is offered between clips and never locks the feed', async ({ browser }) => {
  const author = await actor(browser, 'creator'),
    student = await actor(browser, 'student');
  await season(author, 'Перерыв', 3);
  const page = await student.context.newPage();
  // Shortens the 40-minute default for the test only.
  await page.addInitScript(() => localStorage.setItem('oylatap-break-after-seconds', '2'));
  await page.goto('/');
  await expect(page.locator('.feed-slide video').first()).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.getByRole('dialog', { name: 'Время для паузы' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Следующая серия', exact: true }).click();
  const pause = page.getByRole('dialog', { name: 'Время для паузы' });
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('link', { name: /На сегодня хватит/ })).toHaveAttribute(
    'href',
    '/progress',
  );
  await pause.getByRole('button', { name: 'Смотреть дальше' }).click();
  await expect(pause).toBeHidden();
  // The next clip plays again after the break is dismissed.
  const video = page.locator('.feed-slide video').nth(1);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
});
