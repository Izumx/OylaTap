import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import 'dotenv/config';
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { hashPassword, tokenHash } from '../server/auth';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const baseURL = 'http://127.0.0.1:3100';
const seed = '10000000-0000-4000-8000-000000000001';
const created: string[] = [],
  contexts: BrowserContext[] = [];
type Actor = { id: string; context: BrowserContext };
async function actor(browser: Browser, role: 'student' | 'teacher' = 'student'): Promise<Actor> {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [
    id,
    'Проверка истории',
    `${id}@example.test`,
    hashPassword(randomUUID()),
    role,
  ]);
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
async function linked(browser: Browser) {
  const teacher = await actor(browser, 'teacher'),
    student = await actor(browser);
  const c = await post(teacher, '/classes', { name: 'Класс истории попыток' });
  await post(student, '/classes/join', { code: c.code });
  return { teacher, student, c };
}
async function topic(teacher: Actor, student: Actor, c: { id: string }, withFinal = true) {
  const id = randomUUID(),
    episode = randomUUID();
  const media = (
    await db.query('SELECT media_path FROM episodes WHERE season_id=$1 ORDER BY position LIMIT 1', [
      seed,
    ])
  ).rows[0].media_path;
  await db.query(
    "INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility) VALUES($1,$2,'История проверочного события','Проверка сохранения причин и последствий','kz-history','ru',7,'published','class')",
    [id, teacher.id],
  );
  await db.query(
    "INSERT INTO episodes(id,season_id,position,title,script,duration,media_path) VALUES($1,$2,0,'Причины и последствия','Событие имеет причины и последствия.',12,$3)",
    [episode, id, media],
  );
  const questions = [
    { purpose: 'micro', prompt: 'Что объясняет событие?', correct: 0 },
    { purpose: 'final', prompt: 'Как связать событие и изменения?', correct: 1 },
    { purpose: 'final', prompt: 'Как обосновать свой вывод?', correct: 0 },
  ].slice(0, withFinal ? 3 : 1);
  const ids = [];
  for (const [position, q] of questions.entries()) {
    const qid = randomUUID();
    ids.push(qid);
    await db.query(
      `INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id,purpose) VALUES($1,$2,$3,$4,'["Причина","Следствие"]',$5,'Связь событий помогает объяснить изменения.',$6,$7)`,
      [qid, id, position, q.prompt, q.correct, episode, q.purpose],
    );
  }
  await post(teacher, '/assignments', {
    class_id: c.id,
    season_id: id,
    due_at: '2099-01-01T12:00:00Z',
  });
  return { id, episode, questions: ids };
}
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  for (const id of created) {
    await db.query('DELETE FROM seasons WHERE owner_id=$1', [id]);
    await db.query('DELETE FROM classrooms WHERE teacher_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
  await db.end();
});

test('final questions are separate from microquestions and invalid answers never create attempts', async ({
  browser,
}) => {
  const a = await actor(browser);
  const season = await get(a, `/seasons/${seed}`);
  expect(season.quiz_mode).toBe('final');
  expect(season.questions).toHaveLength(3);
  for (const ep of season.episodes) {
    const micro = await get(a, `/episodes/${ep.id}/micro`);
    expect(season.questions.some((q: { id: string }) => q.id === micro.id)).toBe(false);
    expect(micro).not.toHaveProperty('correct');
    expect(micro).not.toHaveProperty('explanation');
  }
  for (const q of season.questions) {
    expect(q.purpose).toBe('final');
    expect(q).not.toHaveProperty('correct');
    expect(q).not.toHaveProperty('explanation');
  }
  for (const answers of [[0], [0, 1, 4], [0, 1, 5], [-1, 1, 0]])
    expect(
      (
        await a.context.request.post(`/api/seasons/${seed}/attempts`, { data: { answers } })
      ).status(),
    ).toBe(400);
  expect((await get(a, '/attempts')).attempts).toHaveLength(0);
  const result = await post(a, `/seasons/${seed}/attempts`, { answers: [0, 1, 0] });
  expect(result).toMatchObject({
    kind: 'final',
    score: 3,
    total: 3,
    snapshot_source: 'captured',
    review_available: true,
  });
  expect(result.results[1].episode_title).toBe('Новое начало в Жетысу');
  expect((await a.context.request.get(`/api/attempts/${result.id}/practice`)).status()).toBe(409);
});

