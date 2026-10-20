import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, one } from '../server/db.js';
import { khanateId, syncBundledContent } from './bundled-content.js';
try {
  const owner =
    process.env.CONTENT_OWNER_ID ||
    (await one('SELECT owner_id FROM seasons WHERE id=$1', [khanateId]))?.owner_id ||
    (
      await one(
        "SELECT id FROM users WHERE id='00000000-0000-4000-8000-000000000001' AND role='teacher'",
      )
    )?.id;
  if (!owner)
    throw new Error(
      'Set CONTENT_OWNER_ID to an existing teacher/creator, or initialize a demo database first.',
    );
  const result = await syncBundledContent(db, owner);
  await mkdir('.local', { recursive: true });
  const file = `.local/content-sync-${randomUUID()}.json`;
  await writeFile(file, JSON.stringify(result, null, 2));
  console.log(
    `Two real videos ready; removed ${result.removedSeasons.length} template topics. Cleanup manifest: ${file}`,
  );
} finally {
  await db.end();
}
