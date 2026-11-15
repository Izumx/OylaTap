# «Угадай до урока» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** учитель отправляет классу серию-загадку перед уроком, ученики делают ставку, на уроке экран класса показывает раскол голосов и раскрывает ответ, через 3 дня — повторная проверка.

**Architecture:** загадка — опубликованный сезон `kind='hook'` с одной серией и одним вопросом `purpose='hook'`, чтобы переиспользовать каталог, видео и правила доступа. Новые таблицы `hook_runs` (запуск в классе) и `hook_guesses` (ставки). Вся серверная логика — в новом модуле `server/hooks.ts`, весь интерфейс — в `src/Hooks.tsx` и `src/hooks.css`. Экран класса опрашивает сервер раз в 3 секунды.

**Tech Stack:** React 19 + TypeScript + Vite, Express 5, PostgreSQL, zod, Playwright e2e. Новая зависимость: `qrcode` (QR-код ссылки приглашения на экране класса).

**Spec:** `docs/superpowers/specs/2026-11-15-lesson-hooks-design.md`

**Отложено:** режим «Загадка к уроку» в студии автора (по дизайну режется первым). В этой версии загадки — встроенный контент (Task 8).

## Global Constraints

- Интерфейс на двух языках через `t(ru, kk)` из `useApp()`; стили — токены `src/style.css` (`--bg`, `--panel`, `--line`, `--muted`, `--mint`, `--ink`).
- Ошибки сервера — через `HttpError`, `notFound()`, `fail()` из `server/index.ts` или `res.status(..).json({ error })`, тексты ошибок на русском.
- Все 72 существующих e2e-теста остаются зелёными; новые тесты — в `tests/hooks.spec.ts` по образцу `tests/reports.spec.ts` (`actor`, `get`, `post`, удаление созданных пользователей в `afterEach`).
- До раскрытия ученик никогда не получает `correct`, `explanation` и раскол голосов — ни в одном ответе API.
- Экран класса не показывает имена учеников; тексты «почему?» видит только учитель.
- Повторная проверка открывается через **3 дня** после раскрытия (`recheck_at = revealed_at + interval '3 days'`).
- Ставка: `confidence` 1 «наугад», 2 «думаю, что так», 3 «уверен»; `reason` до **140** символов.
- Гостевой аккаунт: только имя (2–40 символов), удаляется вместе со ставками после **60** дней неактивности.
- Экран класса опрашивает сервер каждые **3** секунды.

## Review Focus

- Ученик открыл запуск чужого класса по прямой ссылке — ожидается 404, а не данные.
- Ставка пришла в ту же секунду, что и раскрытие — после `revealed_at` ставка `before` отклоняется с 409, раскол не меняется задним числом.
- 30 телефонов зала заходят как гости с одного Wi-Fi — лимит запросов `/api/auth/guest` не блокирует (отдельный лимит 300 за 10 минут на IP).
- Учитель перезапускает загадку, пока ученик держит открытую карточку — следующая ставка принимается в новом цикле, старые ставки удалены.
- В классе 0 учеников или 0 ставок — экран класса и итоги показывают нули без деления на ноль.

---

### Task 1: Схема базы данных и предметы

