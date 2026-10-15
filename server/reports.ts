import { Router } from 'express';
import { z } from 'zod';
import { rows, one } from './db.js';
import { required, teacher } from './auth.js';
import type { ResultRow, SavedAnswer, CommonMistake, ReportFocus } from '../src/report-types.js';

const querySchema = z.object({
  class_id: z.string().uuid().optional(),
  season_id: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  focus: z.enum(['all', 'help', 'review', 'not_started', 'awaiting_test']).default('all'),
});
type Filters = z.infer<typeof querySchema>;
type InternalRow = ResultRow & { results_snapshot: SavedAnswer[] | null; total: number | null };

async function reportRows(teacherId: string, filters: Filters) {
  return rows<InternalRow>(
    `SELECT c.id class_id,c.name class_name,u.id user_id,u.name,s.id season_id,s.title,a.due_at,
    (SELECT count(*)::int FROM episodes e WHERE e.season_id=s.id) episode_count,
    (SELECT count(*)::int FROM completions p JOIN episodes e ON e.id=p.episode_id WHERE e.season_id=s.id AND p.user_id=u.id) watched,
    (SELECT count(DISTINCT ma.episode_id)::int FROM micro_answers ma JOIN episodes e ON e.id=ma.episode_id WHERE e.season_id=s.id AND ma.user_id=u.id AND ma.passed) micro_correct,
    (SELECT count(DISTINCT ma.episode_id)::int FROM micro_answers ma JOIN episodes e ON e.id=ma.episode_id WHERE e.season_id=s.id AND ma.user_id=u.id) micro_answered,
    (SELECT max(round(100.0*t.score/t.total))::int FROM assessment_attempts t WHERE t.season_id=s.id AND t.user_id=u.id) test_score,
    latest.id latest_attempt_id,latest.created_at latest_at,latest.results_snapshot,latest.total,
    round(100.0*latest.score/latest.total)::int latest_score,
    (SELECT round(100.0*t.score/t.total)::int FROM assessment_attempts t WHERE t.season_id=s.id AND t.user_id=u.id ORDER BY t.created_at DESC,t.id DESC OFFSET 1 LIMIT 1) previous_score,
    r.id retelling_id,r.teacher_score,r.feedback,r.transcript,r.created_at retelling_at
    FROM classrooms c JOIN memberships m ON m.class_id=c.id JOIN users u ON u.id=m.user_id
    JOIN assignments a ON a.class_id=c.id JOIN seasons s ON s.id=a.season_id
    LEFT JOIN LATERAL(SELECT * FROM assessment_attempts WHERE user_id=u.id AND season_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL(SELECT * FROM retellings WHERE user_id=u.id AND season_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
    WHERE c.teacher_id=$1 AND ($2::uuid IS NULL OR c.id=$2) AND ($3::uuid IS NULL OR s.id=$3)
    AND ($4::text IS NULL OR strpos(lower(u.name),lower($4))>0)
    ORDER BY c.name,u.name,s.title,c.id,u.id,s.id`,
    [teacherId, filters.class_id ?? null, filters.season_id ?? null, filters.q || null],
  );
}
function matches(r: ResultRow, focus: ReportFocus) {
  switch (focus) {
    case 'help':
      return r.latest_score !== null && r.latest_score < 70;
    case 'review':
      return r.retelling_id !== null && r.teacher_score === null;
    case 'not_started':
      return !r.watched && !r.micro_answered && !r.latest_attempt_id && !r.retelling_id;
    case 'awaiting_test':
      return (
        r.latest_score === null &&
        (r.watched > 0 || r.micro_answered > 0 || r.retelling_id !== null)
      );
    default:
      return true;
  }
}
const publicRow = ({ results_snapshot, total, ...row }: InternalRow): ResultRow => row;
function insights(list: InternalRow[]) {
  // One latest assessment per learner/topic, even when assigned in two owned classes.
  const unique = [
    ...new Map(
      list.filter((r) => r.latest_attempt_id).map((r) => [r.latest_attempt_id!, r]),
    ).values(),
  ];
  const available = unique.filter((r) => r.results_snapshot?.length === r.total);
  const groups = new Map<string, CommonMistake>();
  for (const row of available)
    for (const answer of row.results_snapshot!) {
      const key = JSON.stringify([
        row.season_id,
        answer.id,
        answer.prompt,
        answer.options,
        answer.correct,
        answer.explanation,
        answer.episode_id,
      ]);
      const item = groups.get(key) || {
        ...answer,
        key,
        season_id: row.season_id,
        title: row.title,
        wrong: 0,
        answered: 0,
      };
      item.answered++;
      if (!answer.passed) item.wrong++;
      groups.set(key, item);
    }
  return {
    coverage: { available: available.length, total: unique.length },
    mistakes: [...groups.values()]
      .filter((q) => q.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || a.prompt.localeCompare(b.prompt))
      .slice(0, 6),
  };
}

