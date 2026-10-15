import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Download,
  ListChecks,
  Mic,
  Search,
  UsersRound,
  RefreshCw,
} from 'lucide-react';
import { useApp, useResource } from './lib';
import { Modal, PageHeader, State } from './components';
import { ReviewModal } from './Teacher';
import type { ReportOverview, ResultRow, TeacherAttempt, ReportFocus } from './report-types';

export function ResultsPage() {
  const { t, locale } = useApp();
  const [params, setParams] = useSearchParams();
  const [review, setReview] = useState<ResultRow | null>(null);
  const query = new URLSearchParams();
  for (const key of ['class_id', 'season_id', 'q', 'focus'])
    if (params.get(key)) query.set(key, params.get(key)!);
  const r = useResource<ReportOverview>(`/results/overview?${query}`);
  const d = r.data;
  const classId = params.get('class_id') || '';
  const focus = params.get('focus') || 'all';
  const classes = [
    ...new Map(
      (d?.options || []).map((x) => [x.class_id, { id: x.class_id, name: x.class_name }]),
    ).values(),
  ];
  const topics = [
    ...new Map(
      (d?.options || [])
        .filter((x) => x.season_id && (!classId || x.class_id === classId))
        .map((x) => [x.season_id!, { id: x.season_id!, title: x.title! }]),
    ).values(),
  ];
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('attempt_id');
    next.delete('attempt_class');
    if (key === 'class_id') next.delete('season_id');
    setParams(next);
  }
  const focusOptions: [ReportFocus, string][] = [
    ['all', t('Все работы', 'Барлық жұмыстар')],
    ['help', t('Разобрать ошибки', 'Қателерді талдау')],
    ['review', t('Проверить пересказ', 'Мазмұндауды тексеру')],
    ['awaiting_test', t('Ждём тест', 'Тестті күтеміз')],
    ['not_started', t('Ещё не начали', 'Әлі бастамаған')],
  ];
  return (
    <div className="page reports-page">
      <PageHeader
        eyebrow={t('СЛЕДУЮЩИЙ ШАГ ДЛЯ КАЖДОГО', 'ӘР ОҚУШЫНЫҢ КЕЛЕСІ ҚАДАМЫ')}
        title={t('Как идут дела у класса', 'Сыныптың жағдайы')}
        description={t(
          'Замечайте трудности, разбирайте ответы и помогайте двигаться дальше.',
          'Қиындықтарды байқап, жауаптарды талдап, әрі қарай оқуға көмектесіңіз.',
        )}
        action={
          <a className="button secondary" href={`/api/results.csv?${query}`} download>
            <Download size={17} />
            {t('Скачать CSV', 'CSV жүктеу')}
          </a>
        }
      />
      <section className="panel report-filters" aria-label={t('Фильтры отчёта', 'Есеп сүзгілері')}>
        <label>
          {t('Класс', 'Сынып')}
          <select
            aria-label={t('Фильтр класса', 'Сынып сүзгісі')}
            value={classId}
            onChange={(e) => filter('class_id', e.target.value)}
          >
            <option value="">{t('Все классы', 'Барлық сыныптар')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Тема', 'Тақырып')}
          <select
            value={params.get('season_id') || ''}
            onChange={(e) => filter('season_id', e.target.value)}
          >
            <option value="">{t('Все темы', 'Барлық тақырыптар')}</option>
            {topics.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <form
          className="report-search"
          key={params.get('q') || ''}
          onSubmit={(e) => {
            e.preventDefault();
            filter('q', String(new FormData(e.currentTarget).get('q') || '').trim());
          }}
        >
          <label>
            {t('Ученик', 'Оқушы')}
            <div>
              <input
                name="q"
                maxLength={100}
                defaultValue={params.get('q') || ''}
                placeholder={t('Поиск по имени', 'Аты бойынша іздеу')}
              />
              <button className="icon-button" aria-label={t('Найти ученика', 'Оқушыны табу')}>
                <Search size={19} />
              </button>
            </div>
          </label>
        </form>
        <button className="text-button" onClick={() => setParams({})}>
          {t('Сбросить', 'Тазарту')}
        </button>
      </section>
      <State {...r} retry={r.reload}>
        {d && (
          <>
            <div className="report-summary">
              <div className="panel">
                <UsersRound size={21} />
                <strong>{d.counts.learners}</strong>
                <span>
                  {t('учеников в выбранных заданиях', 'таңдалған тапсырмалардағы оқушылар')}
                </span>
              </div>
              <button className="panel" onClick={() => filter('focus', 'help')}>
                <ListChecks size={21} />
                <strong>{d.counts.help}</strong>
                <span>{t('работ с ошибками для разбора', 'қателерін талдау қажет жұмыстар')}</span>
                <ArrowRight size={17} />
              </button>
              <button className="panel" onClick={() => filter('focus', 'review')}>
                <Mic size={21} />
                <strong>{d.counts.review}</strong>
                <span>{t('пересказов ждут проверки', 'тексеруді күтетін мазмұндаулар')}</span>
                <ArrowRight size={17} />
              </button>
            </div>
            <p className="report-scope muted small">
              {t(
                'Счётчики и частые ошибки учитывают класс, тему и поиск. Балл ниже 70% — повод вместе разобрать ошибки, а не школьная отметка.',
                'Сандар мен жиі қателер сыныпты, тақырыпты және іздеуді ескереді. 70%-дан төмен нәтиже — мектеп бағасы емес, қателерді бірге талдауға себеп.',
              )}
            </p>
            <div className="results-toolbar">
              <h2>
                {t('Работы учеников', 'Оқушылардың жұмыстары')}{' '}
                <span className="muted">{d.rows.length}</span>
              </h2>
              <button className="text-button" onClick={r.reload}>
                <RefreshCw size={15} />
                {t('Обновить', 'Жаңарту')}
              </button>
            </div>
            <div
              className="report-tabs"
              aria-label={t('Какие работы показать', 'Қандай жұмыстарды көрсету')}
            >
              {focusOptions.map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={focus === value}
                  onClick={() => filter('focus', value === 'all' ? '' : value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {d.rows.length ? (
              <div className="table-wrap report-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Ученик / тема', 'Оқушы / тақырып')}</th>
                      <th>{t('Просмотр и вопросы', 'Көру және сұрақтар')}</th>
                      <th>{t('Результат теста', 'Тест нәтижесі')}</th>
                      <th>{t('Следующий шаг', 'Келесі қадам')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((x) => (
                      <tr key={`${x.class_id}-${x.user_id}-${x.season_id}`}>
                        <td>
                          <b>{x.name}</b>
                          <span>{x.class_name}</span>
                          <small>{x.title}</small>
                        </td>
                        <td data-label={t('Просмотр и вопросы', 'Көру және сұрақтар')}>
                          <b>
                            {x.watched}/{x.episode_count} {t('серий', 'серия')}
                          </b>
                          <small>
                            {t('Верных микровопросов', 'Дұрыс микросұрақтар')}: {x.micro_correct}/
                            {x.episode_count}
                          </small>
                          <div className="progress-track">
                            <i
                              style={{
                                width: `${x.episode_count ? (100 * x.watched) / x.episode_count : 0}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td data-label={t('Результат теста', 'Тест нәтижесі')}>
                          {x.latest_score !== null ? (
                            <>
                              <b className={x.latest_score < 70 ? 'report-low' : ''}>
                                {x.latest_score}% <small>{t('последний', 'соңғы')}</small>
                              </b>
                              <small>
                                {t('Лучший', 'Үздік')}: {x.test_score}%
                                {x.previous_score !== null &&
                                  ` · ${t('Предыдущий', 'Алдыңғы')}: ${x.previous_score}%`}
                              </small>
                              {x.previous_score !== null && (
                                <small>
                                  {t('Изменение', 'Өзгеріс')}:{' '}
                                  {x.latest_score - x.previous_score > 0 ? '+' : ''}
                                  {x.latest_score - x.previous_score} {t('п.п.', 'п.т.')}
                                </small>
                              )}
                              <small>
                                {x.latest_at &&
                                  new Date(x.latest_at).toLocaleDateString(
                                    locale === 'kk' ? 'kk-KZ' : 'ru-RU',
                                    { timeZone: 'Asia/Qyzylorda' },
                                  )}
                              </small>
                            </>
                          ) : (
                            <span className="muted">{t('Ещё не пройден', 'Әлі өтпеген')}</span>
                          )}
                        </td>
                        <td data-label={t('Следующий шаг', 'Келесі қадам')}>
                          <p className="report-next">
                            {x.latest_score !== null && x.latest_score < 70
                              ? t(
                                  'Разобрать ошибки и повторить связанные серии',
                                  'Қателерді талдап, байланысты серияларды қайталау',
                                )
                              : x.watched < x.episode_count
                                ? t('Продолжить просмотр темы', 'Тақырыпты көруді жалғастыру')
                                : x.latest_score === null
                                  ? t('Перейти к итоговому тесту', 'Қорытынды тестке өту')
                                  : t('Просмотр и тест завершены', 'Көру мен тест аяқталды')}
                          </p>
                          <div className="report-row-actions">
                            {x.latest_attempt_id && (
                              <button
                                className="button secondary small-button"
                                onClick={() => {
                                  const next = new URLSearchParams(params);
                                  next.set('attempt_id', x.latest_attempt_id!);
                                  next.set('attempt_class', x.class_id);
                                  setParams(next);
                                }}
                              >
                                {t('Ответы ученика', 'Оқушы жауаптары')}
                              </button>
                            )}
                            {x.retelling_id && (
                              <button
                                className="button secondary small-button"
                                onClick={() => setReview(x)}
                              >
                                <Mic size={14} />
                                {x.teacher_score === null
                                  ? t('Проверить пересказ', 'Мазмұндауды тексеру')
                                  : t(
                                      `Пересказ: ${x.teacher_score}%`,
                                      `Мазмұндау: ${x.teacher_score}%`,
                                    )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state compact">
                <BookOpen size={30} />
                <h2>{t('Здесь пока нет работ', 'Мұнда әзірге жұмыс жоқ')}</h2>
                <p>
                  {t(
                    'Измените фильтры или пригласите учеников и назначьте тему.',
                    'Сүзгілерді өзгертіңіз немесе оқушыларды шақырып, тақырып беріңіз.',
                  )}
                </p>
                <Link className="button secondary" to="/classes">
                  {t('К классам', 'Сыныптарға')}
                </Link>
              </div>
            )}
            <section
              className="panel report-insights"
              aria-label={t('Частые ошибки', 'Жиі қателер')}
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    {t('ЧТО ОБСУДИТЬ НА УРОКЕ', 'САБАҚТА НЕНІ ТАЛҚЫЛАУ КЕРЕК')}
                  </span>
                  <h2>{t('Частые ошибки', 'Жиі қателер')}</h2>
                </div>
                <BookOpen size={23} />
              </div>
              <p className="muted small">
                {t(
                  `По последнему тесту каждого ученика по теме. Разбор доступен для ${d.coverage.available} из ${d.coverage.total} результатов. Повторение ошибок не меняет эту сводку.`,
                  `Әр оқушының тақырып бойынша соңғы тесті. ${d.coverage.total} нәтиженің ${d.coverage.available} талдауы бар. Қателерді қайталау бұл қорытындыны өзгертпейді.`,
                )}
              </p>
              {d.mistakes.length ? (
                <div className="mistake-grid">
                  {d.mistakes.map((m) => (
                    <article key={m.key} className="common-mistake">
                      <span className="mistake-count">
                        {t(
                          `${m.wrong} из ${m.answered} ошиблись`,
                          `${m.answered} оқушының ${m.wrong} қателесті`,
                        )}
                      </span>
                      <h3>{m.prompt}</h3>
                      <p className="muted small">{m.title}</p>
                      <details>
                        <summary>{t('Ответ и объяснение', 'Жауап және түсіндірме')}</summary>
                        <p>
                          <b>{m.options[m.correct]}</b>
                        </p>
                        <p>{m.explanation}</p>
                      </details>
                      {m.episode_position !== null && (
                        <Link
                          className="text-button"
                          to={`/watch/${m.season_id}?episode=${m.episode_position}`}
                        >
                          {t('Открыть связанную серию', 'Байланысты серияны ашу')}
                          <ArrowRight size={15} />
                        </Link>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="report-no-errors">
                  {d.coverage.total === 0
                    ? t(
                        'После первых тестов здесь появятся вопросы, которые стоит обсудить.',
                        'Алғашқы тесттерден кейін талқылауға қажет сұрақтар осында көрінеді.',
                      )
                    : d.coverage.available === 0
                      ? t(
                          'Баллы сохранены, но ответы старых попыток недоступны для разбора.',
                          'Балдар сақталған, бірақ ескі талпыныстардың жауаптары талдауға қолжетімсіз.',
                        )
                      : t(
                          'В доступных разборах последних тестов ошибок нет.',
                          'Соңғы тесттердің қолжетімді талдауларында қате жоқ.',
                        )}
                </p>
              )}
            </section>
          </>
        )}
      </State>
      {review && (
        <ReviewModal
          data={review}
          onClose={() => setReview(null)}
          onSaved={() => {
            setReview(null);
            r.reload();
          }}
        />
      )}
      {params.get('attempt_id') && (
        <TeacherAttemptModal
          key={params.get('attempt_id')}
          id={params.get('attempt_id')!}
          classId={params.get('attempt_class') || ''}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete('attempt_id');
            next.delete('attempt_class');
            setParams(next);
          }}
        />
      )}
    </div>
  );
}

function TeacherAttemptModal({
  id,
  classId,
  onClose,
}: {
  id: string;
  classId: string;
  onClose: () => void;
}) {
  const { t, locale } = useApp();
  const r = useResource<TeacherAttempt>(
    `/results/attempts/${encodeURIComponent(id)}?class_id=${encodeURIComponent(classId)}`,
  );
  const a = r.data;
  return (
    <Modal title={t('Ответы ученика', 'Оқушы жауаптары')} onClose={onClose}>
      <State {...r} retry={r.reload}>
        {a && (
          <div className="teacher-attempt">
            <h3>{a.name}</h3>
            <p>
              {a.class_name} · {a.title}
            </p>
            <p className="muted small">
              {new Date(a.created_at).toLocaleString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
                timeZone: 'Asia/Qyzylorda',
              })}
            </p>
            <strong className="saved-score">
              {a.score} / {a.total} <small>· {Math.round((100 * a.score) / a.total)}%</small>
            </strong>
            {a.kind === 'legacy' && (
              <p className="inline-note">
                {t(
                  'Тест прежнего формата: использовал вопросы серий.',
                  'Бұрынғы форматтағы тест: серия сұрақтары қолданылған.',
                )}
              </p>
            )}
            {a.snapshot_source === 'reconstructed' && (
              <p className="muted small">
                {t(
                  'Разбор восстановлен по сохранившимся вопросам.',
                  'Талдау сақталған сұрақтардан қалпына келтірілді.',
                )}
              </p>
            )}
            {a.results.length ? (
              <div className="quiz-review saved-review">
                {a.results.map((q, i) => (
                  <article key={`${q.id}-${i}`} className={q.passed ? 'passed' : 'wrong'}>
                    <h3>
                      {i + 1}. {q.prompt}
                    </h3>
                    <p>
                      <b>{t('Ответ ученика: ', 'Оқушының жауабы: ')}</b>
                      {q.options[q.answer]}
                    </p>
                    {!q.passed && (
                      <p>
                        <b>{t('Верный ответ: ', 'Дұрыс жауап: ')}</b>
                        {q.options[q.correct]}
                      </p>
                    )}
                    <p>{q.explanation}</p>
                    {!q.passed && q.episode_position !== null && (
                      <Link
                        className="text-button"
                        onClick={onClose}
                        to={`/watch/${a.season_id}?episode=${q.episode_position}`}
                      >
                        {t('Открыть связанную серию', 'Байланысты серияны ашу')}
                        <ArrowRight size={15} />
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p>
                {t(
                  'Балл сохранён. Подробные ответы этой старой попытки недоступны.',
                  'Балл сақталған. Бұл ескі талпыныстың толық жауаптары қолжетімсіз.',
                )}
              </p>
            )}
          </div>
        )}
      </State>
    </Modal>
  );
}
