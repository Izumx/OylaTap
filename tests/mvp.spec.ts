import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { db } from '../server/db';
const seed = '10000000-0000-4000-8000-000000000001';
const createdUsers: string[] = [];
async function account(request: APIRequestContext, role: 'student' | 'teacher') {
  const result = await request.post('/api/auth/register', {
    data: {
      name: role === 'teacher' ? 'Тестовый учитель' : 'Тестовый ученик',
      email: `${randomUUID()}@example.test`,
      password: 'test-only-password-123',
      role,
      grade: 7,
    },
  });
  expect(result.status()).toBe(201);
  const { user } = await result.json();
  createdUsers.push(user.id);
  return user;
}
async function draft(request: APIRequestContext) {
  const r = await request.post('/api/seasons', {
    data: {
      title: 'Тестовый сезон',
      description: 'Объясняем причины и последствия событий.',
      subject: 'kz-history',
      language: 'ru',
      grade: 7,
      source_text: 'Исходный учебный материал.',
      episodes: [
        {
          title: 'Причины и события',
          script:
            'Каждое событие имеет причины. Чтобы понять историю, нужно связать причины и последствия.',
        },
      ],
      questions: [
        {
          prompt: 'Что помогает понять историю?',
          options: ['Только дата', 'Причины и последствия', 'Только имя'],
          correct: 1,
          explanation: 'Связь причин и последствий помогает объяснить событие.',
        },
        {
          purpose: 'final',
          prompt: 'Как объяснить последствия исторического события?',
          options: [
            'Назвать только дату',
            'Связать причины и последующие изменения',
            'Назвать только имя',
          ],
          correct: 1,
          explanation: 'Объяснение связывает причины, событие и последующие изменения.',
        },
      ],
    },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).id;
}
test.afterAll(async () => {
  // Remove only accounts created by this run and their dependent demo work.
  for (const id of createdUsers) {
    await db.query('DELETE FROM seasons WHERE owner_id=$1', [id]);
    await db.query('DELETE FROM classrooms WHERE teacher_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
  await db.end();
});

test('guest feed plays actual video, navigates chapters and works on a phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const first = page.locator('.feed-slide').first().locator('video');
  await expect
    .poll(() => first.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Следующая серия', exact: true }).click();
  await expect(page.locator('.chapter-list>button.active b')).toHaveText('Новое начало в Жетысу');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bottom-nav')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.locator('.feed-scroll').evaluate((el) => {
    el.scrollTop = 2 * el.clientHeight;
  });
  await expect
    .poll(() =>
      page.locator('.feed-scroll').evaluate((el) => Math.round(el.scrollTop / el.clientHeight)),
    )
    .toBe(2);
  await page.getByRole('button', { name: 'Пройти тест', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
test('quiz grades on server, explains mistakes, persists progress in PostgreSQL', async ({
  page,
}) => {
  const user = await account(page.request, 'student');
  await page.goto(`/watch/${seed}`);
  await page.getByRole('button', { name: 'Пройти тест', exact: true }).click();
  const d = page.getByRole('dialog');
  await d
    .getByRole('button', { name: 'A Недовольство подтолкнуло людей искать новые условия' })
    .click();
  await d.getByRole('button', { name: 'Дальше' }).click();
  await d.getByRole('button', { name: 'A Оно заменило любые решения племён' }).click();
  await d.getByRole('button', { name: 'Дальше' }).click();
  await d
    .getByRole('button', { name: 'A Связать причины переселения и последующее объединение' })
    .click();
  await d.getByRole('button', { name: 'Показать результат' }).click();
  await expect(d.locator('.quiz-result h3')).toHaveText('2 из 3');
  await expect(d.locator('.wrong')).toContainText('Земли дали условия для нового объединения');
  await d.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.goto('/progress');
  await expect(page.locator('.stat-card').nth(1)).toContainText('1');
  await expect(page.locator('.stat-card').nth(3)).toContainText('67%');
  const stored = await db.query('SELECT score,total FROM attempts WHERE user_id=$1', [user.id]);
  expect(stored.rows).toEqual([{ score: 2, total: 3 }]);
  await page.reload();
  await expect(page.locator('.stat-card').nth(3)).toContainText('67%');
});
test('teacher imports material, edits quiz, renders, previews and publishes', async ({ page }) => {
  await account(page.request, 'teacher');
  await page.goto('/studio/new');
  await page.getByLabel('Название сезона', { exact: true }).fill('Сезон из конспекта');
  await page
    .getByLabel('Чему научится ученик?', { exact: true })
    .fill('Понять связь причин и последствий в историческом событии.');
  await page.locator('input[type=file]').setInputFiles({
    name: 'lesson.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      'Историческое событие имеет несколько причин. Когда мы связываем факты, мы лучше понимаем последствия и изменения в обществе.',
    ),
  });
  await expect(page.getByLabel('Или вставьте текст')).toContainText('Историческое событие');
  await page.getByRole('button', { name: 'Подготовить серии' }).click();
  await page.getByLabel('Название серии').fill('Почему меняется общество');
  await page.getByRole('button', { name: 'Микровопрос', exact: true }).click();
  await page.getByLabel('Формулировка', { exact: true }).fill('Как понять историческое событие?');
  await page.getByLabel('A', { exact: true }).fill('Запомнить одну дату');
  await page.getByLabel('B', { exact: true }).fill('Связать причины и последствия');
  await page.getByLabel('C', { exact: true }).fill('Забыть о контексте');
  await page.getByLabel('Правильный ответ', { exact: true }).selectOption('1');
  await page
    .getByLabel('Объяснение после ответа')
    .fill('Связь причин и последствий помогает объяснить событие.');
  await page.getByRole('button', { name: 'Итоговый вопрос', exact: true }).click();
  const finalQuestion = page.locator('.question-editor').last();
  await finalQuestion
    .getByLabel('Формулировка', { exact: true })
    .fill('Как объяснить изменения в обществе?');
  await finalQuestion.getByLabel('A', { exact: true }).fill('Назвать одну дату');
  await finalQuestion
    .getByLabel('B', { exact: true })
    .fill('Показать причины и последующие изменения');
  await finalQuestion.getByLabel('C', { exact: true }).fill('Не учитывать события');
  await finalQuestion.getByLabel('Правильный ответ', { exact: true }).selectOption('1');
  await finalQuestion
    .getByLabel('Объяснение после ответа')
    .fill('Объяснение связывает причины и изменения.');
  await page.getByRole('button', { name: 'К видео', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Собрать видео', exact: true }).click();
  await expect(page.getByText('Видео готово', { exact: true })).toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Посмотреть серию', exact: true }).click();
  const d = page.getByRole('dialog');
  const video = d.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await d.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByLabel('Я проверил(а) материалы и подтверждаю публикацию').check();
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Сезон в библиотеке', { exact: true })).toBeVisible();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Сезон из конспекта' })).toBeVisible();
});
test('class code joins student; tests and assignments appear in teacher report', async ({
  page,
  playwright,
}) => {
  const teacher = await account(page.request, 'teacher');
  await page.goto('/classes');
  await page.getByRole('button', { name: 'Добавить класс' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Название класса', { exact: true }).fill('7 Б — тест');
  await d.getByRole('button', { name: 'Создать и получить код' }).click();
  await expect(page.locator('.invite-code b')).toBeVisible();
  const code = await page.locator('.invite-code b').innerText();
  const c = (await (await page.request.get('/api/classes')).json())[0];
  const assigned = await page.request.post('/api/assignments', {
    data: {
      class_id: c.id,
      season_id: seed,
      due_at: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  expect(assigned.ok()).toBe(true);
  const student = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await account(student, 'student');
  expect((await student.post('/api/classes/join', { data: { code } })).ok()).toBe(true);
  expect((await (await student.get('/api/assignments')).json())[0].class_name).toBe('7 Б — тест');
  expect(
    (await student.post(`/api/seasons/${seed}/attempts`, { data: { answers: [0, 1, 0] } })).ok(),
  ).toBe(true);
  await page.goto('/classes');
  const openTopic = page
    .locator('.teacher-assignments')
    .getByRole('link', { name: 'Открыть', exact: true });
  await expect(openTopic).toHaveAttribute('href', `/learn/${seed}`);
  await openTopic.click();
  await expect(
    page.getByRole('heading', { name: 'Как появилось Казахское ханство', exact: true }),
  ).toBeVisible();
  await page.goto('/results');
  await expect(page.locator('tbody')).toContainText('100%');
  await expect(page.locator('tbody')).toContainText('Тестовый ученик');
  const csv = await page.request.get('/api/results.csv');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('7 Б — тест');
  await student.dispose();
});
test('audio recording, teacher review, student playback and deletion', async ({
  page,
  playwright,
}) => {
  const teacher = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await account(teacher, 'teacher');
  const c = await (await teacher.post('/api/classes', { data: { name: '7 В — голос' } })).json();
  await teacher.post('/api/assignments', {
    data: {
      class_id: c.id,
      season_id: seed,
      due_at: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  await account(page.request, 'student');
  await page.request.post('/api/classes/join', { data: { code: c.code } });
  await page.goto(`/watch/${seed}`);
  await page.getByRole('button', { name: 'Записать пересказ', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await expect(d.getByRole('button', { name: 'Остановить запись' })).toBeVisible();
  await page.waitForTimeout(1500);
  await d.getByRole('button', { name: 'Остановить запись' }).click();
  await expect(d.locator('audio')).toBeVisible();
  await d.getByRole('checkbox').check();
  await d.getByRole('button', { name: 'Отправить пересказ', exact: true }).click();
  await expect(d.getByRole('heading', { name: 'Пересказ сохранён' })).toBeVisible();
  const report = (await (await teacher.get('/api/results')).json())[0];
  expect(report.retelling_id).toBeTruthy();
  expect((await teacher.get(`/api/retellings/${report.retelling_id}/audio`)).ok()).toBe(true);
  expect(
    (
      await teacher.patch(`/api/retellings/${report.retelling_id}/review`, {
        data: {
          score: 85,
          feedback: 'Хорошо объяснены причины. Добавь последствия.',
          transcript: 'Учитель уточнил текст пересказа.',
        },
      })
    ).ok(),
  ).toBe(true);
  await d.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.goto('/profile');
  await expect(page.locator('.retelling-card')).toContainText('85%');
  await expect(page.locator('.retelling-card')).toContainText('Добавь последствия');
  const denied = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await account(denied, 'teacher');
  expect((await denied.get(`/api/retellings/${report.retelling_id}/audio`)).status()).toBe(404);
  await denied.dispose();
  await page.getByRole('button', { name: 'Удалить запись' }).click();
  await expect(page.locator('.retelling-card')).toHaveCount(0);
  expect((await teacher.get(`/api/retellings/${report.retelling_id}/audio`)).status()).toBe(404);
  await teacher.dispose();
});
test('access control, no answer leaks, CSRF and publication prerequisites', async ({
  page,
  playwright,
}) => {
  expect(await (await page.request.get('/api/health')).json()).toEqual({
    ok: true,
    database: 'PostgreSQL',
  });
  const pub = await (await page.request.get(`/api/seasons/${seed}`)).json();
  expect(pub.questions[0]).not.toHaveProperty('correct');
  expect(pub.questions[0]).not.toHaveProperty('explanation');
  expect(
    (await page.request.post('/api/classes', { data: { name: 'Unauthorized' } })).status(),
  ).toBe(401);
  await account(page.request, 'teacher');
  const id = await draft(page.request);
  expect(
    (await page.request.post(`/api/seasons/${id}/publish`, { data: { confirmed: true } })).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post('/api/classes', {
        headers: { Origin: 'https://unrelated.example' },
        data: { name: 'Blocked' },
      })
    ).status(),
  ).toBe(403);
  const other = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await account(other, 'teacher');
  expect((await other.get(`/api/seasons/${id}`)).status()).toBe(404);
  expect((await other.post(`/api/seasons/${id}/render`)).status()).toBe(404);
  expect(
    (await other.post(`/api/seasons/${id}/publish`, { data: { confirmed: true } })).status(),
  ).toBe(404);
  await other.dispose();
  expect((await page.request.get('/api/seasons/not-a-uuid')).status()).toBe(400);
});
test('published teacher seasons are private to assigned classes by default', async ({
  page,
  playwright,
}) => {
  await account(page.request, 'teacher');
  const id = await draft(page.request);
  const s = await (await page.request.get(`/api/seasons/${id}`)).json();
  const seedSeason = await (await page.request.get(`/api/seasons/${seed}`)).json();
  const video = await (
    await page.request.get(`/api/episodes/${seedSeason.episodes[0].id}/video`)
  ).body();
  const upload = await page.request.post(`/api/seasons/${id}/episodes/${s.episodes[0].id}/video`, {
    multipart: { file: { name: 'flow-export.mp4', mimeType: 'video/mp4', buffer: video } },
  });
  expect(upload.status()).toBe(200);
  expect(
    (await page.request.post(`/api/seasons/${id}/publish`, { data: { confirmed: true } })).ok(),
  ).toBe(true);
  const student = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await account(student, 'student');
  expect((await student.get(`/api/seasons/${id}`)).status()).toBe(404);
  expect((await student.get(`/api/episodes/${s.episodes[0].id}/video`)).status()).toBe(404);
  expect(
    (await student.post(`/api/seasons/${id}/attempts`, { data: { answers: [1] } })).status(),
  ).toBe(404);
  const c = await (
    await page.request.post('/api/classes', { data: { name: 'Закрытый класс' } })
  ).json();
  await page.request.post('/api/assignments', {
    data: { class_id: c.id, season_id: id, due_at: new Date(Date.now() + 86400000).toISOString() },
  });
  await student.post('/api/classes/join', { data: { code: c.code } });
  expect((await student.get(`/api/seasons/${id}`)).status()).toBe(200);
  expect((await student.get(`/api/episodes/${s.episodes[0].id}/video`)).status()).toBe(200);
  const catalog = await (await student.get('/api/catalog')).json();
  expect(catalog.some((x: any) => x.id === id)).toBe(true);
  await student.dispose();
});
test('today has three clips, checks understanding after video and ends without loading more', async ({
  page,
}) => {
  const user = await account(page.request, 'student');
  await page.goto('/');
  await expect(page.locator('.feed-slide')).toHaveCount(4);
  const first = page.locator('.feed-slide').first().locator('video');
  await expect.poll(() => first.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(0);
  await first.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.2;
  });
  const d = page.getByRole('dialog', { name: 'Один вопрос — и дальше' });
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'A Создало условия для объединения' }).click();
  await d.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(d).toContainText('Ответ верный!');
  await d.getByRole('button', { name: 'Дальше по маршруту' }).click();
  const progress = await (await page.request.get('/api/progress')).json();
  expect(progress.stats.micro_correct).toBe(1);
  expect(progress.stats.watched).toBe(1);
  const stored = await db.query('SELECT passed FROM micro_answers WHERE user_id=$1', [user.id]);
  expect(stored.rows).toEqual([{ passed: true }]);
  await page.locator('.feed-scroll').evaluate((el) => {
    el.scrollTop = 3 * el.clientHeight;
  });
  await expect(page.locator('.session-end')).toBeInViewport();
  await expect(page.locator('.session-end')).toContainText('Сессия закончилась');
  await page.mouse.wheel(0, 1500);
  await expect(page.locator('.feed-slide')).toHaveCount(4);
});
test('personal topic preferences persist and teacher topic takes priority for the class', async ({
  page,
  playwright,
}) => {
  await account(page.request, 'student');
  await page.goto('/profile');
  await page
    .getByRole('combobox', { name: 'Моя текущая тема' })
    .selectOption('10000000-0000-4000-8000-000000000003');
  await page.getByRole('button', { name: 'Сохранить учебный план', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Учебный план сохранён' })).toBeVisible();
  let today = await (await page.request.get('/api/today')).json();
  expect(today.season_id).toBe('10000000-0000-4000-8000-000000000003');
  expect(today.topic_source).toBe('personal');
  const teacher = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3000' });
  await account(teacher, 'teacher');
  const c = await (
    await teacher.post('/api/classes', { data: { name: 'Класс с текущей темой' } })
  ).json();
  await page.request.post('/api/classes/join', { data: { code: c.code } });
  const changed = await teacher.patch(`/api/classes/${c.id}/topic`, { data: { season_id: seed } });
  expect(changed.ok()).toBe(true);
  today = await (await page.request.get('/api/today')).json();
  expect(today.season_id).toBe(seed);
  expect(today.topic_source).toBe('class');
  const pref = await (await page.request.get('/api/learning-preferences')).json();
  expect(pref.current_season_id).toBe('10000000-0000-4000-8000-000000000003');
  expect(pref.reminder_enabled).toBe(false);
  await teacher.dispose();
});

test('topic journey resumes unwatched video, reviews a quiz mistake and keeps progress after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await account(page.request, 'student');
  const season = await (await page.request.get(`/api/seasons/${seed}`)).json();
  await page.request.post(`/api/episodes/${season.episodes[0].id}/complete`);
  await page.goto('/library');
  await page.locator(`.season-card[href="/learn/${seed}"]`).click();
  await expect(page.getByRole('heading', { name: 'Твой маршрут по теме' })).toBeVisible();
  await expect(page.locator('.journey-steps li').nth(0)).toContainText('1/3 просмотрено');
  const resume = page.getByRole('link', { name: 'Продолжить просмотр', exact: true });
  await expect(resume).toHaveAttribute('href', `/watch/${seed}?episode=1`);
  await resume.click();
  for (const [index, answer] of [
    [1, 'B Керей и Жанибек'],
    [2, 'A В Жетысу'],
  ] as const) {
    const video = page.locator('.feed-slide video').nth(index);
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
      .toBeGreaterThan(0);
    await video.evaluate((el: HTMLVideoElement) => {
      el.currentTime = el.duration - 0.15;
    });
    const micro = page.getByRole('dialog', { name: 'Один вопрос — и дальше' });
    await expect(micro).toBeVisible();
    await micro.getByRole('button', { name: answer, exact: true }).click();
    await micro.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(micro).toContainText('Ответ верный!');
    await micro.getByRole('button', { name: 'Дальше по маршруту' }).click();
  }
  await expect(page.locator('.session-end')).toBeInViewport();
  await page.getByRole('button', { name: 'Закрепить тему: пройти тест' }).click();
  const quiz = page.getByRole('dialog', { name: 'Проверь понимание' });
  await quiz
    .getByRole('button', { name: 'A Недовольство подтолкнуло людей искать новые условия' })
    .click();
  await quiz.getByRole('button', { name: 'Дальше', exact: true }).click();
  await quiz.getByRole('button', { name: 'A Оно заменило любые решения племён' }).click();
  await quiz.getByRole('button', { name: 'Дальше', exact: true }).click();
  await quiz
    .getByRole('button', { name: 'A Связать причины переселения и последующее объединение' })
    .click();
  await quiz.getByRole('button', { name: 'Показать результат' }).click();
  await expect(quiz.locator('.quiz-result h3')).toHaveText('2 из 3');
  await quiz.getByRole('button', { name: 'Повторить серию: Новое начало в Жетысу' }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${seed}\\?episode=1$`));
  await expect(page.locator('.chapter-list>button.active b')).toHaveText('Новое начало в Жетысу');
  await page.goto(`/learn/${seed}`);
  await page.reload();
  await expect(page.locator('.journey-steps li').nth(0)).toContainText('3/3 просмотрено');
  await expect(page.locator('.journey-steps li').nth(1)).toContainText(
    'Последний результат: 2 из 3',
  );
  await page.getByRole('button', { name: 'Рассказать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать запись', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.journey-steps li').nth(2)).toContainText(
    'Голосом, с текстовым дополнением',
  );
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/learning-route-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Твой маршрут по теме' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/qa/learning-route-mobile.png', fullPage: true });
  await page.goto('/progress');
  await expect(page.locator('.continue-topic')).toContainText('Повтори сложное');
  await page.locator('.continue-topic').click();
  await expect(page).toHaveURL(`/learn/${seed}`);
  expect(errors).toEqual([]);
});

test('guest can explore a topic, and test entry asks for login without recording progress', async ({
  page,
}) => {
  await page.goto(`/learn/${seed}`);
  await page.getByRole('button', { name: 'Пройти тест', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Войти');
  expect((await page.request.get('/api/progress')).status()).toBe(401);
});

test('quiet feed keeps focus and appearance preferences, and supports pause and keyboard seeking', async ({
  page,
}) => {
  await page.goto(`/watch/${seed}`);
  const video = page.locator('.feed-slide video').first();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('data-comfort', 'soft');
  await expect(page.locator('.season-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Режим фокуса', exact: true }).click();
  await expect(page.locator('.season-panel')).toBeVisible();
  await page.reload();
  await expect(page.locator('.season-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Режим фокуса', exact: true }).click();
  await page.getByRole('button', { name: 'Спокойный режим', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-comfort', 'contrast');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-comfort', 'contrast');
  await page.getByRole('button', { name: 'Спокойный режим', exact: true }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await page.locator('.feed-scroll').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const seek = page.locator('.feed-slide').first().getByRole('slider', { name: 'Позиция видео' });
  await seek.press('Home');
  await seek.press('ArrowRight');
  await seek.press('ArrowRight');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(0.2, 1);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.locator('.feed-scroll').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/feed-comfort-desktop.png' });
});

test('phone feed fills the screen, keeps controls reachable and does not overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/watch/${seed}`);
  const video = page.locator('.feed-slide video').first();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await expect(page.locator('.mobile-header')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  for (const name of ['Содержание сезона', 'Пройти тест', 'Записать пересказ', 'Включить звук']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(776);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/feed-comfort-mobile.png' });
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Записать пересказ', exact: true }),
  ).toBeInViewport();
});
