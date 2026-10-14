import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { PDFParse } from 'pdf-parse';
import { db, rows, one } from './db.js';
import {
  auth,
  required,
  teacher,
  hashPassword,
  verifyPassword,
  createSession,
  cookieToken,
  tokenHash,
} from './auth.js';
import { dataDir, renderSeason } from './render.js';
import { aiEnabled, generateDraft, materialSchema } from './ai.js';

const app = express();
const exec = promisify(execFile);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
    let host = '';
    try {
      host = new URL(req.headers.origin).host;
    } catch {}
    if (host !== req.headers.host) {
      res.status(403).json({ error: 'Запрос с другого сайта отклонён' });
      return;
    }
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use('/api', auth);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 1, fields: 3 },
});
const uid = z.string().uuid();
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const notFound = () => {
  throw new HttpError(404, 'Не найдено или нет доступа');
};
const fail = (message: string) => {
  throw new HttpError(400, message);
};
const demo = process.env.DEMO_MODE === 'true';
const limitMap = new Map<string, { n: number; until: number }>();
app.use('/api/auth', (req, res, next) => {
  const key = req.ip || 'local';
  const now = Date.now();
  let r = limitMap.get(key);
  if (!r || r.until < now) {
    r = { n: 0, until: now + 10 * 60000 };
    limitMap.set(key, r);
  }
  if (++r.n > 40) {
    res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут.' });
    return;
  }
  if (limitMap.size > 10000) for (const [k, v] of limitMap) if (v.until < now) limitMap.delete(k);
  next();
});
const visibilitySql =
  "(s.visibility='public' OR s.owner_id=$1 OR EXISTS(SELECT 1 FROM assignments av JOIN memberships mv ON mv.class_id=av.class_id WHERE av.season_id=s.id AND mv.user_id=$1))";
const publicUser = (u: any) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  grade: u.grade,
  language: u.language,
});
app.get('/api/health', async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, database: 'PostgreSQL' });
});
app.get('/api/me', (req, res) => res.json({ user: req.user || null, demo }));
app.get('/api/ai/status', required, teacher, (req, res) => res.json({ draft_enabled: aiEnabled }));
app.post('/api/material/draft', required, teacher, async (req, res) => {
  if (!aiEnabled)
    throw new HttpError(503, 'Локальный ИИ не подключён. Можно редактировать сценарий вручную.');
  const input = materialSchema.parse(req.body);
  try {
    res.json(await generateDraft(input));
  } catch (error) {
    throw new HttpError(
      502,
      error instanceof z.ZodError
        ? 'ИИ вернул неподходящий черновик. Материал сохранён, попробуйте ещё раз.'
        : error instanceof Error
          ? error.message
          : 'Локальный ИИ недоступен',
    );
  }
});
app.post('/api/auth/demo', async (req, res) => {
  if (!demo) notFound();
  const { role } = z.object({ role: z.enum(['student', 'teacher']) }).parse(req.body);
  const user = await one('SELECT * FROM users WHERE email=$1', [`${role}@demo.oylatap.local`]);
  if (!user) throw new HttpError(503, 'Демонстрационные данные ещё не подготовлены');
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
});
const accountSchema = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .transform((x) => x.toLowerCase().trim()),
  password: z.string().min(10).max(128),
});
app.post('/api/auth/register', async (req, res) => {
  const data = accountSchema
    .extend({
      name: z.string().trim().min(2).max(80),
      role: z.enum(['student', 'teacher']),
      grade: z.number().int().min(5).max(11).default(7),
    })
    .parse(req.body);
  if (await one('SELECT id FROM users WHERE email=$1', [data.email]))
    throw new HttpError(409, 'Этот email уже зарегистрирован');
  const id = randomUUID();
  const user = await one(
    'INSERT INTO users(id,name,email,password_hash,role,grade) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, data.name, data.email, hashPassword(data.password), data.role, data.grade],
  );
  await createSession(res, id);
  res.status(201).json({ user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = accountSchema.parse(req.body);
  const u = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (!u || !verifyPassword(password, u.password_hash))
    throw new HttpError(401, 'Неверный email или пароль');
  await createSession(res, u.id);
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', async (req, res) => {
  const t = cookieToken(req);
  if (t) await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(t)]);
  res.clearCookie('oylatap_session', { path: '/' });
  res.json({ ok: true });
});
app.patch('/api/profile', required, async (req, res) => {
  const data = z
    .object({
      name: z.string().trim().min(2).max(80),
      grade: z.number().int().min(5).max(11),
      language: z.enum(['ru', 'kk']),
    })
    .parse(req.body);
  const u = await one('UPDATE users SET name=$2,grade=$3,language=$4 WHERE id=$1 RETURNING *', [
    req.user!.id,
    data.name,
    data.grade,
    data.language,
  ]);
  res.json({ user: publicUser(u) });
});
const catalogSql = `SELECT s.id,s.title,s.description,s.subject,s.language,s.grade,s.color,s.art,s.status,s.created_at,s.source_name,
 (SELECT count(*)::int FROM episodes e WHERE e.season_id=s.id) episode_count,
 (SELECT coalesce(sum(duration),0)::int FROM episodes e WHERE e.season_id=s.id) duration,
 (SELECT count(*)::int FROM completions c JOIN episodes e ON e.id=c.episode_id WHERE e.season_id=s.id AND c.user_id=$1) completed,
 (SELECT max(round(100.0*a.score/a.total))::int FROM attempts a WHERE a.season_id=s.id AND a.user_id=$1) best_score
 FROM seasons s`;
