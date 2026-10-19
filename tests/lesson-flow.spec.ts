import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import 'dotenv/config';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const seed = '10000000-0000-4000-8000-000000000001';
const users: string[] = [];
const seasons: string[] = [];
async function student(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: 'Ученик маршрута',
      email: `${randomUUID()}@example.test`,
      password: 'test-only-password-123',
      role: 'student',
      grade: 7,
    },
  });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  users.push(user.id);
  return user;
}
async function finishVideo(page: Page, index = 0) {
  const video = page.locator('.feed-slide video').nth(index);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.1;
  });
  const micro = page.getByRole('dialog', { name: 'Один вопрос — и дальше' });
  await expect(micro).toBeVisible();
  return micro;
}
test.afterAll(async () => {
  for (const id of seasons) await db.query('DELETE FROM seasons WHERE id=$1', [id]);
  for (const id of users) await db.query('DELETE FROM users WHERE id=$1', [id]);
  await db.end();
});

test('video covers use real JPEGs, remain private and fall back to illustration on failure', async ({
  page,
  request,
}) => {
  const catalog = await (await request.get('/api/catalog')).json();
  const topic = catalog.find((s: any) => s.id === seed);
  expect(topic.cover_episode_id).toBeTruthy();
  const poster = await request.get(`/api/episodes/${topic.cover_episode_id}/poster`);
  expect(poster.status()).toBe(200);
  expect(poster.headers()['content-type']).toContain('image/jpeg');
  const metadata = await sharp(await poster.body()).metadata();
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.width).toBeLessThanOrEqual(720);

  const privateId = randomUUID(),
    episodeId = randomUUID();
  seasons.push(privateId);
  await db.query(
    `INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility)
     SELECT $1,owner_id,'Закрытая тема','Тест','kz-history','ru',7,'published','class' FROM seasons WHERE id=$2`,
    [privateId, seed],
  );
  await db.query(
    `INSERT INTO episodes(id,season_id,position,title,script,media_path)
     SELECT $1,$2,0,'Закрытая серия','Тест',media_path FROM episodes WHERE id=$3`,
    [episodeId, privateId, topic.cover_episode_id],
  );
  expect((await request.get(`/api/episodes/${episodeId}/poster`)).status()).toBe(404);
  // Even a previously generated image must become inaccessible after access is revoked.
  await db.query("UPDATE seasons SET visibility='public' WHERE id=$1", [privateId]);
  expect((await request.get(`/api/episodes/${episodeId}/poster`)).status()).toBe(200);
  await db.query("UPDATE seasons SET visibility='class' WHERE id=$1", [privateId]);
  expect((await request.get(`/api/episodes/${episodeId}/poster`)).status()).toBe(404);

  await page.goto('/library');
  const card = page.locator(`.season-card[href="/learn/${seed}"]`);
  const image = card.locator('img.season-art');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await page.route('**/api/episodes/*/poster', (route) => route.fulfill({ status: 503, body: '' }));
  await page.reload();
  await expect(card.locator('svg.season-art')).toBeVisible();
});

test('wrong micro answer replays the same clip, then correct feedback leads to the final test on a phone', async ({
  page,
}) => {
  await student(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/watch/${seed}?episode=2`);
  let micro = await finishVideo(page, 2);
  await micro.getByRole('button', { name: 'B В Западной Европе', exact: true }).click();
  await micro.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(micro).toContainText('Разберём вместе');
  await micro.getByRole('button', { name: 'Повторить объяснение', exact: true }).click();
  await expect(micro).not.toBeVisible();
  const video = page.locator('.feed-slide video').nth(2);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(5);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  micro = await finishVideo(page, 2);
  await micro.getByRole('button', { name: 'A В Жетысу', exact: true }).click();
  await micro.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(micro).toContainText('Ответ верный!');
  await expect(micro).toContainText('Дальше — итоговый тест');
  await micro.getByRole('button', { name: 'Дальше по маршруту' }).click();
  await expect(page.locator('.session-end')).toBeInViewport();
  await expect(page.locator('.session-end .button.primary')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрепить тему: пройти тест' }).click();
  await expect(page.getByRole('dialog', { name: 'Проверь понимание' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a partial saved test makes review the primary next step on the topic page', async ({
  page,
}) => {
  await student(page);
  const topic = await (await page.request.get(`/api/seasons/${seed}`)).json();
  for (const episode of topic.episodes)
    expect((await page.request.post(`/api/episodes/${episode.id}/complete`)).ok()).toBe(true);
  const questions = (
    await db.query(
      "SELECT correct FROM questions WHERE season_id=$1 AND purpose='final' ORDER BY position",
      [seed],
    )
  ).rows;
  const answers = questions.map((q: any, i: number) => (i === 0 ? (q.correct + 1) % 3 : q.correct));
  const attempt = await (
    await page.request.post(`/api/seasons/${seed}/attempts`, { data: { answers } })
  ).json();
  await page.goto(`/learn/${seed}`);
  await page.reload();
  const hero = page.locator('.topic-intro');
  await expect(hero.getByRole('link', { name: 'Разобрать ошибки', exact: true })).toHaveAttribute(
    'href',
    `/attempts/${attempt.id}`,
  );
  await expect(hero).toContainText('Следующий шаг');
  await expect(hero.getByRole('button', { name: 'Рассказать своими словами' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/lesson-next-step-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const perfect = await page.request.post(`/api/seasons/${seed}/attempts`, {
    data: { answers: questions.map((q: any) => q.correct) },
  });
  expect(perfect.status()).toBe(201);
  await page.reload();
  await expect(hero.getByRole('button', { name: 'Рассказать своими словами' })).toBeVisible();
});

for (const [step, feedback, action] of [
  ['retelling', 'Дальше — пересказ по желанию', 'Рассказать своими словами'],
  ['complete', 'Дальше — твой прогресс', 'Посмотреть прогресс'],
] as const) {
  test(`completed learning feedback matches ${step} action`, async ({ page }) => {
    await student(page);
    const topic = await (await page.request.get(`/api/seasons/${seed}`)).json();
    const episode = topic.episodes[2];
    let checked = false;
    await page.route(/\/api\/today(\?|$)/, (route) =>
      route.fulfill({
        json: {
          season_id: seed,
          episode_ids: [episode.id],
          goal: 1,
          correct: checked ? 1 : 0,
          correct_ids: checked ? [episode.id] : [],
          completed_ids: checked ? [episode.id] : [],
          session_complete: checked,
          session_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda' }).format(
            new Date(),
          ),
          mode: 'school',
          topic_source: 'personal',
          next_step: step,
          next_episode: null,
        },
      }),
    );
    await page.goto('/');
    const micro = await finishVideo(page);
    await micro.getByRole('button', { name: 'A В Жетысу', exact: true }).click();
    checked = true;
    await micro.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(micro).toContainText(feedback);
    await micro.getByRole('button', { name: 'Дальше по маршруту' }).click();
    await expect(page.locator('.session-next .primary')).toHaveText(action);
  });
}