**Files:**
- Create: `db/013_lesson_hooks.sql`
- Modify: `scripts/migrate.ts` (добавить `'013_lesson_hooks'` в конец списка)
- Modify: `server/curriculum.ts` (`subjectIds`)
- Modify: подписи предметов во фронтенде (найти по `'world-literature'` в `src/`)
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Produces: таблицы и колонки, на которые опираются все задачи:
  - `seasons.kind text NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson','hook'))`
  - `questions.purpose` разрешает `'hook'` (пересоздать CHECK с `micro`,`final`,`hook`)
  - `seasons_subject_check` и `subjectIds` дополнены `'physics'`, `'biology'`, `'geography'`
  - `users.is_guest boolean NOT NULL DEFAULT false`, `users.last_seen_at timestamptz NOT NULL DEFAULT now()`
  - `hook_runs(id uuid PK, class_id uuid → classrooms ON DELETE CASCADE, season_id uuid → seasons ON DELETE CASCADE, created_by uuid → users, lesson_at timestamptz NOT NULL, votes_shown_at timestamptz, revealed_at timestamptz, recheck_at timestamptz, created_at timestamptz DEFAULT now(), UNIQUE(class_id, season_id))`
  - `hook_guesses(run_id uuid → hook_runs ON DELETE CASCADE, user_id uuid → users ON DELETE CASCADE, phase text CHECK (phase IN ('before','recheck')), answer int NOT NULL CHECK (answer >= 0), confidence int NOT NULL DEFAULT 2 CHECK (confidence BETWEEN 1 AND 3), reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 140), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), PRIMARY KEY(run_id, user_id, phase))`
  - темы программы в `curriculum_topics` для 6 демо-загадок (id `40000000-0000-4000-8000-0000000009NN`): Физика 7 «Взаимодействие тел. Сила»; Биология 7 «Фотосинтез и пигменты листа»; География 7 «Климат и его факторы»; плюс существующие темы алгебры 7 «Формулы сокращённого умножения», истории Казахстана 7 «Образование Казахского ханства»; для литературы 8 — новая тема «Абай — переводчик» (`kz-literature`, 8). Названия на казахском обязательны.

- [ ] **Step 1: Написать падающий тест** `migration adds hook tables, guest columns and new subjects` в `tests/hooks.spec.ts`: запрос к `information_schema.columns` возвращает `seasons.kind`, `users.is_guest`, таблицы `hook_runs`, `hook_guesses`; `GET /api/curriculum?subject=physics` отвечает 200 и содержит хотя бы одну тему.
- [ ] **Step 2: Запустить** `npx playwright test tests/hooks.spec.ts -g migration` — ожидается FAIL.
- [ ] **Step 3: Написать миграцию и расширить `subjectIds`**, подписи новых предметов на двух языках («Физика / Физика», «Биология / Биология», «География / География»).
- [ ] **Step 4: Запустить тест** — ожидается PASS; затем `npm run build` без ошибок.
- [ ] **Step 5: Commit** `feat: add lesson hook schema, guest accounts and science subjects`.

### Task 2: Загадки не попадают в обычные разделы

**Files:**
- Modify: `server/index.ts` (`catalogSql` и выборки опубликованных сезонов), `server/daily-plan.ts`, `server/recommend.ts`, `server/assessments.ts`, `server/analytics.ts`, `server/moderation.ts` — каждое место с `status='published'`, где отдаются уроки
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Consumes: `seasons.kind` (Task 1).
- Produces: правило «уроки — это `kind='lesson'`»; загадки видны только через `/api/hooks*` и `/api/hook-runs*`.

- [ ] **Step 1: Падающий тест** `published hook seasons stay out of catalog, today plan and recommendations`: вставить в БД опубликованный публичный сезон `kind='hook'` с одной серией; `GET /api/catalog`, `GET /api/today`, `GET /api/recommendations` (точный путь взять из `server/recommend.ts`) не содержат его id.
- [ ] **Step 2: Запустить** — FAIL.
- [ ] **Step 3: Добавить `AND s.kind='lesson'`** во все выборки уроков; модерация и прямой `GET /api/seasons/:id` для владельца продолжают работать с загадками.
- [ ] **Step 4: Запустить** новый тест и весь набор `npx playwright test` — все PASS.
- [ ] **Step 5: Commit** `feat: keep lesson hooks out of lesson surfaces`.

### Task 3: Серверный модуль загадок

