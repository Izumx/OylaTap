import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, rows, one } from './db.js';
import { required, moderator } from './auth.js';
import { aiEnabled, reviewContent } from './ai.js';

export type Flag = {
  code: string;
  severity: 'block' | 'review';
  source: 'rules' | 'ai';
  field: string;
  excerpt: string;
  message: string;
};
export type ModerationText = {
  title: string;
  description: string;
  episodes: { title: string; script: string }[];
  questions: { prompt: string; options: string[]; explanation: string }[];
};

// Approved seasons needed before an author publishes to the shared feed without review.
export const TRUST_AFTER_APPROVALS = 3;
// Distinct learners' open complaints that hide a season from the shared feed.
export const HIDE_AFTER_REPORTS = 3;

// Cyrillic has no \b in JS regexes, so word starts are written as (?<!\p{L}).
const start = '(?<!\\p{L})';
const rules: {
  code: string;
  severity: Flag['severity'];
  pattern: RegExp;
  message: string;
}[] = [
  {
    code: 'profanity',
    severity: 'block',
    pattern: new RegExp(
      `${start}(ху[йяеёию]|пизд|(за|у|вы|от|на|по|до)?[её]б(а[нлт]|ну|у[чт])|бляд|бля(?!\\p{L})|мудак|пид[оа]р|гандон|шлюх|сука(?!\\p{L}))`,
      'iu',
    ),
    message: 'Нецензурная лексика недопустима в учебном контенте',
  },
  {
    code: 'profanity_kk',
    severity: 'review',
    pattern: new RegExp(`${start}(сіг[еі]|қотақ)`, 'iu'),
    message: 'Возможная грубая лексика на казахском — нужна проверка модератора',
  },
  {
    code: 'gambling',
    severity: 'block',
    pattern: new RegExp(
      `${start}(онлайн[- ]?казино|букмекер|1xbet|олимпбет|игровые автоматы|ставк[аиу] на спорт|бәс тігу)`,
      'iu',
    ),
    message: 'Реклама азартных игр запрещена',
  },
  {
    code: 'link',
    severity: 'review',
    pattern:
      /(https?:\/\/|www\.|t\.me\/|(?<![\p{L}\d])[a-z0-9-]{2,}\.(com|ru|kz|net|org|me|io|xyz)(?![\p{L}]))/iu,
    message: 'Ссылки в видео проверяет модератор',
  },
  {
    code: 'phone',
    severity: 'review',
    pattern: /(?<!\d)(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/u,
    message: 'Телефон в контенте: возможна реклама или личные данные',
  },
  {
    code: 'email',
    severity: 'review',
    pattern: /[\w.+-]+@[\w-]+\.[\w.]+/u,
    message: 'Email в контенте: возможна реклама или личные данные',
  },
  {
    code: 'iin',
    severity: 'review',
    pattern: /(?<!\d)\d{12}(?!\d)/u,
    message: 'Похоже на ИИН — личные данные публиковать нельзя',
  },
  {
    code: 'promotion',
    severity: 'review',
    pattern: new RegExp(
      `${start}(подпиш(ись|итесь)|промокод|мой телеграм|в директ|whatsapp|ватсап|вотсап|жазылыңыз|жазыл(?!\\p{L}))`,
      'iu',
    ),
    message: 'Самореклама и призывы подписаться проверяет модератор',
  },
  {
    code: 'sensitive',
    severity: 'review',
    pattern: new RegExp(
      `${start}(суицид|самоубийств|покончить с собой|наркотик|закладк|мефедрон|өз-өзіне қол жұмсау|есірткі)`,
      'iu',
    ),
    message: 'Чувствительная тема: проверьте подачу для детей',
  },
];

function fields(text: ModerationText) {
  const list: [string, string][] = [
    ['Название', text.title],
    ['Описание', text.description],
  ];
  text.episodes.forEach((e, i) => {
    list.push([`Серия ${i + 1}: название`, e.title], [`Серия ${i + 1}: текст`, e.script]);
  });
  text.questions.forEach((q, i) => {
    list.push(
      [`Вопрос ${i + 1}`, q.prompt],
      [`Вопрос ${i + 1}: варианты`, q.options.join(' / ')],
      [`Вопрос ${i + 1}: объяснение`, q.explanation],
    );
  });
  return list;
}

export function checkRules(text: ModerationText): Flag[] {
  const flags: Flag[] = [];
  for (const [field, value] of fields(text))
    for (const rule of rules) {
      const match = rule.pattern.exec(value);
      if (!match) continue;
      const at = Math.max(0, match.index - 20);
      flags.push({
        code: rule.code,
        severity: rule.severity,
        source: 'rules',
        field,
        excerpt: value.slice(at, match.index + match[0].length + 20),
        message: rule.message,
      });
    }
  return flags;
}

export async function seasonText(seasonId: string): Promise<ModerationText> {
  const s = await one('SELECT title,description FROM seasons WHERE id=$1', [seasonId]);
  return {
    title: s.title,
    description: s.description,
    episodes: await rows('SELECT title,script FROM episodes WHERE season_id=$1 ORDER BY position', [
      seasonId,
    ]),
    questions: await rows(
      'SELECT prompt,options,explanation FROM questions WHERE season_id=$1 ORDER BY position',
      [seasonId],
    ),
  };
}

export async function decide(
  seasonId: string,
  decision: string,
  note = '',
  moderatorId: string | null = null,
) {
  await db.query(
    'INSERT INTO moderation_decisions(id,season_id,moderator_id,decision,note) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), seasonId, moderatorId, decision, note],
  );
}

// AI hints are appended after submission so a slow local model never blocks the author.
// They never publish or reject anything by themselves.
export async function addAiReview(seasonId: string, language: string) {
  if (!aiEnabled) return;
  try {
    const issues = await reviewContent(await seasonText(seasonId), language);
    if (!issues.length) return;
    const flags: Flag[] = issues.map((x) => ({
      code: `ai_${x.kind}`,
      severity: 'review',
      source: 'ai',
      field: 'ИИ-проверка',
      excerpt: x.quote,
      message: x.note,
    }));
    await db.query(
      "UPDATE seasons SET moderation_flags=moderation_flags||$2::jsonb WHERE id=$1 AND status='moderation'",
      [seasonId, JSON.stringify(flags)],
    );
  } catch (error) {
    console.error('AI review failed:', error instanceof Error ? error.message : 'unknown');
  }
}

export function moderationRouter(visibilitySql: string) {
  const router = Router();
  const uid = z.string().uuid();

  router.post('/seasons/:id/report', required, async (req, res) => {
    const id = uid.parse(req.params.id);
    const d = z
      .object({
        reason: z.enum(['mistake', 'unsafe', 'spam', 'copyright', 'other']),
        comment: z.string().trim().max(1000).default(''),
        episode_id: uid.nullable().default(null),
      })
      .parse(req.body);
    const s = await one(
      `SELECT s.id,s.owner_id,s.hidden FROM seasons s WHERE s.id=$2 AND s.status='published' AND ${visibilitySql}`,
      [req.user!.id, id],
    );
    if (!s) {
      res.status(404).json({ error: 'Не найдено или нет доступа' });
      return;
    }
    if (s.owner_id === req.user!.id) {
      res.status(400).json({ error: 'Своё видео можно исправить в студии' });
      return;
    }
    await db.query(
      `INSERT INTO content_reports(id,season_id,episode_id,user_id,reason,comment) VALUES($1,$2,
       (SELECT id FROM episodes WHERE id=$3 AND season_id=$2),$4,$5,$6)
       ON CONFLICT(season_id,user_id) DO UPDATE SET reason=EXCLUDED.reason,comment=EXCLUDED.comment,
       episode_id=EXCLUDED.episode_id,status='open',created_at=now()`,
      [randomUUID(), id, d.episode_id, req.user!.id, d.reason, d.comment],
    );
    const hidden = await one(
      `UPDATE seasons SET hidden=true WHERE id=$1 AND NOT hidden AND visibility='public'
       AND (SELECT count(*) FROM content_reports WHERE season_id=$1 AND status='open')>=$2 RETURNING id`,
      [id, HIDE_AFTER_REPORTS],
    );
    if (hidden) await decide(id, 'hidden_by_reports', `Открытых жалоб: ${HIDE_AFTER_REPORTS}+`);
    res.status(201).json({ ok: true });
  });

  router.get('/moderation/queue', required, moderator, async (req, res) => {
    res.json(
      await rows(
        `SELECT s.id,s.title,s.description,s.subject,s.language,s.grade,s.status,s.hidden,s.style,s.voice,
         s.moderation_flags,s.moderation_note,s.updated_at,s.owner_id,u.name owner_name,u.role owner_role,u.trust_level,
         (SELECT count(*)::int FROM episodes e WHERE e.season_id=s.id) episode_count,
         coalesce((SELECT json_agg(json_build_object('reason',r.reason,'comment',r.comment,'created_at',r.created_at) ORDER BY r.created_at DESC)
           FROM content_reports r WHERE r.season_id=s.id AND r.status='open'),'[]') reports,
         coalesce((SELECT json_agg(json_build_object('decision',d.decision,'note',d.note,'created_at',d.created_at) ORDER BY d.created_at DESC)
           FROM moderation_decisions d WHERE d.season_id=s.id),'[]') history
         FROM seasons s JOIN users u ON u.id=s.owner_id
         WHERE s.status='moderation' OR s.hidden
           OR (s.status='published' AND EXISTS(SELECT 1 FROM content_reports r WHERE r.season_id=s.id AND r.status='open'))
         ORDER BY s.hidden DESC,(s.status='moderation') DESC,s.updated_at`,
      ),
    );
  });

  router.post('/moderation/:id/decision', required, moderator, async (req, res) => {
    const id = uid.parse(req.params.id);
    const d = z
      .object({
        decision: z.enum(['approve', 'reject', 'restore', 'unpublish']),
        note: z.string().trim().max(2000).default(''),
      })
      .parse(req.body);
    if (['reject', 'unpublish'].includes(d.decision) && d.note.length < 5) {
      res.status(400).json({ error: 'Объясните автору, что исправить (минимум 5 символов)' });
      return;
    }
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const s = (await c.query('SELECT * FROM seasons WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!s) throw Object.assign(new Error('Не найдено'), { status: 404 });
      if (s.owner_id === req.user!.id)
        throw Object.assign(new Error('Свой сезон проверяет другой модератор'), { status: 403 });
      const allowed: Record<string, boolean> = {
        approve: s.status === 'moderation',
        reject: s.status === 'moderation',
        restore: s.status === 'published',
        unpublish: s.status === 'published',
      };
      if (!allowed[d.decision])
        throw Object.assign(new Error('Это действие недоступно в текущем статусе'), {
          status: 409,
        });
      if (d.decision === 'approve')
        await c.query(
          "UPDATE seasons SET status='published',visibility='public',hidden=false,moderation_note=NULLIF($2,''),published_at=coalesce(published_at,now()),updated_at=now() WHERE id=$1",
          [id, d.note],
        );
      if (d.decision === 'reject')
        await c.query(
          "UPDATE seasons SET status='rejected',moderation_note=$2,updated_at=now() WHERE id=$1",
          [id, d.note],
        );
      if (d.decision === 'restore') {
        await c.query('UPDATE seasons SET hidden=false WHERE id=$1', [id]);
        await c.query(
          "UPDATE content_reports SET status='dismissed' WHERE season_id=$1 AND status='open'",
          [id],
        );
      }
      if (d.decision === 'unpublish') {
        await c.query(
          "UPDATE seasons SET status='rejected',hidden=false,moderation_note=$2,updated_at=now() WHERE id=$1",
          [id, d.note],
        );
        await c.query(
          "UPDATE content_reports SET status='upheld' WHERE season_id=$1 AND status='open'",
          [id],
        );
        // A confirmed problem returns the author to reviewed publishing.
        await c.query("UPDATE users SET trust_level='new' WHERE id=$1", [s.owner_id]);
      }
      await c.query(
        'INSERT INTO moderation_decisions(id,season_id,moderator_id,decision,note) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          id,
          req.user!.id,
          {
            approve: 'approved',
            reject: 'rejected',
            restore: 'restored',
            unpublish: 'unpublished',
          }[d.decision],
          d.note,
        ],
      );
      if (d.decision === 'approve')
        await c.query(
          `UPDATE users SET trust_level='trusted' WHERE id=$1 AND trust_level='new'
           AND (SELECT count(DISTINCT d.season_id) FROM moderation_decisions d JOIN seasons x ON x.id=d.season_id
                WHERE x.owner_id=$1 AND d.decision='approved')>=$2
           AND NOT EXISTS(SELECT 1 FROM content_reports r JOIN seasons x ON x.id=r.season_id
                WHERE x.owner_id=$1 AND r.status='upheld')`,
          [s.owner_id, TRUST_AFTER_APPROVALS],
        );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      const e = error as Error & { status?: number };
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Ошибка сервера' });
      return;
    } finally {
      c.release();
    }
    res.json({ ok: true });
  });
  return router;
}
