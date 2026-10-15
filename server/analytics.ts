import { Router } from 'express';
import { z } from 'zod';
import { db, rows, one } from './db.js';
import { required, author } from './auth.js';

export type SeasonStats = {
  season_id: string;
  views: number;
  completed: number;
  viewers: number;
  likes: number;
  answers: number;
  passed: number;
};
// Per-season engagement. A view is one learner on one episode; completion is ≥90% watched.
// Understanding counts each learner's first microquestion answer, not retries.
export const statsSql = (where = 'true') => `
 SELECT s.id season_id,
  coalesce(v.views,0)::int views, coalesce(v.completed,0)::int completed, coalesce(v.viewers,0)::int viewers,
  coalesce(l.likes,0)::int likes, coalesce(a.answers,0)::int answers, coalesce(a.passed,0)::int passed
 FROM seasons s
 LEFT JOIN (SELECT e.season_id,count(*) views,count(*) FILTER (WHERE ev.watched_ratio>=0.9) completed,
   count(DISTINCT ev.user_id) viewers FROM episode_views ev JOIN episodes e ON e.id=ev.episode_id GROUP BY 1) v ON v.season_id=s.id
 LEFT JOIN (SELECT e.season_id,count(*) likes FROM episode_likes x JOIN episodes e ON e.id=x.episode_id GROUP BY 1) l ON l.season_id=s.id
 LEFT JOIN (SELECT season_id,count(*) answers,count(*) FILTER (WHERE passed) passed FROM (
   SELECT DISTINCT ON (ma.user_id,ma.episode_id) e.season_id,ma.passed FROM micro_answers ma
   JOIN episodes e ON e.id=ma.episode_id ORDER BY ma.user_id,ma.episode_id,ma.created_at) f GROUP BY 1) a ON a.season_id=s.id
 WHERE ${where}`;

// Smoothed towards a neutral prior so a video with three views cannot top the feed.
// Understanding weighs as much as watching; likes least, to avoid rewarding clickbait.
const PRIOR = 10;
export function quality(s: SeasonStats) {
  const completion = (s.completed + 0.6 * PRIOR) / (s.views + PRIOR);
  const likeRate = Math.min(1, ((s.likes + 0.08 * PRIOR) / (s.views + PRIOR)) * 4);
  const understanding = (s.passed + 0.6 * PRIOR) / (s.answers + PRIOR);
  return {
    completion_rate: s.views ? Math.round((100 * s.completed) / s.views) : null,
    like_rate: s.views ? Math.round((100 * s.likes) / s.views) : null,
    understanding_rate: s.answers ? Math.round((100 * s.passed) / s.answers) : null,
    quality: Number((0.4 * completion + 0.2 * likeRate + 0.4 * understanding).toFixed(3)),
  };
}

