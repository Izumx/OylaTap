import { Router, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, rows, one } from './db.js';
import { required, teacher, author } from './auth.js';
import { subjectSchema } from './curriculum.js';

const uid = z.string().uuid();
const guessSchema = z.object({
  phase: z.enum(['before', 'recheck']),
  answer: z.number().int().min(0).max(9),
  confidence: z.number().int().min(1).max(3),
  reason: z.string().trim().max(140).optional(),
});

/** Deterministic shuffle for the recheck: same order for every student of one run, never the original. */
export function recheckOrder(runId: string, n: number): number[] {
  const key = (i: number) => createHash('sha256').update(`${runId}:${i}`).digest('hex');
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a).localeCompare(key(b)));
  return order.every((v, i) => v === i) ? order.map((_, i) => (i + 1) % n) : order;
}

// One query loads everything a run screen needs; access is checked by the caller.
const runSql = `SELECT r.*, c.teacher_id, c.name class_name, c.code join_code, s.title, s.subject,
  e.id episode_id, q.prompt, q.options, q.correct, q.explanation,
  (SELECT count(*)::int FROM memberships m WHERE m.class_id=r.class_id) students
  FROM hook_runs r JOIN classrooms c ON c.id=r.class_id JOIN seasons s ON s.id=r.season_id
  JOIN episodes e ON e.season_id=s.id AND e.position=0
  JOIN questions q ON q.season_id=s.id AND q.purpose='hook'
  WHERE r.id=$1`;

type Run = Record<string, any>;

async function loadRun(id: string): Promise<Run | undefined> {
  return one(runSql, [id]);
}
async function memberRun(req: Request): Promise<Run> {
  const run = await loadRun(uid.parse(req.params.id));
  const member =
    run &&
    (run.teacher_id === req.user!.id ||
      (await one('SELECT 1 FROM memberships WHERE class_id=$1 AND user_id=$2', [
        run.class_id,
        req.user!.id,
      ])));
  if (!run || !member)
    throw Object.assign(new Error('Не найдено или нет доступа'), { status: 404 });
  return run;
}
async function ownRun(req: Request): Promise<Run> {
  const run = await loadRun(uid.parse(req.params.id));
  if (!run || run.teacher_id !== req.user!.id)
    throw Object.assign(new Error('Не найдено или нет доступа'), { status: 404 });
  return run;
}

async function guesses(runId: string, phase: 'before' | 'recheck') {
  return rows<{ user_id: string; answer: number; confidence: number; reason: string }>(
    'SELECT user_id,answer,confidence,reason FROM hook_guesses WHERE run_id=$1 AND phase=$2',
    [runId, phase],
  );
}
const tally = (n: number, list: { answer: number }[]) => {
  const votes = Array(n).fill(0);
  for (const g of list) if (g.answer < n) votes[g.answer]++;
  return votes;
};
const recheckOpen = (run: Run) => !!run.revealed_at && new Date(run.recheck_at) <= new Date();

async function studentView(run: Run, userId: string) {
  const before = await guesses(run.id, 'before');
  const n = run.options.length;
  const mine = before.find((g) => g.user_id === userId) || null;
  const view: Record<string, unknown> = {
    id: run.id,
    class_name: run.class_name,
    title: run.title,
    subject: run.subject,
    episode_id: run.episode_id,
    prompt: run.prompt,
    options: run.options,
    lesson_at: run.lesson_at,
    answered: before.length,
    students: run.students,
    my_before: mine && { answer: mine.answer, confidence: mine.confidence, reason: mine.reason },
    revealed: !!run.revealed_at,
    recheck_open: recheckOpen(run),
    my_recheck: null,
  };
  if (run.revealed_at) {
    Object.assign(view, {
      correct: run.correct,
      explanation: run.explanation,
      votes: tally(n, before),
    });
    const order = recheckOrder(run.id, n);
    if (view.recheck_open) view.recheck_options = order.map((i) => run.options[i]);
    const re = (await guesses(run.id, 'recheck')).find((g) => g.user_id === userId);
    if (re) view.my_recheck = { answer: order.indexOf(re.answer), confidence: re.confidence };
  }
  return view;
}