test('student reopens a saved review, practises only mistakes, and sees honest latest/best progress', async ({
  browser,
}) => {
  const { teacher, student, c } = await linked(browser);
  await post(teacher, '/assignments', {
    class_id: c.id,
    season_id: seed,
    due_at: '2099-01-01T12:00:00Z',
  });
  const first = await post(student, `/seasons/${seed}/attempts`, { answers: [0, 0, 1] });
  const page = await student.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/learn/${seed}`);
  await page.getByRole('link', { name: 'Разобрать последнюю попытку' }).click();
  await expect(page.locator('.saved-score')).toContainText('1 из 3');
  await page.reload();
  await expect(page.locator('.saved-review .wrong')).toHaveCount(2);
  await expect(
    page.getByRole('link', { name: 'Повторить серию: Новое начало в Жетысу' }),
  ).toHaveAttribute('href', `/watch/${seed}?episode=1`);
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/saved-review-desktop.png', fullPage: true });
  await page.screenshot({ path: '.local/qa/saved-review-overview.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/saved-review-mobile.png', fullPage: true });
  const practice = await get(student, `/attempts/${first.id}/practice`);
  const beforePracticeProgress = await get(student, '/progress');
  expect(practice.questions).toHaveLength(2);
  expect(practice.questions[0]).not.toHaveProperty('correct');
  expect(practice.questions[0]).not.toHaveProperty('explanation');
  await page.getByRole('link', { name: 'Повторить ошибки (2)' }).click();
  await expect(page.getByRole('heading', { name: 'Повторение ошибок', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'B Земли дали условия для нового объединения' }).click();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await page
    .getByRole('button', { name: 'A Связать причины переселения и последующее объединение' })
    .click();
  await page.getByRole('button', { name: 'Проверить упражнение' }).click();
  await expect(page.locator('.saved-score')).toContainText('2 из 2');
  await expect(page.locator('.saved-result')).toContainText('Балл итогового теста не изменился');
  let progress = await get(student, '/progress');
  expect(progress.stats).toMatchObject({ tests: 1, practices: 1, latest_test_average: 33 });
  expect(progress.stats.xp).toBe(beforePracticeProgress.stats.xp);
  expect(progress.seasons.find((s: { id: string }) => s.id === seed)).toMatchObject({
    last_score: 33,
    best_score: 33,
  });
  expect((await get(teacher, '/results'))[0].test_score).toBe(33);
  await post(student, `/seasons/${seed}/attempts`, { answers: [0, 1, 0] });
  progress = await get(student, '/progress');
  expect(progress.stats).toMatchObject({ tests: 2, practices: 1, latest_test_average: 100 });
  expect(progress.seasons[0]).toMatchObject({
    last_score: 100,
    best_score: 100,
    previous_score: 33,
  });
  await page.goto('/progress');
  await expect(page.locator('.stat-card').nth(3)).toContainText('100%');
  await expect(page.locator('.score-trend')).toContainText('Изменение: +67 п.п.');
  await page.getByRole('link', { name: 'История тестов', exact: true }).click();
  await expect(page.locator('.attempt-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Сменить язык', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Тесттер тарихы', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/attempt-history-kazakh.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('saved questions and practice remain immutable when source questions are edited or removed', async ({
  browser,
}) => {
  const { teacher, student, c } = await linked(browser);
  const s = await topic(teacher, student, c);
  const before = await post(student, `/seasons/${s.id}/attempts`, { answers: [0, 0] });
  expect(before.score).toBe(1);
  await db.query(
    "UPDATE questions SET prompt='Другой изменённый вопрос',correct=0,explanation='Другая версия объяснения' WHERE id=$1",
    [s.questions[1]],
  );
  await db.query('DELETE FROM questions WHERE id=$1', [s.questions[2]]);
  const after = await get(student, `/attempts/${before.id}`);
  expect(after.results).toEqual(before.results);
  const repeated = await post(student, `/attempts/${before.id}/practice`, { answers: [1] });
  expect(repeated).toMatchObject({
    kind: 'practice',
    score: 1,
    total: 1,
    parent_attempt_id: before.id,
  });
  expect((await get(student, `/attempts/${before.id}`)).score).toBe(1);
});

test('history and practice enforce ownership, fresh season access and private cursor access', async ({
  browser,
}) => {
  const { teacher, student, c } = await linked(browser);
  const s = await topic(teacher, student, c);
  const other = await actor(browser);
  const attempt = await post(student, `/seasons/${s.id}/attempts`, { answers: [0, 1] });
  for (const outsider of [other, teacher]) {
    for (const suffix of ['', '/practice'])
      expect(
        (await outsider.context.request.get(`/api/attempts/${attempt.id}${suffix}`)).status(),
      ).toBe(404);
    expect(
      (
        await outsider.context.request.post(`/api/attempts/${attempt.id}/practice`, {
          data: { answers: [1, 0] },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await outsider.context.request.get(`/api/attempts?before=${attempt.id}`)).status(),
    ).toBe(404);
  }
  const guest = await browser.newContext({ baseURL });
  contexts.push(guest);
  expect((await guest.request.get('/api/attempts')).status()).toBe(401);
  await db.query('DELETE FROM memberships WHERE user_id=$1 AND class_id=$2', [student.id, c.id]);
  expect((await student.context.request.get(`/api/attempts/${attempt.id}`)).status()).toBe(404);
  expect(
    (
      await student.context.request.post(`/api/attempts/${attempt.id}/practice`, {
        data: { answers: [1, 0] },
      })
    ).status(),
  ).toBe(404);
  expect((await get(student, '/attempts')).attempts).toHaveLength(0);
});

test('publication requires different micro and final questions, and editor settings survive save', async ({
  browser,
}) => {
  const teacher = await actor(browser, 'teacher');
  const body = {
    title: 'Раздельные вопросы',
    description: 'Проверяем причины и следствия отдельно от просмотра.',
    subject: 'kz-history',
    language: 'ru',
    grade: 7,
    source_text: 'Причины помогают объяснить событие.',
    episodes: [
      {
        id: undefined as string | undefined,
        title: 'Причины и следствия',
        script: 'Изменения имеют причины и последующие последствия.',
      },
    ],
    questions: [
      {
        purpose: 'micro',
        prompt: 'Что помогает объяснить событие?',
        options: ['Причина', 'Цвет'],
        correct: 0,
        explanation: 'Причина помогает объяснить событие.',
        episode_position: 0,
      },
    ],
  };
  const s = await post(teacher, '/seasons', body);
  const saved = await get(teacher, `/seasons/${s.id}`);
  body.episodes[0].id = saved.episodes[0].id;
  const media = (
    await db.query('SELECT media_path FROM episodes WHERE season_id=$1 ORDER BY position LIMIT 1', [
      seed,
    ])
  ).rows[0].media_path;
  await db.query('UPDATE episodes SET media_path=$2 WHERE season_id=$1', [s.id, media]);
  const publish = () =>
    teacher.context.request.post(`/api/seasons/${s.id}/publish`, { data: { confirmed: true } });
  expect((await publish()).status()).toBe(400);
  body.questions.push({ ...body.questions[0], purpose: 'final' });
  expect((await teacher.context.request.put(`/api/seasons/${s.id}`, { data: body })).ok()).toBe(
    true,
  );
  expect((await publish()).status()).toBe(400);
  body.questions[1].prompt = 'Как обосновать причину изменения?';
  expect((await teacher.context.request.put(`/api/seasons/${s.id}`, { data: body })).ok()).toBe(
    true,
  );
  const roundtrip = await get(teacher, `/seasons/${s.id}`);
  expect(roundtrip.questions.map((q: { purpose: string }) => q.purpose)).toEqual([
    'micro',
    'final',
  ]);
  const page = await teacher.context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/studio/${s.id}`);
  await page.getByRole('button', { name: '2 Сценарий и тест', exact: true }).click();
  await expect(page.locator('.question-editor')).toHaveCount(2);
  await expect(page.getByLabel('Назначение вопроса').nth(0)).toHaveValue('micro');
  await expect(page.getByLabel('Назначение вопроса').nth(1)).toHaveValue('final');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/question-types-editor-mobile.png', fullPage: true });
  expect((await publish()).status()).toBe(200);
});

