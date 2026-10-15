import { randomUUID, randomBytes } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { db, one, rows } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { renderEpisode } from '../server/render.js';
if (process.env.DEMO_MODE !== 'true')
  throw new Error('Demo seeding requires DEMO_MODE=true. Do not seed a live school database.');
const teacherId = '00000000-0000-4000-8000-000000000001',
  studentId = '00000000-0000-4000-8000-000000000002',
  creatorId = '00000000-0000-4000-8000-000000000003';
for (const u of [
  { id: teacherId, name: 'Айгерим Садыкова', email: 'teacher@demo.oylatap.local', role: 'teacher' },
  { id: studentId, name: 'Али', email: 'student@demo.oylatap.local', role: 'student' },
  { id: creatorId, name: 'Данияр Математик', email: 'creator@demo.oylatap.local', role: 'creator' },
]) {
  await db.query(
    'INSERT INTO users(id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
    [u.id, u.name, u.email, u.role, hashPassword(randomBytes(32).toString('hex'))],
  );
}
const seasons = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Как появилось Казахское ханство',
    description:
      'Керей, Жанибек и решение, которое изменило историю. Разбираемся в причинах, а не заучиваем даты.',
    subject: 'kz-history',
    language: 'ru',
    grade: 7,
    color: 'sage',
    art: 'history',
    episodes: [
      [
        'Почему люди искали перемен?',
        'В XV веке часть кочевых племён была недовольна политикой Абулхаира. Керей и Жанибек стали лидерами переселения. Важно различать повод и причины: перемены накапливались долго.',
      ],
      [
        'Новое начало в Жетысу',
        'Керей и Жанибек переселились с поддержавшими их людьми в западную часть Могулистана. Правитель Есен-Буга предоставил им земли в Жетысу. Это создало условия для объединения.',
      ],
      [
        'Что объединило ханство?',
        'В школьной традиции образование Казахского ханства относят к 1465–1466 годам. Объединение укрепляло связи племён. Дата помогает ориентироваться, но главное — понимать причины и последствия.',
      ],
    ],
    questions: [
      [
        'Почему переселение стало важным шагом?',
        [
          'Создало условия для объединения',
          'Сразу прекратило все войны',
          'Отменило кочевой образ жизни',
        ],
        0,
        'Переселение дало территории и политические условия для нового объединения.',
      ],
      [
        'Кто стоял у истоков ханства?',
        ['Абылай и Кенесары', 'Керей и Жанибек', 'Абай и Шокан'],
        1,
        'Керей и Жанибек возглавили переселение и образование ханства.',
      ],
      [
        'Где находились предоставленные земли?',
        ['В Жетысу', 'В Западной Европе', 'На берегу Балтийского моря'],
        0,
        'Есен-Буга предоставил переселенцам земли в Жетысу.',
      ],
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    title: 'Абай: ойлан, үйрен, өзгер',
    description:
      'Білім, еңбек пен адам болу туралы. Абайдың ойларын күнделікті өмірмен байланыстырамыз.',
    subject: 'kz-literature',
    language: 'kk',
    grade: 7,
    color: 'peach',
    art: 'book',
    episodes: [
      [
        'Білім не үшін керек?',
        'Абай білімге ұмтылуды адамның дамуының маңызды жолы деп қарастырды. Білім тек деректі жаттау емес: түсіну, ойлау және үйренгеніңді өмірде қолдану.',
      ],
      [
        'Еңбек пен жауапкершілік',
        'Абай шығармаларында еңбек пен адамның өзіне талап қоюы жиі айтылады. Өзгеріс шағын әрекеттен басталады: бүгін қандай пайдалы істі соңына дейін орындай аласың?',
      ],
      [
        'Өз ойыңды айт',
        'Әдеби мәтінді түсіну үшін өз пікіріңді дәлелде. Автордың ойын қысқаша айт, содан кейін өмірден мысал келтір. Пікір мен мәтіндегі деректі ажырат.',
      ],
    ],
    questions: [
      [
        'Білімді түсінудің белгісі қандай?',
        ['Тек жаттап алу', 'Үйренгенді қолдана білу', 'Сұрақ қоймау'],
        1,
        'Білімді қолдану мен түсіндіру түсінгеніңді көрсетеді.',
      ],
      [
        'Пікірді қалай негіздейміз?',
        ['Мысал мен дәлел келтіреміз', 'Дауысты көтереміз', 'Тек қайталаймыз'],
        0,
        'Мәтіннен дәлел мен өмірден мысал пікірді түсінікті етеді.',
      ],
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    title: 'Пушкин: за строками стихотворения',
    description: 'Как услышать настроение текста, заметить образ и объяснить своё впечатление.',
    subject: 'ru-literature',
    language: 'ru',
    grade: 7,
    color: 'lilac',
    art: 'poetry',
    episodes: [
      [
        'Кто говорит в стихотворении?',
        'Лирический герой — голос, через который мы слышим чувства и мысли в стихотворении. Он не всегда совпадает с автором. Сначала спроси: что чувствует этот голос и почему?',
      ],
      [
        'Как работает образ?',
        'Образ помогает представить мысль через картину, звук или ощущение. Найди слово, которое создаёт настроение. Объясни, какой эффект оно производит и что изменится без него.',
      ],
      [
        'Впечатление и доказательство',
        'Можно по-разному воспринимать стихотворение. Чтобы объяснение было убедительным, опирайся на детали текста. Формула: моё впечатление, деталь, объяснение связи.',
      ],
    ],
    questions: [
      [
        'Лирический герой — это…',
        ['Всегда сам поэт', 'Голос чувств и мыслей в стихотворении', 'Любой читатель'],
        1,
        'Лирический герой не всегда тождествен автору: это голос текста.',
      ],
      [
        'Как обосновать впечатление?',
        ['Указать деталь текста и объяснить её', 'Назвать только дату', 'Повторить чужое мнение'],
        0,
        'Деталь текста делает впечатление аргументированным.',
      ],
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    title: 'Шёлковый путь: больше, чем торговля',
    description: 'Путешествие по дорогам, которые связывали города, идеи и культуры.',
    subject: 'world-history',
    language: 'ru',
    grade: 6,
    color: 'blue',
    art: 'route',
    episodes: [
      [
        'Не одна дорога',
        'Шёлковый путь — название сети торговых маршрутов, а не одной дороги. Пути менялись в зависимости от безопасности, природных условий и политической ситуации.',
      ],
      [
        'Что путешествовало вместе с товарами?',
        'Купцы перевозили ткани, специи и другие товары. Вместе с людьми распространялись знания, технологии и культурные традиции. Обмен влиял на жизнь городов.',
      ],
      [
        'Города как точки встречи',
        'Города на маршрутах давали путникам отдых, рынки и возможность обмена. Города Казахстана, включая Тараз и Отрар, были связаны с этой сетью. Спроси: что делает город удобным для торговли?',
      ],
    ],
    questions: [
      [
        'Что точнее описывает Шёлковый путь?',
        ['Одна неизменная дорога', 'Сеть торговых маршрутов', 'Морской маршрут вокруг мира'],
        1,
        'Это сеть маршрутов, которые изменялись со временем.',
      ],
      [
        'Кроме товаров распространялись…',
        ['Знания и культурные традиции', 'Только деньги', 'Только военные приказы'],
        0,
        'Обмен связывал культуры и помогал распространять знания.',
      ],
    ],
  },
];
seasons[1].questions.splice(1, 0, [
  'Қандай әрекет жауапкершілікті көрсетеді?',
  ['Пайдалы істі аяқтау', 'Әрқашан кейінге қалдыру', 'Тек уәде беру'],
  0,
  'Пайдалы істі соңына дейін орындау еңбек пен жауапкершілікті көрсетеді.',
]);
seasons[2].questions.splice(1, 0, [
  'Что помогает заметить художественный образ?',
  ['Только номер страницы', 'Слово, создающее картину или ощущение', 'Только год издания'],
  1,
  'Образ создаёт картину, звук или ощущение и помогает понять настроение.',
]);
seasons[3].questions.push([
  'Почему города были важны для торговых маршрутов?',
  ['Давали рынки, отдых и обмен', 'Исключали встречу культур', 'Запрещали торговлю'],
  0,
  'Города были местами встречи, отдыха, торговли и обмена.',
]);
for (const s of seasons) {
  const exists = await one('SELECT id FROM seasons WHERE id=$1', [s.id]);
  if (!exists) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        "INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,color,art,status,source_name,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'published','Демонстрационные материалы OylaTap; требуется проверка учителем','public')",
        [s.id, teacherId, s.title, s.description, s.subject, s.language, s.grade, s.color, s.art],
      );
      for (const [i, e] of s.episodes.entries())
        await c.query(
          'INSERT INTO episodes(id,season_id,position,title,script) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), s.id, i, ...e],
        );
      for (const [i, q] of s.questions.entries())
        await c.query(
          'INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [randomUUID(), s.id, i, q[0], JSON.stringify(q[1]), q[2], q[3]],
        );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  const episodeList = await rows('SELECT id FROM episodes WHERE season_id=$1 ORDER BY position', [
    s.id,
  ]);
  for (const [i, q] of s.questions.entries())
    await db.query(
      'INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(season_id,position) DO UPDATE SET prompt=EXCLUDED.prompt,options=EXCLUDED.options,correct=EXCLUDED.correct,explanation=EXCLUDED.explanation,episode_id=EXCLUDED.episode_id',
      [randomUUID(), s.id, i, q[0], JSON.stringify(q[1]), q[2], q[3], episodeList[i].id],
    );
  for (const e of await rows('SELECT * FROM episodes WHERE season_id=$1 ORDER BY position', [
    s.id,
  ])) {
    try {
      if (!e.media_path) throw new Error('missing');
      await access(e.media_path);
    } catch {
      await renderEpisode(e, s.color);
    }
  }
}
await db.query(
  await readFile(new URL('../db/007_demo_final_questions.sql', import.meta.url), 'utf8'),
);
// The demo teacher also moderates, so the whole author → moderator → feed path can be tried.
await db.query('UPDATE users SET is_moderator=true WHERE id=$1', [teacherId]);

