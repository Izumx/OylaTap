import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import 'dotenv/config';
import pg from 'pg';
import { hashPassword, tokenHash } from '../server/auth';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const seed = '10000000-0000-4000-8000-000000000001';
const classId = randomUUID(),
  emptyClassId = randomUUID(),
  topicId = randomUUID();
const code = randomBytes(4).toString('hex').toUpperCase();
const emptyCode = randomBytes(4).toString('hex').toUpperCase();
const emails: string[] = [];
const password = 'invitation-test-password';
let teacher: { id: string; token: string; email: string };

async function actor(role: 'student' | 'teacher' | 'creator' = 'student') {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  const email = `${id}@invitation.example.test`;
  emails.push(email);
  await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [
    id,
    'Участник приглашения',
    email,
    hashPassword(password),
    role,
  ]);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [tokenHash(token), id],
  );
  return { id, token, email };
}
async function authenticate(context: BrowserContext, person: { token: string }) {
  await context.addCookies([
    { name: 'oylatap_session', value: person.token, url: 'http://127.0.0.1:3100' },
  ]);
}
test.beforeAll(async () => {
  teacher = await actor('teacher');
  await db.query(
    `INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility)
    VALUES($1,$2,'Тема по приглашению','Материал класса','kz-history','ru',7,'published','class')`,
    [topicId, teacher.id],
  );
  await db.query(
    `INSERT INTO episodes(id,season_id,position,title,script,duration,media_path)
    SELECT $1,$2,0,'Урок класса',script,duration,media_path FROM episodes WHERE season_id=$3 ORDER BY position LIMIT 1`,
    [randomUUID(), topicId, seed],
  );
  await db.query(
    `INSERT INTO classrooms(id,teacher_id,name,code,current_season_id) VALUES
    ($1,$2,'7 Б · Приглашение',$3,$4),($5,$2,'Класс без темы',$6,NULL)`,
    [classId, teacher.id, code, topicId, emptyClassId, emptyCode],
  );
  await db.query(
    "INSERT INTO assignments(id,class_id,season_id,due_at) VALUES($1,$2,$3,now()+interval '7 days')",
    [randomUUID(), classId, topicId],
  );
});
test.afterAll(async () => {
  await db.query('DELETE FROM classrooms WHERE id=ANY($1::uuid[])', [[classId, emptyClassId]]);
  await db.query('DELETE FROM seasons WHERE id=$1', [topicId]);
  await db.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
  await db.end();
});

test('invitation preview exposes only the class name and does not join; joining is protected and repeatable', async ({
  page,
}) => {
  const preview = await page.request.get(`/api/invitations/${code.toLowerCase()}`);
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toEqual({ name: '7 Б · Приглашение', joined: false });
  expect((await page.request.get(`/api/seasons/${topicId}`)).status()).toBe(404);
  expect((await page.request.post('/api/classes/join', { data: { code } })).status()).toBe(401);
  expect((await page.request.get('/api/invitations/NOTREALCODE')).status()).toBe(404);
  expect((await page.request.get('/api/invitations/ab')).status()).toBe(400);
  const person = await actor();
  await authenticate(page.context(), person);
  await page.request.get(`/api/invitations/${code}`);
  expect((await db.query('SELECT * FROM memberships WHERE user_id=$1', [person.id])).rowCount).toBe(
    0,
  );
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post('/api/classes/join', {
      data: { code: ` ${code.toLowerCase()} ` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).next_path).toBe(`/learn/${topicId}`);
  }
  expect(
    (
      await db.query('SELECT * FROM memberships WHERE user_id=$1 AND class_id=$2', [
        person.id,
        classId,
      ])
    ).rowCount,
  ).toBe(1);
  expect((await page.request.get(`/api/seasons/${topicId}`)).status()).toBe(200);
  expect((await (await page.request.get(`/api/invitations/${code}`)).json()).joined).toBe(true);
  expect(
    (await (await page.request.post('/api/classes/join', { data: { code: emptyCode } })).json())
      .next_path,
  ).toBe('/assignments');
  await db.query('UPDATE classrooms SET current_season_id=NULL WHERE id=$1', [classId]);
  await db.query(
    `INSERT INTO assignments(id,class_id,season_id,due_at) VALUES
    ($1,$2,$3,now()-interval '3 days'),($4,$2,$5,now()-interval '2 days')`,
    [randomUUID(), classId, seed, randomUUID(), '10000000-0000-4000-8000-000000000002'],
  );
  expect(
    (
      await page.request.post(`/api/seasons/${seed}/attempts`, { data: { answers: [0, 1, 0] } })
    ).status(),
  ).toBe(201);
  const unfinished = await page.request.post('/api/classes/join', { data: { code } });
  expect((await unfinished.json()).next_path).toBe('/learn/10000000-0000-4000-8000-000000000002');
  await db.query('UPDATE classrooms SET current_season_id=$2 WHERE id=$1', [classId, topicId]);
});

