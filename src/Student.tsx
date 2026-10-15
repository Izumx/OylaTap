import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCheck,
  BookOpen,
  Mic,
  ListChecks,
  Share2,
  X,
  Search,
  SlidersHorizontal,
  Clock3,
  Target,
  Trophy,
  Sparkles,
  Send,
  Square,
  RotateCcw,
  LoaderCircle,
  Trash2,
  CalendarDays,
  PanelRightClose,
  PanelRightOpen,
  Moon,
} from 'lucide-react';
import {
  api,
  post,
  useApp,
  useResource,
  subjects,
  minutes,
  type Season,
  type Episode,
  type DailySession,
} from './lib';
import { Modal, State, PageHeader, SeasonArt, SeasonCard } from './components';
import { LearningPreferences } from './Learning';

type Clip = { season: Season; episode: Episode };
function MicroQuestion({
  episode,
  onClose,
  onPassed,
  onNext,
}: {
  episode: Episode;
  onClose: () => void;
  onPassed: () => void;
  onNext: () => void;
}) {
  const r = useResource<any>(`/episodes/${episode.id}/micro`);
  const { t, user } = useApp();
  const [answer, setAnswer] = useState<number | null>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={t('Один вопрос — и дальше', 'Бір сұрақ — әрі қарай')} onClose={onClose}>
      <p className="muted small">{episode.title}</p>
      <State {...r} retry={r.reload}>
        {r.data && (
          <>
            <h3 className="question-title">{r.data.prompt}</h3>
            {!result ? (
              <div className="answer-options">
                {r.data.options.map((o: string, i: number) => (
                  <button
                    key={i}
                    className={answer === i ? 'selected' : ''}
                    onClick={() => setAnswer(i)}
                  >
                    <span>{String.fromCharCode(65 + i)}</span>
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <div className={`micro-result ${result.passed ? 'passed' : 'wrong'}`}>
                <b>
                  {result.passed
                    ? t('Ответ верный!', 'Дұрыс жауап!')
                    : t('Разберём вместе', 'Бірге түсінейік')}
                </b>
                <p>{result.explanation}</p>
                {!user && (
                  <small>
                    {t(
                      'В демо результат не сохраняется. Войди, чтобы видеть свой прогресс.',
                      'Демода нәтиже сақталмайды. Прогресіңді көру үшін кір.',
                    )}
                  </small>
                )}
              </div>
            )}
            {error && <p className="error-inline">{error}</p>}
            {!result ? (
              <button
                className="button primary full"
                disabled={answer === null || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const v = await post(`/episodes/${episode.id}/check`, { answer });
                    setResult(v);
                    if (v.passed) onPassed();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Проверить', 'Тексеру')}
                <ArrowRight size={17} />
              </button>
            ) : (
              <>
                <button className="button primary full" onClick={onNext}>
                  {t('Дальше по маршруту', 'Маршрутты жалғастыру')}
                  <ArrowRight size={17} />
                </button>
                {!result.passed && (
                  <button
                    className="text-button full"
                    onClick={() => {
                      setResult(null);
                      setAnswer(null);
                    }}
                  >
                    {t('Попробовать ещё раз', 'Қайта байқап көру')}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </State>
    </Modal>
  );
}
export function Feed() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startEpisode = Math.max(0, Number(searchParams.get('episode') || 0));
  const [mode, setMode] = useState<'school' | 'free'>('school'),
    [focus, setFocus] = useState(() => localStorage.getItem('oylatap-feed-focus') !== 'off'),
    [today, setToday] = useState<DailySession | null>(null),
    [dailyStart, setDailyStart] = useState(0),
    [micro, setMicro] = useState<Episode | null>(null),
    [passed, setPassed] = useState<Set<string>>(new Set());
  const { user, t, locale, notify, login, authOpen } = useApp();
  const [clips, setClips] = useState<Clip[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [active, setActive] = useState(0),
    [muted, setMuted] = useState(true),
    [modal, setModal] = useState<'quiz' | 'record' | 'chapters' | 'notes' | null>(null),
    [version, setVersion] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const slideHeight = useRef(0);
  const activeSlide = useRef(0);
  const dailyRef = useRef<DailySession | null>(null);
  const feedGeneration = useRef(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    feedGeneration.current += 1;
    setLoading(true);
    setError('');
    (async () => {
      const daily = id ? null : await api<DailySession>(`/today?mode=${mode}`);
      const all: Season[] = id
        ? [await api(`/seasons/${id}`)]
        : daily?.season_id
          ? [await api(`/seasons/${daily.season_id}`)]
          : [];
      if (alive) {
        setToday(daily);
        dailyRef.current = daily;
        setPassed(new Set(daily?.correct_ids || []));
        const firstPending =
          daily?.episode_ids.findIndex((episodeId) => !daily.completed_ids?.includes(episodeId)) ??
          0;
        setDailyStart(firstPending < 0 ? daily?.episode_ids.length || 0 : firstPending);
        setMicro(null);
      }
      if (alive) {
        setClips(
          all.flatMap((season) =>
            (season.episodes || [])
              .filter((e) => id || daily?.episode_ids.includes(e.id))
              .map((episode) => ({ season, episode })),
          ),
        );
        setActive(0);
        activeSlide.current = 0;
        scroll.current?.scrollTo(0, 0);
      }
    })()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      feedGeneration.current += 1;
    };
  }, [id, user?.id, version, mode]);
  const current = clips[Math.min(active, clips.length - 1)];
  const atEnd = active === clips.length;
  const sessionDone =
    clips.length > 0 && clips.every((c) => c.episode.completed && passed.has(c.episode.id));
  const sourceLabel =
    today?.topic_source === 'class'
      ? t('Тема класса', 'Сынып тақырыбы')
      : today?.topic_source === 'assignment'
        ? t('Задание учителя', 'Мұғалім тапсырмасы')
        : today?.topic_source === 'personal'
          ? t('Твоя выбранная тема', 'Таңдаған тақырыбың')
          : today?.topic_source === 'review'
            ? t('Повторение сложного', 'Қиын тақырыпты қайталау')
            : t('Тема из библиотеки', 'Кітапхана тақырыбы');
  const go = useCallback(
    (n: number, behavior: ScrollBehavior = 'smooth') => {
      const el = scroll.current;
      if (!el) return;
      el.scrollTo({
        top: Math.max(0, Math.min(n, clips.length)) * el.clientHeight,
        behavior,
      });
    },
    [clips.length],
  );
  useEffect(() => {
    if (loading || !clips.length) return;
    const target = id ? Math.min(startEpisode, clips.length - 1) : dailyStart;
    requestAnimationFrame(() => go(Number.isFinite(target) ? target : 0, 'instant'));
  }, [loading, id, startEpisode, dailyStart, clips.length, go]);
  useEffect(() => {
    const el = scroll.current;
    if (!el || loading) return;
    slideHeight.current = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === slideHeight.current) return;
      slideHeight.current = el.clientHeight;
      el.scrollTo({ top: activeSlide.current * el.clientHeight, behavior: 'instant' });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, clips.length]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      )
        return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        go(active + 1);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        go(active - 1);
      }
      if (
        e.code === 'Space' &&
        !(e.target as HTMLElement)?.closest('button,a,[contenteditable="true"]')
      ) {
        const video = scroll.current?.querySelectorAll('video').item(active);
        if (!video) return;
        e.preventDefault();
        if (!e.repeat) {
          if (video.paused) void video.play().catch(() => {});
          else video.pause();
        }
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [active, go]);
  const open = (kind: 'quiz' | 'record') => {
    if (!user) {
      login();
      return;
    }
    setModal(kind);
  };
  async function complete(episode: Episode) {
    if (episode.completed) return;
    try {
      if (user) await post(`/episodes/${episode.id}/complete`);
      setClips((old) =>
        old.map((c) =>
          c.episode.id === episode.id ? { ...c, episode: { ...c.episode, completed: true } } : c,
        ),
      );
      if (user)
        notify(
          t('Серия просмотрена. Теперь проверь понимание!', 'Серия аяқталды. Түсінгеніңді тексер!'),
        );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const refreshDaily = useCallback(async () => {
    if (!id && user?.id) {
      const generation = feedGeneration.current;
      try {
        const plan = await api<DailySession>(`/today?mode=${mode}`);
        if (generation !== feedGeneration.current) return;
        const old = dailyRef.current;
        if (
          old &&
          (old.session_date !== plan.session_date ||
            old.season_id !== plan.season_id ||
            old.episode_ids.join() !== plan.episode_ids.join())
        ) {
          reload();
          return;
        }
        dailyRef.current = plan;
        setToday(plan);
        setPassed(new Set(plan.correct_ids || []));
        setClips((oldClips) =>
          oldClips.map((clip) => ({
            ...clip,
            episode: {
              ...clip.episode,
              completed:
                clip.episode.completed || Boolean(plan.completed_ids?.includes(clip.episode.id)),
            },
          })),
        );
      } catch (error) {
        if (generation === feedGeneration.current) notify((error as Error).message);
      }
    }
  }, [id, user?.id, mode, notify, reload]);
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') void refreshDaily();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    const timer = setInterval(() => {
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Qyzylorda',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (dailyRef.current && date !== dailyRef.current.session_date) onReturn();
    }, 60000);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      clearInterval(timer);
    };
  }, [refreshDaily]);
  async function share() {
    if (!current) return;
    const url = new URL(`/watch/${current.season.id}`, window.location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: current.season.title, url });
      else {
        await navigator.clipboard.writeText(url);
        notify(t('Ссылка скопирована', 'Сілтеме көшірілді'));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        notify(t('Не удалось поделиться. Скопируй адрес страницы.', 'Бет сілтемесін көшір.'));
    }
  }
  return (
    <div className={`feed-page ${focus ? 'feed-focused' : ''}`}>
      <header className="feed-top">
        <div className="feed-tabs">
          <button
            className={!id && mode === 'school' ? 'active' : ''}
            onClick={() => {
              setMode('school');
              if (id) navigate('/');
            }}
          >
            {t('Сегодня', 'Бүгін')}
          </button>
          <button
            className={!id && mode === 'free' ? 'active' : ''}
            onClick={() => {
              setMode('free');
              if (id) navigate('/');
            }}
          >
            {t('По интересам', 'Қызығушылықтар')}
          </button>
          {id && <span className="active">{t('Сезон', 'Маусым')}</span>}
        </div>
        <div className="feed-toolbar">
          <button
            className="focus-toggle"
            aria-label={t('Режим фокуса', 'Назар режимі')}
            aria-pressed={focus}
            onClick={() => {
              setFocus(!focus);
              localStorage.setItem('oylatap-feed-focus', focus ? 'off' : 'on');
            }}
          >
            {focus ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
            <span>{focus ? t('О теме', 'Тақырып туралы') : t('Только видео', 'Тек видео')}</span>
          </button>
          <Link className="feed-search" to="/library" aria-label="Найти сезон">
            <Search size={20} />
          </Link>
        </div>
      </header>
      <State loading={loading} error={error} retry={reload}>
        {clips.length === 0 ? (
          <div className="empty-state">
            <h2>{t('Истории скоро появятся', 'Оқиғалар жақында қосылады')}</h2>
            <p>{t('Учитель ещё не опубликовал сезоны.', 'Мұғалім әлі маусым жарияламады.')}</p>
          </div>
        ) : (
          <div className="feed-body">
            <div className="player-column">
              <div className="feed-session-label">
                <span className="live-dot" />
                {id ? t('Твой сезон', 'Сенің маусымың') : sourceLabel}
                <span>
                  {Math.min(active + 1, clips.length)} / {clips.length}
                </span>
              </div>
              <div
                className="feed-scroll"
                tabIndex={0}
                role="region"
                ref={scroll}
                onScroll={() => {
                  const el = scroll.current;
                  if (el && el.clientHeight === slideHeight.current) {
                    const index = Math.min(
                      clips.length,
                      Math.round(el.scrollTop / el.clientHeight),
                    );
                    activeSlide.current = index;
                    setActive(index);
                  }
                }}
                aria-label="Вертикальная лента. Листайте вверх или вниз."
              >
                {clips.map((c, i) => (
                  <div className="feed-slide" key={c.episode.id}>
                    <FeedVideo
                      clip={c}
                      context={today ? sourceLabel : undefined}
                      active={i === active && !modal && !micro && !authOpen}
                      muted={muted}
                      onEnded={() => {
                        const generation = feedGeneration.current;
                        void complete(c.episode).then(() => {
                          if (generation === feedGeneration.current) setMicro(c.episode);
                        });
                      }}
                      onQuiz={() => open('quiz')}
                    />
                  </div>
                ))}
                <div className="feed-slide session-end">
                  <div className="end-orbit">
                    <CheckCheck size={45} />
                  </div>
                  <span className="eyebrow">{t('В СВОЁМ ТЕМПЕ', 'ӨЗ ҚАРҚЫНЫҢМЕН')}</span>
                  <h2>
                    {t(
                      sessionDone
                        ? today?.is_review
                          ? 'Тема уже пройдена'
                          : 'Цель дня выполнена'
                        : 'Сессия закончилась',
                      sessionDone
                        ? today?.is_review
                          ? 'Тақырып аяқталған'
                          : 'Күндік мақсат орындалды'
                        : 'Сессия аяқталды',
                    )}
                  </h2>
                  <p>
                    {t(
                      'Лента делает паузу. Можно закончить на сегодня или продолжить по желанию.',
                      'Лента үзіліс жасайды. Бүгін аяқтауға немесе қалауыңша жалғастыруға болады.',
                    )}
                  </p>
                  <div className="end-stats">
                    <span>
                      <b>{clips.length}</b>
                      {t('серии в маршруте', 'маршруттағы серия')}
                    </span>
                    <span>
                      <b>
                        {passed.size}/{clips.length}
                      </b>
                      {t('верных микровопросов', 'дұрыс микросұрақ')}
                    </span>
                  </div>
                  {current && (
                    <div className="session-next">
                      {today && !sessionDone ? (
                        <button
                          className="button primary full"
                          onClick={() =>
                            go(
                              clips.findIndex(
                                (clip) => !clip.episode.completed || !passed.has(clip.episode.id),
                              ),
                            )
                          }
                        >
                          <RotateCcw size={18} />{' '}
                          {t('Вернуться к сериям сессии', 'Сессия серияларына оралу')}
                        </button>
                      ) : today?.next_step === 'continue' && today.next_episode ? (
                        <Link
                          className="button primary full"
                          to={`/watch/${current.season.id}?episode=${today.next_episode.position}`}
                        >
                          <Play size={18} />{' '}
                          {t('Продолжить тему сейчас', 'Тақырыпты қазір жалғастыру')}
                        </Link>
                      ) : today?.next_step === 'retelling' ? (
                        <button className="button primary full" onClick={() => open('record')}>
                          <Mic size={18} /> {t('Рассказать своими словами', 'Өз сөзіңмен айту')}
                        </button>
                      ) : today?.next_step === 'complete' ? (
                        <Link className="button primary full" to="/progress">
                          {t('Посмотреть прогресс', 'Прогресті көру')} <ArrowRight size={18} />
                        </Link>
                      ) : (
                        <button className="button primary full" onClick={() => open('quiz')}>
                          <ListChecks size={18} />
                          {t('Закрепить тему: пройти тест', 'Тақырыпты бекіту: тест тапсыру')}
                        </button>
                      )}
                      <Link className="text-button" to={`/learn/${current.season.id}`}>
                        {t('Мой маршрут по теме', 'Тақырып бойынша жолым')}
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  )}
                  {today && (
                    <div className="tomorrow-topic">
                      {t('Дальше по теме', 'Тақырып бойынша келесі қадам')}
                      <strong>
                        {today.next_episode
                          ? t(
                              `Серия ${today.next_episode.position + 1}: ${today.next_episode.title}`,
                              `${today.next_episode.position + 1}-серия: ${today.next_episode.title}`,
                            )
                          : today.next_step === 'quiz'
                            ? t('Итоговый тест', 'Қорытынды тест')
                            : today.next_step === 'retelling'
                              ? t('Объясни своими словами', 'Өз сөзіңмен түсіндір')
                              : t('Тест и пересказ сохранены', 'Тест пен мазмұндау сақталды')}
                      </strong>
                      <small>
                        {today.next_episode
                          ? t(
                              'Сегодняшний набор сохранён. Следующая короткая сессия — завтра. Продолжить тему сейчас можно по желанию.',
                              'Бүгінгі сериялар сақталды. Келесі қысқа сессия — ертең. Қаласаң, тақырыпты қазір жалғастыр.',
                            )
                          : t(
                              'Конец короткой сессии и результат теста — разные шаги. Результат пересказа оценивает учитель.',
                              'Қысқа сессияның соңы мен тест нәтижесі — бөлек қадамдар. Мазмұндауды мұғалім бағалайды.',
                            )}
                        {!sessionDone && (
                          <span>
                            {t(
                              ' Чтобы завершить маршрут серий, посмотри их и ответь верно на микровопросы.',
                              ' Сериялар жолын аяқтау үшін оларды көріп, микросұрақтарға дұрыс жауап бер.',
                            )}
                          </span>
                        )}
                      </small>
                    </div>
                  )}
                  <button className="button primary full" onClick={() => go(0)}>
                    <RotateCcw size={17} />
                    {t('Повторить серии', 'Серияларды қайталау')}
                  </button>
                  <Link className="button secondary full" to="/library">
                    {t('Самому выбрать другую тему', 'Басқа тақырып таңдау')}
                    <ArrowRight size={17} />
                  </Link>
                  <Link className="text-button" to="/progress">
                    {t('Посмотреть прогресс', 'Прогресті көру')}
                  </Link>
                </div>
              </div>
              <p className="feed-key-hint">
                {t('↑ ↓ — листать · пробел — пауза', '↑ ↓ — ауыстыру · бос орын — кідірту')}
              </p>
              <div className={`feed-actions ${atEnd ? 'hidden-actions' : ''}`}>
                <button onClick={() => setModal('chapters')} aria-label="Содержание сезона">
                  <span>
                    <BookOpen size={25} />
                  </span>
                  <small>{t('Сезон', 'Маусым')}</small>
                </button>
                <button onClick={() => open('quiz')} aria-label="Пройти тест">
                  <span className="action-mint">
                    <ListChecks size={25} />
                  </span>
                  <small>{t('Тест', 'Тест')}</small>
                </button>
                <button onClick={() => open('record')} aria-label="Записать пересказ">
                  <span>
                    <Mic size={24} />
                  </span>
                  <small>{t('Пересказ', 'Мазмұндау')}</small>
                </button>
                <button onClick={() => void share()} aria-label="Поделиться сезоном">
                  <span>
                    <Share2 size={23} />
                  </span>
                  <small>{t('Поделиться', 'Бөлісу')}</small>
                </button>
                <button
                  onClick={() => setMuted(!muted)}
                  aria-label={muted ? 'Включить звук' : 'Выключить звук'}
                >
                  <span>{muted ? <VolumeX size={22} /> : <Volume2 size={22} />}</span>
                  <small>{t('Звук', 'Дыбыс')}</small>
                </button>
              </div>
              <div className="feed-arrows">
                <button
                  aria-label="Предыдущая серия"
                  disabled={active === 0}
                  onClick={() => go(active - 1)}
                >
                  <ChevronUp size={26} />
                </button>
                <button
                  aria-label="Следующая серия"
                  disabled={active === clips.length}
                  onClick={() => go(active + 1)}
                >
                  <ChevronDown size={26} />
                </button>
              </div>
            </div>
            {current && (
              <aside className="season-panel">
                <div className="eyebrow">
                  {t(
                    today?.topic_source === 'class' ? 'СЕГОДНЯ В КЛАССЕ' : 'ТВОЯ ТЕМА СЕГОДНЯ',
                    today?.topic_source === 'class' ? 'БҮГІН СЫНЫПТА' : 'БҮГІНГІ ТАҚЫРЫБЫҢ',
                  )}
                </div>
                {today && (
                  <p className="daily-reason">
                    {sourceLabel}
                    {today.class_name ? ` · ${today.class_name}` : ''}.{' '}
                    {t(
                      `Сессия: ${clips.length} из ${today.route_total} серий темы.`,
                      `Сессия: тақырыптың ${today.route_total} сериясынан ${clips.length} серия.`,
                    )}
                  </p>
                )}
                <h1>{current.season.title}</h1>
                <p>{current.season.description}</p>
                <div className="season-meta">
                  <span>{subjects[current.season.subject]?.[locale === 'kk' ? 1 : 0]}</span>
                  <span>
                    {current.season.grade} {t('класс', 'сынып')}
                  </span>
                </div>
                <div className="chapter-header">
                  <h3>{t('Твой маршрут', 'Сенің жолың')}</h3>
                  <span>
                    {Math.min(active + 1, clips.length)}/{clips.length}
                  </span>
                </div>
                <div className="chapter-list">
                  {current.season
                    .episodes!.filter((ep) => id || clips.some((c) => c.episode.id === ep.id))
                    .map((ep) => (
                      <button
                        key={ep.id}
                        className={ep.id === current.episode.id ? 'active' : ''}
                        onClick={() => go(clips.findIndex((c) => c.episode.id === ep.id))}
                      >
                        <span className="chapter-number">
                          {clips.find((c) => c.episode.id === ep.id)?.episode.completed ? (
                            <Check size={16} />
                          ) : (
                            String(ep.position + 1).padStart(2, '0')
                          )}
                        </span>
                        <span>
                          <b>{ep.title}</b>
                          <small>
                            {ep.duration} {t('сек', 'сек')}
                          </small>
                        </span>
                        {ep.id === current.episode.id && (
                          <span className="equalizer">
                            <i />
                            <i />
                            <i />
                          </span>
                        )}
                      </button>
                    ))}
                </div>
                <button className="quiz-banner" onClick={() => open('quiz')}>
                  <span className="quiz-icon">
                    <ListChecks size={23} />
                  </span>
                  <span>
                    <b>{t('Проверь себя', 'Өзіңді тексер')}</b>
                    <small>
                      {current.season.questions?.length}{' '}
                      {t('вопроса · без таймера', 'сұрақ · таймерсіз')}
                    </small>
                  </span>
                  <ArrowRight size={20} />
                </button>
                <button className="notes-link" onClick={() => setModal('notes')}>
                  <BookOpen size={17} />
                  {t('Открыть конспект серии', 'Серия мәтінін ашу')}
                  <ArrowUpRightIcon />
                </button>
                <div className="feed-tip">
                  <Sparkles size={18} />
                  <p>
                    {t(
                      'Не нужно запоминать всё сразу. В любой момент вернись к серии.',
                      'Бәрін бірден жаттаудың қажеті жоқ. Серияға кез келген уақытта орал.',
                    )}
                  </p>
                </div>
                <div className="demo-label">
                  {current.season.source_name.startsWith('Демонстрационные')
                    ? t(
                        'Демонстрационный контент · без озвучки',
                        'Демонстрациялық мазмұн · дыбыссыз',
                      )
                    : t('Материал проверен учителем', 'Материалды мұғалім тексерді')}
                </div>
              </aside>
            )}
          </div>
        )}
      </State>
      {micro && (
        <MicroQuestion
          episode={micro}
          onClose={() => setMicro(null)}
          onPassed={() => {
            setPassed((old) => new Set([...old, micro.id]));
            void refreshDaily();
          }}
          onNext={() => {
            setMicro(null);
            go(active + 1);
          }}
        />
      )}
      {current && modal === 'chapters' && (
        <Modal title={current.season.title} onClose={() => setModal(null)}>
          <p className="muted">{current.season.description}</p>
          <div className="chapter-list">
            {current.season.episodes!.map((ep, i) => (
              <button
                key={ep.id}
                onClick={() => {
                  const target = clips.findIndex((c) => c.episode.id === ep.id);
                  if (target >= 0) go(target);
                  else navigate(`/watch/${current.season.id}?episode=${ep.position}`);
                  setModal(null);
                }}
              >
                <span className="chapter-number">{i + 1}</span>
                <span>
                  <b>{ep.title}</b>
                  <small>{ep.duration} секунд</small>
                </span>
                <Play size={17} />
              </button>
            ))}
          </div>
          <button className="button primary full" onClick={() => open('quiz')}>
            {t('Пройти тест', 'Тест тапсыру')}
            <ArrowRight size={18} />
          </button>
        </Modal>
      )}
      {current && modal === 'notes' && (
        <Modal title={current.episode.title} onClose={() => setModal(null)}>
          <p className="lesson-notes">{current.episode.script}</p>
          <p className="muted small">{current.season.source_name}</p>
        </Modal>
      )}
      {current && modal === 'quiz' && (
        <Quiz
          season={current.season}
          onClose={() => {
            setModal(null);
            void refreshDaily();
          }}
          onRecord={() => setModal('record')}
          onReview={(position) => {
            setModal(null);
            const index = current.season.episodes!.findIndex((ep) => ep.position === position);
            if (index >= 0) {
              if (id === current.season.id) {
                const video = scroll.current?.querySelectorAll('video').item(index);
                if (video) video.currentTime = 0;
                go(index);
              }
              navigate(`/watch/${current.season.id}?episode=${index}`);
            }
          }}
        />
      )}
      {current && modal === 'record' && (
        <Recorder
          season={current.season}
          onClose={() => {
            setModal(null);
            void refreshDaily();
          }}
        />
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={16} />;
}
function FeedVideo({
  clip,
  context,
  active,
  muted,
  onEnded,
  onQuiz,
}: {
  clip: Clip;
  context?: string;
  active: boolean;
  muted: boolean;
  onEnded: () => void;
  onQuiz: () => void;
}) {
  const { t } = useApp();
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [failed, setFailed] = useState(false);
  const pct = duration ? (time / duration) * 100 : 0;
  const stamp = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.play()
        .then(() => setPaused(false))
        .catch(() => setPaused(true));
    } else {
      v.pause();
      setPaused(true);
    }
  }, [active]);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused)
      v.play()
        .then(() => setPaused(false))
        .catch(() => setPaused(true));
    else {
      v.pause();
      setPaused(true);
    }
  };
  return (
    <article className={`video-stage color-${clip.season.color}`}>
      <video
        ref={ref}
        src={clip.episode.has_video ? `/api/episodes/${clip.episode.id}/video` : undefined}
        playsInline
        muted={muted}
        preload={active ? 'auto' : 'none'}
        onError={() => setFailed(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
        }}
        onLoadedMetadata={(e) =>
          setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
        }
        onEnded={() => {
          onEnded();
          setPaused(true);
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        aria-label={clip.episode.title}
      />
      <div className="video-top">
        <Link className="subject-badge" to={`/learn/${clip.season.id}`}>
          <BookOpen size={12} /> {t('Открыть тему', 'Тақырыпты ашу')}
        </Link>
        <span className="episode-badge">
          {clip.episode.position + 1}/{clip.season.episodes!.length}
        </span>
      </div>
      <button
        className="video-play-layer"
        onClick={toggle}
        aria-label={paused ? 'Воспроизвести' : 'Пауза'}
      >
        {paused && (
          <span>
            <Play size={36} fill="currentColor" />
          </span>
        )}
      </button>
      {failed && (
        <div className="video-failure">
          <p>{t('Видео не загрузилось', 'Видео жүктелмеді')}</p>
          <button
            className="button secondary"
            onClick={() => {
              setFailed(false);
              ref.current?.load();
            }}
          >
            Повторить
          </button>
          <p>{clip.episode.script}</p>
        </div>
      )}
      <div className="video-bottom">
        {context && <p className="video-context">{context}</p>}
        <div className="creator">
          <span className="creator-avatar">O</span>
          <span>
            OylaTap <CheckCheck size={16} />
          </span>
          <span className="video-language">
            {clip.season.language === 'kk' ? 'Қазақша' : 'Русский'}
          </span>
        </div>
        <h2>{clip.episode.title}</h2>
        <Link to={`/learn/${clip.season.id}`} className="video-season-link">
          <BookOpen size={14} />
          {clip.season.title}
        </Link>
        {pct >= 98 && (
          <button className="button primary video-quiz" onClick={onQuiz}>
            {t('Что ты понял? Проверим', 'Түсінгеніңді тексерейік')}
            <ArrowRight size={17} />
          </button>
        )}
      </div>
      <span className="video-time" aria-hidden="true">
        {stamp(time)} / {stamp(duration)}
      </span>
      <input
        className="video-seek"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(time, duration || 1)}
        disabled={!duration}
        aria-label={t('Позиция видео', 'Видеодағы орын')}
        aria-valuetext={`${stamp(time)} / ${stamp(duration)}`}
        style={{ '--played': `${Math.min(100, pct)}%` } as React.CSSProperties}
        onChange={(e) => {
          const value = Number(e.target.value);
          if (ref.current) ref.current.currentTime = value;
          setTime(value);
        }}
      />
    </article>
  );
}

export function Quiz({
  season,
  onClose,
  onRecord,
  onReview,
}: {
  season: Season;
  onClose: () => void;
  onRecord: () => void;
  onReview: (position: number) => void;
}) {
  const { t } = useApp();
  const questions = season.questions || [];
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<number[]>([]),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      setResult(await post(`/seasons/${season.id}/attempts`, { answers }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const q = questions[index];
  return (
    <Modal title={t('Проверь понимание', 'Түсінгеніңді тексер')} onClose={onClose}>
      {!questions.length ? (
        <p>{t('Учитель ещё не добавил вопросы.', 'Мұғалім сұрақтарды әлі қоспады.')}</p>
      ) : result ? (
        <>
          <div className="quiz-result">
            <div className="result-orbit">
              <Trophy size={32} />
            </div>
            <span className="eyebrow">
              {t('ЕЩЁ ОДИН ШАГ К ПОНИМАНИЮ', 'ТҮСІНУГЕ ТАҒЫ БІР ҚАДАМ')}
            </span>
            <h3>
              {result.score} {t('из', '/')} {result.total}
            </h3>
            <p>
              {result.score === result.total
                ? t(
                    'Всё получилось! Расскажи тему своими словами.',
                    'Жарайсың! Тақырыпты өз сөзіңмен айт.',
                  )
                : t(
                    'Ошибки показывают, куда посмотреть ещё раз.',
                    'Қателер нені қайталау керектігін көрсетеді.',
                  )}
            </p>
          </div>
          <div className="quiz-review">
            {result.results.map((r: any, i: number) => {
              const question = questions.find((q) => q.id === r.id);
              const episode = season.episodes?.find(
                (ep) => ep.position === question?.episode_position,
              );
              return (
                <div className={r.passed ? 'passed' : 'wrong'} key={r.id}>
                  <b>
                    {r.passed ? <Check size={18} /> : <RotateCcw size={18} />} {i + 1}. {r.prompt}
                  </b>
                  <p>{r.explanation}</p>
                  {!r.passed && (
                    <small>
                      {t('Верный ответ: ', 'Дұрыс жауап: ')}
                      {r.options[r.correct]}
                    </small>
                  )}
                  {!r.passed && episode?.has_video && (
                    <button
                      className="text-button review-episode"
                      onClick={() => onReview(episode.position)}
                    >
                      <Play size={15} />
                      {t('Повторить серию: ', 'Серияны қайталау: ')}
                      {episode.title}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button className="button primary full" onClick={onRecord}>
            <Mic size={18} />
            {t('Рассказать своими словами', 'Өз сөзіммен айту')}
          </button>
          <button
            className="text-button full"
            onClick={() => {
              setIndex(0);
              setAnswers([]);
              setResult(null);
            }}
          >
            {t('Пройти ещё раз', 'Қайта тапсыру')}
          </button>
          <Link className="text-button full quiz-progress-link" to="/progress" onClick={onClose}>
            {t('Посмотреть мой прогресс', 'Прогресімді көру')}
            <ArrowRight size={16} />
          </Link>
        </>
      ) : (
        <>
          <p className="muted small">{season.title}</p>
          <div className="quiz-progress">
            <span>
              {t('Вопрос', 'Сұрақ')} {index + 1}/{questions.length}
            </span>
            <span>{t('Без спешки', 'Асықпай')}</span>
            <div className="progress-track">
              <i style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
            </div>
          </div>
          <h3 className="question-title">{q.prompt}</h3>
          <div className="answer-options">
            {q.options.map((o, i) => (
              <button
                key={i}
                className={answers[index] === i ? 'selected' : ''}
                onClick={() =>
                  setAnswers((prev) => {
                    const n = [...prev];
                    n[index] = i;
                    return n;
                  })
                }
              >
                <span>{String.fromCharCode(65 + i)}</span>
                {o}
                {answers[index] === i && <Check size={18} />}
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
              className="icon-button"
              aria-label="Предыдущий вопрос"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft size={21} />
            </button>
            <button
              className="button primary"
              disabled={answers[index] === undefined || busy}
              onClick={() => (index === questions.length - 1 ? void submit() : setIndex(index + 1))}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {t(
                    index === questions.length - 1 ? 'Показать результат' : 'Дальше',
                    index === questions.length - 1 ? 'Нәтижені көру' : 'Келесі',
                  )}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
export function Recorder({ season, onClose }: { season: Season; onClose: () => void }) {
  const { t, notify } = useApp();
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [blob, setBlob] = useState<Blob | null>(null),
    [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState(''),
    [consent, setConsent] = useState(false),
    [transcript, setTranscript] = useState('');
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]);
  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((x) => x.stop());
    },
    [],
  );
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () =>
        setSeconds((s) => {
          if (s >= 119) {
            recorder.current?.stop();
            return 120;
          }
          return s + 1;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [recording]);
  async function start() {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          t(
            'Для записи нужен поддерживаемый браузер и HTTPS.',
            'Жазу үшін HTTPS және қолдайтын браузер қажет.',
          ),
        );
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = audio;
      chunks.current = [];
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((x) =>
        MediaRecorder.isTypeSupported(x),
      );
      const r = new MediaRecorder(audio, mime ? { mimeType: mime } : undefined);
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = () => {
        setBlob(new Blob(chunks.current, { type: r.mimeType }));
        setRecording(false);
        audio.getTracks().forEach((x) => x.stop());
      };
      setBlob(null);
      setSeconds(0);
      r.start(500);
      setRecording(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send() {
    if (!blob) return;
    setBusy(true);
    setError('');
    try {
      const f = new FormData();
      f.append('file', blob, 'retelling.webm');
      f.append('transcript', transcript);
      f.append('consent', String(consent));
      await api(`/seasons/${season.id}/retellings`, { method: 'POST', body: f });
      setSent(true);
      notify(t('Пересказ сохранён', 'Мазмұндау сақталды'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Теперь твоими словами', 'Енді өз сөзіңмен')} onClose={onClose}>
      {sent ? (
        <div className="sent-state">
          <CheckCheck size={45} />
          <h3>{t('Пересказ сохранён', 'Мазмұндау сақталды')}</h3>
          <p>
            {t(
              'Если сезон назначен твоему классу, учитель сможет прослушать запись и оставить отзыв. Автоматическая оценка ИИ ещё не подключена.',
              'Егер маусым сыныпқа берілсе, мұғалім жазбаны тыңдап, пікір қалдырады. ЖИ бағалауы әлі қосылмаған.',
            )}
          </p>
          <button className="button primary" onClick={onClose}>
            {t('Продолжить', 'Жалғастыру')}
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            {t(
              'Объясни главную мысль, назови важные события и свяжи их между собой. Не нужно повторять текст слово в слово.',
              'Негізгі ойды, маңызды оқиғаларды және олардың байланысын түсіндір.',
            )}
          </p>
          <div className="record-hints">
            <span>01 {t('Что произошло?', 'Не болды?')}</span>
            <span>02 {t('Почему?', 'Неліктен?')}</span>
            <span>03 {t('Что изменилось?', 'Не өзгерді?')}</span>
          </div>
          <div className={`recorder ${recording ? 'recording' : ''}`}>
            <div className="record-wave">
              {Array.from({ length: 23 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    height: `${8 + (Math.sin(i * 1.7) + 1) * 20}px`,
                    animationDelay: `${i * 0.07}s`,
                  }}
                />
              ))}
            </div>
            <div className="record-time">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} <span>/ 2:00</span>
            </div>
            {recording ? (
              <button
                className="record-button stop"
                onClick={() => recorder.current?.stop()}
                aria-label="Остановить запись"
              >
                <Square size={22} fill="currentColor" />
              </button>
            ) : (
              <button
                className="record-button"
                onClick={() => void start()}
                aria-label="Начать запись"
              >
                <Mic size={25} />
              </button>
            )}
            <small>
              {t(
                recording
                  ? 'Нажми, чтобы закончить'
                  : blob
                    ? 'Можно записать ещё раз'
                    : 'Нажми и расскажи',
                recording ? 'Аяқтау үшін бас' : blob ? 'Қайта жазуға болады' : 'Басып, айтып бер',
              )}
            </small>
          </div>
          {url && <audio src={url} controls className="audio-player" />}
          <label className="form-label">
            {t('Свой текст — по желанию', 'Мәтін — қалауың бойынша')}
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              maxLength={10000}
              placeholder={t(
                'Добавь свой текст или уточнение. Это не автоматическая расшифровка.',
                'Мәтініңді немесе түсіндірмеңді қос. Бұл автоматты транскрипция емес.',
              )}
              rows={3}
            />
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              {t(
                'Согласен сохранить запись и предоставить её учителю моего класса. Запись можно удалить в профиле.',
                'Жазбаны сақтауға және сынып мұғаліміне беруге келісемін. Жазбаны профильден жоюға болады.',
              )}
            </span>
          </label>
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary full"
            disabled={!blob || !consent || busy || recording}
            onClick={() => void send()}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <>
                <Send size={17} />
                {t('Отправить пересказ', 'Мазмұндауды жіберу')}
              </>
            )}
          </button>
        </>
      )}
    </Modal>
  );
}

export function LibraryPage() {
  const r = useResource<Season[]>('/catalog');
  const { t, locale } = useApp();
  const [search, setSearch] = useState(''),
    [subject, setSubject] = useState('all'),
    [lang, setLang] = useState('all'),
    [grade, setGrade] = useState('all');
  const filtered = (r.data || []).filter(
    (s) =>
      (subject === 'all' || s.subject === subject) &&
      (lang === 'all' || s.language === lang) &&
      (grade === 'all' || s.grade === Number(grade)) &&
      `${s.title} ${s.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('ТВОЯ СЛЕДУЮЩАЯ ИСТОРИЯ', 'КЕЛЕСІ ОҚИҒАҢ')}
        title={t('Любопытство — хороший план', 'Қызығушылық — жақсы жоспар')}
        description={t(
          'Выбери тему. Несколько коротких серий — и всё встаёт на свои места.',
          'Тақырып таңда. Қысқа сериялар арқылы түсін.',
        )}
      />
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={19} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Название или тема', 'Атауы немесе тақырып')}
            aria-label="Поиск сезонов"
          />
          {search && (
            <button aria-label="Очистить поиск" onClick={() => setSearch('')}>
              <X size={16} />
            </button>
          )}
        </label>
        <select aria-label="Язык контента" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="all">{t('Все языки', 'Барлық тілдер')}</option>
          <option value="ru">Русский</option>
          <option value="kk">Қазақша</option>
        </select>
        <select aria-label="Класс" value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="all">{t('Все классы', 'Барлық сыныптар')}</option>
          {[5, 6, 7, 8, 9, 10, 11].map((g) => (
            <option key={g} value={g}>
              {g} {t('класс', 'сынып')}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-chips">
        <button className={subject === 'all' ? 'active' : ''} onClick={() => setSubject('all')}>
          {t('Все темы', 'Барлық тақырыптар')}
        </button>
        {Object.entries(subjects).map(([key, labels]) => (
          <button
            key={key}
            className={subject === key ? 'active' : ''}
            onClick={() => setSubject(key)}
          >
            {labels[locale === 'kk' ? 1 : 0]}
          </button>
        ))}
      </div>
      <State {...r} retry={r.reload}>
        {filtered.length ? (
          <>
            <div className="section-label">
              {filtered.length} {t('сезона для новых открытий', 'маусым')}
            </div>
            <div className="season-grid">
              {filtered.map((s) => (
                <SeasonCard season={s} key={s.id} />
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Search size={32} />
            <h2>{t('Такой темы пока нет', 'Бұл тақырып әлі жоқ')}</h2>
            <p>
              {t(
                'Попробуй другое название или убери фильтры.',
                'Басқа атау немесе сүзгіні қолданып көр.',
              )}
            </p>
            <button
              className="button secondary"
              onClick={() => {
                setSearch('');
                setSubject('all');
                setLang('all');
                setGrade('all');
              }}
            >
              {t('Сбросить фильтры', 'Сүзгіні өшіру')}
            </button>
          </div>
        )}
      </State>
      <div className="inline-note">
        <Sparkles size={19} />
        {t(
          'Демонстрационные сезоны показывают формат. Учебные материалы проверяет учитель перед публикацией.',
          'Демо маусымдар форматты көрсетеді. Оқу материалдарын мұғалім тексереді.',
        )}
      </div>
    </div>
  );
}
export function AssignmentsPage() {
  const r = useResource<any[]>('/assignments');
  const classes = useResource<any[]>('/classes');
  const { t, notify } = useApp();
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('УЧИМСЯ ВМЕСТЕ', 'БІРГЕ ҮЙРЕНЕМІЗ')}
        title={t('Твои задания', 'Тапсырмаларың')}
        description={t(
          'Всё от учителя в одном месте. Сначала серии, потом тест и пересказ.',
          'Алдымен сериялар, содан кейін тест пен мазмұндау.',
        )}
      />
      <form
        className="join-banner"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = await post('/classes/join', { code });
            notify(t(`Ты в классе «${c.name}»!`, `«${c.name}» сыныбына қосылдың!`));
            setCode('');
            r.reload();
            classes.reload();
          } catch (err) {
            notify((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <BookOpen size={24} />
          <span>
            <b>{t('Есть код от учителя?', 'Мұғалімнің коды бар ма?')}</b>
            <small>{t('Присоединись к своему классу', 'Сыныбыңа қосыл')}</small>
          </span>
        </div>
        <label className="sr-only" htmlFor="class-code">
          Код класса
        </label>
        <input
          id="class-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          minLength={4}
          maxLength={16}
          placeholder="OYLA7A"
        />
        <button className="button primary" disabled={busy}>
          {t('Присоединиться', 'Қосылу')}
          <ArrowRight size={17} />
        </button>
      </form>
      <div className="class-pills">
        {classes.data?.map((c) => (
          <span key={c.id}>{c.name}</span>
        ))}
      </div>
      <State {...r} retry={r.reload}>
        {r.data?.length ? (
          <div className="assignment-list">
            {r.data.map((a) => {
              const done = a.best_score !== null;
              const late = new Date(a.due_at) < new Date();
              return (
                <Link className="assignment-card" key={a.id} to={`/learn/${a.season_id}`}>
                  <div className="assignment-art">
                    <SeasonArt art={a.art} color={a.color} />
                  </div>
                  <div className="assignment-info">
                    <span className={`status ${done ? 'published' : late ? 'failed' : 'draft'}`}>
                      {done
                        ? t('Тест пройден', 'Тест аяқталды')
                        : late
                          ? t('Срок прошёл · можно продолжить', 'Мерзім өтті · жалғастыра аласың')
                          : t('Можно начинать', 'Бастауға болады')}
                    </span>
                    <h3>{a.title}</h3>
                    <p>{a.class_name}</p>
                    <div className="assignment-meta">
                      <span>
                        <CalendarDays size={15} />
                        {new Date(a.due_at).toLocaleDateString(localeDate())}
                      </span>
                      <span>
                        {a.completed}/{a.episode_count} {t('серий', 'серия')}
                      </span>
                      {done && (
                        <span className="mint">
                          {a.best_score}% {t('тест', 'тест')}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight size={22} />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <ClipboardIcon />
            <h2>{t('Пока без домашних заданий', 'Әзірге тапсырма жоқ')}</h2>
            <p>
              {t(
                'Присоединись к классу или выбери тему в библиотеке.',
                'Сыныпқа қосыл немесе тақырып таңда.',
              )}
            </p>
            <Link className="button primary" to="/library">
              {t('Выбрать сезон', 'Маусым таңдау')}
            </Link>
          </div>
        )}
      </State>
    </div>
  );
}
function ClipboardIcon() {
  return <ListChecks size={34} />;
}
const localeDate = () => (localStorage.getItem('oylatap-locale') === 'kk' ? 'kk-KZ' : 'ru-RU');
export function ProgressPage() {
  const r = useResource<any>('/progress');
  const { t, user } = useApp();
  const s = r.data?.stats;
  const nextSeason: Season | undefined = r.data?.seasons.find(
    (season: Season) =>
      season.completed < season.episode_count ||
      season.best_score === null ||
      season.best_score < 100,
  );
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('СРАВНИВАЙ СЕБЯ С СОБОЙ', 'ӨЗІҢДІ ӨЗІҢМЕН САЛЫСТЫР')}
        title={t(
          `${user!.name.split(' ')[0]}, каждый шаг важен`,
          `${user!.name.split(' ')[0]}, әр қадам маңызды`,
        )}
        description={t(
          'Просмотр, тест и пересказ — разные шаги. Здесь видно каждый из них.',
          'Көру, тест және мазмұндау — бөлек қадамдар.',
        )}
      />
      <State {...r} retry={r.reload}>
        {s && (
          <>
            <div className="stats-grid">
              <Stat
                icon={<Play />}
                value={s.watched}
                label={t('Серий просмотрено', 'Көрілген сериялар')}
              />
              <Stat
                icon={<ListChecks />}
                value={s.tests}
                label={t('Тестов пройдено', 'Аяқталған тесттер')}
              />
              <Stat
                icon={<Mic />}
                value={s.retellings}
                label={t('Пересказов записано', 'Жазылған мазмұндаулар')}
              />
              <Stat
                icon={<Target />}
                value={s.tests ? `${s.understanding}%` : '—'}
                label={t('Средний результат теста', 'Тесттің орташа нәтижесі')}
              />
            </div>
            <div className="learning-xp">
              <Sparkles size={22} />
              <span>
                <b>
                  {s.xp} {t('опыта', 'тәжірибе')}
                </b>
                <small>
                  {s.micro_correct}{' '}
                  {t(
                    'серий с верным микровопросом · просмотр сам по себе не означает понимание',
                    'дұрыс микросұрағы бар серия',
                  )}
                </small>
              </span>
            </div>
            {nextSeason && (
              <Link className="continue-topic" to={`/learn/${nextSeason.id}`}>
                <span className="continue-icon">
                  <BookOpen size={24} />
                </span>
                <span>
                  <small>{t('СЛЕДУЮЩИЙ ШАГ', 'КЕЛЕСІ ҚАДАМ')}</small>
                  <strong>{nextSeason.title}</strong>
                  <span>
                    {nextSeason.completed < nextSeason.episode_count
                      ? t('Продолжи с непросмотренной серии.', 'Көрілмеген сериядан жалғастыр.')
                      : nextSeason.best_score === null
                        ? t(
                            'Все серии просмотрены. Пора проверить понимание.',
                            'Барлық сериялар көрілді. Енді түсінгеніңді тексер.',
                          )
                        : t(
                            'Повтори сложное и попробуй тест ещё раз.',
                            'Күрделі тұстарды қайталап, тестті қайта тапсырып көр.',
                          )}
                  </span>
                </span>
                <ArrowRight size={21} />
              </Link>
            )}
            <div className="progress-panels">
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t('Немного каждый день', 'Күнде аз-аздан')}</h2>
                  <Sparkles size={20} />
                </div>
                <p className="muted">
                  {t(
                    'Любой шаг считается. За пропуски никто не отнимает достижения.',
                    'Әр қадам есептеледі. Жетістіктер жоғалмайды.',
                  )}
                </p>
                <div className="activity-week">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - 6 + i);
                    const key =
                      d.getFullYear() +
                      '-' +
                      String(d.getMonth() + 1).padStart(2, '0') +
                      '-' +
                      String(d.getDate()).padStart(2, '0');
                    const n = r.data.activity.find((x: any) => x.date === key)?.n || 0;
                    return (
                      <div key={key}>
                        <span className={n ? 'active' : ''}>
                          {n ? <Check size={21} /> : <span />}
                        </span>
                        <small>{d.toLocaleDateString(localeDate(), { weekday: 'short' })}</small>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="panel achievement-panel">
                <Trophy size={30} />
                <h2>{t('Твоё первое открытие', 'Алғашқы жаңалығың')}</h2>
                <p>
                  {s.tests
                    ? t(
                        'Первый тест пройден. Ты уже проверил, что понял — это важнее простого просмотра.',
                        'Алғашқы тест аяқталды. Түсінгеніңді тексердің.',
                      )
                    : t(
                        'Пройди первый тест и получи достижение за понимание.',
                        'Бірінші тестті аяқтап, жетістік ал.',
                      )}
                </p>
                <span className={`status ${s.tests ? 'published' : 'draft'}`}>
                  {s.tests ? t('Получено', 'Алынды') : t('Ещё впереди', 'Алда')}
                </span>
              </section>
            </div>
            <div className="section-heading">
              <h2>{t('Ты уже начал', 'Бастаған маусымдарың')}</h2>
              <Link to="/library">
                {t('Все сезоны', 'Барлық маусымдар')}
                <ArrowRight size={16} />
              </Link>
            </div>
            {r.data.seasons.length ? (
              <div className="season-grid">
                {r.data.seasons.map((v: Season) => (
                  <SeasonCard key={v.id} season={v} />
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <h3>{t('Первый сезон ждёт тебя', 'Бірінші маусым сені күтеді')}</h3>
                <Link className="button primary" to="/">
                  {t('Открыть ленту', 'Лентаны ашу')}
                  <ArrowRight size={17} />
                </Link>
              </div>
            )}
          </>
        )}
      </State>
    </div>
  );
}
export function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <strong>{value}</strong>
      <p>{label}</p>
    </div>
  );
}
export function ProfilePage() {
  const { t, user, refresh, notify, demo, setLocale, comfort, setComfort } = useApp();
  const [busy, setBusy] = useState(false);
  const catalog = useResource<Season[]>('/catalog');
  const [records, setRecords] = useState<{ season: Season; r: any }[]>([]);
  const loadRecords = useCallback(async () => {
    if (!catalog.data) return;
    const ss = await Promise.all(catalog.data.map((s) => api<Season>(`/seasons/${s.id}`)));
    setRecords(ss.flatMap((season) => (season.retellings || []).map((r) => ({ season, r }))));
  }, [catalog.data]);
  useEffect(() => {
    loadRecords().catch((e) => notify(e.message));
  }, [loadRecords]);
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('ТВОЙ АККАУНТ', 'СЕНІҢ АККАУНТЫҢ')}
        title={t('Как тебе удобно', 'Өзіңе ыңғайлы')}
        description={t('Настрой обучение под себя.', 'Оқуды өзіңе бейімде.')}
      />
      <section className="panel appearance-panel">
        <Moon size={23} />
        <label>
          <span>
            <b>{t('Спокойное оформление', 'Жайлы безендіру')}</b>
            <small>
              {t(
                'Приглушённые акценты и меньше анимации. Настройка сохраняется на этом устройстве.',
                'Жұмсақ түстер және аз анимация. Баптау осы құрылғыда сақталады.',
              )}
            </small>
          </span>
          <input type="checkbox" checked={comfort} onChange={(e) => setComfort(e.target.checked)} />
        </label>
      </section>
      {user?.role === 'student' && <LearningPreferences />}
      <div className="profile-grid">
        <section className="panel">
          <div className="profile-identity">
            <span className="avatar large">{user!.name[0]}</span>
            <div>
              <h2>{user!.name}</h2>
              <p>{user!.email}</p>
            </div>
          </div>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await api('/profile', {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: f.get('name'),
                    grade: Number(f.get('grade')),
                    language: f.get('language'),
                  }),
                });
                setLocale(f.get('language') as 'ru' | 'kk');
                await refresh();
                notify(t('Настройки сохранены', 'Баптаулар сақталды'));
              } catch (err) {
                notify((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Имя', 'Аты')}
              <input name="name" defaultValue={user!.name} required minLength={2} maxLength={80} />
            </label>
            <div className="form-row">
              <label>
                {t('Класс', 'Сынып')}
                <select name="grade" defaultValue={user!.grade}>
                  {[5, 6, 7, 8, 9, 10, 11].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label>
                {t('Язык интерфейса', 'Интерфейс тілі')}
                <select name="language" defaultValue={user!.language}>
                  <option value="ru">Русский</option>
                  <option value="kk">Қазақша</option>
                </select>
              </label>
            </div>
            <button className="button primary" disabled={busy}>
              {t('Сохранить настройки', 'Баптауларды сақтау')}
              <Check size={17} />
            </button>
          </form>
          {demo && (
            <p className="inline-note small">
              {t(
                'Демо-среда. Для пилота нужны отдельные аккаунты и настройки хранения данных.',
                'Демо орта. Пилотқа бөлек аккаунттар және деректерді сақтау баптаулары қажет.',
              )}
            </p>
          )}
        </section>
        <section className="panel">
          <h2>{t('Твои голосовые записи', 'Дауыстық жазбаларың')}</h2>
          <p className="muted">
            {t(
              'Записи доступны тебе и учителю класса, которому назначен сезон.',
              'Жазбалар саған және маусымды берген мұғалімге қолжетімді.',
            )}
          </p>
          {records.length ? (
            records.map(({ season, r }) => (
              <div className="retelling-card" key={r.id}>
                <h3>{season.title}</h3>
                <span className={`status ${r.teacher_score === null ? 'draft' : 'published'}`}>
                  {r.teacher_score === null
                    ? t('Ожидает проверки', 'Тексеруді күтуде')
                    : `${r.teacher_score}% · ${t('оценка учителя', 'мұғалім бағасы')}`}
                </span>
                <audio src={`/api/retellings/${r.id}/audio`} controls className="audio-player" />
                {r.feedback && <p className="feedback">{r.feedback}</p>}
                <button
                  className="text-button danger"
                  onClick={async () => {
                    try {
                      await api(`/retellings/${r.id}`, { method: 'DELETE' });
                      await loadRecords();
                      notify(t('Запись удалена', 'Жазба жойылды'));
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  {t('Удалить запись', 'Жазбаны жою')}
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state compact">
              <Mic size={30} />
              <p>
                {t(
                  'Здесь появится твой первый пересказ.',
                  'Алғашқы мазмұндауың осында пайда болады.',
                )}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
