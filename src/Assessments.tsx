import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ListChecks, Play, RotateCcw } from 'lucide-react';
import { useApp, useResource, post, type Question } from './lib';
import { PageHeader, State } from './components';

type Summary = {
  id: string;
  season_id: string;
  title: string;
  kind: 'final' | 'legacy' | 'practice';
  score: number;
  total: number;
  created_at: string;
  parent_attempt_id: string | null;
  review_available: boolean;
  snapshot_source: 'captured' | 'reconstructed' | 'unavailable';
};
type Answer = {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  correct: number;
  explanation: string;
  passed: boolean;
  episode_id: string | null;
  episode_position: number | null;
  episode_title: string | null;
};
type Detail = Summary & { results: Answer[] };
function useKindLabel() {
  const { t } = useApp();
  return (kind: Summary['kind']) =>
    kind === 'practice'
      ? t('Повторение ошибок', 'Қателерді қайталау')
      : kind === 'legacy'
        ? t('Тест прежнего формата', 'Бұрынғы форматтағы тест')
        : t('Итоговый тест', 'Қорытынды тест');
}
function date(value: string, locale: string) {
  return new Date(value).toLocaleString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    timeZone: 'Asia/Qyzylorda',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryPage() {
  const { t, locale } = useApp();
  const label = useKindLabel();
  const [params] = useSearchParams();
  const season = params.get('season_id'),
    before = params.get('before');
  const query = new URLSearchParams();
  if (season) query.set('season_id', season);
  if (before) query.set('before', before);
  const r = useResource<{ attempts: Summary[]; next_cursor: string | null }>(`/attempts?${query}`);
  const more = new URLSearchParams(query);
  if (r.data?.next_cursor) more.set('before', r.data.next_cursor);
  return (
    <div className="page assessment-page">
      <PageHeader
        eyebrow={t('ВЕРНУТЬСЯ И РАЗОБРАТЬСЯ', 'ҚАЙТА ОРАЛЫП, ТҮСІНУ')}
        title={t('История тестов', 'Тесттер тарихы')}
        description={t(
          'Результаты и объяснения остаются здесь. Повторение ошибок учитывается отдельно от итогового теста.',
          'Нәтижелер мен түсіндірмелер осында сақталады. Қателерді қайталау қорытынды тесттен бөлек есептеледі.',
        )}
        action={
          <Link className="button secondary" to={season ? `/learn/${season}` : '/progress'}>
            <ArrowLeft size={17} />
            {season
              ? t('К прогрессу по теме', 'Тақырып прогресіне')
              : t('К прогрессу', 'Прогреске')}
          </Link>
        }
      />
      <State {...r} retry={r.reload}>
        {r.data?.attempts.length ? (
          <div className="attempt-list">
            {r.data.attempts.map((a) => (
              <Link className="panel attempt-card" to={`/attempts/${a.id}`} key={a.id}>
                <div>
                  <span className="eyebrow">{label(a.kind)}</span>
                  <h2>{a.title}</h2>
                  <p>{date(a.created_at, locale)}</p>
                  <small>
                    {a.review_available
                      ? t('Ответы и разбор сохранены', 'Жауаптар мен талдау сақталды')
                      : t(
                          'Сохранён балл · разбор недоступен',
                          'Балл сақталған · талдау қолжетімсіз',
                        )}
                  </small>
                </div>
                <span className="attempt-score">
                  {Math.round((100 * a.score) / a.total)}%
                  <small>
                    {a.score}/{a.total}
                  </small>
                </span>
                <ArrowRight size={20} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <ListChecks size={34} />
            <h2>{t('Здесь будут твои попытки', 'Талпыныстарың осында болады')}</h2>
            <p>{t('Выбери тему и проверь себя.', 'Тақырып таңдап, өзіңді тексер.')}</p>
            <Link className="button primary" to="/library">
              {t('Выбрать тему', 'Тақырып таңдау')}
            </Link>
          </div>
        )}
        <div className="assessment-pagination">
          {before && (
            <Link
              className="button secondary"
              to={`/attempts${season ? `?season_id=${season}` : ''}`}
            >
              {t('К последним попыткам', 'Соңғы талпыныстарға')}
            </Link>
          )}
          {r.data?.next_cursor && (
            <Link className="button secondary" to={`/attempts?${more}`}>
              {t('Более ранние попытки', 'Алдыңғы талпыныстар')}
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </State>
    </div>
  );
}

export function AttemptPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const label = useKindLabel();
  const r = useResource<Detail>(`/attempts/${id}`);
  const a = r.data;
  const mistakes = a?.results.filter((q) => !q.passed) || [];
  return (
    <div className="page assessment-page">
      <Link className="topic-back" to={a ? `/attempts?season_id=${a.season_id}` : '/attempts'}>
        <ArrowLeft size={17} />
        {t('История тестов', 'Тесттер тарихы')}
      </Link>
      <State {...r} retry={r.reload}>
        {a && (
          <>
            <PageHeader
              eyebrow={label(a.kind)}
              title={a.title}
              description={date(a.created_at, locale)}
            />
            <section className="panel saved-result">
              <strong className="saved-score">
                {a.score} {t('из', '/')} {a.total}{' '}
                <small>· {Math.round((100 * a.score) / a.total)}%</small>
              </strong>
              <p>
                {a.kind === 'practice'
                  ? t(
                      'Это упражнение по ошибкам. Балл итогового теста не изменился.',
                      'Бұл қателерді қайталау жаттығуы. Қорытынды тест балы өзгерген жоқ.',
                    )
                  : t(
                      'Это результат одной попытки. Просмотр и пересказ оцениваются отдельно.',
                      'Бұл бір талпыныстың нәтижесі. Көру мен мазмұндау бөлек бағаланады.',
                    )}
              </p>
              {a.kind === 'legacy' && (
                <p className="inline-note">
                  {t(
                    'В прежнем формате тест использовал вопросы серий. Это не отдельная независимая проверка.',
                    'Бұрынғы тестте серия сұрақтары қолданылды. Бұл бөлек тәуелсіз тексеру емес.',
                  )}
                </p>
              )}
              {a.snapshot_source === 'reconstructed' && (
                <p className="muted small">
                  {t(
                    'Разбор старой попытки восстановлен по сохранившимся вопросам. Исходный балл сохранён.',
                    'Ескі талпыныстың талдауы сақталған сұрақтардан қалпына келтірілді. Бастапқы балл сақталды.',
                  )}
                </p>
              )}
              <div className="assessment-actions">
                {a.review_available && mistakes.length > 0 && (
                  <Link className="button primary" to={`/attempts/${a.id}/practice`}>
                    <RotateCcw size={17} />
                    {t(
                      `Повторить ошибки (${mistakes.length})`,
                      `Қателерді қайталау (${mistakes.length})`,
                    )}
                  </Link>
                )}
                <Link className="button secondary" to={`/learn/${a.season_id}`}>
                  {t('К маршруту темы', 'Тақырып жолына')}
                  <ArrowRight size={17} />
                </Link>
                {a.parent_attempt_id && (
                  <Link className="text-button" to={`/attempts/${a.parent_attempt_id}`}>
                    {t('Исходная попытка', 'Бастапқы талпыныс')}
                  </Link>
                )}
              </div>
            </section>
            {a.review_available ? (
              <section
                className="quiz-review saved-review"
                aria-label={t('Сохранённый разбор', 'Сақталған талдау')}
              >
                {a.results.map((q, index) => (
                  <article key={`${q.id}-${index}`} className={q.passed ? 'passed' : 'wrong'}>
                    <h2>
                      {q.passed ? <Check size={19} /> : <RotateCcw size={19} />} {index + 1}.{' '}
                      {q.prompt}
                    </h2>
                    <p>
                      <b>{t('Твой ответ: ', 'Жауабың: ')}</b>
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
                        className="text-button review-episode"
                        to={`/watch/${a.season_id}?episode=${q.episode_position}`}
                      >
                        <Play size={16} />
                        {t('Повторить серию: ', 'Серияны қайталау: ')}
                        {q.episode_title || q.episode_position + 1}
                      </Link>
                    )}
                  </article>
                ))}
              </section>
            ) : (
              <section className="panel">
                <h2>{t('Подробный разбор не сохранился', 'Толық талдау сақталмаған')}</h2>
                <p>
                  {t(
                    'Балл и дата попытки сохранены. Чтобы получить полный разбор, пройди текущий тест ещё раз.',
                    'Талпыныстың балы мен күні сақталды. Толық талдау алу үшін қазіргі тестті қайта тапсыр.',
                  )}
                </p>
              </section>
            )}
          </>
        )}
      </State>
    </div>
  );
}

export function PracticePage() {
  const { id } = useParams();
  const { t } = useApp();
  const r = useResource<{ title: string; questions: Question[] }>(`/attempts/${id}/practice`);
  return (
    <div className="page assessment-page">
      <Link className="topic-back" to={`/attempts/${id}`}>
        <ArrowLeft size={17} />
        {t('К исходному разбору', 'Бастапқы талдауға')}
      </Link>
      <PageHeader
        eyebrow={t('ПРАКТИКА', 'ЖАТТЫҒУ')}
        title={t('Повторение ошибок', 'Қателерді қайталау')}
        description={t(
          'Только вопросы, в которых была ошибка. Результат сохранится отдельно от итогового теста.',
          'Тек қате кеткен сұрақтар. Нәтиже қорытынды тесттен бөлек сақталады.',
        )}
      />
      <State {...r} retry={r.reload}>
        {r.data && (
          <PracticeExercise
            key={id}
            attemptId={id!}
            questions={r.data.questions}
            title={r.data.title}
          />
        )}
      </State>
    </div>
  );
}
function PracticeExercise({
  attemptId,
  questions,
  title,
}: {
  attemptId: string;
  questions: Question[];
  title: string;
}) {
  const { t } = useApp();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const q = questions[index];
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const result = await post(`/attempts/${attemptId}/practice`, { answers });
      navigate(`/attempts/${result.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="panel practice-exercise">
      <p className="muted">{title}</p>
      <p>
        {t('Вопрос', 'Сұрақ')} {index + 1}/{questions.length}
      </p>
      <h2 className="question-title">{q.prompt}</h2>
      <div className="answer-options">
        {q.options.map((option, i) => (
          <button
            className={answers[index] === i ? 'selected' : ''}
            aria-pressed={answers[index] === i}
            key={i}
            onClick={() =>
              setAnswers((old) => {
                const next = [...old];
                next[index] = i;
                return next;
              })
            }
          >
            <span>{String.fromCharCode(65 + i)}</span>
            {option}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      <div className="quiz-controls">
        <button
          className="button secondary"
          disabled={index === 0 || busy}
          onClick={() => setIndex(index - 1)}
        >
          {t('Назад', 'Артқа')}
        </button>
        <button
          className="button primary"
          disabled={answers[index] === undefined || busy}
          onClick={() => (index === questions.length - 1 ? void submit() : setIndex(index + 1))}
        >
          {index === questions.length - 1
            ? t('Проверить упражнение', 'Жаттығуды тексеру')
            : t('Дальше', 'Әрі қарай')}
          <ArrowRight size={17} />
        </button>
      </div>
    </section>
  );
}
