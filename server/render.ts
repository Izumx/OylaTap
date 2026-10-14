import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { db, rows } from './db.js';
const exec = promisify(execFile);
export const dataDir = resolve(process.env.DATA_DIR || '.local/uploads');
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
function wrap(text: string, width = 27) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}
export async function renderEpisode(
  episode: { id: string; title: string; script: string; position: number },
  color = 'sage',
) {
  await mkdir(dataDir, { recursive: true });
  const titleLines = wrap(episode.title, 21).slice(0, 4);
  const bodyLines = wrap(episode.script, 31);
  if (bodyLines.length > 18)
    throw new Error('Сократите текст серии до 500 символов для читаемых субтитров.');
  const palette: Record<string, string> = {
    sage: '#215b48',
    peach: '#9b4d33',
    lilac: '#55497a',
    blue: '#305f7a',
  };
  const bg = palette[color] || palette.sage;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="${bg}"/><circle cx="620" cy="120" r="220" fill="white" opacity=".06"/><circle cx="20" cy="1180" r="290" fill="white" opacity=".04"/><g font-family="DejaVu Sans, sans-serif" fill="#f8f5e9">${titleLines.map((line, i) => `<text x="56" y="${190 + i * 58}" font-size="44" font-weight="bold">${xml(line)}</text>`).join('')}<rect x="56" y="${215 + titleLines.length * 58}" width="80" height="6" rx="3" fill="#bce8a3"/>${bodyLines.map((line, i) => `<text x="56" y="${310 + titleLines.length * 58 + i * 35}" font-size="28">${xml(line)}</text>`).join('')}</g></svg>`;
  const png = resolve(dataDir, `${episode.id}.png`);
  const mp4 = resolve(dataDir, `${episode.id}.mp4`);
  await sharp(Buffer.from(svg)).png().toFile(png);
  const duration = Math.min(45, Math.max(12, Math.ceil(episode.script.split(/\s+/).length / 2.5)));
  await exec(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-loop',
      '1',
      '-i',
      png,
      '-t',
      String(duration),
      '-vf',
      'scale=540:960,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads',
      '2',
      '-r',
      '12',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { timeout: 120000 },
  );
  await db.query('UPDATE episodes SET media_path=$1,duration=$2 WHERE id=$3', [
    mp4,
    duration,
    episode.id,
  ]);
}
export async function renderSeason(id: string) {
  try {
    const [season] = await rows('SELECT * FROM seasons WHERE id=$1', [id]);
    for (const ep of await rows('SELECT * FROM episodes WHERE season_id=$1 ORDER BY position', [
      id,
    ]))
      await renderEpisode(ep, season.color);
    await db.query(
      "UPDATE seasons SET status='review',render_error=NULL,updated_at=now() WHERE id=$1",
      [id],
    );
  } catch (error) {
    console.error('Video rendering failed:', error instanceof Error ? error.message : 'unknown');
    await db.query(
      "UPDATE seasons SET status='failed',render_error=$2,updated_at=now() WHERE id=$1",
      [id, 'Не удалось собрать видео. Сценарий сохранён — можно повторить сборку.'],
    );
  }
}