**Files:**
- Create: `server/hooks.ts`
- Modify: `server/index.ts` (`app.use('/api', hooksRouter(visibilitySql))` рядом с `dailyRouter`)
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Consumes: таблицы Task 1; `required`, `teacher`, `author` из `server/auth.ts`; `rows`, `one`, `db` из `server/db.ts`.
- Produces (все пути под `/api`):
  - `GET /hooks?subject&grade&language` (`required`, `author`) → `HookSummary[]` = `{ id, title, subject, grade, language, topic_title_ru, topic_title_kk, episode_id, duration, prompt }` — только `kind='hook'`, `status='published'`.
  - `POST /classes/:classId/hook-runs` (`teacher`, владелец класса) body `{ season_id: uuid, lesson_at: ISO datetime }` → `HookRun`; 409 «Эта загадка уже запущена в классе», если запуск есть.
  - `GET /classes/:classId/hook-runs` (`teacher`, владелец) → `HookRunRow[]` = `HookRun & { title, answered, students }`.
  - `GET /hook-runs` (`required`, ученик) → `StudentHookRun[]` по всем классам ученика, новые сверху.
  - `GET /hook-runs/:id` → `StudentHookRun` для участника класса, 404 для остальных.
  - `POST /hook-runs/:id/guess` body `{ phase: 'before'|'recheck', answer: int, confidence: 1|2|3, reason?: string ≤140 }` → `StudentHookRun`. `before` — только пока `revealed_at IS NULL` (иначе 409 «Ответ уже раскрыт»); `recheck` — только при `revealed_at IS NOT NULL AND now() >= recheck_at` (иначе 409), `answer` — индекс в перемешанном порядке, сервер переводит в исходный.
  - `POST /hook-runs/:id/show-votes`, `POST /hook-runs/:id/reveal`, `POST /hook-runs/:id/restart` (`teacher`, владелец класса) → `ScreenState`. `reveal` ставит `recheck_at = now() + interval '3 days'`; `restart` удаляет ставки и обнуляет `votes_shown_at`, `revealed_at`, `recheck_at`.
  - `GET /hook-runs/:id/screen` (`teacher`, владелец) → `ScreenState` = `{ run_id, prompt, options, answered, students, votes: number[] | null, confident: number | null, correct: number | null, explanation: string | null, join_code, revealed: boolean }` — `votes`/`confident` только после `show-votes`, `correct`/`explanation` только после `reveal`.
  - `GET /hook-runs/:id/results` (`teacher`, владелец) → `{ summary: { students, watched, answered, before_correct, recheck_answered, recheck_correct }, students: { name, watched_ratio, before_answer, confidence, reason, recheck_answer }[] }`.
  - `StudentHookRun` = `{ id, class_name, title, subject, episode_id, prompt, options, lesson_at, answered, students, my_before: Guess | null, revealed: boolean, correct?: number, explanation?: string, votes?: number[], recheck_open: boolean, recheck_options?: string[], my_recheck: Guess | null }`; `correct`, `explanation`, `votes` присутствуют только при `revealed`.
  - `export function recheckOrder(runId: string, n: number): number[]` — детерминированная перестановка индексов `0..n-1`: сортировка индексов по `sha256(runId + ':' + i)`; если получилась исходная, циклический сдвиг на 1.

- [ ] **Step 1: Падающий тест** `teacher launches a hook, students guess, votes stay hidden until the teacher shows them, reveal opens the answer`: учитель + 2 ученика, класс, `POST /classes/:id/hook-runs`; ученик 1 ставит 1 (уверен), ученик 2 — 0; `GET /hook-runs/:id` у ученика не содержит `correct`, `explanation`, `votes`; `/screen` до `show-votes` → `votes: null`, `answered: 2`; после `show-votes` → `votes` = `[1,1,0]`; после `reveal` у ученика `revealed: true`, есть `correct`; новая ставка `before` → 409.
- [ ] **Step 2: Падающий тест** `hook runs are private to the class`: ученик другого класса получает 404 на `GET /hook-runs/:id` и на `guess`; другой учитель — 404 на `/screen`, `/reveal`, `/results`.
- [ ] **Step 3: Падающий тест** `recheck maps shuffled options back and opens three days after reveal`: после `reveal` сдвинуть `recheck_at` в прошлое прямым UPDATE; `recheck_options` ≠ исходным `options`; ставка по индексу правильного ответа в перемешанном списке → в `/results` `recheck_answer` равен исходному `correct`; до `recheck_at` ставка `recheck` → 409.
- [ ] **Step 4: Падающий тест** `restart clears guesses and reveal` и `empty class screen shows zeros`: `restart` → `answered: 0`, `revealed: false`, у ученика снова можно ставить `before`; класс без учеников → `/screen` `{ answered: 0, students: 0 }`, `/results` без ошибок.
- [ ] **Step 5: Запустить** `npx playwright test tests/hooks.spec.ts` — новые тесты FAIL.
- [ ] **Step 6: Реализовать `hooksRouter(visibilitySql: string): Router`** в `server/hooks.ts` (по образцу `dailyRouter`), все проверки доступа — через JOIN на `classrooms.teacher_id` и `memberships`.
- [ ] **Step 7: Запустить** — PASS; весь набор — PASS.
- [ ] **Step 8: Commit** `feat: add lesson hook runs, guesses, class screen and results API`.

