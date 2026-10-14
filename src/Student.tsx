import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
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
} from './lib';
import { Modal, State, PageHeader, SeasonArt, SeasonCard } from './components';

type Clip = { season: Season; episode: Episode };
export function Feed() {
  const { id } = useParams();
  const loc = useLocation();
  const { user, t, locale, notify, login } = useApp();
  const [clips, setClips] = useState<Clip[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [active, setActive] = useState(0),
    [muted, setMuted] = useState(true),
    [modal, setModal] = useState<'quiz' | 'record' | 'chapters' | 'notes' | null>(null),
    [version, setVersion] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const reload = () => setVersion((v) => v + 1);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      const list: Season[] = id ? [await api(`/seasons/${id}`)] : await api('/catalog');
      const all = id ? list : await Promise.all(list.map((s) => api<Season>(`/seasons/${s.id}`)));
      if (alive) {
        setClips(
          all.flatMap((season) => (season.episodes || []).map((episode) => ({ season, episode }))),
        );
        setActive(0);
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
    };
  }, [id, user?.id, version]);
  const current = clips[active];
  const go = useCallback(
    (n: number) => {
      const el = scroll.current;
      if (!el) return;
      el.scrollTo({
        top: Math.max(0, Math.min(n, clips.length - 1)) * el.clientHeight,
        behavior: 'smooth',
      });
    },
    [clips.length],
  );
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
    if (!user || episode.completed) return;
    try {
      await post(`/episodes/${episode.id}/complete`);
      setClips((old) =>
        old.map((c) =>
          c.episode.id === episode.id ? { ...c, episode: { ...c.episode, completed: true } } : c,
        ),
      );
      notify(
        t('Серия просмотрена. Теперь проверь понимание!', 'Серия аяқталды. Түсінгеніңді тексер!'),
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
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
    <div className="feed-page">
      <header className="feed-top">
        <div className="feed-tabs">
          <Link to="/" className={!id ? 'active' : ''}>
            {t('Для тебя', 'Сен үшін')}
          </Link>
          <Link to="/assignments">{t('От учителя', 'Мұғалімнен')}</Link>
          {id && <span className="active">{t('Сезон', 'Маусым')}</span>}
        </div>
        <Link className="feed-search" to="/library" aria-label="Найти сезон">
          <Search size={20} />
        </Link>
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
              <div
                className="feed-scroll"
                ref={scroll}
                onScroll={() => {
                  const el = scroll.current;
                  if (el)
                    setActive(
                      Math.min(clips.length - 1, Math.round(el.scrollTop / el.clientHeight)),
                    );
                }}
                aria-label="Вертикальная лента. Листайте вверх или вниз."
              >
                {clips.map((c, i) => (
                  <div className="feed-slide" key={c.episode.id}>
                    <FeedVideo
                      clip={c}
                      active={i === active}
                      muted={muted}
                      onEnded={() => void complete(c.episode)}
                      onQuiz={() => open('quiz')}
                    />
                  </div>
                ))}
              </div>
              <div className="feed-actions">
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
                  disabled={active === clips.length - 1}
                  onClick={() => go(active + 1)}
                >
                  <ChevronDown size={26} />
                </button>
              </div>
            </div>
            {current && (
              <aside className="season-panel">
                <div className="eyebrow">
                  {t('МАЛЕНЬКИЕ СЕРИИ. БОЛЬШИЕ ОТКРЫТИЯ.', 'ШАҒЫН СЕРИЯЛАР. ҮЛКЕН ЖАҢАЛЫҚТАР.')}
                </div>
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
                    {current.episode.position + 1}/{current.season.episodes!.length}
                  </span>
                </div>
                <div className="chapter-list">
                  {current.season.episodes!.map((ep, i) => (
                    <button
                      key={ep.id}
                      className={ep.id === current.episode.id ? 'active' : ''}
                      onClick={() => go(clips.findIndex((c) => c.episode.id === ep.id))}
                    >
                      <span className="chapter-number">
                        {clips.find((c) => c.episode.id === ep.id)?.episode.completed ? (
                          <Check size={16} />
                        ) : (
                          String(i + 1).padStart(2, '0')
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
                  {t('Демонстрационный контент · без озвучки', 'Демонстрациялық мазмұн · дыбыссыз')}
                </div>
              </aside>
            )}
          </div>
        )}
      </State>
      {current && modal === 'chapters' && (
        <Modal title={current.season.title} onClose={() => setModal(null)}>
          <p className="muted">{current.season.description}</p>
          <div className="chapter-list">
            {current.season.episodes!.map((ep, i) => (
              <button
                key={ep.id}
                onClick={() => {
                  go(clips.findIndex((c) => c.episode.id === ep.id));
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
          onClose={() => setModal(null)}
          onRecord={() => setModal('record')}
        />
      )}
      {current && modal === 'record' && (
        <Recorder season={current.season} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={16} />;
}
function FeedVideo({
  clip,
  active,
  muted,
  onEnded,
  onQuiz,
}: {
  clip: Clip;
  active: boolean;
  muted: boolean;
  onEnded: () => void;
  onQuiz: () => void;
}) {
  const { t } = useApp();
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false),
    [pct, setPct] = useState(0),
    [failed, setFailed] = useState(false);
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
          setPct(v.duration ? (v.currentTime / v.duration) * 100 : 0);
        }}
        onEnded={() => {
          onEnded();
          setPaused(true);
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        aria-label={clip.episode.title}
      />
      <div className="video-top">
        <Link className="subject-badge" to="/library">
          {t('УЧИСЬ В СВОЁМ ТЕМПЕ', 'ӨЗ ҚАРҚЫНЫҢМЕН')}
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
        <Link to={`/watch/${clip.season.id}`} className="video-season-link">
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
      <div className="video-progress">
        <i style={{ width: `${pct}%` }} />
      </div>
    </article>
  );
}

function Quiz({
  season,
  onClose,
  onRecord,
}: {
  season: Season;
  onClose: () => void;
  onRecord: () => void;
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
            {result.results.map((r: any, i: number) => (
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
              </div>
            ))}
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
function Recorder({ season, onClose }: { season: Season; onClose: () => void }) {
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
                <Link className="assignment-card" key={a.id} to={`/watch/${a.season_id}`}>
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
  const { t, user, refresh, notify, demo, setLocale } = useApp();
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
