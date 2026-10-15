import { Router } from 'express';
import { z } from 'zod';
import { rows } from './db.js';

export const subjectIds = [
  'kz-history',
  'world-history',
  'kz-literature',
  'ru-literature',
  'algebra',
  'geometry',
] as const;
export const subjectSchema = z.enum(subjectIds);

// School week in Kazakhstan time: week 1 starts on 1 September. Returns null in the
// summer break, when the programme gives no current topic.
export function schoolWeek(now = new Date()) {
  const local = new Date(now.getTime() + 5 * 3600000);
  const year = local.getUTCMonth() >= 8 ? local.getUTCFullYear() : local.getUTCFullYear() - 1;
  const start = Date.UTC(year, 8, 1);
  const week = Math.floor((local.getTime() - start) / (7 * 86400000)) + 1;
  return week >= 1 && week <= 36 ? week : null;
}

export function curriculumRouter() {
  const router = Router();
  router.get('/curriculum', async (req, res) => {
    const q = z
      .object({
        subject: subjectSchema.optional(),
        grade: z.coerce.number().int().min(5).max(11).optional(),
      })
      .parse(req.query);
    res.json({
      week: schoolWeek(),
      topics: await rows(
        `SELECT id,subject,grade,title_ru,title_kk,week_from,week_to FROM curriculum_topics
         WHERE ($1::text IS NULL OR subject=$1) AND ($2::int IS NULL OR grade=$2)
         ORDER BY subject,grade,week_from`,
        [q.subject ?? null, q.grade ?? null],
      ),
    });
  });
  return router;
}