test('history pagination preserves attempts with equal microsecond timestamps and filters topics', async ({
  browser,
}) => {
  const a = await actor(browser);
  for (let i = 0; i < 22; i++) await post(a, `/seasons/${seed}/attempts`, { answers: [0, 1, 0] });
  await post(a, '/seasons/10000000-0000-4000-8000-000000000003/attempts', { answers: [0, 1, 1] });
  await db.query("UPDATE attempts SET created_at='2026-10-15T10:00:00.123456Z' WHERE user_id=$1", [
    a.id,
  ]);
  const first = await get(a, '/attempts');
  expect(first.attempts).toHaveLength(20);
  expect(first.next_cursor).toBeTruthy();
  const second = await get(a, `/attempts?before=${first.next_cursor}`);
  expect(second.attempts).toHaveLength(3);
  expect(second.next_cursor).toBeNull();
  expect(new Set([...first.attempts, ...second.attempts].map((x) => x.id)).size).toBe(23);
  const filtered = await get(a, `/attempts?season_id=${seed}`);
  const filteredNext = await get(a, `/attempts?season_id=${seed}&before=${filtered.next_cursor}`);
  expect(filteredNext.attempts).toHaveLength(2);
  expect((await get(a, '/progress')).stats.latest_test_average).toBe(50);
});