app.get('/api/catalog', async (req, res) =>
  res.json(
    await rows(
      catalogSql +
        " WHERE s.status='published' AND " +
        visibilitySql +
        ' ORDER BY s.created_at,s.id',
      [req.user?.id || null],
    ),
  ),
);
app.get('/api/my-seasons', required, teacher, async (req, res) =>
  res.json(
    await rows(catalogSql + ' WHERE s.owner_id=$2 ORDER BY s.created_at DESC', [
      req.user!.id,
      req.user!.id,
    ]),
  ),
);
app.get('/api/seasons/:id', async (req, res) => {
  const id = uid.parse(req.params.id);
  const s = await one('SELECT * FROM seasons WHERE id=$1', [id]);
  if (!s || (s.status !== 'published' && s.owner_id !== req.user?.id)) notFound();
  const owner = s.owner_id === req.user?.id;
  if (
    s.status === 'published' &&
    !(await one('SELECT s.id FROM seasons s WHERE s.id=$2 AND ' + visibilitySql, [
      req.user?.id || null,
      id,
    ]))
  )
    notFound();
  const episodes = await rows(
    `SELECT e.id,e.position,e.title,e.script,e.duration,(media_path IS NOT NULL) has_video,
    EXISTS(SELECT 1 FROM completions c WHERE c.episode_id=e.id AND c.user_id=$2) completed
    FROM episodes e WHERE season_id=$1 ORDER BY position`,
    [id, req.user?.id || null],
  );
  const questions = await rows(
    `SELECT id,position,prompt,options${owner ? ',correct,explanation' : ''} FROM questions WHERE season_id=$1 ORDER BY position`,
    [id],
  );
  const attempts = req.user
    ? await rows(
        'SELECT id,score,total,created_at FROM attempts WHERE user_id=$1 AND season_id=$2 ORDER BY created_at DESC',
        [req.user.id, id],
      )
    : [];
  const retellings = req.user
    ? await rows(
        'SELECT id,transcript,teacher_score,feedback,created_at FROM retellings WHERE user_id=$1 AND season_id=$2 ORDER BY created_at DESC',
        [req.user.id, id],
      )
    : [];
  res.json({
    ...s,
    source_text: owner ? s.source_text : undefined,
    episodes,
    questions,
    attempts,
    retellings,
  });
});
app.get('/api/episodes/:id/video', async (req, res) => {
  const ep = await one(
    `SELECT e.media_path,s.status,s.owner_id FROM episodes e JOIN seasons s ON s.id=e.season_id WHERE e.id=$2 AND ((s.status='published' AND ${visibilitySql}) OR s.owner_id=$1)`,
    [req.user?.id || null, uid.parse(req.params.id)],
  );
  if (!ep || !ep.media_path || (ep.status !== 'published' && ep.owner_id !== req.user?.id))
    notFound();
  res.type('video/mp4').sendFile(ep.media_path, { dotfiles: 'allow' });
});
app.post('/api/episodes/:id/complete', required, async (req, res) => {
  const id = uid.parse(req.params.id);
  if (
    !(await one(
      "SELECT e.id FROM episodes e JOIN seasons s ON s.id=e.season_id WHERE e.id=$2 AND s.status='published' AND " +
        visibilitySql,
      [req.user!.id, id],
    ))
  )
    notFound();
  await db.query(
    'INSERT INTO completions(user_id,episode_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [req.user!.id, id],
  );
  res.json({ ok: true });
});
app.post('/api/seasons/:id/attempts', required, async (req, res) => {
  const id = uid.parse(req.params.id);
  if (
    !(await one(
      "SELECT s.id FROM seasons s WHERE s.id=$2 AND s.status='published' AND " + visibilitySql,
      [req.user!.id, id],
    ))
  )
    notFound();
  const { answers } = z
    .object({ answers: z.array(z.number().int().min(0).max(5)).min(1).max(15) })
    .parse(req.body);
  const q = await rows('SELECT * FROM questions WHERE season_id=$1 ORDER BY position', [id]);
  if (q.length !== answers.length) fail('Ответьте на все вопросы');
  const results = q.map((v, i) => ({
    id: v.id,
    prompt: v.prompt,
    options: v.options,
    answer: answers[i],
    correct: v.correct,
    explanation: v.explanation,
    passed: answers[i] === v.correct,
  }));
  const score = results.filter((x) => x.passed).length;
  await db.query(
    'INSERT INTO attempts(id,user_id,season_id,answers,score,total) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), req.user!.id, id, JSON.stringify(answers), score, q.length],
  );
  res.json({ score, total: q.length, results });
});
app.get('/api/progress', required, async (req, res) => {
  const id = req.user!.id;
  const stats = await one(
    `SELECT (SELECT count(*)::int FROM completions WHERE user_id=$1) watched,
  (SELECT count(*)::int FROM attempts WHERE user_id=$1) tests,
  (SELECT count(*)::int FROM retellings WHERE user_id=$1) retellings,
  (SELECT coalesce(round(avg(100.0*score/total)),0)::int FROM attempts WHERE user_id=$1) understanding`,
    [id],
  );
  const activity = await rows(
    `SELECT date::text, sum(n)::int n FROM (
    SELECT completed_at::date date,count(*) n FROM completions WHERE user_id=$1 AND completed_at>=CURRENT_DATE-6 GROUP BY 1
    UNION ALL SELECT created_at::date,count(*) FROM attempts WHERE user_id=$1 AND created_at>=CURRENT_DATE-6 GROUP BY 1
    UNION ALL SELECT created_at::date,count(*) FROM retellings WHERE user_id=$1 AND created_at>=CURRENT_DATE-6 GROUP BY 1
    ) a GROUP BY date ORDER BY date`,
    [id],
  );
  res.json({
    stats,
    activity,
    seasons: await rows(
      catalogSql +
        " WHERE s.status='published' AND (EXISTS(SELECT 1 FROM completions c JOIN episodes e ON e.id=c.episode_id WHERE e.season_id=s.id AND c.user_id=$1) OR EXISTS(SELECT 1 FROM attempts a WHERE a.season_id=s.id AND a.user_id=$1)) ORDER BY s.id",
      [id],
    ),
  });
});
app.get('/api/classes', required, async (req, res) => {
  const list = await rows(
    `SELECT c.*,(SELECT count(*)::int FROM memberships m WHERE m.class_id=c.id) students
    FROM classrooms c WHERE ${req.user!.role === 'teacher' ? 'c.teacher_id=$1' : 'EXISTS(SELECT 1 FROM memberships m WHERE m.class_id=c.id AND m.user_id=$1)'} ORDER BY c.created_at DESC`,
    [req.user!.id],
  );
  res.json(list);
});
app.post('/api/classes', required, teacher, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
  res
    .status(201)
    .json(
      await one('INSERT INTO classrooms(id,teacher_id,name,code) VALUES($1,$2,$3,$4) RETURNING *', [
        randomUUID(),
        req.user!.id,
        name,
        randomBytes(4).toString('hex').toUpperCase(),
      ]),
    );
});
app.post('/api/classes/join', required, async (req, res) => {
  if (req.user!.role !== 'student')
    throw new HttpError(403, 'К классу могут присоединяться ученики');
  const { code } = z
    .object({
      code: z
        .string()
        .trim()
        .min(4)
        .max(16)
        .transform((x) => x.toUpperCase()),
    })
    .parse(req.body);
  const c = await one('SELECT id,name FROM classrooms WHERE code=$1', [code]);
  if (!c) fail('Класс с таким кодом не найден');
  await db.query('INSERT INTO memberships(class_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    c.id,
    req.user!.id,
  ]);
  res.json(c);
});
app.get('/api/assignments', required, async (req, res) => {
  res.json(
    await rows(
      `SELECT a.*,c.name class_name,s.title,s.subject,s.color,s.art,s.language,
    (SELECT count(*)::int FROM episodes e WHERE e.season_id=s.id) episode_count,
    (SELECT count(*)::int FROM completions p JOIN episodes e ON e.id=p.episode_id WHERE e.season_id=s.id AND p.user_id=$1) completed,
    (SELECT max(round(100.0*t.score/t.total))::int FROM attempts t WHERE t.season_id=s.id AND t.user_id=$1) best_score
    FROM assignments a JOIN classrooms c ON c.id=a.class_id JOIN seasons s ON s.id=a.season_id
    WHERE ${req.user!.role === 'teacher' ? 'c.teacher_id=$1' : 'EXISTS(SELECT 1 FROM memberships m WHERE m.class_id=c.id AND m.user_id=$1)'} ORDER BY a.due_at`,
      [req.user!.id],
    ),
  );
});
app.post('/api/assignments', required, teacher, async (req, res) => {
  const d = z
    .object({ class_id: uid, season_id: uid, due_at: z.iso.datetime({ offset: true }) })
    .parse(req.body);
  if (
    !(await one('SELECT id FROM classrooms WHERE id=$1 AND teacher_id=$2', [
      d.class_id,
      req.user!.id,
    ]))
  )
    notFound();
  if (
    !(await one(
      "SELECT id FROM seasons WHERE id=$1 AND status='published' AND (visibility='public' OR owner_id=$2)",
      [d.season_id, req.user!.id],
    ))
  )
    fail('Сначала опубликуйте сезон');
  const a = await one(
    'INSERT INTO assignments(id,class_id,season_id,due_at) VALUES($1,$2,$3,$4) ON CONFLICT(class_id,season_id) DO UPDATE SET due_at=EXCLUDED.due_at RETURNING *',
    [randomUUID(), d.class_id, d.season_id, d.due_at],
  );
  res.json(a);
});
const seasonData = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(5).max(500),
  subject: z.enum(['kz-history', 'world-history', 'kz-literature', 'ru-literature']),
  language: z.enum(['ru', 'kk']),
  grade: z.number().int().min(5).max(11),
  source_text: z.string().max(60000),
  source_name: z.string().max(200).default('Материал учителя'),
  episodes: z
    .array(
      z.object({
        id: uid.optional(),
        title: z.string().trim().min(2).max(100),
        script: z.string().trim().min(10).max(500),
      }),
    )
    .min(1)
    .max(10),
  questions: z
    .array(
      z
        .object({
          prompt: z.string().trim().min(5).max(300),
          options: z.array(z.string().trim().min(1).max(200)).min(2).max(5),
          correct: z.number().int().min(0).max(4),
          explanation: z.string().trim().min(5).max(500),
        })
        .refine(
          (q) => q.correct < q.options.length,
          'Правильный ответ должен быть в списке вариантов',
        ),
    )
    .max(15),
});
async function owned(req: express.Request) {
  const s = await one('SELECT * FROM seasons WHERE id=$1 AND owner_id=$2', [
    uid.parse(req.params.id),
    req.user!.id,
  ]);
  if (!s) notFound();
  return s;
}
async function saveSeason(
  userId: string,
  data: z.infer<typeof seasonData>,
  id: string = randomUUID(),
  existing = false,
) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    if (existing) {
      const locked = await c.query(
        'SELECT status FROM seasons WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, userId],
      );
      if (!locked.rows[0] || ['published', 'rendering'].includes(locked.rows[0].status))
        throw new HttpError(409, 'Опубликованный или собирающийся сезон нельзя редактировать');
      await c.query(
        "UPDATE seasons SET title=$2,description=$3,subject=$4,language=$5,grade=$6,source_text=$7,source_name=$8,status='draft',render_error=NULL,updated_at=now() WHERE id=$1",
        [
          id,
          data.title,
          data.description,
          data.subject,
          data.language,
          data.grade,
          data.source_text,
          data.source_name,
        ],
      );
    } else
      await c.query(
        'INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,source_text,source_name,color,art) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          userId,
          data.title,
          data.description,
          data.subject,
          data.language,
          data.grade,
          data.source_text,
          data.source_name,
          data.subject === 'kz-literature'
            ? 'peach'
            : data.subject === 'ru-literature'
              ? 'lilac'
              : data.subject === 'world-history'
                ? 'blue'
                : 'sage',
          data.subject.includes('literature') ? 'book' : 'history',
        ],
      );
    const previous = (await c.query('SELECT * FROM episodes WHERE season_id=$1', [id])).rows;
    await c.query('DELETE FROM questions WHERE season_id=$1', [id]);
    await c.query('DELETE FROM episodes WHERE season_id=$1', [id]);
    for (const [i, e] of data.episodes.entries()) {
      const old = previous.find((x) => x.id === e.id);
      const keep = old && old.title === e.title && old.script === e.script;
      await c.query(
        'INSERT INTO episodes(id,season_id,position,title,script,media_path,duration) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          old ? e.id : randomUUID(),
          id,
          i,
          e.title,
          e.script,
          keep ? old.media_path : null,
          keep ? old.duration : 60,
        ],
      );
    }
    for (const [i, q] of data.questions.entries())
      await c.query(
        'INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), id, i, q.prompt, JSON.stringify(q.options), q.correct, q.explanation],
      );
    await c.query('COMMIT');
    return { id };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
