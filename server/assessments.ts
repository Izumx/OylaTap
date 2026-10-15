import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, one, rows } from './db.js';
import { required } from './auth.js';

const uid = z.string().uuid();
const answersSchema = z.object({ answers: z.array(z.number().int().min(0).max(4)).min(1).max(15) });
type Question = {
  id: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  purpose: 'micro' | 'final';
  episode_id: string | null;
  episode_position: number | null;
  episode_title: string | null;
};
type Review = Omit<Question, 'purpose'> & { answer: number; passed: boolean };
type Attempt = {
  id: string;
  season_id: string;
  title: string;
  score: number;
  total: number;
  kind: 'final' | 'legacy' | 'practice';
  created_at: string;
  cursor_time?: string;
  parent_attempt_id: string | null;
  results_snapshot: Review[] | null;
  snapshot_source: 'captured' | 'reconstructed' | 'unavailable';
};
const notFound = (res: import('express').Response) =>
  res.status(404).json({ error: 'Не найдено или нет доступа' });
const detail = (a: Attempt) => ({
  ...a,
  results_snapshot: undefined,
  cursor_time: undefined,
  results: a.results_snapshot || [],
  review_available: a.results_snapshot?.length === a.total,
});
async function save(
  userId: string,
  seasonId: string,
  questions: Omit<Question, 'purpose'>[],
  answers: number[],
  kind: Attempt['kind'],
  parent: string | null = null,
) {
  const results: Review[] = questions.map((q, i) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options,
    correct: q.correct,
    explanation: q.explanation,
    episode_id: q.episode_id,
    episode_position: q.episode_position,
    episode_title: q.episode_title,
    answer: answers[i],
    passed: answers[i] === q.correct,
  }));
  const score = results.filter((r) => r.passed).length;
  const attempt = await one<Attempt>(
    `INSERT INTO attempts(id,user_id,season_id,answers,score,total,kind,results_snapshot,snapshot_source,parent_attempt_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'captured',$9) RETURNING *`,
    [
      randomUUID(),
      userId,
      seasonId,
      JSON.stringify(answers),
      score,
      results.length,
      kind,
      JSON.stringify(results),
      parent,
    ],
  );
  return detail(attempt!);
}
function validAnswers(questions: { options: string[] }[], answers: number[]) {
  return (
    questions.length === answers.length && questions.every((q, i) => answers[i] < q.options.length)
  );
}

export function assessmentsRouter(visibilitySql: string) {
  const router = Router();
  async function owned(userId: string, id: string) {
    return one<Attempt>(
      `SELECT a.*,a.created_at::text cursor_time,s.title FROM attempts a JOIN seasons s ON s.id=a.season_id
       WHERE a.user_id=$1 AND a.id=$2 AND s.status='published' AND ${visibilitySql}`,
      [userId, id],
    );
  }
  router.post('/seasons/:id/attempts', required, async (req, res) => {
    const id = uid.parse(req.params.id),
      userId = req.user!.id;
    if (
      !(await one(
        `SELECT s.id FROM seasons s WHERE s.id=$2 AND s.status='published' AND ${visibilitySql}`,
        [userId, id],
      ))
    ) {
      notFound(res);
      return;
    }
    const { answers } = answersSchema.parse(req.body);
    const all = await rows<Question>(
      `SELECT q.*,e.position episode_position,e.title episode_title FROM questions q
       LEFT JOIN episodes e ON e.id=q.episode_id WHERE q.season_id=$1 ORDER BY q.position`,
      [id],
    );
    const final = all.filter((q) => q.purpose === 'final');
    const questions = final.length ? final : all.filter((q) => q.purpose === 'micro');
    if (!validAnswers(questions, answers)) {
      res.status(400).json({ error: 'Ответьте на все вопросы и выберите существующие варианты' });
      return;
    }
    res
      .status(201)
      .json(await save(userId, id, questions, answers, final.length ? 'final' : 'legacy'));
  });
  router.get('/attempts', required, async (req, res) => {
    const query = z.object({ season_id: uid.optional(), before: uid.optional() }).parse(req.query);
    const userId = req.user!.id;
    const anchor = query.before ? await owned(userId, query.before) : null;
    if (query.before && !anchor) {
      notFound(res);
      return;
    }
    const list = await rows(
      `SELECT a.id,a.season_id,s.title,a.kind,a.score,a.total,a.created_at,a.parent_attempt_id,
       a.snapshot_source,(a.results_snapshot IS NOT NULL AND jsonb_array_length(a.results_snapshot)=a.total) review_available
       FROM attempts a JOIN seasons s ON s.id=a.season_id
       WHERE a.user_id=$1 AND s.status='published' AND ${visibilitySql}
       AND ($2::uuid IS NULL OR a.season_id=$2)
       AND ($3::timestamptz IS NULL OR (a.created_at,a.id)<($3::timestamptz,$4::uuid))
       ORDER BY a.created_at DESC,a.id DESC LIMIT 21`,
      [userId, query.season_id || null, anchor?.cursor_time || null, anchor?.id || null],
    );
    res.json({ attempts: list.slice(0, 20), next_cursor: list.length > 20 ? list[19].id : null });
  });
  router.get('/attempts/:id', required, async (req, res) => {
    const attempt = await owned(req.user!.id, uid.parse(req.params.id));
    if (!attempt) {
      notFound(res);
      return;
    }
    res.json(detail(attempt));
  });
  router.get('/attempts/:id/practice', required, async (req, res) => {
    const attempt = await owned(req.user!.id, uid.parse(req.params.id));
    if (!attempt) {
      notFound(res);
      return;
    }
    if (attempt.results_snapshot?.length !== attempt.total) {
      res
        .status(409)
        .json({ error: 'Для этой старой попытки полный разбор недоступен. Пройди тест заново.' });
      return;
    }
    const mistakes = attempt.results_snapshot.filter((q) => !q.passed);
    if (!mistakes.length) {
      res.status(409).json({ error: 'В этой попытке нет ошибок для повторения' });
      return;
    }
    res.json({
      title: attempt.title,
      questions: mistakes.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
    });
  });
  router.post('/attempts/:id/practice', required, async (req, res) => {
    const attempt = await owned(req.user!.id, uid.parse(req.params.id));
    if (!attempt) {
      notFound(res);
      return;
    }
    if (attempt.results_snapshot?.length !== attempt.total) {
      res.status(409).json({ error: 'Полный разбор недоступен. Пройди тест заново.' });
      return;
    }
    const questions = attempt.results_snapshot.filter((q) => !q.passed);
    const { answers } = answersSchema.parse(req.body);
    if (!validAnswers(questions, answers)) {
      res.status(400).json({ error: 'Ответьте на все вопросы и выберите существующие варианты' });
      return;
    }
    res
      .status(201)
      .json(
        await save(req.user!.id, attempt.season_id, questions, answers, 'practice', attempt.id),
      );
  });
  return router;
}