test('old scores stay visible without invented reviews and separate finals replace legacy aggregates', async ({
  browser,
}) => {
  const { teacher, student, c } = await linked(browser);
  const s = await topic(teacher, student, c, false);
  expect((await get(student, `/seasons/${s.id}`)).quiz_mode).toBe('legacy');
  const oldId = randomUUID();
  await db.query(
    "INSERT INTO attempts(id,user_id,season_id,answers,score,total,kind,created_at) VALUES($1,$2,$3,'[0]',1,1,'legacy',now()-interval '1 day')",
    [oldId, student.id, s.id],
  );
  const old = await get(student, `/attempts/${oldId}`);
  expect(old).toMatchObject({ score: 1, total: 1, review_available: false, results: [] });
  expect((await student.context.request.get(`/api/attempts/${oldId}/practice`)).status()).toBe(409);
  const page = await student.context.newPage();
  await page.goto(`/attempts/${oldId}`);
  await expect(page.getByRole('heading', { name: 'Подробный разбор не сохранился' })).toBeVisible();
  await db.query(
    `INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id,purpose) VALUES($1,$2,1,'Как объяснить связь событий?','["Связать причины","Только запомнить дату"]',0,'Связь причин помогает объяснить событие.',$3,'final')`,
    [randomUUID(), s.id, s.episode],
  );
  await post(student, `/seasons/${s.id}/attempts`, { answers: [1] });
  const p = await get(student, '/progress');
  expect(p.seasons[0]).toMatchObject({ last_score: 0, best_score: 0 });
  expect(p.stats.latest_test_average).toBe(0);
  expect(p.stats.xp).toBe(10);
  expect((await get(student, `/attempts?season_id=${s.id}`)).attempts).toHaveLength(2);
});