app.post('/api/seasons', required, teacher, async (req, res) =>
  res.status(201).json(await saveSeason(req.user!.id, seasonData.parse(req.body))),
);
app.put('/api/seasons/:id', required, teacher, async (req, res) => {
  await owned(req);
  res.json(
    await saveSeason(req.user!.id, seasonData.parse(req.body), uid.parse(req.params.id), true),
  );
});
app.post('/api/material/extract', required, teacher, upload.single('file'), async (req, res) => {
  if (!req.file) fail('Выберите PDF или текстовый файл');
  if (req.file!.size > 10 * 1024 * 1024) fail('Материал должен быть не больше 10 МБ');
  const ext = extname(req.file!.originalname).toLowerCase();
  let text = '';
  if (ext === '.pdf' && req.file!.buffer.subarray(0, 5).toString() === '%PDF-') {
    const parser = new PDFParse({ data: req.file!.buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (['.txt', '.md'].includes(ext)) {
    text = req.file!.buffer.toString('utf8');
  } else fail('Поддерживаются PDF, TXT и MD');
  if (!text.trim())
    fail('В файле нет текста. Для сканированного PDF вставьте распознанный текст вручную.');
  if (text.length > 60000) fail('Материал слишком большой. Выберите фрагмент до 60 000 символов.');
  res.json({ text, name: req.file!.originalname });
});
app.post('/api/seasons/:id/render', required, teacher, async (req, res) => {
  await owned(req);
  const updated = await db.query(
    "UPDATE seasons SET status='rendering',render_error=NULL WHERE id=$1 AND status IN ('draft','review','failed') RETURNING id",
    [req.params.id],
  );
  if (!updated.rowCount) throw new HttpError(409, 'Сезон уже собирается или опубликован');
  void renderSeason(String(req.params.id));
  res.status(202).json({ ok: true });
});
app.post('/api/seasons/:id/publish', required, teacher, async (req, res) => {
  await owned(req);
  const d = z
    .object({
      confirmed: z.literal(true),
      visibility: z.enum(['public', 'class']).default('class'),
    })
    .parse(req.body);
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const s = (await c.query('SELECT * FROM seasons WHERE id=$1 FOR UPDATE', [req.params.id]))
      .rows[0];
    if (!['draft', 'review'].includes(s.status)) fail('Сезон ещё не готов к публикации');
    if (
      (await c.query('SELECT 1 FROM episodes WHERE season_id=$1 AND media_path IS NULL', [s.id]))
        .rowCount
    )
      fail('Добавьте или соберите видео для каждой серии');
    if (!(await c.query('SELECT 1 FROM questions WHERE season_id=$1', [s.id])).rowCount)
      fail('Добавьте хотя бы один вопрос с объяснением');
    await c.query(
      "UPDATE seasons SET status='published',visibility=$2,updated_at=now() WHERE id=$1",
      [s.id, d.visibility],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  res.json({ ok: d.confirmed });
});
app.post(
  '/api/seasons/:id/episodes/:episodeId/video',
  required,
  teacher,
  async (req, res, next) => {
    const s = await owned(req);
    if (['published', 'rendering'].includes(s.status))
      throw new HttpError(409, 'Загрузка доступна в черновике');
    if (
      !(await one('SELECT id FROM episodes WHERE id=$1 AND season_id=$2', [
        uid.parse(req.params.episodeId),
        s.id,
      ]))
    )
      notFound();
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) fail('Выберите видео MP4');
    if (extname(req.file!.originalname).toLowerCase() !== '.mp4')
      fail('Поддерживается MP4 (H.264)');
    await mkdir(dataDir, { recursive: true });
    const path = resolve(dataDir, `${randomUUID()}.mp4`);
    await writeFile(path, req.file!.buffer);
    try {
      const p = await exec(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_name,codec_type',
          '-of',
          'json',
          path,
        ],
        { timeout: 15000 },
      );
      const meta = JSON.parse(p.stdout);
      if (!meta.streams?.some((s: any) => s.codec_type === 'video' && s.codec_name === 'h264'))
        fail('Для воспроизведения нужен MP4 с видеокодеком H.264');
      const duration = Math.ceil(Number(meta.format.duration));
      if (!Number.isFinite(duration) || duration < 1 || duration > 180)
        fail('Серия должна длиться от 1 до 180 секунд');
      await db.query('UPDATE episodes SET media_path=$1,duration=$2 WHERE id=$3 AND season_id=$4', [
        path,
        duration,
        req.params.episodeId,
        req.params.id,
      ]);
    } catch (e) {
      await unlink(path).catch(() => {});
      throw e instanceof HttpError ? e : new HttpError(400, 'Файл не удалось прочитать как видео');
    }
    res.json({ ok: true });
  },
);
app.post(
  '/api/seasons/:id/retellings',
  required,
  async (req, res, next) => {
    if (
      !(await one(
        "SELECT s.id FROM seasons s WHERE s.id=$2 AND s.status='published' AND " + visibilitySql,
        [req.user!.id, uid.parse(req.params.id)],
      ))
    )
      notFound();
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) fail('Добавьте голосовую запись');
    if (req.body.consent !== 'true')
      fail('Подтвердите согласие на сохранение записи и доступ учителя');
    if (req.file!.size > 15 * 1024 * 1024) fail('Запись должна быть не больше 15 МБ');
    const transcript = z
      .string()
      .max(10000)
      .parse(req.body.transcript || '');
    const mime = req.file!.mimetype.split(';')[0];
    if (!['audio/webm', 'video/webm', 'audio/mp4', 'audio/ogg'].includes(mime))
      fail('Формат записи не поддерживается');
    await mkdir(dataDir, { recursive: true });
    const id = randomUUID(),
      path = resolve(dataDir, `${id}.audio`);
    await writeFile(path, req.file!.buffer);
    try {
      const p = await exec(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path],
        { timeout: 15000 },
      );
      const meta = JSON.parse(p.stdout);
      if (!meta.streams?.some((s: any) => s.codec_type === 'audio'))
        fail('В файле нет звуковой дорожки');
      if (Number(meta.format?.duration) > 125)
        fail('Максимальная длительность пересказа — 2 минуты');
      await db.query(
        'INSERT INTO retellings(id,user_id,season_id,media_path,mime_type,transcript) VALUES($1,$2,$3,$4,$5,$6)',
        [
          id,
          req.user!.id,
          req.params.id,
          path,
          mime === 'video/webm' ? 'audio/webm' : mime,
          transcript,
        ],
      );
    } catch (e) {
      await unlink(path).catch(() => {});
      throw e instanceof HttpError
        ? e
        : new HttpError(400, 'Не удалось прочитать голосовую запись');
    }
    res.status(201).json({ id });
  },
);
const retellingAccess = `SELECT r.* FROM retellings r WHERE r.id=$1 AND (r.user_id=$2 OR EXISTS(
 SELECT 1 FROM memberships m JOIN classrooms c ON c.id=m.class_id JOIN assignments a ON a.class_id=c.id
 WHERE m.user_id=r.user_id AND c.teacher_id=$2 AND a.season_id=r.season_id))`;
