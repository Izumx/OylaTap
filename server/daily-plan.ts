import type { PoolClient } from 'pg';
import { db } from './db.js';
import type { User } from './auth.js';

type Mode = 'school' | 'free';
type EpisodeProgress = {
  id: string;
  title: string;
  position: number;
  watched: boolean;
  passed: boolean;
};

// Selection and persistence share one transaction. Concurrent tabs cannot create
// different portions for the same learner/day. No network or media work holds the lock.
export async function dailyPlan(user: User | undefined, mode: Mode, visibilitySql: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (user)
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `oylatap-daily:${user.id}`,
      ]);
    const result = await selectPlan(client, user, mode, visibilitySql);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function selectPlan(
  client: PoolClient,
  user: User | undefined,
  mode: Mode,
  visibilitySql: string,
) {
  const userId = user?.id || null;
  const { session_date: date } = (
    await client.query("SELECT (now() AT TIME ZONE 'Asia/Qyzylorda')::date::text session_date")
  ).rows[0];
  const visible = (
    await client.query(
      `SELECT s.id,s.title,s.language,s.grade,s.subject,
       EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=s.id AND e.media_path IS NOT NULL
         AND NOT (EXISTS(SELECT 1 FROM completions c WHERE c.user_id=$1 AND c.episode_id=e.id)
           AND EXISTS(SELECT 1 FROM micro_answers ma WHERE ma.user_id=$1 AND ma.episode_id=e.id AND ma.passed))) route_pending
       FROM seasons s WHERE s.status='published' AND ${visibilitySql}
       AND EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=s.id AND e.media_path IS NOT NULL)
       ORDER BY s.created_at,s.id`,
      [userId],
    )
  ).rows;
  if (!visible.length)
    return { season_id: null, episode_ids: [], goal: 0, correct: 0, mode, session_date: date };
  const preferences = user
    ? (await client.query('SELECT current_season_id,interests FROM users WHERE id=$1', [userId]))
        .rows[0]
    : null;
  const current =
    mode === 'school' && user
      ? (
          await client.query(
            `SELECT c.id,c.name,c.current_season_id FROM classrooms c
             JOIN memberships m ON m.class_id=c.id
             WHERE m.user_id=$1 AND c.current_season_id=ANY($2::uuid[])
             ORDER BY c.created_at DESC,c.id LIMIT 1`,
            [userId, visible.map((s) => s.id)],
          )
        ).rows[0]
      : null;
  // Automatic recommendations stay fixed today. An explicit topic change is the
  // exception: the teacher's current topic immediately overrides a personal plan.
  const contextKey = current
    ? `class:${current.id}:${current.current_season_id}`
    : `${mode}:auto:${preferences?.current_season_id || ''}`;
  const stored = user
    ? (
        await client.query(
          'SELECT * FROM daily_sessions WHERE user_id=$1 AND session_date=$2 AND mode=$3',
          [userId, date, mode],
        )
      ).rows[0]
    : null;
  let season = stored && visible.find((s) => s.id === stored.season_id);
  let selection = stored;
  if (!season || stored.context_key !== contextKey) {
    let topicId = preferences?.current_season_id;
    let source = topicId ? 'personal' : 'library';
    let className: string | null = null;
    if (current) {
      topicId = current.current_season_id;
      source = 'class';
      className = current.name;
    } else if (mode === 'school' && user) {
      // An assignment is submitted once every video was watched and a final test
      // was submitted. The score is not an implicit mastery threshold; retellings
      // remain optional until assignments have explicit completion requirements.
      const assigned = (
        await client.query(
          `SELECT a.season_id,c.name FROM assignments a
           JOIN classrooms c ON c.id=a.class_id JOIN memberships m ON m.class_id=c.id
           WHERE m.user_id=$1 AND a.season_id=ANY($2::uuid[])
           AND (NOT EXISTS(SELECT 1 FROM assessment_attempts t WHERE t.user_id=$1 AND t.season_id=a.season_id)
             OR EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=a.season_id
               AND NOT EXISTS(SELECT 1 FROM completions p WHERE p.user_id=$1 AND p.episode_id=e.id)))
           ORDER BY a.due_at,a.created_at,a.id LIMIT 1`,
          [userId, visible.map((s) => s.id)],
        )
      ).rows[0];
      if (assigned) {
        topicId = assigned.season_id;
        source = 'assignment';
        className = assigned.name;
      }
    } else if (mode === 'free' && user) {
      const weak = (
        await client.query(
          `SELECT season_id FROM (SELECT DISTINCT ON(season_id) season_id,score,total
           FROM assessment_attempts WHERE user_id=$1 AND season_id=ANY($2::uuid[])
           ORDER BY season_id,created_at DESC,id DESC) latest WHERE 100.0*score/total<70
           ORDER BY 100.0*score/total,season_id LIMIT 1`,
          [userId, visible.map((s) => s.id)],
        )
      ).rows[0];
      if (weak) {
        topicId = weak.season_id;
        source = 'review';
      }
    }
    visible.sort(
      (a, b) =>
        Number(b.id === topicId) - Number(a.id === topicId) ||
        Number(b.route_pending) - Number(a.route_pending) ||
        Number(b.language === user?.language) - Number(a.language === user?.language) ||
        Number(b.grade === user?.grade) - Number(a.grade === user?.grade) ||
        Number(preferences?.interests?.includes(b.subject) || false) -
          Number(preferences?.interests?.includes(a.subject) || false),
    );
    season = visible[0];
    if (season.id !== topicId) source = 'library';
    selection = { topic_source: source, class_name: className };
  }
  const episodes = (
    await client.query<EpisodeProgress>(
      `SELECT e.id,e.title,e.position,
       EXISTS(SELECT 1 FROM completions c WHERE c.user_id=$1 AND c.episode_id=e.id) watched,
       EXISTS(SELECT 1 FROM micro_answers ma WHERE ma.user_id=$1 AND ma.episode_id=e.id AND ma.passed) passed
       FROM episodes e WHERE e.season_id=$2 AND e.media_path IS NOT NULL ORDER BY e.position`,
      [userId, season.id],
    )
  ).rows;
  const remaining = episodes.filter((ep) => !(ep.watched && ep.passed));
  if (!stored || season.id !== stored.season_id || stored.context_key !== contextKey) {
    selection.episode_ids = (remaining.length ? remaining : episodes).slice(0, 3).map((e) => e.id);
    selection.is_review = remaining.length === 0;
    if (user)
      await client.query(
        `INSERT INTO daily_sessions(user_id,session_date,mode,season_id,episode_ids,context_key,topic_source,class_name,is_review)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(user_id,session_date,mode) DO UPDATE SET
         season_id=EXCLUDED.season_id,episode_ids=EXCLUDED.episode_ids,context_key=EXCLUDED.context_key,
         topic_source=EXCLUDED.topic_source,class_name=EXCLUDED.class_name,is_review=EXCLUDED.is_review,created_at=now()`,
        [
          userId,
          date,
          mode,
          season.id,
          selection.episode_ids,
          contextKey,
          selection.topic_source,
          selection.class_name,
          selection.is_review,
        ],
      );
  }
  const selected = episodes.filter((e) => selection.episode_ids.includes(e.id));
  const correctIds = selected.filter((e) => e.passed).map((e) => e.id);
  const completedIds = selected.filter((e) => e.watched && e.passed).map((e) => e.id);
  const next = remaining.find((e) => !selection.episode_ids.includes(e.id));
  const checks = (
    await client.query(
      `SELECT EXISTS(SELECT 1 FROM assessment_attempts WHERE user_id=$1 AND season_id=$2) has_test,
       EXISTS(SELECT 1 FROM retellings WHERE user_id=$1 AND season_id=$2) has_retelling`,
      [userId, season.id],
    )
  ).rows[0];
  return {
    season_id: season.id,
    episode_ids: selected.map((e) => e.id),
    goal: selected.length,
    correct: correctIds.length,
    correct_ids: correctIds,
    completed_ids: completedIds,
    session_complete: completedIds.length === selected.length,
    session_date: date,
    mode,
    topic_source: selection.topic_source,
    class_name: selection.class_name,
    topic: season.title,
    is_review: selection.is_review,
    route_done: episodes.length - remaining.length,
    route_total: episodes.length,
    next_episode: next ? { id: next.id, title: next.title, position: next.position } : null,
    next_step: next
      ? 'continue'
      : !checks.has_test
        ? 'quiz'
        : !checks.has_retelling
          ? 'retelling'
          : 'complete',
  };
}
