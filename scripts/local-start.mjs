import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, constants, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const windows = process.platform === 'win32';
const npm = windows ? 'npm.cmd' : 'npm';
const checkOnly = process.argv.includes('--check');
const noBrowser = process.argv.includes('--no-browser');
function start(command, args, options) {
  if (windows && command === npm) {
    return spawn('cmd.exe', ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')], options);
  }
  return spawn(command, args, options);
}
function check(command, args, message) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 15000 });
  if (result.status !== 0) throw new Error(message);
}
async function run(command, args) {
  // Only fixed npm arguments reach cmd.exe. No user input is embedded in a shell command.
  const child = start(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error(`${command}: код выхода ${code}`)),
    );
  });
}
async function healthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const value = await response.json();
    return response.ok && value.ok === true && value.database === 'PostgreSQL';
  } catch {
    return false;
  }
}
async function free(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}
function openBrowser(url) {
  if (noBrowser) return;
  const command = windows ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = windows ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`Откройте в браузере: ${url}`));
  child.unref();
}
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error('Нужен Node.js 22.12 или новее. Установите Node.js LTS и повторите запуск.');
  check(
    'docker',
    ['info'],
    'Docker недоступен. Установите и запустите Docker Desktop (или Docker Engine), дождитесь готовности и повторите запуск.',
  );
  check('docker', ['compose', 'version'], 'Нужен Docker Compose. Он входит в Docker Desktop.');
  check(
    'ffmpeg',
    ['-version'],
    'FFmpeg не найден в PATH. Установите FFmpeg, закройте и снова откройте терминал.',
  );
  check(
    'ffprobe',
    ['-version'],
    'FFprobe не найден в PATH. Он должен быть установлен вместе с FFmpeg.',
  );
  console.log('Node.js, Docker Compose и FFmpeg доступны.');
  if (checkOnly) process.exit(0);
  if (await healthy(3100)) {
    console.log('OylaTap уже работает: http://127.0.0.1:3100');
    openBrowser('http://127.0.0.1:3100');
    process.exit(0);
  }
  mkdirSync('.local', { recursive: true });
  if (!existsSync('.env')) copyFileSync('.env.example', '.env', constants.COPYFILE_EXCL);
  await run(npm, ['ci', '--cache', '.local/npm-cache']);
  await run('docker', ['compose', 'up', '-d', 'db']);
  let databaseReady = false;
  for (let i = 0; i < 30; i++) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'db',
        'sh',
        '-c',
        'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
      ],
      { stdio: 'ignore', timeout: 5000 },
    );
    if (result.status === 0) {
      databaseReady = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!databaseReady) throw new Error('PostgreSQL не запустился. Посмотрите ошибку Docker выше.');
  await run(npm, ['run', 'db:migrate']);
  const { config } = await import('dotenv');
  const settings = config({ quiet: true }).parsed || {};
  if ((process.env.DEMO_MODE || settings.DEMO_MODE) === 'true') await run(npm, ['run', 'db:seed']);
  let port = 3100;
  if (await healthy(port)) {
    console.log(`OylaTap уже работает: http://127.0.0.1:${port}`);
    openBrowser(`http://127.0.0.1:${port}`);
    process.exit(0);
  }
  while (!(await free(port))) {
    if (++port > 3010)
      throw new Error('Порты 3100–3110 заняты. Закройте другие серверы и повторите запуск.');
  }
  const child = start(npm, ['run', 'dev'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.once('exit', (code) => process.exit(code || 0));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (await healthy(port)) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) {
    child.kill();
    throw new Error('Сайт не запустился. Смотрите сообщение сервера выше.');
  }
  console.log(
    `\nСАЙТ ЗАПУЩЕН НА ЭТОМ КОМПЬЮТЕРЕ: http://127.0.0.1:${port}\nОставьте это окно открытым. Остановка: Ctrl+C.\n`,
  );
  openBrowser(`http://127.0.0.1:${port}`);
} catch (error) {
  console.error(`\nНе удалось запустить OylaTap: ${error.message}\n`);
  process.exitCode = 1;
}
