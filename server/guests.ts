import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, one } from './db.js';
import { createSession } from './auth.js';

/** Guests (code + name, no email) are removed with their data after 60 days without activity. */
export async function purgeGuests(): Promise<number> {
  const r = await db.query(
    "DELETE FROM users WHERE is_guest AND last_seen_at < now() - interval '60 days'",
  );
  return r.rowCount || 0;
}

/** Keeps a guest alive while they use the app; writes at most once an hour. */
export async function guestActivity(req: Request, _res: Response, next: NextFunction) {
  const u = req.user;
  if (u?.is_guest && (!u.last_seen_at || Date.now() - new Date(u.last_seen_at).getTime() > 3600000))
    await db.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [u.id]);
  next();
}

export function guestRouter() {
  const router = Router();
  router.post('/auth/guest', async (req, res) => {
    const d = z
      .object({
        code: z
          .string()
          .trim()
          .min(4)
          .max(16)
          .transform((v) => v.toUpperCase()),
        name: z.string().trim().min(2).max(40),
      })
      .parse(req.body);
    const c = await one('SELECT id,name FROM classrooms WHERE code=$1', [d.code]);
    if (!c) {
      res.status(404).json({ error: 'Класс с таким кодом не найден' });
      return;
    }
    const id = randomUUID();
    const user = await one(
      `INSERT INTO users(id,name,email,password_hash,role,is_guest)
       VALUES($1,$2,$3,'guest-no-password','student',true)
       RETURNING id,name,role,grade,language,is_guest`,
      [id, d.name, `guest-${id}@guest.oylatap.invalid`],
    );
    await db.query('INSERT INTO memberships(class_id,user_id) VALUES($1,$2)', [c.id, id]);
    await createSession(res, id);
    res.status(201).json({ user, class_name: c.name, next_path: '/assignments' });
  });
  return router;
}
