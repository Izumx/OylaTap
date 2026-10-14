import { randomUUID, randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { db, one, rows } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { renderEpisode } from '../server/render.js';
if (process.env.DEMO_MODE !== 'true')
  throw new Error('Demo seeding requires DEMO_MODE=true. Do not seed a live school database.');
const teacherId = '00000000-0000-4000-8000-000000000001',
  studentId = '00000000-0000-4000-8000-000000000002';
for (const u of [
  { id: teacherId, name: 'Айгерим Садыкова', email: 'teacher@demo.oylatap.local', role: 'teacher' },
  { id: studentId, name: 'Али', email: 'student@demo.oylatap.local', role: 'student' },
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
console.log('Demo users, 4 seasons with playable caption videos, classroom and assignment ready.');
await db.end();
