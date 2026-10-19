import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { db } from './db.js';
import { hashPassword, tokenHash } from './auth.js';
import { smtpResetSender, trustedAppUrl, type ResetSender } from './mail.js';

type Options = { pool?: pg.Pool; sender?: ResetSender | null; appUrl?: string };
const genericMessage =
  'Если аккаунт с таким email существует, мы отправим ссылку для восстановления. / Егер мұндай email бар болса, қалпына келтіру сілтемесін жібереміз.';
const invalidMessage =
  'Ссылка недействительна или истекла. Запросите новую. / Сілтеме жарамсыз немесе мерзімі өткен. Жаңасын сұраңыз.';
export function recoveryRouter(options: Options = {}) {
  const router = Router();
  const pool = options.pool || db;
  const origin = trustedAppUrl(options.appUrl);
  const sender = options.sender === undefined ? smtpResetSender() : options.sender;
  const enabled = Boolean(origin && sender);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/recovery-status', (_req, res) => res.json({ enabled }));
  router.post('/password-reset/request', async (req, res) => {
    if (!enabled) {
      res.status(503).json({
        error:
          'Восстановление через email ещё не подключено. / Email арқылы қалпына келтіру әлі қосылмаған.',
      });
      return;
    }
    const input = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        language: z.enum(['ru', 'kk']).optional(),
      })
      .safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: 'Проверьте email. / Email мекенжайын тексеріңіз.' });
      return;
    }
    // Return before account lookup or SMTP, so both response body and timing are account-independent.
    res.status(202).json({ ok: true, message: genericMessage });
    const token = randomBytes(32).toString('hex');
    const digest = tokenHash(token);
    try {
      const account = (
        await pool.query('SELECT id,email,language FROM users WHERE email=$1', [input.data.email])
      ).rows[0];
      if (!account) return;
      await pool.query('DELETE FROM password_resets WHERE expires_at<=now()');
      await pool.query(
        "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [digest, account.id],
      );
      const url = new URL('/reset-password', origin);
      url.hash = `token=${token}`;
      await sender!.send({
        to: account.email,
        url: url.href,
        language: input.data.language || account.language || 'ru',
      });
    } catch {
      // Never log transport errors: SMTP diagnostics can contain recipients or message content.
      await pool.query('DELETE FROM password_resets WHERE token_hash=$1', [digest]).catch(() => {});
      console.warn('Password recovery delivery failed; check SMTP service and configuration.');
    }
  });
  router.post('/password-reset/confirm', async (req, res) => {
    const input = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(10).max(128) })
      .safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error:
          'Нужна действующая ссылка и пароль от 10 до 128 символов. / Жарамды сілтеме және 10–128 таңбалы құпиясөз қажет.',
      });
      return;
    }
    const digest = tokenHash(input.data.token);
    const passwordHash = hashPassword(input.data.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the account first. All reset links for one account serialize, including different links.
      const account = (
        await client.query(
          'SELECT u.id FROM users u JOIN password_resets p ON p.user_id=u.id WHERE p.token_hash=$1 FOR UPDATE OF u',
          [digest],
        )
      ).rows[0];
      const consumed =
        account &&
        (
          await client.query(
            'DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id',
            [digest],
          )
        ).rows[0];
      if (!consumed) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: invalidMessage });
        return;
      }
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
        consumed.user_id,
        passwordHash,
      ]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [consumed.user_id]);
      await client.query('DELETE FROM password_resets WHERE user_id=$1', [consumed.user_id]);
      await client.query('COMMIT');
      res.clearCookie('oylatap_session', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
      });
      res.json({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  return router;
}