test('a new student registers from the invitation, reloads and opens the assigned private lesson on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/join/${code}`);
  await expect(page.getByRole('heading', { name: '7 Б · Приглашение', exact: true })).toBeVisible();
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({ path: '.local/qa/class-invitation-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Войти и продолжить', exact: true }).click();
  const auth = page.getByRole('dialog');
  await auth.getByRole('button', { name: 'Первый раз здесь? Создать аккаунт' }).click();
  const email = `${randomUUID()}@invitation.example.test`;
  emails.push(email);
  await auth.getByLabel('Как тебя зовут?').fill('Новый ученик');
  await auth.getByLabel('Язык обучения', { exact: true }).selectOption('ru');
  await auth.getByLabel('Email', { exact: true }).fill(email);
  await auth.getByLabel('Пароль', { exact: true }).fill(password);
  await auth.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(auth).not.toBeVisible();
  await expect(page).toHaveURL(`/join/${code}`);
  await page.reload();
  await page.getByRole('button', { name: 'Присоединиться к классу', exact: true }).click();
  await expect(page).toHaveURL(`/learn/${topicId}`);
  await expect(
    page.getByRole('heading', { name: 'Тема по приглашению', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an existing student logs in without losing the link and teacher accounts cannot join', async ({
  page,
}) => {
  const person = await actor();
  await page.goto(`/join/${emptyCode}`);
  await page.getByRole('button', { name: 'Войти и продолжить', exact: true }).click();
  const auth = page.getByRole('dialog');
  await auth.getByLabel('Email', { exact: true }).fill(person.email);
  await auth.getByLabel('Пароль', { exact: true }).fill(password);
  await auth.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(auth).not.toBeVisible();
  await page.getByRole('button', { name: 'Присоединиться к классу', exact: true }).click();
  await expect(page).toHaveURL('/assignments');
  await authenticate(page.context(), await actor('teacher'));
  await page.goto(`/join/${code}`);
  await expect(
    page.getByRole('heading', { name: 'Нужен аккаунт ученика', exact: true }),
  ).toBeVisible();
  expect((await page.request.post('/api/classes/join', { data: { code } })).status()).toBe(403);
  await expect(
    page.getByRole('button', { name: 'Присоединиться к классу', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Войти как ученик', exact: true }).click();
  await expect(page).toHaveURL(`/join/${code}`);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('an invalid or changed invitation cannot display or join the previous class', async ({
  page,
}) => {
  await authenticate(page.context(), await actor());
  await page.goto(`/join/${code}`);
  await expect(page.getByRole('heading', { name: '7 Б · Приглашение', exact: true })).toBeVisible();
  await page.goto('/join/NOTREALCODE');
  await expect(page.getByRole('heading', { name: 'Не удалось открыть приглашение' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Присоединиться к классу' })).toHaveCount(0);
  await expect(page.getByText('7 Б · Приглашение', { exact: true })).toHaveCount(0);
});

test('teacher can copy the invitation and still select it when clipboard is unavailable', async ({
  page,
}) => {
  await authenticate(page.context(), teacher);
  await page.goto('/classes');
  const card = page
    .locator('.class-card')
    .filter({ has: page.getByRole('heading', { name: '7 Б · Приглашение', exact: true }) });
  const field = card.getByLabel('Ссылка для учеников', { exact: true });
  await expect(field).toHaveValue(`http://127.0.0.1:3100/join/${code}`);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__copiedInvitation = value;
        },
      },
    }),
  );
  await card.getByRole('button', { name: 'Скопировать ссылку-приглашение', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedInvitation)).toBe(
    `http://127.0.0.1:3100/join/${code}`,
  );
  await expect(page.getByRole('status').filter({ hasText: 'Ссылка скопирована' })).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    }),
  );
  await card.getByRole('button', { name: 'Скопировать ссылку-приглашение', exact: true }).click();
  await expect(field).toBeFocused();
  expect(
    await field.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!),
  ).toBeGreaterThan(0);
});

test('registration saves Kazakh learning language and keeps the invitation after reload', async ({
  page,
}) => {
  await page.goto(`/join/${emptyCode}`);
  await page.getByRole('button', { name: 'Войти и продолжить', exact: true }).click();
  const auth = page.getByRole('dialog');
  await auth.getByRole('button', { name: 'Первый раз здесь? Создать аккаунт' }).click();
  const email = `${randomUUID()}@invitation.example.test`;
  emails.push(email);
  await auth.getByLabel('Как тебя зовут?').fill('Жаңа оқушы');
  await auth.getByLabel('Язык обучения', { exact: true }).selectOption('kk');
  await auth.getByLabel('Email', { exact: true }).fill(email);
  await auth.getByLabel('Пароль', { exact: true }).fill(password);
  await auth.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(auth).not.toBeVisible();
  expect((await (await page.request.get('/api/me')).json()).user.language).toBe('kk');
  await page.reload();
  await expect(page).toHaveURL(`/join/${emptyCode}`);
  await expect(page.getByRole('button', { name: 'Сыныпқа қосылу', exact: true })).toBeVisible();
  expect(await page.locator('html').getAttribute('lang')).toBe('kk');
});

for (const action of ['join', 'logout'] as const) {
  test(`a delayed ${action} response cannot redirect or reopen login after leaving the invitation`, async ({
    page,
  }) => {
    await authenticate(page.context(), await actor(action === 'join' ? 'student' : 'teacher'));
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const endpoint = action === 'join' ? '/api/classes/join' : '/api/auth/logout';
    await page.route(`**${endpoint}`, async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
    });
    await page.goto(`/join/${code}`);
    await page
      .getByRole('button', {
        name: action === 'join' ? 'Присоединиться к классу' : 'Войти как ученик',
        exact: true,
      })
      .click();
    await entered;
    await page.getByRole('main').getByRole('link', { name: 'Библиотека', exact: true }).click();
    await expect(page).toHaveURL('/library');
    const responded = page.waitForResponse((response) => response.url().endsWith(endpoint));
    release();
    await (await responded).finished();
    // Allow the completed fetch's React side effects to settle before checking the new route.
    await page.waitForTimeout(150);
    await expect(page).toHaveURL('/library');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
