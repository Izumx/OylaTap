import { randomUUID, randomBytes } from 'node:crypto';
import { db, one } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { khanateId, syncBundledContent } from './bundled-content.js';

if (process.env.DEMO_MODE !== 'true')
  throw new Error('Demo seeding requires DEMO_MODE=true. Do not seed a live school database.');
const teacherId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000002';
try {
  for (const u of [
    {
      id: teacherId,
      name: 'Айгерим Садыкова',
      email: 'teacher@demo.oylatap.local',
      role: 'teacher',
    },
    { id: studentId, name: 'Али', email: 'student@demo.oylatap.local', role: 'student' },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Данияр',
      email: 'creator@demo.oylatap.local',
      role: 'creator',
    },
  ])
    await db.query(
      'INSERT INTO users(id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
      [u.id, u.name, u.email, u.role, hashPassword(randomBytes(32).toString('hex'))],
    );
  await db.query('UPDATE users SET is_moderator=true WHERE id=$1', [teacherId]);
  const owner =
    (await one('SELECT owner_id FROM seasons WHERE id=$1', [khanateId]))?.owner_id || teacherId;
  const result = await syncBundledContent(db, owner);
  const classId = '20000000-0000-4000-8000-000000000001';
  await db.query(
    "INSERT INTO classrooms(id,teacher_id,name,code,current_season_id) VALUES($1,$2,'7 А · История и литература','OYLA7A',$3) ON CONFLICT(id) DO NOTHING",
    [classId, teacherId, khanateId],
  );
  await db.query('INSERT INTO memberships(class_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    classId,
    studentId,
  ]);
  await db.query(
    "INSERT INTO assignments(id,class_id,season_id,due_at) VALUES($1,$2,$3,now()+interval '7 days') ON CONFLICT(class_id,season_id) DO NOTHING",
    [randomUUID(), classId, khanateId],
  );
  console.log(
    'Demo accounts and classroom ready. Two real videos; ' +
      result.removedSeasons.length +
      ' legacy template topics removed.',
  );
} finally {
  await db.end();
}