### Task 4: Вход в класс по коду и имени

**Files:**
- Modify: `server/index.ts` (новый маршрут, лимит запросов, обновление `last_seen_at`, очистка гостей)
- Modify: `src/JoinClass.tsx` (форма «Войти по имени» для гостя)
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Consumes: `users.is_guest`, `users.last_seen_at` (Task 1); `createSession` из `server/auth.ts`.
- Produces: `POST /api/auth/guest` body `{ code: string, name: string(2–40, trim) }` → `{ user, next_path }`; создаёт `users(role='student', is_guest=true, email='guest-<uuid>@guest.oylatap.invalid', password_hash='guest-no-password')`, членство в классе и сессию. 404 «Класс с таким кодом не найден». `next_path` = `/assignments`. Отдельный лимит 300 запросов за 10 минут на IP (общий лимит `/api/auth` его не трогает). Функция `purgeGuests(): Promise<number>` удаляет гостей с `last_seen_at < now() - interval '60 days'`, вызывается при старте сервера и раз в 6 часов. Middleware обновляет `last_seen_at` гостя не чаще раза в час.

- [ ] **Step 1: Падающий тест** `guest joins a class by code and name and can place a bet`: без cookie `POST /api/auth/guest { code, name: 'Айгерим' }` → 200, `GET /api/me` → `role: 'student'`, гость в `GET /api/hook-runs` видит запуск класса и ставит `before`.
- [ ] **Step 2: Падающий тест** `stale guests are purged with their guesses`: гостю ставится `last_seen_at = now() - interval '61 days'`, вызов `purgeGuests()` (экспортировать из модуля, тест вызывает через `import`) удаляет пользователя и его ставки; обычный ученик с тем же `last_seen_at` не удалён.
- [ ] **Step 3: Падающий тест** `thirty guests from one address can join` — 30 последовательных `POST /api/auth/guest` из одного контекста → все 200.
- [ ] **Step 4: Запустить** — FAIL.
- [ ] **Step 5: Реализовать маршрут, лимит, `purgeGuests`, обновление `last_seen_at`; на странице приглашения** для невошедшего пользователя — поле имени и кнопка «Войти по имени» (рядом с существующим входом), после успеха — переход на `next_path`.
- [ ] **Step 6: Запустить** — PASS; весь набор — PASS.
- [ ] **Step 7: Commit** `feat: join a class with code and name only`.

### Task 5: Учитель запускает загадку и смотрит итоги

**Files:**
- Create: `src/Hooks.tsx` (`LaunchHookModal`, `HookRunsList`, `HookResultsPage`), `src/hooks.css`
- Modify: `src/Teacher.tsx` (`ClassesPage`: кнопка «Загадка к уроку» и список запусков класса), `src/main.tsx` (маршрут `/classes/:classId/hooks/:runId` под `<Private teacher>`, импорт `hooks.css`)
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Consumes: `GET /api/hooks`, `POST/GET /api/classes/:classId/hook-runs`, `GET /api/hook-runs/:id/results` (Task 3); `Modal`, `State`, `PageHeader` из `src/components.tsx`; `api`, `post`, `useResource`, `useApp` из `src/lib.tsx`.
- Produces: компоненты `LaunchHookModal({ classId, onLaunched })`, `HookRunsList({ classId })`, страница `HookResultsPage`; ссылки «Экран класса» → `/classes/:classId/hooks/:runId/screen` (Task 6).