// Independent author's lessons: generated board and caption videos tied to programme topics.
type Q = [string, string[], number, string, number];
const authored: {
  id: string;
  title: string;
  description: string;
  grade: number;
  style: 'board' | 'captions';
  topic: string;
  episodes: [string, string][];
  micro: Q[];
  final: Q[];
}[] = [
  {
    id: '10000000-0000-4000-8000-000000000005',
    title: 'Квадрат суммы без зубрёжки',
    description: 'Почему (a + b)² ≠ a² + b², откуда берётся 2ab и как считать квадраты в уме.',
    grade: 7,
    style: 'board',
    topic: '40000000-0000-4000-8000-000000000103',
    episodes: [
      [
        'Почему не a² + b²?',
        'Почему (a + b)² — это не a² + b²?\nПроверим на числах: a = 2, b = 3.\n`(2 + 3)² = 5² = 25`\n`2² + 3² = 4 + 9 = 13`\n25 ≠ 13 — значит, что-то потерялось.',
      ],
      [
        'Раскрываем скобки',
        '(a + b)² — это (a + b), умноженное само на себя.\n`(a + b)(a + b)`\nКаждое слагаемое первой скобки умножаем на каждое из второй.\n`= a² + ab + ab + b²`\n`= a² + 2ab + b²`\nПотерянная часть — это 2ab.',
      ],
      [
        'Квадраты в уме',
        'Формула помогает считать в уме.\n`51² = (50 + 1)²`\n`= 2500 + 100 + 1`\n`= 2601`\nПопробуй сам: 31² = 900 + 60 + 1 = 961.',
      ],
    ],
    micro: [
      [
        'Чему равно (2 + 3)²?',
        ['13', '25', '10'],
        1,
        '(2 + 3)² = 5² = 25, а 2² + 3² = 13: квадрат суммы не равен сумме квадратов.',
        0,
      ],
      [
        'Какое слагаемое теряют, когда пишут (a + b)² = a² + b²?',
        ['2ab', 'ab²', '2a + 2b'],
        0,
        'При раскрытии (a + b)(a + b) получаются два произведения ab, вместе 2ab.',
        1,
      ],
      ['Чему равно 21²?', ['421', '441', '401'], 1, '21² = (20 + 1)² = 400 + 40 + 1 = 441.', 2],
    ],
    final: [
      [
        'Раскройте скобки: (x + 4)²',
        ['x² + 16', 'x² + 8x + 16', 'x² + 4x + 16'],
        1,
        'По формуле: x² + 2·x·4 + 4² = x² + 8x + 16.',
        1,
      ],
      [
        'Почему 3² + 4² ≠ (3 + 4)²?',
        ['Не хватает слагаемого 2·3·4 = 24', 'Они равны', 'Потому что 3 и 4 — разные числа'],
        0,
        '(3 + 4)² = 49 = 9 + 24 + 16, а 3² + 4² = 25. Разница 24 — это 2ab.',
        0,
      ],
      [
        'Чему равно 101²?',
        ['10 201', '10 001', '1 201'],
        0,
        '(100 + 1)² = 10 000 + 200 + 1 = 10 201.',
        2,
      ],
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    title: 'Квадратный корень за три шага',
    description:
      'Что такое √, почему у отрицательного числа нет корня и как оценить √50 без калькулятора.',
    grade: 8,
    style: 'captions',
    topic: '40000000-0000-4000-8000-000000000201',
    episodes: [
      [
        'Обратное действие',
        'Возведём 7 в квадрат: 7² = 49.\nКорень задаёт обратный вопрос: какое неотрицательное число в квадрате даёт 49?\n`√49 = 7`\nКвадратный корень всегда неотрицателен.',
      ],
      [
        'Почему нет √(−4)',
        'Любое число в квадрате неотрицательно.\n`2² = 4 и (−2)² = 4`\nНи одно действительное число в квадрате не даёт −4.\nПоэтому среди действительных чисел √(−4) не существует.',
      ],
      [
        'Оценка корня',
        '√50 — не целое число, но его можно оценить.\n`7² = 49, 8² = 64`\n50 лежит между 49 и 64, значит √50 между 7 и 8.\nИ ближе к 7, потому что 50 ближе к 49.',
      ],
    ],
    micro: [
      [
        'Чему равен √81?',
        ['9', '−9', '40,5'],
        0,
        '9² = 81, а квадратный корень неотрицателен, поэтому √81 = 9.',
        0,
      ],
      [
        'Почему среди действительных чисел нет √(−9)?',
        ['Квадрат любого числа неотрицателен', 'Потому что 9 нечётное', 'Он есть и равен −3'],
        0,
        '(−3)² = 9, а не −9. Квадрат действительного числа не бывает отрицательным.',
        1,
      ],
      [
        'Между какими целыми числами лежит √30?',
        ['5 и 6', '4 и 5', '15 и 16'],
        0,
        '5² = 25 < 30 < 36 = 6², значит 5 < √30 < 6.',
        2,
      ],
    ],
    final: [
      ['Чему равен √144?', ['12', '72', '−12'], 0, '12² = 144, корень неотрицателен.', 0],
      [
        'Какое выражение не имеет смысла среди действительных чисел?',
        ['√0', '√(−1)', '√1'],
        1,
        '√0 = 0, √1 = 1, а квадрат действительного числа не может равняться −1.',
        1,
      ],
      [
        'Какое целое число ближе всего к √99?',
        ['10', '9', '50'],
        0,
        '10² = 100, а 99 очень близко к 100.',
        2,
      ],
    ],
  },
];
for (const s of authored) {
  if (!(await one('SELECT id FROM seasons WHERE id=$1', [s.id]))) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        "INSERT INTO seasons(id,owner_id,title,description,subject,language,grade,color,art,status,source_name,visibility,style,topic_id,published_at) VALUES($1,$2,$3,$4,'algebra','ru',$5,'slate','math','published','Демонстрационные материалы OylaTap; требуется проверка учителем','public',$6,$7,now())",
        [s.id, creatorId, s.title, s.description, s.grade, s.style, s.topic],
      );
      const ids: string[] = [];
      for (const [i, e] of s.episodes.entries()) {
        ids.push(randomUUID());
        await c.query(
          'INSERT INTO episodes(id,season_id,position,title,script) VALUES($1,$2,$3,$4,$5)',
          [ids[i], s.id, i, ...e],
        );
      }
      for (const [i, q] of [
        ...s.micro.map((q) => [...q, 'micro'] as const),
        ...s.final.map((q) => [...q, 'final'] as const),
      ].entries())
        await c.query(
          'INSERT INTO questions(id,season_id,position,prompt,options,correct,explanation,episode_id,purpose) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [randomUUID(), s.id, i, q[0], JSON.stringify(q[1]), q[2], q[3], ids[q[4]], q[5]],
        );
      await c.query(
        "INSERT INTO moderation_decisions(id,season_id,moderator_id,decision,note) VALUES($1,$2,$3,'approved','Демонстрационный пример')",
        [randomUUID(), s.id, teacherId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  for (const e of await rows('SELECT * FROM episodes WHERE season_id=$1 ORDER BY position', [
    s.id,
  ])) {
    try {
      if (!e.media_path) throw new Error('missing');
      await access(e.media_path);
    } catch {
      await renderEpisode(e, {
        color: 'slate',
        style: s.style,
        language: 'ru',
        author: 'Данияр Математик',
      });
    }
  }
}
const classId = '20000000-0000-4000-8000-000000000001';
await db.query(
  "INSERT INTO classrooms(id,teacher_id,name,code,current_season_id) VALUES($1,$2,'7 А · История и литература','OYLA7A',$3) ON CONFLICT(id) DO NOTHING",
  [classId, teacherId, seasons[0].id],
);
await db.query('INSERT INTO memberships(class_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
  classId,
  studentId,
]);
await db.query(
  "INSERT INTO assignments(id,class_id,season_id,due_at) VALUES($1,$2,$3,now()+interval '7 days') ON CONFLICT(class_id,season_id) DO NOTHING",
  [randomUUID(), classId, seasons[0].id],
);
console.log(
  'Demo users (student, teacher-moderator, author), 6 seasons with playable videos, classroom and assignment ready.',
);
await db.end();
