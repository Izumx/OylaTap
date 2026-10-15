import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, rows, one } from './db.js';
import { required, teacher } from './auth.js';
import { dailyPlan } from './daily-plan.js';
import { subjectSchema } from './curriculum.js';
const uid = z.string().uuid();
const day = "(now() AT TIME ZONE 'Asia/Qyzylorda')::date";
export function dailyRouter(visibilitySql: string) {
  const router = Router();
  router.get('/today', async (req, res) => {
    const mode = req.query.mode === 'free' ? 'free' : 'school';
    res.json(await dailyPlan(req.user, mode, visibilitySql));
  });
  router.get('/episodes/:id/micro', async (req, res) => {
    const q = await one(
      `SELECT q.id,q.prompt,q.options FROM questions q JOIN episodes e ON e.id=q.episode_id JOIN seasons s ON s.id=e.season_id WHERE e.id=$2 AND q.purpose='micro' AND s.status='published' AND ${visibilitySql} ORDER BY q.position LIMIT 1`,
      [req.user?.id || null, uid.parse(req.params.id)],
    );
    if (!q) {
      res.status(404).json({ error: 'Микровопрос пока не добавлен' });
      return;
    }
    res.json(q);
  });
  router.post('/episodes/:id/check', async (req, res) => {
    const id = uid.parse(req.params.id),
      { answer } = z.object({ answer: z.number().int().min(0).max(4) }).parse(req.body);
    const q = await one(
      `SELECT q.* FROM questions q JOIN episodes e ON e.id=q.episode_id JOIN seasons s ON s.id=e.season_id WHERE e.id=$2 AND q.purpose='micro' AND s.status='published' AND ${visibilitySql} ORDER BY q.position LIMIT 1`,
      [req.user?.id || null, id],
    );
    if (!q || answer >= q.options.length) {
      res.status(400).json({ error: 'Выберите вариант ответа' });
      return;
    }
    const passed = answer === q.correct;
    if (req.user)
      await db.query(
        'INSERT INTO micro_answers(id,user_id,episode_id,question_id,answer,passed) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), req.user.id, id, q.id, answer, passed],
      );
    res.json({ passed, correct: q.correct, explanation: q.explanation });
  });
  router.get('/learning-preferences', required, async (req, res) =>
    res.json(
      await one(
        'SELECT current_season_id,interests,reminder_enabled,reminder_time FROM users WHERE id=$1',
        [req.user!.id],
      ),
    ),
  );
  router.patch('/learning-preferences', required, async (req, res) => {
    const d = z
      .object({
        current_season_id: uid.nullable(),
        interests: z.array(subjectSchema).max(subjectSchema.options.length),
        reminder_enabled: z.boolean(),
        reminder_time: z.string().regex(/^(0[8-9]|1\d|20):[0-5]\d$/),
      })
      .parse(req.body);
    if (
      d.current_season_id &&
      !(await one(
        "SELECT s.id FROM seasons s WHERE s.id=$2 AND s.status='published' AND " + visibilitySql,
        [req.user!.id, d.current_season_id],
      ))
    ) {
      res.status(404).json({ error: 'Тема недоступна' });
      return;
    }
    await db.query(
      'UPDATE users SET current_season_id=$2,interests=$3,reminder_enabled=$4,reminder_time=$5 WHERE id=$1',
      [
        req.user!.id,
        d.current_season_id,
        JSON.stringify([...new Set(d.interests)]),
        d.reminder_enabled,
        d.reminder_time,
      ],
    );
    res.json({ ok: true });
  });
  router.patch('/classes/:id/topic', required, teacher, async (req, res) => {
    const id = uid.parse(req.params.id),
      { season_id } = z.object({ season_id: uid }).parse(req.body);
    if (
      !(await one('SELECT id FROM classrooms WHERE id=$1 AND teacher_id=$2', [id, req.user!.id])) ||
      !(await one(
        "SELECT id FROM seasons WHERE id=$1 AND status='published' AND ((visibility='public' AND NOT hidden) OR owner_id=$2)",
        [season_id, req.user!.id],
      ))
    ) {
      res.status(404).json({ error: 'Класс или сезон недоступен' });
      return;
    }
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE classrooms SET current_season_id=$2 WHERE id=$1', [id, season_id]);
      await c.query(
        "INSERT INTO assignments(id,class_id,season_id,due_at) VALUES($1,$2,$3,now()+interval '7 days') ON CONFLICT(class_id,season_id) DO NOTHING",
        [randomUUID(), id, season_id],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    res.json({ ok: true });
  });
  // One reminder per account/day while the app is open. Background Web Push is a separate integration.
  router.post('/reminders/claim', required, async (req, res) => {
    const d = await one(
      `UPDATE users SET reminder_date=${day} WHERE id=$1 AND reminder_enabled AND (reminder_date IS NULL OR reminder_date<>${day}) AND to_char(now() AT TIME ZONE 'Asia/Qyzylorda','HH24:MI')>=reminder_time AND to_char(now() AT TIME ZONE 'Asia/Qyzylorda','HH24:MI')<'21:00' RETURNING id,current_season_id`,
      [req.user!.id],
    );
    const topic = d
      ? await one(
          'SELECT title FROM seasons WHERE id=coalesce((SELECT current_season_id FROM classrooms c JOIN memberships m ON m.class_id=c.id WHERE m.user_id=$1 AND c.current_season_id IS NOT NULL ORDER BY c.created_at DESC LIMIT 1),$2)',
          [req.user!.id, d.current_season_id],
        )
      : null;
    res.json({
      show: Boolean(d),
      text: topic
        ? `Сегодня тема «${topic.title}»: три короткие серии и вопросы на понимание.`
        : 'Сегодня — короткая тема и несколько вопросов. Вернись к своему плану.',
    });
  });
  return router;
}