app.get('/api/retellings/:id/audio', required, async (req, res) => {
  const r = await one(retellingAccess, [uid.parse(req.params.id), req.user!.id]);
  if (!r) notFound();
  res.type(r.mime_type).sendFile(r.media_path, { dotfiles: 'allow' });
});
app.delete('/api/retellings/:id', required, async (req, res) => {
  const r = await one('DELETE FROM retellings WHERE id=$1 AND user_id=$2 RETURNING media_path', [
    uid.parse(req.params.id),
    req.user!.id,
  ]);
  if (!r) notFound();
  await unlink(r.media_path).catch(() => {});
  res.json({ ok: true });
});
app.patch('/api/retellings/:id/review', required, teacher, async (req, res) => {
  const r = await one(retellingAccess, [uid.parse(req.params.id), req.user!.id]);
  if (!r) notFound();
  const d = z
    .object({
      score: z.number().int().min(0).max(100),
      feedback: z.string().trim().min(3).max(2000),
      transcript: z.string().max(10000),
    })
    .parse(req.body);
  await db.query(
    'UPDATE retellings SET teacher_score=$2,feedback=$3,transcript=$4,reviewed_by=$5 WHERE id=$1',
    [r.id, d.score, d.feedback, d.transcript, req.user!.id],
  );
  res.json({ ok: true });
});
async function resultsForTeacher(id: string) {
  return rows(
    `SELECT c.id class_id,c.name class_name,u.id user_id,u.name,s.id season_id,s.title,
    (SELECT count(*)::int FROM episodes e WHERE e.season_id=s.id) episode_count,
    (SELECT count(*)::int FROM completions p JOIN episodes e ON e.id=p.episode_id WHERE e.season_id=s.id AND p.user_id=u.id) watched,
    (SELECT max(round(100.0*t.score/t.total))::int FROM attempts t WHERE t.season_id=s.id AND t.user_id=u.id) test_score,
    r.id retelling_id,r.teacher_score,r.feedback,r.transcript,r.created_at retelling_at
    FROM classrooms c JOIN memberships m ON m.class_id=c.id JOIN users u ON u.id=m.user_id
    JOIN assignments a ON a.class_id=c.id JOIN seasons s ON s.id=a.season_id
    LEFT JOIN LATERAL(SELECT * FROM retellings WHERE user_id=u.id AND season_id=s.id ORDER BY created_at DESC LIMIT 1) r ON true
    WHERE c.teacher_id=$1 ORDER BY c.name,u.name,s.title`,
    [id],
  );
}
app.get('/api/results', required, teacher, async (req, res) =>
  res.json(await resultsForTeacher(req.user!.id)),
);
app.get('/api/results.csv', required, teacher, async (req, res) => {
  const list = await resultsForTeacher(req.user!.id);
  const cell = (v: unknown) =>
    '"' +
    String(v ?? '')
      .replace(/^[=+@\-\t\r]/, "'")
      .replaceAll('"', '""') +
    '"';
  const csv = [
    'Класс;Ученик;Сезон;Просмотрено;Серий;Тест %;Пересказ %;Комментарий',
    ...list.map((r) =>
      [
        r.class_name,
        r.name,
        r.title,
        r.watched,
        r.episode_count,
        r.test_score,
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
app.use('/api', (req, res) => res.status(404).json({ error: 'Такого действия нет' }));
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    const names: Record<string, string> = {
      title: 'Название',
      description: 'Учебная цель',
      script: 'Текст серии',
      source_text: 'Материал',
      prompt: 'Вопрос',
      options: 'Варианты ответа',
      explanation: 'Объяснение',
      email: 'Email',
      password: 'Пароль',
      name: 'Имя',
      grade: 'Класс',
      language: 'Язык',
      score: 'Оценка',
      feedback: 'Отзыв',
      code: 'Код класса',
      episodes: 'Серии',
      questions: 'Вопросы',
      due_at: 'Срок',
    };
    const messages = error.issues.map((x: any) => {
      const field = names[String(x.path.at(-1))] || names[String(x.path[0])] || 'Поле';
      if (x.code === 'too_small')
        return `${field}: минимум ${x.minimum}${x.origin === 'string' ? ' символов' : ''}`;
      if (x.code === 'too_big')
        return `${field}: максимум ${x.maximum}${x.origin === 'string' ? ' символов' : ''}`;
      return `${field}: проверьте значение`;
    });
    res.status(400).json({ error: messages.join('. ') });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: 'Файл слишком большой или формат загрузки неверен' });
    return;
  }
  if (error.code === '23505') {
    res.status(409).json({ error: 'Такая запись уже существует' });
    return;
  }
  console.error(
    'Request failed',
    req.method,
    req.path,
    error instanceof Error ? error.message : 'unknown',
  );
  res.status(error.status || 500).json({
    error: error instanceof HttpError ? error.message : 'Ошибка сервера. Попробуйте снова.',
  });
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*splat}', (req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
await db.query('SELECT 1');
await db.query(
  "UPDATE seasons SET status='failed',render_error='Сервер перезапущен во время сборки. Можно повторить без потери сценария.' WHERE status='rendering'",
);
await db.query('DELETE FROM sessions WHERE expires_at<now()');
const server = app.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () =>
  console.log('OylaTap running; database: PostgreSQL'),
);
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    server.close(() => {
      void db.end().then(() => process.exit(0));
    });
  });
