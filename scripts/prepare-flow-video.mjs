// Assemble already downloaded Flow scenes. Does not generate content or contact Google.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const [sourceDir, outputDir = '.local/flow-khanate'] = process.argv.slice(2);
if (!sourceDir)
  throw new Error('Usage: node scripts/prepare-flow-video.mjs SOURCE_DIRECTORY [OUTPUT_DIRECTORY]');
const out = resolve(outputDir);
const lesson = JSON.parse(
  await readFile(new URL('../content/khanate-flow/lesson.json', import.meta.url), 'utf8'),
);
const files = await readdir(sourceDir);
const find = (prefix) => {
  const matches = files.filter((f) => f.startsWith(prefix) && f.endsWith('.mp4'));
  if (matches.length !== 1)
    throw new Error(`Expected exactly one MP4 for ${prefix}; found ${matches.length}`);
  return resolve(sourceDir, matches[0]);
};
await mkdir(out, { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const probe = async (path) =>
  JSON.parse(
    (
      await exec(ffprobe, [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        path,
      ])
    ).stdout,
  );
const run = (args) =>
  exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    cwd: out,
    timeout: 300000,
    maxBuffer: 4 * 1024 * 1024,
  });
const records = [];
for (const [i, scene] of lesson.scenes.entries()) {
  const visual = find(scene.visual_prefix),
    voice = find(scene.voice_prefix);
  const [v, a] = await Promise.all([probe(visual), probe(voice)]);
  if (
    Math.abs(Number(v.format.duration) - 8) > 0.1 ||
    Math.abs(Number(a.format.duration) - 8) > 0.1 ||
    !a.streams.some((s) => s.codec_type === 'audio')
  )
    throw new Error(`Invalid eight-second input: scene ${i + 1}`);
  const target = join(out, `part-${String(i + 1).padStart(2, '0')}.mp4`);
  await run([
    '-n',
    '-i',
    visual,
    '-i',
    voice,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-ac',
    '1',
    '-t',
    '8',
    '-movflags',
    '+faststart',
    target,
  ]);
  records.push({
    scene: i + 1,
    visual: basename(visual),
    voice: basename(voice),
    part: basename(target),
  });
  console.log(`Prepared scene ${i + 1}/${lesson.scenes.length}`);
}
await writeFile(join(out, 'concat.txt'), records.map((r) => `file '${r.part}'`).join('\n'));
await run(['-n', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'joined.mp4']);
// Fixed 720x1280 subtitle canvas leaves room for OylaTap's bottom controls.
const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,DejaVu Sans,31,&H00FFFFFF,&H00FFFFFF,&H00141616,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1,2,35,110,285,1\nStyle: Chapter,DejaVu Sans,26,&H00D1F2DF,&H00FFFFFF,&H00141616,&H80000000,1,0,0,0,100,100,0,0,1,2,1,7,40,100,145,1\nStyle: Note,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H00141616,&H80000000,0,0,0,0,100,100,0,0,1,1.5,1,7,40,100,192,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
const assTime = (t) =>
  `0:${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const srtTime = (t) =>
  `00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')},${String(Math.round((t % 1) * 1000)).padStart(3, '0')}`;
const events = [],
  cues = [];
for (const [i, scene] of lesson.scenes.entries()) {
  events.push(
    `Dialogue: 0,${assTime(i * 8)},${assTime((i + 1) * 8)},Chapter,,0,0,0,,${String(i + 1).padStart(2, '0')} / 06 · ${scene.heading}`,
  );
  for (const [j, text] of scene.captions.entries()) {
    const start = i * 8 + j * 4,
      end = start + 4;
    events.push(
      `Dialogue: 1,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text.replaceAll('\n', '\\N')}`,
    );
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`);
  }
}
events.push('Dialogue: 0,0:00:00.00,0:00:04.00,Note,,0,0,0,,Художественная ИИ-реконструкция');
await writeFile(join(out, 'captions.ass'), header + events.join('\n') + '\n');
await writeFile(join(out, 'khanate-ru.srt'), cues.join('\n'));
await writeFile(
  join(out, 'narration.txt'),
  lesson.scenes.map((s, i) => `${i + 1}. ${s.narration}`).join('\n\n'),
);
// Normalize the complete voice track in two passes to keep scene loudness consistent.
const analysis = await exec(
  ffmpeg,
  [
    '-hide_banner',
    '-nostdin',
    '-i',
    join(out, 'joined.mp4'),
    '-vn',
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
    '-f',
    'null',
    '-',
  ],
  { timeout: 60000 },
);
const measured = JSON.parse(analysis.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s)?.[0] || '{}');
if (!Number.isFinite(Number(measured.input_i)))
  throw new Error('Narration contains no measurable sound');
const loudness = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
const final = join(out, 'oylatap-khanate-full-ru.mp4');
await run([
  '-n',
  '-i',
  'joined.mp4',
  '-vf',
  'ass=captions.ass',
  '-af',
  loudness,
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '20',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  '-ar',
  '48000',
  '-ac',
  '1',
  '-movflags',
  '+faststart',
  final,
]);
await run(['-n', '-ss', '1.0', '-i', final, '-frames:v', '1', 'cover.jpg']);
const metadata = await probe(final);
await writeFile(
  join(out, 'build.json'),
  JSON.stringify(
    { source: 'Google Flow existing downloads', records, metadata, voiceMeasurement: measured },
    null,
    2,
  ),
);
console.log(JSON.stringify({ file: final, duration: metadata.format.duration, metadata }));
