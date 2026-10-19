import 'dotenv/config';
import pg from 'pg';
import { runNextRender } from '../../server/render-queue';

const schema = process.env.QUEUE_TEST_SCHEMA;
if (!schema || !/^queue_[a-f0-9]+$/.test(schema)) throw new Error('Isolated queue schema required');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
await runNextRender(pool, async () => {
  process.stdout.write('CLAIMED\n');
  await new Promise(() => {});
  return true;
});
await pool.end();
