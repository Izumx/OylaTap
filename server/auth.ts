import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type pg from 'pg';
import { one, db } from './db.js';
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher' | 'creator';
  grade: number;
  language: 'ru' | 'kk';
  trust_level: 'new' | 'trusted';
  is_moderator: boolean;
};
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function cookieToken(req: Request) {
  return (req.headers.cookie || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('oylatap_session='))
    ?.slice(16);
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function setSessionCookie(res: Response, token: string) {
  res.cookie('oylatap_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 86400000,
    path: '/',
  });
}
// Password resets take the same account lock before replacing credentials and revoking sessions.
// Verify the password and insert the session while holding that lock, then expose the token only
// after commit so a login using superseded credentials cannot survive a concurrent reset.
export async function authenticateWithPassword(pool: pg.Pool, email: string, password: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = (await client.query('SELECT * FROM users WHERE email=$1 FOR UPDATE', [email]))
      .rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      await client.query('ROLLBACK');
      return null;
    }
    const token = randomBytes(32).toString('hex');
    await client.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [tokenHash(token), user.id],
    );
    await client.query('COMMIT');
    return { user, token };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function createSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [tokenHash(token), userId],
  );
  setSessionCookie(res, token);
}
export async function auth(req: Request, res: Response, next: NextFunction) {
  const token = cookieToken(req);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    req.user = await one<User>(
      'SELECT u.id,u.name,u.email,u.role,u.grade,u.language,u.trust_level,u.is_moderator FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()',
      [tokenHash(token)],
    );
  }
  next();
}
export function required(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Войдите в аккаунт' });
    return;
  }
  next();
}
export function teacher(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'teacher') {
    res.status(403).json({ error: 'Этот раздел доступен учителю' });
    return;
  }
  next();
}
// Teachers and independent authors share the studio. Classes and reports stay teacher-only.
export function author(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'teacher' && req.user?.role !== 'creator') {
    res.status(403).json({ error: 'Студия доступна учителям и авторам' });
    return;
  }
  next();
}
export function moderator(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.is_moderator) {
    res.status(403).json({ error: 'Раздел доступен модераторам' });
    return;
  }
  next();
}
