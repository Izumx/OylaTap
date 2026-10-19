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
  CircleHelp,
  UserRound,
  ChartNoAxesCombined,
  Forward,
  Ellipsis,
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
  Heart,
  Flag,
} from 'lucide-react';
import {
  api,
  post,
  useApp,
  useResource,
  subjects,
  minutes,
  testQuestions,
  type Season,
  type Episode,
  type DailySession,
} from './lib';
import { Modal, State, PageHeader, SeasonArt, SeasonCard } from './components';
import { LearningPreferences } from './Learning';

// `key` stays unique when the endless feed shows an episode again.
type Clip = { season: Season; episode: Episode; reason?: string; key?: string };
type ForYou = {
  week: number | null;
  items: { season_id: string; episode_id: string; reason: string }[];
  exhausted: boolean;
};
// Concept 3.0: a soft break after long continuous watching. A suggestion, never a lock.
const breakAfterSeconds = (comfort: boolean) => {
  try {
    const custom = Number(localStorage.getItem('oylatap-break-after-seconds'));
    if (custom > 0) return custom;
  } catch {}
  return (comfort ? 20 : 40) * 60;
};
function MicroQuestion({
  episode,
  onClose,
  onPassed,
  onNext,
  onReplay,
  nextLabel,
  route = true,
}: {
  episode: Episode;
  onClose: () => void;
  onPassed: () => void;
  onNext: () => void;
  onReplay: () => void;
  nextLabel: string;
  route?: boolean;
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
                    aria-pressed={answer === i}
                    disabled={busy}
                    onClick={() => setAnswer(i)}
                  >
                    <span>{String.fromCharCode(65 + i)}</span>
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <div className={`micro-result ${result.passed ? 'passed' : 'wrong'}`} role="status">
                <b>
                  {result.passed
                    ? t('Ответ верный!', 'Дұрыс жауап!')
                    : t('Разберём вместе', 'Бірге түсінейік')}
                </b>
                <p>{result.explanation}</p>
                <p className="micro-next">
                  {result.passed
                    ? nextLabel
                    : t(
                        'Вернись к объяснению и проверь себя ещё раз.',
                        'Түсіндірмені қайта көріп, өзіңді тағы тексер.',
                      )}
                </p>
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
              <>
                <button
                  className="button primary full"
                  disabled={answer === null || busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
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
                  {busy ? t('Проверяем…', 'Тексерілуде…') : t('Проверить', 'Тексеру')}
                  <ArrowRight size={17} />
                </button>
                {/* The question is part of the feed, not a gate: it can be skipped. */}
                <button className="text-button full" onClick={onNext}>
                  {t('Пропустить вопрос', 'Сұрақты өткізу')}
                </button>
              </>
            ) : (
              <>
                {result.passed ? (
                  <button className="button primary full" onClick={onNext}>
                    {route
                      ? t('Дальше по маршруту', 'Маршрутты жалғастыру')
                      : t('Дальше', 'Әрі қарай')}
                    <ArrowRight size={17} />
                  </button>
                ) : (
                  <button className="button primary full" onClick={onReplay}>
                    <RotateCcw size={17} /> {t('Повторить объяснение', 'Түсіндірмені қайталау')}
                  </button>
                )}
                {!result.passed && (
                  <button
                    className="text-button full"
                    onClick={() => {
                      setResult(null);
                      setAnswer(null);
                      setError('');
                    }}
                  >
                    {t('Попробовать ещё раз', 'Қайта байқап көру')}
                  </button>
                )}
                {!result.passed && (
                  <button className="text-button full" onClick={onNext}>
                    {t('Дальше по маршруту', 'Маршрутты жалғастыру')} <ArrowRight size={16} />
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
  // Concept 3.0: the endless personal feed is the main one; "Today" is a short session.
  // The mode lives in the address, so a reload or a shared link keeps it.
  const mode: 'school' | 'foryou' = searchParams.get('feed') === 'today' ? 'school' : 'foryou';
  const [focus, setFocus] = useState(() => localStorage.getItem('oylatap-feed-focus') !== 'off'),
    [today, setToday] = useState<DailySession | null>(null),
    [dailyStart, setDailyStart] = useState(0),
    [micro, setMicro] = useState<Episode | null>(null),
    [passed, setPassed] = useState<Set<string>>(new Set());
  const { user, t, locale, notify, login, authOpen, comfort } = useApp();
  const [clips, setClips] = useState<Clip[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [active, setActive] = useState(0),
    [muted, setMuted] = useState(true),
    [modal, setModal] = useState<
      'quiz' | 'record' | 'chapters' | 'notes' | 'report' | 'learn' | 'more' | null
    >(null),
    [version, setVersion] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const slideHeight = useRef(0);
  const activeSlide = useRef(0);
  const dailyRef = useRef<DailySession | null>(null);
  const feedGeneration = useRef(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Endless "For you": episodes already shown in this feed, cached seasons and paging state.
  const shown = useRef<string[]>([]);
  const seasonCache = useRef(new Map<string, Season>());
  const paging = useRef({ busy: false, done: false, restarted: false, serial: 0 });
  const [feedDone, setFeedDone] = useState(false);
  const fetchBatch = useCallback(async (): Promise<Clip[]> => {
    const picked: ForYou = await post('/foryou', {
      language: locale,
      exclude: shown.current.slice(-400),
    });
    const missing = [...new Set(picked.items.map((item) => item.season_id))].filter(
      (sid) => !seasonCache.current.has(sid),
    );
    for (const season of await Promise.all(missing.map((sid) => api<Season>(`/seasons/${sid}`))))
      seasonCache.current.set(season.id, season);
    return picked.items.flatMap((item) => {
      const season = seasonCache.current.get(item.season_id)!;
      const episode = season.episodes?.find((e) => e.id === item.episode_id);
      if (!episode) return [];
      shown.current.push(episode.id);
      return [
        { season, episode, reason: item.reason, key: `${episode.id}:${paging.current.serial++}` },
      ];
    });
  }, [locale]);
  const loadMore = useCallback(async () => {
    const p = paging.current;
    if (p.busy || p.done) return;
    p.busy = true;
    const generation = feedGeneration.current;
    try {
      let next = await fetchBatch();
      // Nothing new left: start over with the best of what was watched, and say so.
      if (!next.length && !p.restarted) {
        p.restarted = true;
        shown.current = [];
        next = await fetchBatch();
        if (next.length)
          notify(
            t(
              'Новые видео закончились — показываем лучшее ещё раз',
              'Жаңа видеолар бітті — ең жақсыларын қайта көрсетеміз',
            ),
          );
      } else if (next.length) p.restarted = false;
      if (generation !== feedGeneration.current) return;
      if (!next.length) {
        p.done = true;
        setFeedDone(true);
      } else setClips((old) => [...old, ...next]);
    } catch (e) {
      if (generation === feedGeneration.current) notify((e as Error).message);
    } finally {
      p.busy = false;
    }
  }, [fetchBatch, notify, t]);
  useEffect(() => {
    let alive = true;
    feedGeneration.current += 1;
    setLoading(true);
    setError('');
    (async () => {
      if (!id && mode === 'foryou') {
        shown.current = [];
        seasonCache.current = new Map();
        paging.current = { busy: false, done: false, restarted: false, serial: 0 };
        setFeedDone(false);
        const first = await fetchBatch();
        if (!alive) return;
        if (!first.length) {
          paging.current.done = true;
          setFeedDone(true);
        }
        setToday(null);
        dailyRef.current = null;
        setPassed(new Set());
        setDailyStart(0);
        setMicro(null);
        setClips(first);
        setActive(0);
        activeSlide.current = 0;
        scroll.current?.scrollTo(0, 0);
        return;
      }
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
  }, [id, user?.id, version, mode, locale]);
  const endless = !id && mode === 'foryou';
  // Fetch the next batch while three clips are still ahead, so scrolling never stops.
  useEffect(() => {
    if (endless && !loading && clips.length && active >= clips.length - 3) void loadMore();
  }, [endless, loading, active, clips.length, loadMore]);
  // Visible time on the endless feed since the last break.
  const [breakOpen, setBreakOpen] = useState(false);
  const watchedFor = useRef(0);
  useEffect(() => {
    if (!endless) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') watchedFor.current += 1;
    }, 1000);
    return () => clearInterval(timer);
  }, [endless]);
  // Offered between clips, never in the middle of an explanation.
  useEffect(() => {
    if (endless && active > 0 && watchedFor.current >= breakAfterSeconds(comfort))
      setBreakOpen(true);
  }, [endless, active, comfort]);
  const closeBreak = () => {
    watchedFor.current = 0;
    setBreakOpen(false);
  };
  const current = clips[Math.min(active, clips.length - 1)];
  const atEnd = active === clips.length;
  const sessionDone =
    clips.length > 0 && clips.every((c) => c.episode.completed && passed.has(c.episode.id));
  const sourceLabel =
    today?.topic_source === 'class'
      ? t('От учителя', 'Мұғалімнен')
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
  async function like(clip: Clip, liked = !clip.episode.liked): Promise<boolean> {
    if (!user) {
      login();
      return false;
    }
    if (liked && clip.episode.liked) return true;
    try {
      const v = await post(`/episodes/${clip.episode.id}/like`, { liked });
      setClips((old) =>
        old.map((c) =>
          c.episode.id === clip.episode.id
            ? { ...c, episode: { ...c.episode, liked: v.liked, likes: v.likes } }
            : c,
        ),
      );
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  }
  // One-way follow: the author's next videos rank higher in "For you".
  async function follow(clip: Clip) {
    if (!user) {
      login();
      return;
    }
    const authorId = clip.season.owner_id!;
    try {
      const v = await post(`/authors/${authorId}/follow`, {
        following: !clip.season.owner_followed,
      });
      for (const [sid, season] of seasonCache.current)
        if (season.owner_id === authorId)
          seasonCache.current.set(sid, { ...season, owner_followed: v.following });
      setClips((old) =>
        old.map((c) =>
          c.season.owner_id === authorId
            ? { ...c, season: { ...c.season, owner_followed: v.following } }
            : c,
        ),
      );
      notify(
        v.following
          ? t(
              'Ты подписан: видео автора будут чаще в ленте',
              'Жазылдың: автор видеолары жиі шығады',
            )
          : t('Подписка отменена', 'Жазылым тоқтатылды'),
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const open = (kind: 'quiz' | 'record') => {
    if (!user) {
      setModal(null);
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
    // The personal selection has no daily plan to refresh.
    if (!id && user?.id && mode !== 'foryou') {
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
        {id ? (
          <div className="feed-topic-nav">
            <Link to="/" aria-label={t('Вернуться в ленту', 'Лентаға оралу')}>
              <ArrowLeft size={20} />
              <span>{t('Лента', 'Лента')}</span>
            </Link>
            <span>{t('Серии темы', 'Тақырып сериялары')}</span>
          </div>
        ) : (
          <div className="feed-tabs">
            <button
              className={!id && mode === 'foryou' ? 'active' : ''}
              onClick={() => navigate('/')}
            >
              {t('Для тебя', 'Саған')}
            </button>
            <button
              className={!id && mode === 'school' ? 'active' : ''}
              onClick={() => navigate('/?feed=today')}
            >
              {t('Сегодня', 'Бүгін')}
            </button>
          </div>
        )}
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
          <button
            className="feed-more"
            aria-label={t('Ещё действия', 'Басқа әрекеттер')}
            disabled={!current}
            onClick={() => setModal('more')}
          >
            <Ellipsis size={23} />
          </button>
        </div>
      </header>
      <State loading={loading} error={error} retry={reload}>
        {clips.length === 0 ? (
          <div className="empty-state">
            <h2>{t('Видео скоро появятся', 'Видеолар жақында қосылады')}</h2>
            <p>
              {t(
                'Авторы ещё не опубликовали объяснения по этим темам.',
                'Авторлар бұл тақырыптар бойынша әлі түсіндірме жарияламады.',
              )}
            </p>
          </div>
        ) : (
          <div className="feed-body">
            <div className="player-column">
              <div className="feed-session-label">
                <span className="live-dot" />
                {id
                  ? t('Твой сезон', 'Сенің маусымың')
                  : mode === 'foryou'
                    ? t('Подобрано для тебя', 'Саған іріктелді')
                    : sourceLabel}
                {!endless && (
                  <span>
                    {Math.min(active + 1, clips.length)} / {clips.length}
                  </span>
                )}
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
                  <div className="feed-slide" key={c.key || c.episode.id}>
                    <FeedVideo
                      clip={c}
                      onFollow={() => void follow(c)}
                      context={
                        c.reason ||
                        (today
                          ? `${sourceLabel}${today.class_name ? ` · ${today.class_name}` : ''}`
                          : undefined)
                      }
                      teacherSource={Boolean(
                        today && ['class', 'assignment'].includes(today.topic_source || ''),
                      )}
                      personal={Boolean(c.reason)}
                      active={i === active && !modal && !micro && !authOpen && !breakOpen}
                      muted={muted}
                      onEnded={() => {
                        const generation = feedGeneration.current;
                        void complete(c.episode).then(() => {
                          if (generation === feedGeneration.current) setMicro(c.episode);
                        });
                      }}
                      onQuiz={() => setModal('learn')}
                      onLike={() => like(c, true)}
                    />
                  </div>
                ))}
                {endless ? (
                  <div className="feed-slide feed-tail">
                    {feedDone ? (
                      <>
                        <div className="end-orbit">
                          <CheckCheck size={45} />
                        </div>
                        <h2>{t('Ты посмотрел все видео', 'Барлық видеоны көрдің')}</h2>
                        <p>
                          {t(
                            'Новые объяснения появятся, когда авторы их опубликуют.',
                            'Авторлар жариялағанда жаңа түсіндірмелер пайда болады.',
                          )}
                        </p>
                        <Link className="button primary full" to="/library">
                          {t('Выбрать тему в библиотеке', 'Кітапханадан тақырып таңдау')}
                          <ArrowRight size={17} />
                        </Link>
                      </>
                    ) : (
                      <>
                        <LoaderCircle size={32} className="spin" />
                        <p>{t('Подбираем ещё видео…', 'Тағы видео іріктеп жатырмыз…')}</p>
                      </>
                    )}
                  </div>
                ) : (
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
                    <button className="button secondary full" onClick={() => go(0)}>
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
                )}
              </div>
              <p className="feed-key-hint">
                {t('↑ ↓ — листать · пробел — пауза', '↑ ↓ — ауыстыру · бос орын — кідірту')}
              </p>
              <div className={`feed-actions ${atEnd ? 'hidden-actions' : ''}`}>
                <button
                  className="series-action"
                  onClick={() => setModal('chapters')}
                  aria-label="Содержание сезона"
                >
                  <span>
                    <SeriesIcon />
                  </span>
                  <small>{t('Сезон', 'Маусым')}</small>
                </button>
                <button
                  onClick={() => setModal('learn')}
                  aria-label={t('Проверить себя', 'Өзіңді тексер')}
                >
                  <span className="action-mint">
                    <CircleHelp size={27} />
                  </span>
                  <small>{t('Проверить себя', 'Өзіңді тексер')}</small>
                </button>
                <button
                  className="like-action"
                  onClick={() => current && void like(current)}
                  aria-label={current?.episode.liked ? 'Убрать лайк' : 'Нравится объяснение'}
                  aria-pressed={Boolean(current?.episode.liked)}
                >
                  <span className={current?.episode.liked ? 'action-liked' : ''}>
                    <Heart size={23} fill="currentColor" />
                  </span>
                  <small>{current?.episode.likes || t('Нравится', 'Ұнайды')}</small>
                </button>
                <button
                  className="sound-action"
                  onClick={() => setMuted(!muted)}
                  aria-pressed={!muted}
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
                {current.reason && <p className="daily-reason">{current.reason}</p>}
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
                      {testQuestions(current.season).length}{' '}
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
                        'Демонстрационный контент · требует проверки педагогом',
                        'Демонстрациялық мазмұн · педагог тексеруі қажет',
                      )
                    : current.season.owner_role === 'creator'
                      ? t(
                          'Автор платформы · проверено модератором',
                          'Платформа авторы · модератор тексерген',
                        )
                      : t('Материал проверен учителем', 'Материалды мұғалім тексерді')}
                </div>
              </aside>
            )}
          </div>
        )}
      </State>
      {current && modal === 'learn' && (
        <Modal title={t('Проверить себя', 'Өзіңді тексер')} onClose={() => setModal(null)}>
          <p className="muted">{current.season.title}</p>
          <div className="feed-choice-list">
            <button onClick={() => open('quiz')} aria-label="Пройти тест">
              <CircleHelp />
              <span>
                <b>{t('Пройти тест', 'Тест тапсыру')}</b>
                <small>
                  {t(
                    'Ответь на вопросы и разбери ошибки.',
                    'Сұрақтарға жауап беріп, қателерді талда.',
                  )}
                </small>
              </span>
              <ArrowRight size={19} />
            </button>
            <button onClick={() => open('record')} aria-label="Записать пересказ">
              <Mic />
              <span>
                <b>{t('Объяснить своими словами', 'Өз сөзіңмен түсіндір')}</b>
                <small>
                  {t(
                    'Голосом или текстом. По желанию или заданию учителя.',
                    'Дауыспен не мәтінмен. Қалауыңша немесе тапсырма бойынша.',
                  )}
                </small>
              </span>
              <ArrowRight size={19} />
            </button>
          </div>
        </Modal>
      )}
      {current && modal === 'more' && (
        <Modal
          title={t('Настройки и действия', 'Баптаулар мен әрекеттер')}
          onClose={() => setModal(null)}
        >
          <div className="feed-choice-list">
            <Link to="/profile#profile-learning" onClick={() => setModal(null)}>
              <SlidersHorizontal />
              <span>
                <b>{t('Настроить интересы', 'Қызығушылықтарды баптау')}</b>
                <small>
                  {t(
                    'Предметы и темы для ленты «Для тебя».',
                    '«Саған» лентасына арналған пәндер мен тақырыптар.',
                  )}
                </small>
              </span>
              <ArrowRight size={19} />
            </Link>
            <button onClick={() => setModal('notes')}>
              <BookOpen />
              <span>
                <b>{t('Конспект серии', 'Серия мәтіні')}</b>
              </span>
              <ArrowRight size={19} />
            </button>
            <button onClick={() => void share()} aria-label="Поделиться сезоном">
              <Forward />
              <span>
                <b>{t('Поделиться темой', 'Тақырыппен бөлісу')}</b>
              </span>
              <ArrowRight size={19} />
            </button>
            <button
              onClick={() => {
                if (user) setModal('report');
                else {
                  setModal(null);
                  login();
                }
              }}
              aria-label="Сообщить об ошибке"
            >
              <Flag />
              <span>
                <b>{t('Сообщить об ошибке', 'Қате туралы хабарлау')}</b>
              </span>
              <ArrowRight size={19} />
            </button>
          </div>
        </Modal>
      )}
      {breakOpen && (
        <Modal title={t('Время для паузы', 'Үзіліс уақыты')} onClose={closeBreak}>
          <p>
            {t(
              `Ты смотришь уже ${Math.round(watchedFor.current / 60)} мин. Можно отдохнуть или закрепить увиденное парой вопросов.`,
              `Сен ${Math.round(watchedFor.current / 60)} минут көріп отырсың. Демалуға немесе көргеніңді бекітуге болады.`,
            )}
          </p>
          <div className="feed-choice-list">
            <button
              onClick={() => {
                closeBreak();
                setModal('learn');
              }}
            >
              <CircleHelp />
              <span>
                <b>{t('Проверить себя', 'Өзіңді тексер')}</b>
                <small>{current?.season.title}</small>
              </span>
              <ArrowRight size={19} />
            </button>
            <Link to="/progress" onClick={closeBreak}>
              <Moon />
              <span>
                <b>{t('На сегодня хватит', 'Бүгінге жетеді')}</b>
                <small>{t('Посмотреть свой прогресс', 'Прогресіңді көру')}</small>
              </span>
              <ArrowRight size={19} />
            </Link>
          </div>
          <button className="text-button full" onClick={closeBreak}>
            {t('Смотреть дальше', 'Әрі қарай көру')}
          </button>
        </Modal>
      )}
      {micro && (
        <MicroQuestion
          route={!endless}
          key={micro.id}
          episode={micro}
          nextLabel={
            clips[active + 1]
              ? t(
                  `Дальше — ${clips[active + 1].episode.title}`,
                  `Келесі — ${clips[active + 1].episode.title}`,
                )
              : today && !sessionDone
                ? t(
                    'Дальше — итог сессии и что осталось повторить',
                    'Келесі — сессия қорытындысы және қайталау керек тұстар',
                  )
                : today?.next_step === 'continue'
                  ? t(
                      'Дальше — итог сессии и продолжение темы',
                      'Келесі — сессия қорытындысы және тақырыпты жалғастыру',
                    )
                  : today?.next_step === 'retelling'
                    ? t('Дальше — пересказ по желанию', 'Келесі — қалауыңша мазмұндау')
                    : today?.next_step === 'complete'
                      ? t('Дальше — твой прогресс', 'Келесі — сенің прогресің')
                      : t('Дальше — итоговый тест', 'Келесі — қорытынды тест')
          }
          onReplay={() => {
            const index =
              clips[active]?.episode.id === micro.id
                ? active
                : clips.findIndex((clip) => clip.episode.id === micro.id);
            const video = scroll.current?.querySelectorAll('video').item(index);
            if (video) video.currentTime = 0;
            setMicro(null);
            if (index >= 0) go(index);
          }}
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
      {current && modal === 'report' && (
        <ReportModal clip={current} onClose={() => setModal(null)} />
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
function SeriesIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3h10M6 6h16" />
      <rect x="4" y="10" width="20" height="15" rx="4" />
      <path d="m12 14 6 3.5-6 3.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function FeedVideo({
  clip,
  context,
  personal = false,
  teacherSource = false,
  active,
  muted,
  onEnded,
  onQuiz,
  onLike,
  onFollow,
}: {
  clip: Clip;
  context?: string;
  personal?: boolean;
  teacherSource?: boolean;
  active: boolean;
  muted: boolean;
  onEnded: () => void;
  onQuiz: () => void;
  onLike: () => Promise<boolean>;
  onFollow: () => void;
}) {
  const { t, user } = useApp();
  // Demo topics belong to the platform; an author's lesson always carries the author's name.
  const platform =
    clip.season.owner_role !== 'creator' && clip.season.source_name?.startsWith('Демонстрационные');
  const authorName = platform ? 'OylaTap' : clip.season.owner_name || 'OylaTap';
  const authorPage = !platform && clip.season.owner_id ? `/author/${clip.season.owner_id}` : null;
  const ref = useRef<HTMLVideoElement>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (!active) setBurst(0);
    return () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
    };
  }, [active]);
  const [paused, setPaused] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [failed, setFailed] = useState(false);
  // The furthest point watched; reported when the clip stops being the active one.
  const watched = useRef({ max: 0, sent: 0 });
  const report = useCallback(() => {
    const w = watched.current;
    if (!user || w.max - w.sent < 0.05) return;
    w.sent = w.max;
    void post(`/episodes/${clip.episode.id}/view`, { ratio: Math.min(1, w.max) }).catch(() => {});
  }, [user, clip.episode.id]);
  useEffect(() => {
    if (!active) report();
  }, [active, report]);
  useEffect(() => report, [report]);
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
          if (v.duration > 0)
            watched.current.max = Math.max(watched.current.max, v.currentTime / v.duration);
        }}
        onLoadedMetadata={(e) =>
          setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
        }
        onEnded={() => {
          watched.current.max = 1;
          report();
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
        onClick={(event) => {
          // Keyboard activation stays immediate; two touch/click taps only like.
          if (event.detail === 0) {
            if (tapTimer.current) clearTimeout(tapTimer.current);
            tapTimer.current = null;
            toggle();
          } else if (tapTimer.current) {
            clearTimeout(tapTimer.current);
            tapTimer.current = null;
            void onLike().then((ok) => {
              if (ok) setBurst((n) => n + 1);
            });
          } else {
            tapTimer.current = setTimeout(() => {
              tapTimer.current = null;
              toggle();
            }, 260);
          }
        }}
        aria-label={paused ? 'Воспроизвести' : 'Пауза'}
      >
        {paused && (
          <span>
            <Play size={36} fill="currentColor" />
          </span>
        )}
        {paused && (
          <small className="video-gesture-hint">
            {t('Двойной тап — лайк', 'Екі рет түрту — лайк')}
          </small>
        )}
      </button>
      {burst > 0 && active && (
        <div
          key={burst}
          className="video-heart-burst"
          aria-hidden="true"
          onAnimationEnd={() => setBurst(0)}
        >
          <Heart fill="currentColor" />
          <Sparkles />
        </div>
      )}
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
        {/* The session label above the player already names the source on wide screens;
            a personal reason is new information everywhere. */}
        {context && (
          <p
            className={`video-context ${teacherSource ? 'is-teacher' : personal ? 'is-reason' : 'is-source'}`}
          >
            {teacherSource && <BookOpen size={13} />}
            {personal && <Sparkles size={13} />}
            {context}
          </p>
        )}
        <div className="creator">
          {authorPage ? (
            <Link className="creator-link" to={authorPage}>
              <span className="creator-avatar">{authorName.slice(0, 1)}</span>
              <span>
                {authorName} {clip.season.owner_trust === 'trusted' && <CheckCheck size={16} />}
              </span>
            </Link>
          ) : (
            <>
              <span className="creator-avatar">{authorName.slice(0, 1)}</span>
              <span>{authorName}</span>
            </>
          )}
          {authorPage && clip.season.owner_id !== user?.id && (
            <button
              className={`follow-button ${clip.season.owner_followed ? 'following' : ''}`}
              aria-pressed={Boolean(clip.season.owner_followed)}
              onClick={onFollow}
            >
              {clip.season.owner_followed
                ? t('Вы подписаны', 'Жазылдыңыз')
                : t('Подписаться', 'Жазылу')}
            </button>
          )}
          <span className="video-language">
            {clip.season.language === 'kk' ? 'Қазақша' : 'Русский'}
          </span>
        </div>
        <Link to={`/learn/${clip.season.id}`} className="video-caption-link">
          <span>{clip.season.title}</span>
          <ArrowRight size={15} />
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
  const questions = testQuestions(season);
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
          <Link className="button secondary full" to={`/attempts/${result.id}`} onClick={onClose}>
            {t('Открыть сохранённый разбор', 'Сақталған талдауды ашу')} <ArrowRight size={17} />
          </Link>
          {result.score < result.total && (
            <Link
              className="text-button full"
              to={`/attempts/${result.id}/practice`}
              onClick={onClose}
            >
              {t('Повторить только ошибки', 'Тек қателерді қайталау')}
            </Link>
          )}
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
          {season.quiz_mode === 'legacy' && (
            <p className="inline-note">
              {t(
                'В этой теме пока используются вопросы серий. Это повторение прежнего формата, а не отдельный итоговый тест.',
                'Бұл тақырыпта әзірге серия сұрақтары қолданылады. Бұл бөлек қорытынды тест емес, бұрынғы форматтағы қайталау.',
              )}
            </p>
          )}
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
    [showFilters, setShowFilters] = useState(false),
    [subject, setSubject] = useState('all'),
    [lang, setLang] = useState('all'),
    [grade, setGrade] = useState('all');
  const filtered = (r.data || []).filter(
    (s) =>
      (subject === 'all' || s.subject === subject) &&
      (lang === 'all' || s.language === lang) &&
      (grade === 'all' || s.grade === Number(grade)) &&
      `${s.title} ${s.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const filterCount = Number(lang !== 'all') + Number(grade !== 'all');
  return (
    <div className="page library-page">
      <PageHeader
        eyebrow=""
        title={t('Библиотека', 'Кітапхана')}
        description={t('Выбери, в чём хочешь разобраться.', 'Қай тақырыпты түсінгің келеді?')}
      />
      <div className="library-toolbar">
        <div className="search-field" role="search">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Найти тему', 'Тақырыпты табу')}
            aria-label={t('Поиск сезонов', 'Маусымдарды іздеу')}
          />
          {search && (
            <button aria-label="Очистить поиск" onClick={() => setSearch('')}>
              <X size={16} />
            </button>
          )}
        </div>
        <button
          className="library-filter-toggle"
          aria-label={t('Фильтры', 'Сүзгілер')}
          aria-expanded={showFilters}
          aria-controls="library-filters"
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal size={19} />
          <span>{t('Фильтры', 'Сүзгілер')}</span>
          {filterCount > 0 && <b>{filterCount}</b>}
        </button>
      </div>
      <div id="library-filters" className="library-filter-fields" hidden={!showFilters}>
        <label>
          {t('Язык', 'Тіл')}
          <select aria-label="Язык контента" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="all">{t('Все языки', 'Барлық тілдер')}</option>
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
          </select>
        </label>
        <label>
          {t('Класс', 'Сынып')}
          <select aria-label="Класс" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="all">{t('Все классы', 'Барлық сыныптар')}</option>
            {[5, 6, 7, 8, 9, 10, 11].map((g) => (
              <option key={g} value={g}>
                {g} {t('класс', 'сынып')}
              </option>
            ))}
          </select>
        </label>
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
            <div className="section-label" aria-live="polite">
              {t('Темы', 'Тақырыптар')} · {filtered.length}
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
      (season.last_score ?? season.best_score) < 100,
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
        action={
          <Link className="button secondary" to="/attempts">
            <ListChecks size={17} />
            {t('История тестов', 'Тесттер тарихы')}
          </Link>
        }
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
                value={s.latest_test_average !== null ? `${s.latest_test_average}%` : '—'}
                label={t('Средний последний балл', 'Соңғы балдардың орташа мәні')}
              />
            </div>
            <p className="muted small metric-explanation">
              {t(
                'Для среднего берётся последняя попытка по каждой теме. Лучшие результаты показаны отдельно; упражнения по ошибкам их не меняют.',
                'Орташа мәнге әр тақырыптың соңғы талпынысы алынады. Үздік нәтижелер бөлек көрсетіледі; қате бойынша жаттығулар оларды өзгертпейді.',
              )}
            </p>
            {r.data.seasons.some((season: Season) => season.last_score !== null) && (
              <section className="panel score-trends">
                <h2>{t('Последний и лучший результат', 'Соңғы және үздік нәтиже')}</h2>
                {r.data.seasons
                  .filter((season: Season) => season.last_score !== null)
                  .map((season: Season) => (
                    <Link
                      className="score-trend"
                      key={season.id}
                      to={`/attempts?season_id=${season.id}`}
                    >
                      <strong>{season.title}</strong>
                      <span>
                        {t('Последний', 'Соңғы')}: {season.last_score}% · {t('Лучший', 'Үздік')}:{' '}
                        {season.best_score}%
                      </span>
                      {season.previous_score !== null && season.previous_score !== undefined && (
                        <small>
                          {t('Предыдущий', 'Алдыңғы')}: {season.previous_score}% ·{' '}
                          {t('Изменение', 'Өзгеріс')}:{' '}
                          {season.last_score! - season.previous_score > 0 ? '+' : ''}
                          {season.last_score! - season.previous_score} {t('п.п.', 'п.т.')}
                        </small>
                      )}
                      <span className="text-button">
                        {t('Посмотреть попытки', 'Талпыныстарды көру')} <ArrowRight size={15} />
                      </span>
                    </Link>
                  ))}
                <p className="muted small">
                  {t(
                    `Повторений ошибок: ${s.practices}. Это отдельная практика.`,
                    `Қателерді қайталау: ${s.practices}. Бұл бөлек жаттығу.`,
                  )}
                </p>
              </section>
            )}
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
    <div className="page profile-page">
      <header className="profile-hero">
        <div className="profile-hero-top">
          <span className="profile-avatar" aria-hidden="true">
            {user!.name.slice(0, 1)}
          </span>
          <div>
            <span className="profile-kicker">{t('МОЙ OYLATAP', 'МЕНІҢ OYLATAP')}</span>
            <h1>{user!.name}</h1>
            <p>
              {user?.role === 'student'
                ? t(`${user.grade} класс`, `${user.grade} сынып`)
                : user?.role === 'teacher'
                  ? t('Учитель', 'Мұғалім')
                  : t('Автор', 'Автор')}{' '}
              · {user?.language === 'kk' ? 'Қазақша' : 'Русский'}
            </p>
          </div>
        </div>
        <Link
          className="profile-progress-link"
          to={
            user?.role === 'teacher'
              ? '/results'
              : user?.role === 'creator'
                ? '/stats'
                : '/progress'
          }
        >
          <ChartNoAxesCombined size={19} />
          <span>
            {user?.role === 'student'
              ? t('Мой прогресс', 'Менің прогресім')
              : t('Результаты', 'Нәтижелер')}
          </span>
          <ArrowRight size={18} />
        </Link>
      </header>
      <nav className="profile-shortcuts" aria-label={t('Разделы профиля', 'Профиль бөлімдері')}>
        {user?.role === 'student' && (
          <a href="#profile-learning">
            <BookOpen size={17} />
            {t('Обучение', 'Оқу')}
          </a>
        )}
        <a href="#profile-settings">
          <UserRound size={17} />
          {t('Аккаунт', 'Аккаунт')}
        </a>
        <a href="#profile-records">
          <Mic size={17} />
          {t('Записи', 'Жазбалар')}
        </a>
      </nav>
      {user?.role === 'student' && <LearningPreferences />}
      <section className="panel appearance-panel">
        <Moon size={23} />
        <label>
          <span>
            <b>{t('Спокойное оформление', 'Жайлы безендіру')}</b>
            <small>{t('Мягкие цвета и меньше анимации.', 'Жұмсақ түстер және аз анимация.')}</small>
          </span>
          <input type="checkbox" checked={comfort} onChange={(e) => setComfort(e.target.checked)} />
        </label>
      </section>
      <div className="profile-grid">
        <details className="panel profile-account" id="profile-settings">
          <summary>
            <UserRound size={21} />
            <span>
              {t('Личные данные', 'Жеке деректер')}
              <small>{t('Имя, класс и язык', 'Аты, сынып және тіл')}</small>
            </span>
            <ChevronDown size={18} />
          </summary>
          <p className="profile-email">{user!.email}</p>
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
        </details>
        <section className="panel profile-records" id="profile-records">
          <div className="profile-section-title">
            <Mic size={21} />
            <h2>{t('Мои пересказы', 'Мазмұндауларым')}</h2>
            <span>{records.length}</span>
          </div>
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

const reportReasons = [
  ['mistake', 'Ошибка в объяснении', 'Түсіндірмеде қате бар'],
  ['unsafe', 'Небезопасно или обидно', 'Қауіпті немесе қорлайды'],
  ['spam', 'Реклама или спам', 'Жарнама немесе спам'],
  ['copyright', 'Чужой материал', 'Біреудің материалы'],
  ['other', 'Другое', 'Басқа'],
] as const;
function ReportModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const { t, notify } = useApp();
  const [reason, setReason] = useState<string>('mistake'),
    [comment, setComment] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={t('Что не так с роликом?', 'Видеода не дұрыс емес?')} onClose={onClose}>
      <p className="muted small">
        {clip.episode.title} ·{' '}
        {t(
          'Жалобу увидит модератор. Если жалоб несколько, ролик временно уйдёт из общей ленты.',
          'Шағымды модератор көреді.',
        )}
      </p>
      <div className="answer-options">
        {reportReasons.map(([key, ru, kk]) => (
          <button
            key={key}
            className={reason === key ? 'selected' : ''}
            onClick={() => setReason(key)}
          >
            {t(ru, kk)}
          </button>
        ))}
      </div>
      <label className="form-label">
        {t('Что именно? (необязательно)', 'Нақты не? (міндетті емес)')}
        <textarea
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('Например: на 0:12 неверная формула', 'Мысалы: 0:12-де формула қате')}
        />
      </label>
      {error && <p className="error-inline">{error}</p>}
      <button
        className="button primary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post(`/seasons/${clip.season.id}/report`, {
              reason,
              comment,
              episode_id: clip.episode.id,
            });
            notify(t('Спасибо! Модератор проверит.', 'Рахмет! Модератор тексереді.'));
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('Отправить', 'Жіберу')}
        <ArrowRight size={17} />
      </button>
    </Modal>
  );
}
