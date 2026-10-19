import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { db, rows, one } from './db.js';
const exec = promisify(execFile);
export const dataDir = resolve(process.env.DATA_DIR || '.local/uploads');
export type VideoStyle = 'cards' | 'board' | 'captions';
export type Voice = 'none' | 'tts' | 'own';
type Episode = {
  id: string;
  title: string;
  script: string;
  position: number;
  voice_path?: string | null;
};
type Options = {
  signal?: AbortSignal;
  color?: string;
  style?: VideoStyle;
  voice?: Voice;
  language?: string;
  author?: string;
};
const W = 720,
  H = 1280;
// DejaVu ships with Linux servers; Segoe UI, Arial and Consolas cover Cyrillic on Windows.
const SANS = 'DejaVu Sans, Segoe UI, Arial, sans-serif';
const MONO = 'DejaVu Sans Mono, Consolas, Courier New, monospace';
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
const palette: Record<string, string> = {
  sage: '#215b48',
  peach: '#9b4d33',
  lilac: '#55497a',
  blue: '#305f7a',
  slate: '#2f3b52',
};

// One step = one thought on screen. Authors control steps with line breaks;
// otherwise sentences become steps. Formulas go in backticks or on their own line with "=".
export function splitSteps(script: string) {
  const raw = script
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=[\p{Lu}\d`(«"])/u))
    .map((s) => s.trim())
    .filter(Boolean);
  const steps: string[] = [];
  for (const piece of raw) {
    const last = steps.at(-1);
    if (last && last.length < 18 && !isFormula(last) && !isFormula(piece))
      steps[steps.length - 1] = `${last} ${piece}`;
    else steps.push(piece);
  }
  while (steps.length > 8) {
    const i = steps.reduce(
      (best, s, n) =>
        n < steps.length - 1 && s.length + steps[n + 1].length < best.len
          ? { i: n, len: s.length + steps[n + 1].length }
          : best,
      { i: 0, len: Infinity },
    ).i;
    steps.splice(i, 2, `${steps[i]} ${steps[i + 1]}`);
  }
  return steps.length ? steps : [script.trim()];
}
const isFormula = (s: string) => /^`.*`$/.test(s.trim()) || /^[^\p{L}]*=|\s=\s/u.test(s);
const plain = (s: string) => s.replace(/`/g, '');
const words = (s: string) => Math.max(1, plain(s).split(/\s+/).filter(Boolean).length);

// Players draw their own controls over the top and bottom of a vertical video (the app's
// topic badge, TikTok's caption and buttons). Text stays between these safe margins.
// The right edge holds the action buttons, so text keeps clear of it as well.
const TOP_SAFE = 170,
  BOTTOM_SAFE = 340,
  RIGHT_SAFE = 110;
function signature(author: string | undefined, y: number, fill: string) {
  return `<text x="56" y="${y}" font-size="22" fill="${fill}" opacity=".7">${xml(
    author ? `@${author.replace(/\s+/g, '_').slice(0, 30)} · oylatap` : 'oylatap',
  )}</text>`;
}

function cardsFrame(ep: Episode, bg: string, author?: string) {
  const titleLines = wrap(ep.title, 21).slice(0, 4);
  const bodyLines = wrap(plain(ep.script), 31);
  if (bodyLines.length > 18)
    throw new Error('Сократите текст серии до 500 символов для читаемых субтитров.');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${bg}"/><circle cx="620" cy="120" r="220" fill="white" opacity=".06"/><circle cx="20" cy="1180" r="290" fill="white" opacity=".04"/><g font-family="${SANS}" fill="#f8f5e9">${signature(author, TOP_SAFE + 10, '#f8f5e9')}${titleLines.map((line, i) => `<text x="56" y="${TOP_SAFE + 70 + i * 58}" font-size="44" font-weight="bold">${xml(line)}</text>`).join('')}<rect x="56" y="${TOP_SAFE + 95 + titleLines.length * 58}" width="80" height="6" rx="3" fill="#bce8a3"/>${bodyLines.map((line, i) => `<text x="56" y="${TOP_SAFE + 160 + titleLines.length * 58 + i * 35}" font-size="28">${xml(line)}</text>`).join('')}</g></svg>`;
}

// Chalkboard: steps accumulate; the newest is bright, earlier ones dim. When the board
// is full the oldest steps scroll away, as a teacher would wipe the top of the board.
function boardFrame(ep: Episode, steps: string[], upto: number, author?: string) {
  const titleLines = wrap(ep.title, 26).slice(0, 3);
  const titleY = TOP_SAFE + 60;
  const top = titleY + titleLines.length * 52 + 30;
  const bottom = H - BOTTOM_SAFE;
  const blocks = steps.slice(0, upto + 1).map((s, i) => {
    const formula = isFormula(s);
    // Formulas shrink before they wrap: a line break inside an expression misleads.
    const length = plain(s).length;
    const size = formula ? (length <= 22 ? 40 : length <= 28 ? 34 : 28) : 30;
    const lines = wrap(plain(s), formula ? Math.floor((W - 84 - RIGHT_SAFE) / (size * 0.6)) : 34);
    const lh = Math.round(size * 1.3);
    return { lines, formula, size, lh, newest: i === upto, height: lines.length * lh + 26 };
  });
  while (blocks.length > 1 && blocks.reduce((n, b) => n + b.height, 0) > bottom - top)
    blocks.shift();
  let y = top;
  const body = blocks
    .map((b) => {
      const fill = b.formula
        ? b.newest
          ? '#ffd27a'
          : '#c9b27f'
        : b.newest
          ? '#ffffff'
          : '#a9c2b8';
      const out = b.lines
        .map((line, i) => {
          const at = y + (i + 1) * b.lh;
          return `<text x="${b.formula ? 84 : 64}" y="${at}" font-size="${b.size}" fill="${fill}"${b.formula ? ` font-family="${MONO}" font-weight="bold"` : ''}>${xml(line)}</text>`;
        })
        .join('');
      const marker = b.newest
        ? `<rect x="40" y="${y + 12}" width="6" height="${b.height - 30}" rx="3" fill="#ffd27a"/>`
        : '';
      y += b.height;
      return marker + out;
    })
    .join('');
  const dots = steps
    .map(
      (_, i) =>
        `<circle cx="${W - 64 - (steps.length - 1 - i) * 22}" cy="${TOP_SAFE + 3}" r="6" fill="${i <= upto ? '#ffd27a' : '#4d6b60'}"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#1d332d"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="28" fill="#21403a" stroke="#3b5c52" stroke-width="4"/><g font-family="${SANS}">${signature(author, TOP_SAFE + 10, '#d9e6df')}${titleLines.map((line, i) => `<text x="64" y="${titleY + i * 52}" font-size="40" font-weight="bold" fill="#ffd27a">${xml(line)}</text>`).join('')}<rect x="64" y="${titleY + titleLines.length * 52 - 20}" width="${W - 128}" height="3" fill="#3b5c52"/>${body}${dots}</g></svg>`;
}

// Short-video captions: one phrase at a time, large and centred, with story-like progress.
function captionsFrame(ep: Episode, steps: string[], at: number, bg: string, author?: string) {
  const step = plain(steps[at]);
  const size = step.length > 120 ? 40 : step.length > 70 ? 48 : 58;
  const textWidth = W - 56 - RIGHT_SAFE;
  const centre = 56 + textWidth / 2;
  const lines = wrap(step, Math.floor(textWidth / (size * 0.56))).slice(0, 10);
  const lh = size * 1.25;
  // Centred within the safe area, which sits slightly above the frame's middle.
  const middle = (TOP_SAFE + 120 + H - BOTTOM_SAFE) / 2;
  const y0 = middle - (lines.length * lh) / 2 + size * 0.8;
  const bars = steps
    .map((_, i) => {
      const w = (W - 112 - (steps.length - 1) * 8) / steps.length;
      return `<rect x="${56 + i * (w + 8)}" y="${TOP_SAFE}" width="${w}" height="8" rx="4" fill="#ffffff" opacity="${i <= at ? 0.95 : 0.3}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#11151c"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="640" cy="260" r="260" fill="white" opacity=".05"/>${bars}<g font-family="${SANS}"><text x="56" y="${TOP_SAFE + 60}" font-size="28" fill="#ffffff" opacity=".85">${xml(wrap(ep.title, 40)[0])}</text>${signature(author, TOP_SAFE + 96, '#ffffff')}${lines.map((line, i) => `<text x="${centre}" y="${y0 + i * lh}" font-size="${size}" font-weight="bold" fill="${isFormula(steps[at]) ? '#ffd27a' : '#ffffff'}" text-anchor="middle"${isFormula(steps[at]) ? ` font-family="${MONO}"` : ''}>${xml(line)}</text>`).join('')}</g></svg>`;
}

async function probeDuration(path: string, signal?: AbortSignal) {
  const p = await exec(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path],
    { timeout: 15000, signal, windowsHide: true },
  );
  const duration = Number(JSON.parse(p.stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Не удалось прочитать звук');
  return duration;
}

// Local text-to-speech, e.g. Piper with a Russian or Kazakh voice. Configured on the server
// as a JSON array: program, then arguments; {out} is the WAV path, text arrives on stdin.
function ttsCommand(language: string): string[] | null {
  const value = process.env[language === 'kk' ? 'TTS_COMMAND_KK' : 'TTS_COMMAND_RU'];
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') && parsed.length
      ? parsed
      : null;
  } catch {
    return null;
  }
}
export const ttsAvailable = (language: string) => Boolean(ttsCommand(language));
async function synthesize(language: string, text: string, out: string, signal?: AbortSignal) {
  const command = ttsCommand(language);
  if (!command) throw new Error('Озвучка для этого языка не настроена на сервере');
  const [program, ...args] = command;
  await new Promise<void>((done, fail) => {
    const child = spawn(
      program,
      args.map((a) => a.replace('{out}', out)),
      { stdio: ['pipe', 'ignore', 'pipe'], signal, windowsHide: true },
    );
    let errors = '';
    const timer = setTimeout(() => child.kill(), 120000);
    child.stderr.on('data', (d) => (errors = (errors + d).slice(-500)));
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else fail(new Error(`TTS завершился с кодом ${code}: ${errors}`));
    });
    child.stdin.end(text);
  });
}

export async function renderEpisode(episode: Episode, options: Options | string = {}) {
  const o: Options = typeof options === 'string' ? { color: options } : options;
  o.signal?.throwIfAborted();
  const style = o.style || 'cards',
    bg = palette[o.color || 'sage'] || palette.sage;
  await mkdir(dataDir, { recursive: true });
  const work = resolve(dataDir, `render-${episode.id}-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  try {
    const steps = style === 'cards' ? [episode.script] : splitSteps(episode.script);
    // Narration decides the timing when present; otherwise reading speed does.
    let audio: string | null = null;
    if (o.voice === 'own' && episode.voice_path) audio = episode.voice_path;
    if (o.voice === 'tts') {
      audio = resolve(work, 'voice.wav');
      await synthesize(
        o.language || 'ru',
        `${episode.title}. ${steps.map(plain).join(' ')}`,
        audio,
        o.signal,
      );
    }
    // Synthesised narration starts with the title, which stays on the first frame.
    const titleShare =
      o.voice === 'tts' ? words(episode.title) / words(`${episode.title} ${episode.script}`) : 0;
    const reading = steps.map((s) => Math.max(isFormula(s) ? 3 : 2.2, words(s) / 2.4));
    let durations = reading;
    if (audio) {
      const total = await probeDuration(audio, o.signal);
      if (total > 180) throw new Error('Озвучка серии должна быть не длиннее 3 минут');
      const weights = steps.map(words);
      const sum = weights.reduce((a, b) => a + b, 0);
      const spoken = total * (1 - titleShare);
      durations = weights.map((w) => Math.max(1, (spoken * w) / sum));
      durations[0] += total * titleShare;
    } else if (style === 'cards')
      durations = [Math.min(45, Math.max(12, Math.ceil(episode.script.split(/\s+/).length / 2.5)))];
    const frames = steps.map((_, i) =>
      style === 'board'
        ? boardFrame(episode, steps, i, o.author)
        : style === 'captions'
          ? captionsFrame(episode, steps, i, bg, o.author)
          : cardsFrame(episode, bg, o.author),
    );
    const list: string[] = [];
    const pngs: string[] = [];
    for (const [i, svg] of frames.entries()) {
      const png = resolve(work, `frame-${i}.png`).replace(/\\/g, '/');
      await sharp(Buffer.from(svg)).png().toFile(png);
      pngs.push(png);
      list.push(`file '${png.replace(/'/g, "'\\''")}'`, `duration ${durations[i].toFixed(2)}`);
    }
    // The concat demuxer needs the last frame repeated to honour its duration. A single
    // still image is looped instead: concat would keep only one frame of it.
    list.push(list.at(-2)!);
    const listPath = resolve(work, 'frames.txt');
    await writeFile(listPath, list.join('\n'));
    const input =
      pngs.length === 1
        ? ['-loop', '1', '-i', pngs[0]]
        : ['-f', 'concat', '-safe', '0', '-i', listPath];
    const mp4 = resolve(dataDir, `${episode.id}.mp4`);
    const output = resolve(work, 'video.mp4');
    const total = durations.reduce((a, b) => a + b, 0);
    await exec(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        ...input,
        ...(audio ? ['-i', audio] : []),
        '-vf',
        'scale=540:960,format=yuv420p',
        '-r',
        '12',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'stillimage',
        '-threads',
        '2',
        ...(audio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '1'] : []),
        '-t',
        total.toFixed(2),
        '-movflags',
        '+faststart',
        output,
      ],
      { timeout: 180000, signal: o.signal, windowsHide: true },
    );
    o.signal?.throwIfAborted();
    await rename(output, mp4);
    o.signal?.throwIfAborted();
    await db.query(
      "UPDATE episodes SET media_path=$1,duration=$2,media_kind='rendered' WHERE id=$3",
      [mp4, Math.max(1, Math.round(total)), episode.id],
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
export async function renderSeason(id: string, signal?: AbortSignal): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const season = await one(
      'SELECT s.*,u.name owner_name FROM seasons s JOIN users u ON u.id=s.owner_id WHERE s.id=$1',
      [id],
    );
    // Uploaded MP4s (for example from Google Flow) are the author's final cut; keep them.
    for (const ep of await rows(
      "SELECT * FROM episodes WHERE season_id=$1 AND NOT (media_kind='uploaded' AND media_path IS NOT NULL) ORDER BY position",
      [id],
    )) {
      if (season.voice === 'own' && !ep.voice_path)
        throw new Error(`Запишите голос для серии ${ep.position + 1}`);
      await renderEpisode(ep, {
        signal,
        color: season.color,
        style: season.style,
        voice: season.voice,
        language: season.language,
        author: season.owner_name,
      });
    }
    signal?.throwIfAborted();
    await db.query(
      "UPDATE seasons SET status='review',render_error=NULL,updated_at=now() WHERE id=$1",
      [id],
    );
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('Video rendering failed:', message);
    await db.query(
      "UPDATE seasons SET status='failed',render_error=$2,updated_at=now() WHERE id=$1",
      [
        id,
        /^(Запишите|Сократите|Озвучка)/.test(message)
          ? message
          : 'Не удалось собрать видео. Сценарий сохранён — можно повторить сборку.',
      ],
    );
    return false;
  }
}
