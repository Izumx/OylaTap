import { readFile } from 'node:fs/promises';
import { db } from '../server/db.js';
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(4912771)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  for (const name of [
    '001_initial',
    '002_retelling_consent',
    '003_season_visibility',
    '004_daily_learning',
    '005_daily_sessions',
    '006_assessment_history',
    '007_demo_final_questions',
    '008_creator_platform',
    '009_curriculum_topics',
    '010_author_follows',
  ]) {
    if (
      !(await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rowCount
    ) {
      await client.query(await readFile(new URL(`../db/${name}.sql`, import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  }
  await client.query('COMMIT');
  console.log('PostgreSQL migrations complete');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.end();
}