- [ ] **Step 1: Падающий UI-тест** `teacher launches a hook from the class card in under a minute`: учитель открывает `/classes`, жмёт «Загадка к уроку», выбирает «Почему мост не падает?», ставит дату и время, жмёт «Отправить классу»; в списке запусков класса появляется загадка со ссылками «Экран класса» и «Итоги».
- [ ] **Step 2: Падающий UI-тест** `teacher sees results with names, confidence and reasons`: после ставок двух учеников страница итогов показывает «Ответили 2 из 2», имена, уверенность и «почему?».
- [ ] **Step 3: Запустить** — FAIL.
- [ ] **Step 4: Реализовать компоненты** в стиле сайта; фильтр загадок в окне запуска — по предмету и языку.
- [ ] **Step 5: Запустить** — PASS; проверить вид на ширине 390 px (Playwright `viewport: { width: 390, height: 844 }`).
- [ ] **Step 6: Commit** `feat: launch lesson hooks and read results from the class card`.

### Task 6: Экран класса для проектора

**Files:**
- Modify: `src/Hooks.tsx` (`ClassScreenPage`), `src/hooks.css`, `src/main.tsx` (маршрут `/classes/:classId/hooks/:runId/screen` под `<Private teacher>`, без обёртки `Shell`, на весь экран)
- Modify: `package.json` (зависимость `qrcode` и `@types/qrcode`)
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Consumes: `GET /api/hook-runs/:id/screen`, `POST .../show-votes`, `.../reveal`, `.../restart` (Task 3).
- Produces: `ClassScreenPage` — крупный вопрос, «Ответили N из M» с точками, кнопки «Показать голоса» → «Раскрыть ответ» → «Начать заново»; столбцы голосов по вариантам и «уверенных: X из N»; после раскрытия — правильный вариант подсвечен `--mint`, текст раскрытия; QR-код и код класса для входа по `/join/:code`; опрос каждые 3 секунды.

- [ ] **Step 1: Падающий UI-тест** `class screen updates answers live and reveals on click`: учитель открывает экран, ученик ставит через API, в течение 5 секунд на экране «Ответили 1 из 1»; клик «Показать голоса» → виден столбец с 1; клик «Раскрыть ответ» → правильный вариант помечен, имя ученика нигде на экране не встречается.
- [ ] **Step 2: Запустить** — FAIL.
- [ ] **Step 3: Реализовать экран**: шрифт вопроса не меньше 64 px при ширине 1920, раскладка читается с 1280×720.
- [ ] **Step 4: Запустить** — PASS.
- [ ] **Step 5: Commit** `feat: add live class screen with votes, reveal and join QR`.

### Task 7: Ученик смотрит загадку и ставит ставку

**Files:**
- Modify: `src/Hooks.tsx` (`HookCard`), `src/Student.tsx` (`AssignmentsPage` — блок «Загадки к уроку» сверху; `Feed` — карточка активной загадки над лентой, если есть ставка не сделана)
- Test: `tests/hooks.spec.ts`

**Interfaces:**
- Consumes: `GET /api/hook-runs`, `POST /api/hook-runs/:id/guess` (Task 3); видео серии — `/api/episodes/:episodeId/video`.
- Produces: `HookCard({ run, onChange })` с состояниями: «не ответил» (видео, варианты, уверенность «наугад · думаю · уверен», поле «Почему? (необязательно)», кнопка «Поставить», «Уже ответили N из M»), «ставка принята — ответ на уроке» (можно изменить до раскрытия), «раскрыто» («Ты угадал» / «Не угадал — так бывает чаще всего», объяснение, раскол класса), «повтор открыт» (вопрос с перемешанными вариантами).