export function reportsRouter() {
  const router = Router();
  router.use(['/results', '/results.csv'], required, teacher);
  router.get('/results', async (req, res) => {
    const filters = querySchema.parse(req.query);
    res.json(
      (await reportRows(req.user!.id, filters))
        .filter((r) => matches(r, filters.focus))
        .map(publicRow),
    );
  });
  router.get('/results/overview', async (req, res) => {
    const filters = querySchema.parse(req.query);
    const [list, options] = await Promise.all([
      reportRows(req.user!.id, filters),
      rows(
        `SELECT c.id class_id,c.name class_name,s.id season_id,s.title
        FROM classrooms c LEFT JOIN assignments a ON a.class_id=c.id LEFT JOIN seasons s ON s.id=a.season_id
        WHERE c.teacher_id=$1 ORDER BY c.name,s.title`,
        [req.user!.id],
      ),
    ]);
    res.json({
      rows: list.filter((r) => matches(r, filters.focus)).map(publicRow),
      options,
      counts: {
        learners: new Set(list.map((r) => r.user_id)).size,
        help: new Set(list.filter((r) => matches(r, 'help')).map((r) => r.latest_attempt_id)).size,
        review: new Set(list.filter((r) => matches(r, 'review')).map((r) => r.retelling_id)).size,
      },
      ...insights(list),
    });
  });
  router.get('/results/attempts/:id', async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const classId = z.string().uuid().parse(req.query.class_id);
    const result = await one(
      `SELECT t.id,u.name,c.name class_name,s.title,t.season_id,t.score,t.total,t.created_at,t.kind,t.snapshot_source,t.results_snapshot
      FROM attempts t JOIN users u ON u.id=t.user_id JOIN seasons s ON s.id=t.season_id
      JOIN memberships m ON m.user_id=t.user_id JOIN classrooms c ON c.id=m.class_id
      JOIN assignments a ON a.class_id=c.id AND a.season_id=t.season_id
      WHERE t.id=$1 AND c.teacher_id=$2 AND c.id=$3 AND t.kind<>'practice'`,
      [id, req.user!.id, classId],
    );
    if (!result) {
      res.status(404).json({ error: 'Не найдено или нет доступа' });
      return;
    }
    const { results_snapshot, ...summary } = result;
    res.json({
      ...summary,
      results: results_snapshot?.length === result.total ? results_snapshot : [],
    });
  });
  router.get('/results.csv', async (req, res) => {
    const filters = querySchema.parse(req.query);
    const list = (await reportRows(req.user!.id, filters)).filter((r) => matches(r, filters.focus));
    const cell = (value: unknown) =>
      '"' +
      String(value ?? '')
        .replace(/^[=+@\-\t\r]/, "'")
        .replaceAll('"', '""') +
      '"';
    const csv = [
      'Класс;Ученик;Сезон;Просмотрено;Серий;Верные микровопросы;Последний тест %;Предыдущий тест %;Лучший тест %;Дата последнего теста;Пересказ %;Комментарий',
      ...list.map((r) =>
        [
          r.class_name,
          r.name,
          r.title,
          r.watched,
          r.episode_count,
          r.micro_correct,
          r.latest_score,
          r.previous_score,
          r.test_score,
          r.latest_at ? new Date(r.latest_at).toISOString() : '',
          r.teacher_score,
          r.feedback,
        ]
          .map(cell)
          .join(';'),
      ),
    ].join('\r\n');
    res
      .type('text/csv; charset=utf-8')
      .attachment('oylatap-results.csv')
      .send('\uFEFF' + csv);
  });
  return router;
}
