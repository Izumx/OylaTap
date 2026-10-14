import 'dotenv/config';
import pg from 'pg';
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.');
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export async function rows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows;
}
export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(sql, params))[0];
}