- [ ] **Step 1: Падающий UI-тест** `student bets before the lesson and sees the answer only after reveal` на 390×844: ученик видит карточку в «Заданиях», выбирает вариант и «уверен», жмёт «Поставить» → «Ставка принята. Ответ — на уроке»; на странице нет текста раскрытия; после `reveal` (через API учителя) и перезагрузки — «Ты угадал» или «Не угадал» и объяснение.
- [ ] **Step 2: Запустить** — FAIL.
- [ ] **Step 3: Реализовать `HookCard`** и встроить в «Задания» и ленту, не меняя существующий вид остальных карточек.
- [ ] **Step 4: Запустить** — PASS; весь набор — PASS.
- [ ] **Step 5: Commit** `feat: students watch a hook and bet before the lesson`.

### Task 8: Встроенные загадки и демо-класс

**Files:**
- Create: `content/hooks/<slug>/hook.json` и `content/hooks/<slug>/<slug>.mp4` для 6 загадок (`physics-bridge`, `algebra-square`, `history-khanate`, `biology-leaf`, `geography-climate`, `literature-abai`; видео — из `deliverables/video/hooks/out/OylaTap_Hook_<slug>.mp4`, вопросы и раскрытие — из `deliverables/video/hooks/<slug>/hook.json`)
- Modify: `scripts/bundled-content.ts` (`hookSchema`, `bundledHooks`, загрузка в `syncBundledContent` с `kind='hook'`, `purpose='hook'`, `visibility='public'`), `scripts/seed.ts` (демо-класс получает запуск загадки про мост в состоянии «до раскрытия», без ставок)
- Test: `tests/hooks.spec.ts`, существующий `tests/bundled-content.spec.ts`

**Interfaces:**
- Consumes: темы программы Task 1; фиксированные id сезонов `30000000-0000-4000-8000-00000000000N` (N = 1…6 в порядке списка выше).
- Produces: `hookSchema` = `{ title, description, subject, language, grade, topic_id, episode: { title, script }, question: { prompt, options (3), correct, explanation } }`; `bundledHooks`.

- [ ] **Step 1: Падающий тест** `bundled hooks appear in the launch picker with their topics`: после `content:sync` `GET /api/hooks` учителю возвращает 6 загадок, у физики `topic_title_ru` «Взаимодействие тел. Сила», у каждой `episode_id` отдаёт видео 200.
- [ ] **Step 2: Запустить** — FAIL.
- [ ] **Step 3: Реализовать загрузку**; повторный запуск `content:sync` не создаёт дублей и сохраняет id серий и вопросов.
- [ ] **Step 4: Запустить** новый тест и `tests/bundled-content.spec.ts` — PASS.
- [ ] **Step 5: Commit** `feat: bundle six lesson hooks and seed a demo hook run`.

### Task 9: Проверка целиком и деплой

**Files:**
- Modify: `README.md` (раздел «Загадки к уроку»), `deploy/oracle/DEPLOYMENT.md` (шаг `content:sync` после миграции)

- [ ] **Step 1: Полный прогон**: `npm run build`, `npm run format:check`, `npx playwright test` — все зелёные; вывод приложить к отчёту.
- [ ] **Step 2: Ручная проверка на локальном сервере** с двумя телефонными окнами 390×844 и экраном 1920×1080: запуск, вход гостем по QR, ставка, «Показать голоса», «Раскрыть ответ».
- [ ] **Step 3: Commit** `docs: describe lesson hooks and deployment step`.
- [ ] **Step 4: Деплой — только после согласия пользователя**: бэкап (`sudo systemctl start oylatap-backup.service`, `Result=success`), `docker image tag oylatap:oracle-local oylatap:before-hooks`, сборка, `db:migrate`, `content:sync`, запуск, проверка `/api/health` и экрана класса на проде.
