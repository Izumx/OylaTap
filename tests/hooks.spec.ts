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