// Patterns are only reported once enough learners watched; small samples mislead authors.
export const MIN_VIEWS_FOR_INSIGHTS = 20;
export async function styleInsights() {
  const published = await rows(
    `SELECT st.*,s.style,s.subject FROM (${statsSql("s.status='published' AND NOT s.hidden")}) st JOIN seasons s ON s.id=st.season_id`,
  );
  const scored = published.map((s) => ({ ...s, ...quality(s) }));
  const styles = ['cards', 'board', 'captions'].map((style) => {
    const list = scored.filter((s) => s.style === style);
    const sum = (k: keyof SeasonStats) => list.reduce((n, s) => n + Number(s[k]), 0);
    const total = {
      season_id: style,
      views: sum('views'),
      completed: sum('completed'),
      viewers: sum('viewers'),
      likes: sum('likes'),
      answers: sum('answers'),
      passed: sum('passed'),
    };
    return { style, seasons: list.length, views: total.views, ...quality(total) };
  });
  const measured = styles.filter((s) => s.views >= MIN_VIEWS_FOR_INSIGHTS);
  const recommended = measured.sort((a, b) => b.quality - a.quality)[0]?.style || null;
  const top = scored
    .filter((s) => s.views >= MIN_VIEWS_FOR_INSIGHTS)
    .sort((a, b) => b.quality - a.quality)
    .slice(0, Math.max(1, Math.ceil(scored.length / 4)));
  // English for the model prompt, Russian for the author's studio.
  const hints: { en: string; ru: string }[] = [];
  if (top.length) {
    const episodes = await rows<{ script: string }>(
      'SELECT script FROM episodes WHERE season_id=ANY($1::uuid[])',
      [top.map((s) => s.season_id)],
    );
    if (episodes.length) {
      const avg = Math.round(episodes.reduce((n, e) => n + e.script.length, 0) / episodes.length);
      const hooks = episodes.filter((e) => /^[^.!?]{3,140}\?/.test(e.script.trim())).length;
      const formulas = episodes.filter((e) => /`[^`]+`|\s=\s/.test(e.script)).length;
      hints.push({
        en: `Keep each episode around ${avg} characters, like the best lessons.`,
        ru: `У лучших роликов серия в среднем ${avg} символов.`,
      });
      if (hooks / episodes.length >= 0.4)
        hints.push({
          en: 'Open each episode with a short question that creates curiosity.',
          ru: 'Лучшие серии начинаются с короткого вопроса-крючка.',
        });
      if (formulas / episodes.length >= 0.4)
        hints.push({
          en: 'Put each formula or calculation step on its own line.',
          ru: 'Каждую формулу или шаг вычисления пишите отдельной строкой.',
        });
    }
  }
  if (recommended)
    hints.push({
      en: `The best performing visual style is "${recommended}".`,
      ru: `Сейчас лучше всего работает стиль «${{ cards: 'Карточки', board: 'Доска', captions: 'Субтитры' }[recommended]}».`,
    });
  return { styles, recommended, hints, min_views: MIN_VIEWS_FOR_INSIGHTS };
}

export function analyticsRouter(visibilitySql: string) {
  const router = Router();
  const uid = z.string().uuid();
  const visibleEpisode = (userId: string, id: string) =>
    one(
      `SELECT e.id FROM episodes e JOIN seasons s ON s.id=e.season_id WHERE e.id=$2 AND s.status='published' AND ${visibilitySql}`,
      [userId, id],
    );
  router.post('/episodes/:id/view', required, async (req, res) => {
    const id = uid.parse(req.params.id);
    const { ratio } = z.object({ ratio: z.number().min(0).max(1) }).parse(req.body);
    if (!(await visibleEpisode(req.user!.id, id))) {
      res.status(404).json({ error: 'Не найдено или нет доступа' });
      return;
    }
    await db.query(
      `INSERT INTO episode_views(user_id,episode_id,watched_ratio) VALUES($1,$2,$3)
       ON CONFLICT(user_id,episode_id) DO UPDATE SET watched_ratio=GREATEST(episode_views.watched_ratio,EXCLUDED.watched_ratio),last_at=now()`,
      [req.user!.id, id, ratio],
    );
    res.json({ ok: true });
  });
  router.post('/episodes/:id/like', required, async (req, res) => {
    const id = uid.parse(req.params.id);
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
    if (!(await visibleEpisode(req.user!.id, id))) {
      res.status(404).json({ error: 'Не найдено или нет доступа' });
      return;
    }
    if (liked)
      await db.query(
        'INSERT INTO episode_likes(user_id,episode_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [req.user!.id, id],
      );
    else
      await db.query('DELETE FROM episode_likes WHERE user_id=$1 AND episode_id=$2', [
        req.user!.id,
        id,
      ]);
    const { likes } = (await one(
      'SELECT count(*)::int likes FROM episode_likes WHERE episode_id=$1',
      [id],
    ))!;
    res.json({ liked, likes });
  });
  router.get('/studio/stats', required, author, async (req, res) => {
    const list = await rows(
      `SELECT st.*,s.title,s.status,s.style,s.hidden,
       (SELECT count(*)::int FROM content_reports r WHERE r.season_id=s.id AND r.status='open') open_reports
       FROM (${statsSql('s.owner_id=$1')}) st JOIN seasons s ON s.id=st.season_id ORDER BY s.created_at DESC`,
      [req.user!.id],
    );
    res.json({
      trust_level: req.user!.trust_level,
      seasons: list.map((s) => ({ ...s, ...quality(s) })),
    });
  });
  router.get('/insights/styles', required, author, async (req, res) => {
    res.json(await styleInsights());
  });
  return router;
}