async function screenView(run: Run) {
  const before = await guesses(run.id, 'before');
  const shown = !!run.votes_shown_at || !!run.revealed_at;
  return {
    run_id: run.id,
    prompt: run.prompt,
    options: run.options,
    answered: before.length,
    students: run.students,
    votes: shown ? tally(run.options.length, before) : null,
    confident: shown ? before.filter((g) => g.confidence === 3).length : null,
    correct: run.revealed_at ? run.correct : null,
    explanation: run.revealed_at ? run.explanation : null,
    join_code: run.join_code,
    revealed: !!run.revealed_at,
  };
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error: any) {
      if (error?.status === 404 || error?.status === 409)
        res.status(error.status).json({ error: error.message });
      else throw error;
    }
  };
const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });

export function hooksRouter(visibilitySql: string) {
  const router = Router();

  router.get('/hooks', required, author, async (req, res) => {
    const q = z
      .object({
        subject: subjectSchema.optional(),
        grade: z.coerce.number().int().min(5).max(11).optional(),
        language: z.enum(['ru', 'kk']).optional(),
      })
      .parse(req.query);
    res.json(
      await rows(
        `SELECT s.id,s.title,s.subject,s.grade,s.language,t.title_ru topic_title_ru,t.title_kk topic_title_kk,
          e.id episode_id,e.duration,qq.prompt
        FROM seasons s JOIN episodes e ON e.season_id=s.id AND e.position=0
        JOIN questions qq ON qq.season_id=s.id AND qq.purpose='hook'
        LEFT JOIN curriculum_topics t ON t.id=s.topic_id
        WHERE s.kind='hook' AND s.status='published' AND ${visibilitySql}
          AND ($2::text IS NULL OR s.subject=$2) AND ($3::int IS NULL OR s.grade=$3) AND ($4::text IS NULL OR s.language=$4)
        ORDER BY s.subject,s.grade,s.title`,
        [req.user!.id, q.subject ?? null, q.grade ?? null, q.language ?? null],
      ),
    );
  });

  router.post(
    '/classes/:classId/hook-runs',
    required,
    teacher,
    handle(async (req, res) => {
      const classId = uid.parse(req.params.classId);
      const d = z
        .object({ season_id: uid, lesson_at: z.iso.datetime({ offset: true }) })
        .parse(req.body);
      if (
        !(await one('SELECT id FROM classrooms WHERE id=$1 AND teacher_id=$2', [
          classId,
          req.user!.id,
        ]))
      )
        throw Object.assign(new Error('Не найдено или нет доступа'), { status: 404 });
      if (
        !(await one(
          `SELECT s.id FROM seasons s WHERE s.id=$2 AND s.kind='hook' AND s.status='published' AND ${visibilitySql}`,
          [req.user!.id, d.season_id],
        ))
      )
        throw Object.assign(new Error('Загадка не найдена'), { status: 404 });
      const run = await one(
        `INSERT INTO hook_runs(id,class_id,season_id,created_by,lesson_at) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(class_id,season_id) DO NOTHING RETURNING *`,
        [randomUUID(), classId, d.season_id, req.user!.id, d.lesson_at],
      );
      if (!run) throw conflict('Эта загадка уже запущена в классе');
      res.status(201).json(run);
    }),
  );

  router.get(
    '/classes/:classId/hook-runs',
    required,
    teacher,
    handle(async (req, res) => {
      const classId = uid.parse(req.params.classId);
      if (
        !(await one('SELECT id FROM classrooms WHERE id=$1 AND teacher_id=$2', [
          classId,
          req.user!.id,
        ]))
      )
        throw Object.assign(new Error('Не найдено или нет доступа'), { status: 404 });
      res.json(
        await rows(
          `SELECT r.*,s.title,
            (SELECT count(*)::int FROM hook_guesses g WHERE g.run_id=r.id AND g.phase='before') answered,
            (SELECT count(*)::int FROM memberships m WHERE m.class_id=r.class_id) students
          FROM hook_runs r JOIN seasons s ON s.id=r.season_id WHERE r.class_id=$1 ORDER BY r.created_at DESC`,
          [classId],
        ),
      );
    }),
  );

  router.get('/hook-runs', required, async (req, res) => {
    const list = await rows<{ id: string }>(
      `SELECT r.id FROM hook_runs r JOIN memberships m ON m.class_id=r.class_id AND m.user_id=$1
       ORDER BY r.created_at DESC LIMIT 20`,
      [req.user!.id],
    );
    const out = [];
    for (const { id } of list) {
      const run = await loadRun(id);
      if (run) out.push(await studentView(run, req.user!.id));
    }
    res.json(out);
  });

  router.get(
    '/hook-runs/:id',
    required,
    handle(async (req, res) => {
      res.json(await studentView(await memberRun(req), req.user!.id));
    }),
  );

  router.post(
    '/hook-runs/:id/guess',
    required,
    handle(async (req, res) => {
      const run = await memberRun(req);
      const g = guessSchema.parse(req.body);
      const n = run.options.length;
      if (g.answer >= n) throw Object.assign(new Error('Выберите вариант ответа'), { status: 409 });
      let answer = g.answer;
      let gate = 'revealed_at IS NULL';
      if (g.phase === 'recheck') {
        answer = recheckOrder(run.id, n)[g.answer];
        gate = 'revealed_at IS NOT NULL AND recheck_at <= now()';
      }
      // The gate is checked in the same statement, so a bet racing the reveal cannot slip in.
      const saved = await one(
        `INSERT INTO hook_guesses(run_id,user_id,phase,answer,confidence,reason)
         SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM hook_runs WHERE id=$1 AND ${gate})
         ON CONFLICT(run_id,user_id,phase) DO UPDATE SET answer=EXCLUDED.answer,confidence=EXCLUDED.confidence,
           reason=EXCLUDED.reason,updated_at=now()
         RETURNING run_id`,
        [
          run.id,
          req.user!.id,
          g.phase,
          answer,
          g.confidence,
          g.phase === 'before' ? g.reason || '' : '',
        ],
      );
      if (!saved)
        throw conflict(
          g.phase === 'before' ? 'Ответ уже раскрыт' : 'Повторная проверка ещё не открыта',
        );
      res.json(await studentView((await loadRun(run.id))!, req.user!.id));
    }),
  );

  const teacherAction = (path: string, sql: string) =>
    router.post(
      `/hook-runs/:id/${path}`,
      required,
      teacher,
      handle(async (req, res) => {
        const run = await ownRun(req);
        if (path === 'restart')
          await db.query('DELETE FROM hook_guesses WHERE run_id=$1', [run.id]);
        await db.query(sql, [run.id]);
        res.json(await screenView((await loadRun(run.id))!));
      }),
    );
  teacherAction(
    'show-votes',
    'UPDATE hook_runs SET votes_shown_at=coalesce(votes_shown_at,now()) WHERE id=$1',
  );
  teacherAction(
    'reveal',
    "UPDATE hook_runs SET revealed_at=coalesce(revealed_at,now()),recheck_at=coalesce(recheck_at,now()+interval '3 days') WHERE id=$1",
  );
  teacherAction(
    'restart',
    'UPDATE hook_runs SET votes_shown_at=NULL,revealed_at=NULL,recheck_at=NULL WHERE id=$1',
  );

  router.get(
    '/hook-runs/:id/screen',
    required,
    teacher,
    handle(async (req, res) => {
      res.json(await screenView(await ownRun(req)));
    }),
  );

  router.get(
    '/hook-runs/:id/results',
    required,
    teacher,
    handle(async (req, res) => {
      const run = await ownRun(req);
      const list = await rows<{
        name: string;
        watched_ratio: number | null;
        before_answer: number | null;
        confidence: number | null;
        reason: string | null;
        recheck_answer: number | null;
      }>(
        `SELECT u.name, v.watched_ratio, b.answer before_answer, b.confidence, b.reason, rc.answer recheck_answer
        FROM memberships m JOIN users u ON u.id=m.user_id
        LEFT JOIN episode_views v ON v.user_id=u.id AND v.episode_id=$2
        LEFT JOIN hook_guesses b ON b.run_id=$1 AND b.user_id=u.id AND b.phase='before'
        LEFT JOIN hook_guesses rc ON rc.run_id=$1 AND rc.user_id=u.id AND rc.phase='recheck'
        WHERE m.class_id=$3 ORDER BY u.name`,
        [run.id, run.episode_id, run.class_id],
      );
      const count = (f: (s: (typeof list)[number]) => boolean) => list.filter(f).length;
      res.json({
        summary: {
          students: list.length,
          watched: count((s) => s.watched_ratio != null && s.watched_ratio > 0),
          answered: count((s) => s.before_answer != null),
          before_correct: count((s) => s.before_answer === run.correct),
          recheck_answered: count((s) => s.recheck_answer != null),
          recheck_correct: count((s) => s.recheck_answer === run.correct),
        },
        students: list,
      });
    }),
  );

  return router;
}
