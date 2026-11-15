// Copies bundled videos and their posters into dist/ so Vercel serves them as static files.
import { cp, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else if (/\.(mp4|poster\.jpg)$/.test(name)) out.push(p);
  }
  return out;
}
const files = await walk('content');
for (const f of files) await cp(f, join('dist', f));
console.log(`Copied ${files.length} bundled media files into dist/content`);
