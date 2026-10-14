import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { one, db } from './db.js';
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher';
  grade: number;
  language: 'ru' | 'kk';
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
export async function createSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [tokenHash(token), userId],
  );
  res.cookie('oylatap_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 86400000,
    path: '/',
  });
}
export async function auth(req: Request, res: Response, next: NextFunction) {
  const token = cookieToken(req);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    req.user = await one<User>(
      'SELECT u.id,u.name,u.email,u.role,u.grade,u.language FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()',
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
