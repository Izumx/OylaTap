import { Router, type Request } from 'express';
import { z } from 'zod';
import { rows } from './db.js';
import { statsSql, quality } from './analytics.js';
import { schoolWeek } from './curriculum.js';

// Concept 3.0: an endless feed served in batches. The client sends the episodes it
// already showed; once nothing new is left it starts over with the best of what was
// watched, so the feed never ends in a dead end.
const BATCH = 8;
// Clips of one season in a row inside a batch; the rest of the series comes later.
const PER_SEASON = 2;
const MAX_EXCLUDE = 500;

type Candidate = {
  id: string;
  title: string;
  subject: string;
  language: string;
  grade: number;
  owner_id: string;
  published_at: string | null;
  topic_title_ru: string | null;
  topic_title_kk: string | null;
  topic_grade: number | null;
  week_from: number | null;
  week_to: number | null;
};

export function recommendRouter(visibilitySql: string) {
  const router = Router();
  const forYou = async (
    user: Request['user'],
    q: { grade?: number; language?: 'ru' | 'kk'; exclude?: string[] },
  ) => {
    const userId = user?.id || null;
    const grade = user?.role === 'student' ? user.grade : (q.grade ?? null);
    const language = user?.language || q.language || 'ru';
    const exclude = new Set(q.exclude || []);
    const week = schoolWeek();
    const candidates = await rows<Candidate>(
      `SELECT s.id,s.title,s.subject,s.language,s.grade,s.owner_id,s.published_at,
       t.title_ru topic_title_ru,t.title_kk topic_title_kk,t.grade topic_grade,t.week_from,t.week_to
       FROM seasons s LEFT JOIN curriculum_topics t ON t.id=s.topic_id
       WHERE s.status='published' AND ${visibilitySql}
       AND EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=s.id AND e.media_path IS NOT NULL)
       ORDER BY s.published_at DESC NULLS LAST LIMIT 300`,
      [userId],
    );
    if (!candidates.length) return { week, items: [], exhausted: true };
    const ids = candidates.map((c) => c.id);
    const stats = new Map(
      (await rows(statsSql('s.id=ANY($1::uuid[])'), [ids])).map((s) => [s.season_id, quality(s)]),
    );
    const episodes = await rows(
      `SELECT e.id,e.season_id,e.position,
       (EXISTS(SELECT 1 FROM completions c WHERE c.user_id=$2 AND c.episode_id=e.id)
        OR EXISTS(SELECT 1 FROM episode_views v WHERE v.user_id=$2 AND v.episode_id=e.id AND v.watched_ratio>=0.9)) watched,
       EXISTS(SELECT 1 FROM micro_answers m WHERE m.user_id=$2 AND m.episode_id=e.id AND m.passed) passed
       FROM episodes e WHERE e.season_id=ANY($1::uuid[]) AND e.media_path IS NOT NULL ORDER BY e.season_id,e.position`,
      [ids, userId],
    );
    const prefs = userId
      ? (
          await rows(
            `SELECT u.interests,
             coalesce((SELECT array_agg(c.current_season_id) FROM classrooms c JOIN memberships m ON m.class_id=c.id
               WHERE m.user_id=u.id AND c.current_season_id IS NOT NULL),'{}') class_topics,
             coalesce((SELECT array_agg(season_id) FROM (SELECT DISTINCT ON(season_id) season_id,score,total
               FROM assessment_attempts WHERE user_id=u.id ORDER BY season_id,created_at DESC,id DESC) l
               WHERE 100.0*score/total<70),'{}') weak,
             coalesce((SELECT array_agg(f.author_id) FROM author_follows f WHERE f.user_id=u.id),'{}') following
             FROM users u WHERE u.id=$1`,
            [userId],
          )
        )[0]
      : { interests: [], class_topics: [], weak: [], following: [] };
    const kk = language === 'kk';
    const scored = candidates.map((c) => {
      const own = episodes.filter((e) => e.season_id === c.id);
      const pending = own.filter((e) => !(e.watched && e.passed));
      const started = own.some((e) => e.watched);
      const reasons: [number, string][] = [];
      const add = (points: number, reason?: string) => reasons.push([points, reason || '']);
      if (prefs.class_topics.includes(c.id))
        add(6, kk ? 'Сыныбыңның тақырыбы' : 'Тема твоего класса');
      const topic = kk ? c.topic_title_kk : c.topic_title_ru;
      if (
        grade &&
        c.topic_grade === grade &&
        week &&
        c.week_from! - 1 <= week &&
        week <= c.week_to! + 1
      )
        add(
          4,
          kk
            ? `${grade}-сынып бағдарламасы бойынша қазір: ${topic}`
            : `Сейчас по программе ${grade} класса: ${topic}`,
        );
      else if (grade && c.topic_grade === grade && week && c.week_to! < week)
        add(0.8, kk ? `Өткен тақырыпты қайталау: ${topic}` : `Повторение пройденного: ${topic}`);
      if (prefs.weak.includes(c.id))
        add(2.5, kk ? 'Тест нәтижесін жақсартуға' : 'Чтобы улучшить результат теста');
      if (prefs.following.includes(c.owner_id))
        add(2.5, kk ? 'Сен жазылған автор' : 'Автор, на которого ты подписан');
      if (grade) add(c.grade === grade ? 1 : Math.abs(c.grade - grade) > 1 ? -2.5 : -0.5);
      if (prefs.interests.includes(c.subject))
        add(1.5, kk ? 'Сенің қызығушылығың' : 'По твоим интересам');
      add(c.language === language ? 1 : -1.5);
      if (started && pending.length) add(1, kk ? 'Жалғасы' : 'Продолжение темы');
      if (c.published_at && Date.now() - Date.parse(c.published_at) < 14 * 86400000)
        add(0.5, kk ? 'Жаңа' : 'Новое');
      const q = stats.get(c.id);
      add(2 * (q?.quality ?? 0.5));
      if (grade && Math.abs(c.grade - grade) <= 1 && (q?.quality ?? 0) >= 0.65)
        add(0.1, kk ? 'Құрдастарың арасында танымал' : 'Популярно у ровесников');
      // Everything watched and understood: the season comes back only as a rewatch,
      // and says so instead of repeating the original reason.
      const rewatch = !pending.length;
      if (rewatch) add(-6);
      const reason = rewatch
        ? kk
          ? 'Ең жақсысын қайта көру'
          : 'Ещё раз: лучшее из просмотренного'
        : reasons.filter(([, r]) => r).sort((a, b) => b[0] - a[0])[0]?.[1] ||
          (kk ? 'Жақсы түсіндірілген тақырып' : 'Хорошо объяснённая тема');
      // Unfinished episodes first, in series order; then the rest for a rewatch.
      const order = [...pending, ...own.filter((e) => !pending.includes(e))];
      return {
        c,
        score: reasons.reduce((n, [p]) => n + p, 0),
        reason,
        next: order.filter((e) => !exclude.has(e.id)),
      };
    });
    const open = scored.filter((s) => s.next.length).sort((a, b) => b.score - a.score);
    // At most two seasons of one author in a batch while others are available,
    // so new authors get a chance.
    const perAuthor = new Map<string, number>();
    const authors = new Set(open.map((s) => s.c.owner_id));
    const items: { season_id: string; episode_id: string; reason: string }[] = [];
    for (const s of open) {
      if (items.length >= BATCH) break;
      const n = perAuthor.get(s.c.owner_id) || 0;
      if (n >= 2 && authors.size > perAuthor.size) continue;
      perAuthor.set(s.c.owner_id, n + 1);
      for (const e of s.next.slice(0, Math.min(PER_SEASON, BATCH - items.length)))
        items.push({ season_id: s.c.id, episode_id: e.id, reason: s.reason });
    }
    return { week, items, exhausted: items.length === 0 };
  };
  const query = z.object({
    grade: z.coerce.number().int().min(5).max(11).optional(),
    language: z.enum(['ru', 'kk']).optional(),
  });
  router.get('/foryou', async (req, res) => {
    res.json(await forYou(req.user, query.parse(req.query)));
  });
  // POST because the list of already shown episodes does not fit in a URL.
  router.post('/foryou', async (req, res) => {
    const d = query
      .extend({ exclude: z.array(z.string().uuid()).max(MAX_EXCLUDE).default([]) })
      .parse(req.body);
    res.json(await forYou(req.user, d));
  });
  return router;
}
