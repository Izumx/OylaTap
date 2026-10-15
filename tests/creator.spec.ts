import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { hashPassword, tokenHash } from '../server/auth';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const baseURL = 'http://127.0.0.1:3000';
const created: string[] = [],
  contexts: BrowserContext[] = [];
// A test-only programme topic that is current in every school week, so the
// curriculum ranking does not depend on today's date.
const topicId = randomUUID();
type Actor = { id: string; context: BrowserContext };
async function actor(
  browser: Browser,
  role: 'student' | 'teacher' | 'creator',
  extra: { grade?: number; moderator?: boolean; name?: string } = {},
): Promise<Actor> {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO users(id,name,email,password_hash,role,grade,is_moderator) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      id,
      extra.name || 'Проверка автора',
      `${id}@example.test`,
      hashPassword(randomUUID()),
      role,
      extra.grade ?? 9,
      Boolean(extra.moderator),
    ],
  );
  created.push(id);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), id],
  );
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: 'oylatap_session', value: token, url: baseURL }]);
  contexts.push(context);
  return { id, context };
}
async function get(a: Actor, path: string) {
  const r = await a.context.request.get('/api' + path);
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function post(a: Actor, path: string, data: unknown = {}) {
  const r = await a.context.request.post('/api' + path, { data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
const lesson = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  description: 'Разбираем формулу квадрата разности на числах.',
  subject: 'algebra',
  language: 'ru',
  grade: 9,
  style: 'board',
  voice: 'none',
  topic_id: topicId,
  source_text: 'Материал автора',
  episodes: [
    {
      title: 'Квадрат разности',
      script:
        'Почему (a − b)² не равно a² − b²?\n`(a − b)² = a² − 2ab + b²`\nПроверим: (5 − 2)² = 9.',
    },
  ],
  questions: [
    {
      prompt: 'Чему равно (5 − 2)²?',
      options: ['9', '21', '3'],
      correct: 0,
      explanation: '(5 − 2)² = 3² = 9.',
    },
    {
      purpose: 'final',
      prompt: 'Раскройте скобки: (x − 3)²',
      options: ['x² − 9', 'x² − 6x + 9', 'x² + 9'],
      correct: 1,
      explanation: 'x² − 2·3·x + 3² = x² − 6x + 9.',
    },
  ],
  ...extra,
});
async function rendered(author: Actor, title: string, extra: Record<string, unknown> = {}) {
  const { id } = await post(author, '/seasons', lesson(title, extra));
  await post(author, `/seasons/${id}/render`);
  await expect
    .poll(async () => (await get(author, `/seasons/${id}`)).status, { timeout: 30000 })
    .toBe('review');
  return id as string;
}
const publish = (a: Actor, id: string) =>
  a.context.request.post(`/api/seasons/${id}/publish`, { data: { confirmed: true } });

test.beforeAll(async () => {
  await db.query(
    "INSERT INTO curriculum_topics(id,subject,grade,title_ru,title_kk,week_from,week_to) VALUES($1,'algebra',9,$2,$2,1,36)",
    [topicId, `Проверочная тема ${topicId.slice(0, 8)}`],
  );
});
test.afterAll(async () => {
  for (const c of contexts) await c.close();
  for (const id of created) {
    await db.query('DELETE FROM seasons WHERE owner_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
  await db.query('DELETE FROM curriculum_topics WHERE id=$1', [topicId]);
  await db.end();
});

test('author content passes rules and a moderator before the shared feed; trust grows after approvals', async ({
  browser,
}) => {
  const author = await actor(browser, 'creator'),
    moderator = await actor(browser, 'teacher', { moderator: true }),
    student = await actor(browser, 'student');

  // Profanity is rejected before a moderator spends time on it.
  const rude = await post(author, '/seasons', {
    ...lesson('Грубый ролик'),
    episodes: [
      { title: 'Серия', script: 'Это блядь очень просто, смотри внимательно на формулу.' },
    ],
  });
  const refused = await publish(author, rude.id);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain('Нецензурная лексика');

  const id = await rendered(author, 'Квадрат разности');
  const sent = await (await publish(author, id)).json();
  expect(sent.status).toBe('moderation');
  expect((await get(student, '/catalog')).some((s: any) => s.id === id)).toBe(false);
  expect((await student.context.request.get(`/api/seasons/${id}`)).status()).toBe(404);

  // Only moderators see the queue; they inspect answers that learners never receive early.
  expect((await author.context.request.get('/api/moderation/queue')).status()).toBe(403);
  expect((await get(moderator, '/moderation/queue')).some((s: any) => s.id === id)).toBe(true);
  const inspected = await get(moderator, `/seasons/${id}`);
  expect(inspected.questions.every((q: any) => typeof q.correct === 'number')).toBe(true);

  const noNote = await moderator.context.request.post(`/api/moderation/${id}/decision`, {
    data: { decision: 'reject' },
  });
  expect(noNote.status()).toBe(400);
  await post(moderator, `/moderation/${id}/decision`, {
    decision: 'reject',
    note: 'В серии 1 уточните, что a и b — любые числа.',
  });
  const returned = await get(author, `/seasons/${id}`);
  expect(returned.status).toBe('rejected');
  expect(returned.moderation_note).toContain('уточните');
  expect((await publish(author, id)).ok()).toBe(true);
  await post(moderator, `/moderation/${id}/decision`, { decision: 'approve' });

  // Published and tied to the programme: a learner of that grade gets it with a reason.
  expect((await get(student, '/catalog')).some((s: any) => s.id === id)).toBe(true);
  const feed = await get(student, '/foryou');
  const item = feed.items.find((x: any) => x.season_id === id);
  expect(item.reason).toContain('Сейчас по программе 9 класса');
  expect((await get(student, `/seasons/${id}`)).owner_name).toBe('Проверка автора');

  // Three approved seasons without upheld complaints: the next one skips the queue.
  for (const title of ['Второй ролик', 'Третий ролик']) {
    const next = await rendered(author, title);
    await publish(author, next);
    await post(moderator, `/moderation/${next}/decision`, { decision: 'approve' });
  }
  expect((await get(author, '/me')).user.trust_level).toBe('trusted');
  const fourth = await rendered(author, 'Четвёртый ролик');
  expect((await (await publish(author, fourth)).json()).status).toBe('published');
  // Rule warnings still send a trusted author's work to a person.
  const linked = await rendered(author, 'Ролик со ссылкой', {
    description: 'Подробности на example.com — разбираем формулу.',
  });
  const flagged = await (await publish(author, linked)).json();
  expect(flagged.status).toBe('moderation');
  expect(flagged.flags.map((f: any) => f.code)).toContain('link');
});

test('complaints hide a season from the shared feed until a moderator decides', async ({
  browser,
}) => {
  const author = await actor(browser, 'creator'),
    moderator = await actor(browser, 'teacher', { moderator: true }),
    students = [
      await actor(browser, 'student'),
      await actor(browser, 'student'),
      await actor(browser, 'student'),
    ],
    viewer = await actor(browser, 'student');
  await db.query("UPDATE users SET trust_level='trusted' WHERE id=$1", [author.id]);
  const id = await rendered(author, 'Ролик для жалоб');
  expect((await (await publish(author, id)).json()).status).toBe('published');
  const own = await author.context.request.post(`/api/seasons/${id}/report`, {
    data: { reason: 'mistake' },
  });
  expect(own.status()).toBe(400);

  const report = async () => {
    for (const s of students)
      await post(s, `/seasons/${id}/report`, { reason: 'mistake', comment: 'Знак перепутан' });
  };
  await report();
  expect((await get(viewer, '/catalog')).some((s: any) => s.id === id)).toBe(false);
  expect((await get(author, '/my-seasons')).find((s: any) => s.id === id).hidden).toBe(true);
  const queued = (await get(moderator, '/moderation/queue')).find((s: any) => s.id === id);
  expect(queued.reports).toHaveLength(3);

  await post(moderator, `/moderation/${id}/decision`, { decision: 'restore' });
  expect((await get(viewer, '/catalog')).some((s: any) => s.id === id)).toBe(true);

  // Repeated complaints that a moderator upholds unpublish and reset the author's trust.
  await report();
  await post(moderator, `/moderation/${id}/decision`, {
    decision: 'unpublish',
    note: 'Во второй строке перепутан знак.',
  });
  expect((await get(author, `/seasons/${id}`)).status).toBe('rejected');
  expect((await get(author, '/me')).user.trust_level).toBe('new');
});

test('watching, likes and first answers feed author statistics', async ({ browser }) => {
  const author = await actor(browser, 'creator'),
    student = await actor(browser, 'student');
  await db.query("UPDATE users SET trust_level='trusted' WHERE id=$1", [author.id]);
  const id = await rendered(author, 'Ролик для статистики');
  await publish(author, id);
  const episode = (await get(student, `/seasons/${id}`)).episodes[0].id;
  await post(student, `/episodes/${episode}/view`, { ratio: 1 });
  await post(student, `/episodes/${episode}/view`, { ratio: 0.3 });
  expect((await post(student, `/episodes/${episode}/like`, { liked: true })).likes).toBe(1);
  // The first answer was wrong; a later correct retry does not count as understanding.
  await post(student, `/episodes/${episode}/check`, { answer: 1 });
  await post(student, `/episodes/${episode}/check`, { answer: 0 });
  const stats = (await get(author, '/studio/stats')).seasons.find((s: any) => s.season_id === id);
  expect(stats).toMatchObject({
    viewers: 1,
    likes: 1,
    completion_rate: 100,
    understanding_rate: 0,
  });
  const styles = await get(author, '/insights/styles');
  expect(styles.styles.map((s: any) => s.style).sort()).toEqual(['board', 'captions', 'cards']);
  expect((await student.context.request.get('/api/studio/stats')).status()).toBe(403);
});

test("the author's own narration sets the timing and is muxed into the video", async ({
  browser,
}) => {
  const author = await actor(browser, 'creator');
  const { id } = await post(author, '/seasons', lesson('Ролик с голосом', { voice: 'own' }));
  await post(author, `/seasons/${id}/render`);
  await expect
    .poll(async () => (await get(author, `/seasons/${id}`)).render_error, { timeout: 30000 })
    .toContain('Запишите голос для серии 1');

  await mkdir('test-results', { recursive: true });
  const wav = `test-results/voice-${id}.wav`;
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:duration=5',
    wav,
  ]);
  const episode = (await get(author, `/seasons/${id}`)).episodes[0].id;
  const uploaded = await author.context.request.post(
    `/api/seasons/${id}/episodes/${episode}/voice`,
    {
      multipart: {
        file: { name: 'voice.wav', mimeType: 'audio/wav', buffer: await readFile(wav) },
      },
    },
  );
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  await post(author, `/seasons/${id}/render`);
  await expect
    .poll(async () => (await get(author, `/seasons/${id}`)).status, { timeout: 30000 })
    .toBe('review');
  const media = (await db.query('SELECT media_path FROM episodes WHERE id=$1', [episode])).rows[0]
    .media_path;
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      media,
    ]).toString(),
  );
  expect(probe.streams.map((s: any) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Math.abs(Number(probe.format.duration) - 5)).toBeLessThan(0.6);
});

