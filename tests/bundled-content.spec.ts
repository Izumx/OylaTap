import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import {
  syncBundledContent,
  bundledLessons,
  khanateId,
  princeId,
  legacyIds,
} from '../scripts/bundled-content';

const schema = `curation_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
test.beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const file of (await readdir('db')).filter((x) => x.endsWith('.sql')).sort())
    await db.query(await readFile(`db/${file}`, 'utf8'));
});
test.afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

test('curation removes only stock templates, keeps real-video progress and assignments, and is idempotent', async () => {
  const demo = '00000000-0000-4000-8000-000000000001';
  const owner = randomUUID(),
    learner = randomUUID(),
    episode = randomUUID();
  for (const id of [demo, owner, learner])
    await db.query(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Test',$2,'test-only','teacher')",
      [id, `${id}@example.test`],
    );
  for (const [i, id] of legacyIds.entries()) {
    await db.query(
      `INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,source_name)
      VALUES($1,$2,'Old','Test','kz-history','ru',7,'published',$3)`,
      [
        id,
        i === 4 ? owner : demo,
        i === 5
          ? 'Teacher edited this lesson'
          : 'Демонстрационные материалы OylaTap; требуется проверка учителем',
      ],
    );
    await db.query(
      "INSERT INTO episodes(id,season_id,position,title,script,media_kind,media_path) VALUES($1,$2,0,'Old','Test',$3,'test-template.mp4')",
      [randomUUID(), id, i === 3 ? 'uploaded' : 'rendered'],
    );
  }
  await db.query(
    "INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,status,visibility) VALUES($1,$2,'History','Test','kz-history','ru',7,'published','public')",
    [khanateId, owner],
  );
  await db.query(
    "INSERT INTO episodes(id,season_id,position,title,script,media_kind,media_path) VALUES($1,$2,0,'History','Test','uploaded',$3)",
    [episode, khanateId, bundledLessons[0].path],
  );
  const question = randomUUID();
  await db.query(
    "INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id,purpose) VALUES($1,$2,0,'Old','[\"Yes\",\"No\"]',0,'Test',$3,'micro')",
    [question, khanateId, episode],
  );
  await db.query('INSERT INTO completions(user_id,episode_id) VALUES($1,$2)', [learner, episode]);
  const attempt = randomUUID();
  await db.query(
    "INSERT INTO attempts(id,user_id,season_id,answers,score,total) VALUES($1,$2,$3,'[0]',1,1)",
    [attempt, learner, khanateId],
  );
  await db.query('UPDATE users SET current_season_id=$1 WHERE id=$2', [legacyIds[0], learner]);
  const classA = randomUUID(),
    classB = randomUUID(),
    movedAssignment = randomUUID();
  for (const id of [classA, classB])
    await db.query(
      "INSERT INTO classrooms(id,teacher_id,name,code,current_season_id) VALUES($1,$2,'Test',$3,$4)",
      [id, owner, `C${id}`, legacyIds[0]],
    );
  await db.query(
    'INSERT INTO assignments(id,class_id,season_id,due_at) VALUES($1,$2,$3,now()),($4,$2,$5,now()),($6,$7,$5,now())',
    [randomUUID(), classA, khanateId, randomUUID(), legacyIds[0], movedAssignment, classB],
  );

  const first = await syncBundledContent(db, owner);
  expect(first.removedSeasons.sort()).toEqual(legacyIds.slice(0, 3).sort());
  expect(
    (await db.query('SELECT id FROM seasons ORDER BY id')).rows.map((x) => x.id).sort(),
  ).toEqual([...legacyIds.slice(3), khanateId, princeId].sort());
  expect(
    (await db.query('SELECT id FROM episodes WHERE season_id=$1', [khanateId])).rows[0].id,
  ).toBe(episode);
  expect(
    (await db.query('SELECT id FROM questions WHERE season_id=$1 AND position=0', [khanateId]))
      .rows[0].id,
  ).toBe(question);
  expect((await db.query('SELECT id FROM attempts WHERE id=$1', [attempt])).rowCount).toBe(1);
  expect(
    (
      await db.query('SELECT * FROM completions WHERE user_id=$1 AND episode_id=$2', [
        learner,
        episode,
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    (await db.query('SELECT current_season_id FROM users WHERE id=$1', [learner])).rows[0]
      .current_season_id,
  ).toBe(khanateId);
  expect(
    (await db.query('SELECT season_id FROM assignments')).rows.map((x) => x.season_id),
  ).toEqual([khanateId, khanateId]);
  expect(
    (await db.query('SELECT season_id FROM assignments WHERE id=$1', [movedAssignment])).rows[0]
      .season_id,
  ).toBe(khanateId);
  const prince = (await db.query('SELECT subject,language FROM seasons WHERE id=$1', [princeId]))
    .rows[0];
  expect(prince).toEqual({ subject: 'world-literature', language: 'kk' });
  const ids = (await db.query('SELECT id FROM questions ORDER BY id')).rows;
  expect((await syncBundledContent(db, owner)).removedSeasons).toEqual([]);
  expect((await db.query('SELECT id FROM questions ORDER BY id')).rows).toEqual(ids);
  expect(
    (
      await db.query('SELECT count(*)::int n FROM episodes WHERE season_id=ANY($1::uuid[])', [
        [khanateId, princeId],
      ])
    ).rows[0].n,
  ).toBe(2);
});
