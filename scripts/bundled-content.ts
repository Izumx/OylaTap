import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import type pg from 'pg';
import { subjectSchema } from '../server/curriculum.js';
import khanate from '../content/khanate-flow/lesson.json' with { type: 'json' };
import prince from '../content/little-prince-grok/lesson.json' with { type: 'json' };

export const khanateId = 'f9285ed2-b8cf-419e-83e8-c6844a65f74a';
export const princeId = 'a260b7a9-8f7c-4e8c-bd87-38f8d1ee0d20';
export const legacyIds = Array.from(
  { length: 6 },
  (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const lessonSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  subject: subjectSchema,
  language: z.enum(['ru', 'kk']),
  grade: z.number().int().min(5).max(11),
  source_name: z.string().min(1),
  source_text: z.string().min(1),
  episodes: z.array(z.object({ title: z.string(), script: z.string() })).length(1),
  questions: z
    .array(
      z
        .object({
          purpose: z.enum(['micro', 'final']),
          episode_position: z.literal(0),
          prompt: z.string(),
          options: z.array(z.string()).min(2),
          correct: z.number().int().nonnegative(),
          explanation: z.string(),
        })
        .refine((q) => q.correct < q.options.length, 'Answer outside options'),
    )
    .min(2),
});
export const bundledLessons = [
  {
    id: khanateId,
    lesson: lessonSchema.parse(khanate),
    duration: 48,
    path: 'content/khanate-flow/oylatap-khanate-full-ru.mp4',
    topic: '40000000-0000-4000-8000-000000000502',
    color: 'sage',
    art: 'history',
  },
  {
    id: princeId,
    lesson: lessonSchema.parse(prince),
    duration: 38,
    path: 'content/little-prince-grok/oylatap-little-prince-kk.mp4',
    topic: null,
    color: 'lilac',
    art: 'book',
  },
];

/** Back up existing installations before running. Unrelated authored lessons are preserved. */
export async function syncBundledContent(pool: pg.Pool, ownerId: string) {
  // Fail before changing the database if either real video is missing or empty.
  for (const item of bundledLessons) {
    const media = await stat(item.path);
    if (!media.isFile() || !media.size) throw new Error(`Missing bundled video: ${item.path}`);
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(4912772)');
    const owner = await c.query(
      "SELECT id FROM users WHERE id=$1 AND role IN ('teacher','creator')",
      [ownerId],
    );
    if (!owner.rowCount)
      throw new Error('An existing teacher or creator is required as content owner.');
    for (const item of bundledLessons) {
      const s = item.lesson;
      await c.query(
        `INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,color,art,status,source_name,source_text,visibility,topic_id,published_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'published',$10,$11,'public',$12,now())
        ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
          subject=EXCLUDED.subject,language=EXCLUDED.language,grade=EXCLUDED.grade,
          source_name=EXCLUDED.source_name,source_text=EXCLUDED.source_text,
          status='published',visibility='public',topic_id=EXCLUDED.topic_id,updated_at=now()`,
        [
          item.id,
          ownerId,
          s.title,
          s.description,
          s.subject,
          s.language,
          s.grade,
          item.color,
          item.art,
          s.source_name,
          s.source_text,
          item.topic,
        ],
      );
      const e = s.episodes[0];
      const episode = (
        await c.query(
          `INSERT INTO episodes(id,season_id,position,title,script,duration,media_path,media_kind)
        VALUES($1,$2,0,$3,$4,$5,$6,'uploaded') ON CONFLICT(season_id,position) DO UPDATE
        SET title=EXCLUDED.title,script=EXCLUDED.script,duration=EXCLUDED.duration,
          media_path=EXCLUDED.media_path,media_kind='uploaded' RETURNING id`,
          [randomUUID(), item.id, e.title, e.script, item.duration, item.path],
        )
      ).rows[0];
      for (const [i, q] of s.questions.entries()) {
        await c.query(
          `INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id,purpose)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(season_id,position) DO UPDATE SET
            prompt=EXCLUDED.prompt,options=EXCLUDED.options,correct=EXCLUDED.correct,
            explanation=EXCLUDED.explanation,episode_id=EXCLUDED.episode_id,purpose=EXCLUDED.purpose`,
          [
            randomUUID(),
            item.id,
            i,
            q.prompt,
            JSON.stringify(q.options),
            q.correct,
            q.explanation,
            episode.id,
            q.purpose,
          ],
        );
      }
    }
    const legacy = (
      await c.query(
        `SELECT s.id FROM seasons s
      WHERE s.id=ANY($1::uuid[]) AND s.owner_id=ANY($2::uuid[])
        AND s.source_name='Демонстрационные материалы OylaTap; требуется проверка учителем'
        AND NOT EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=s.id AND e.media_kind<>'rendered')`,
        [
          legacyIds,
          ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'],
        ],
      )
    ).rows.map((x) => x.id);
    const removed = (
      await c.query(
        'SELECT id,season_id,media_path FROM episodes WHERE season_id=ANY($1::uuid[])',
        [legacy],
      )
    ).rows;
    // Keep the history route and its existing assignments attached to the actual film.
    if (legacy.includes(legacyIds[0])) {
      for (const table of ['users', 'classrooms'])
        await c.query(`UPDATE ${table} SET current_season_id=$1 WHERE current_season_id=$2`, [
          khanateId,
          legacyIds[0],
        ]);
      await c.query(
        `UPDATE assignments a SET season_id=$1 WHERE a.season_id=$2
        AND NOT EXISTS(SELECT 1 FROM assignments b WHERE b.class_id=a.class_id AND b.season_id=$1)`,
        [khanateId, legacyIds[0]],
      );
    }
    await c.query('DELETE FROM seasons WHERE id=ANY($1::uuid[])', [legacy]);
    await c.query('COMMIT');
    return {
      lessons: bundledLessons.map((x) => x.id),
      removedSeasons: legacy,
      removedMedia: removed,
    };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