test('an author signs up in the browser and a learner meets the video in "For you"', async ({
  browser,
  page,
}) => {
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Войти или попробовать демо' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Я автор' }).click();
  await d.getByRole('button', { name: 'Первый раз здесь? Создать аккаунт' }).click();
  await d.getByLabel('Как тебя зовут?').fill('Асель Физмат');
  await d.getByLabel('Email').fill(`${randomUUID()}@example.test`);
  await d.getByLabel('Пароль').fill('test-only-password-123');
  await d.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByText('СТУДИЯ АВТОРА')).toBeVisible();
  const me = (await (await page.request.get('/api/me')).json()).user;
  created.push(me.id);
  expect(me.role).toBe('creator');
  await expect(page.getByText('Вы новый автор')).toBeVisible();
  await page.goto('/studio/new');
  await page.getByLabel('Предмет').selectOption('algebra');
  await page.getByRole('combobox', { name: /^Класс/ }).selectOption('9');
  await expect(
    page.getByLabel('Тема школьной программы').locator('option', { hasText: 'Проверочная тема' }),
  ).toHaveCount(1);

  // A trusted author's lesson reaches a 9th-grader through the personal selection.
  const author = await actor(browser, 'creator', { name: 'Ерлан Алгебра' });
  await db.query("UPDATE users SET trust_level='trusted' WHERE id=$1", [author.id]);
  const id = await rendered(author, 'Ролик для ленты');
  await publish(author, id);
  const student = await actor(browser, 'student');
  const learner = await student.context.newPage();
  await learner.goto('/');
  await learner.getByRole('button', { name: 'Для тебя' }).click();
  await expect(learner.locator('.feed-session-label')).toContainText('Подобрано для тебя');
  const slide = learner.locator('.feed-slide', { hasText: 'Ролик для ленты' }).first();
  await slide.scrollIntoViewIfNeeded();
  await expect(slide.locator('.video-context')).toContainText('Сейчас по программе 9 класса');
  await expect(slide.locator('.creator')).toContainText('Ерлан Алгебра');
  await slide.getByRole('button', { name: 'Сообщить об ошибке' }).click();
  const r = learner.getByRole('dialog');
  await r.getByRole('button', { name: 'Ошибка в объяснении' }).click();
  await r.getByRole('button', { name: 'Отправить' }).click();
  await expect(learner.getByRole('status')).toContainText('Модератор проверит');
  const stored = await db.query('SELECT reason FROM content_reports WHERE season_id=$1', [id]);
  expect(stored.rows).toEqual([{ reason: 'mistake' }]);
});
