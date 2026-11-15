import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const pending = new Map<string, Promise<Buffer>>();
// A catalogue can request many covers at once. Decode one video at a time.
let queue: Promise<unknown> = Promise.resolve();

/** A JPEG frame of the video at `at` seconds; falls back to the first frame for shorter videos. */
export async function videoPoster(mediaPath: string, at = 0): Promise<Buffer> {
  const source = resolve(mediaPath);
  const info = await stat(source);
  const key = createHash('sha256')
    .update(`${source}:${info.size}:${info.mtimeMs}${at ? `:${at}` : ''}`)
    .digest('hex');
  const directory = resolve('.local/posters');
  const target = join(directory, `${key}.jpg`);
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const job = queue.then(async () => {
    const frame = async (seek: number) =>
      (
        await exec(
          process.env.FFMPEG_PATH || 'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(seek),
            '-i',
            source,
            '-frames:v',
            '1',
            '-vf',
            "scale='min(480,iw)':-2",
            '-q:v',
            '3',
            '-f',
            'image2pipe',
            '-vcodec',
            'mjpeg',
            'pipe:1',
          ],
          { encoding: 'buffer', timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        )
      ).stdout;
    let stdout = await frame(at);
    if (!stdout.length && at) stdout = await frame(0);
    if (!stdout.length) throw new Error('No video frame available');
    await mkdir(directory, { recursive: true });
    await writeFile(target, stdout);
    return stdout;
  });
  pending.set(key, job);
  queue = job.catch(() => {});
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
