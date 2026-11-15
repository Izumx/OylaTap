import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Clock3, MonitorPlay, Sparkles, UsersRound } from 'lucide-react';
import { api, post, subjects, useApp, useResource } from './lib';
import { Modal, PageHeader, State } from './components';

export type HookSummary = {
  id: string;
  title: string;
  subject: string;
  grade: number;
  language: 'ru' | 'kk';
  topic_title_ru: string | null;
  topic_title_kk: string | null;
  episode_id: string;
  duration: number;
  prompt: string;
};
export type HookRunRow = {
  id: string;
  title: string;
  lesson_at: string;
  revealed_at: string | null;
  answered: number;
  students: number;
};
type ResultsRow = {
  name: string;
  watched_ratio: number | null;
  before_answer: number | null;
  confidence: number | null;
  reason: string | null;
  recheck_answer: number | null;
};
type Results = {
  summary: {
    students: number;
    watched: number;
    answered: number;
    before_correct: number;
    recheck_answered: number;
    recheck_correct: number;
  };
  students: ResultsRow[];
};

export const confidenceLabels: Record<number, [string, string]> = {
  1: ['наугад', 'кездейсоқ'],
  2: ['думаю, что так', 'солай ойлаймын'],
  3: ['уверен', 'сенімдімін'],
};
const pad = (n: number) => String(n).padStart(2, '0');
function tomorrow() {
  const d = new Date(Date.now() + 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function lessonTime(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LaunchHookModal({ classId, onClose, onLaunched }: { classId: string; onClose: () => void; onLaunched: () => void }) {
  const { t, locale, notify } = useApp();
  const hooks = useResource<HookSummary[]>('/hooks');
  const [chosen, setChosen] = useState(''),
    [date, setDate] = useState(tomorrow()),
    [time, setTime] = useState('09:00'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function launch() {
    if (!chosen) {
      setError(t('Выберите загадку', 'Жұмбақты таңдаңыз'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await post(`/classes/${classId}/hook-runs`, {
        season_id: chosen,
        lesson_at: new Date(`${date}T${time}`).toISOString(),
      });
      notify(t('Загадка отправлена классу', 'Жұмбақ сыныпқа жіберілді'));
      onLaunched();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Загадка к уроку', 'Сабаққа жұмбақ')} onClose={onClose} wide>
      <p className="muted">
        {t(
          'Ученики посмотрят серию и сделают ставку. Ответ вы раскроете на уроке.',
          'Оқушылар серияны көріп, болжам жасайды. Жауапты сабақта ашасыз.',
        )}
      </p>
      <State {...hooks} retry={hooks.reload}>
        <div className="hook-pick-list">
          {hooks.data?.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`hook-pick ${chosen === h.id ? 'chosen' : ''}`}
              aria-pressed={chosen === h.id}
              onClick={() => setChosen(h.id)}
            >
              <span className="hook-pick-check">{chosen === h.id ? <Check size={16} /> : <Sparkles size={16} />}</span>
              <span>
                <b>{h.title}</b>
                <small>
                  {(subjects[h.subject]?.[locale === 'kk' ? 1 : 0] || h.subject) + ` · ${h.grade} ${t('класс', 'сынып')}`}
                  {h.topic_title_ru ? ` · ${locale === 'kk' ? h.topic_title_kk || h.topic_title_ru : h.topic_title_ru}` : ''}
                  {` · ${h.duration} ${t('с', 'с')}`}
                </small>
              </span>
            </button>
          ))}
          {!hooks.data?.length && <p className="muted">{t('Загадок пока нет', 'Әзірге жұмбақ жоқ')}</p>}
        </div>
      </State>
      <div className="hook-when">
        <label className="form-label">
          {t('Дата урока', 'Сабақ күні')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="form-label">
          {t('Время урока', 'Сабақ уақыты')}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={busy} onClick={() => void launch()}>
        {t('Отправить классу', 'Сыныпқа жіберу')}
      </button>
    </Modal>
  );
}

export function HookRunsList({ classId }: { classId: string }) {
  const { t, locale } = useApp();
  const runs = useResource<HookRunRow[]>(`/classes/${classId}/hook-runs`);
  const [open, setOpen] = useState(false);
  return (
    <div className="hook-runs">
      <button className="button primary full" onClick={() => setOpen(true)}>
        <Sparkles size={17} />
        {t('Загадка к уроку', 'Сабаққа жұмбақ')}
      </button>
      {runs.data?.map((r) => (
        <div className="hook-run" key={r.id}>
          <div>
            <b>{r.title}</b>
            <small>
              <Clock3 size={13} /> {lessonTime(r.lesson_at, locale)} · {t('ответили', 'жауап берді')} {r.answered}/{r.students}
              {r.revealed_at ? ` · ${t('раскрыто', 'ашылды')}` : ''}
            </small>
          </div>
          <div className="hook-run-links">
            <Link to={`/classes/${classId}/hooks/${r.id}/screen`}>
              <MonitorPlay size={15} />
              {t('Экран класса', 'Сынып экраны')}
            </Link>
            <Link to={`/classes/${classId}/hooks/${r.id}`}>{t('Итоги', 'Қорытынды')}</Link>
          </div>
        </div>
      ))}
      {open && (
        <LaunchHookModal
          classId={classId}
          onClose={() => setOpen(false)}
          onLaunched={() => {
            setOpen(false);
            runs.reload();
          }}
        />
      )}
    </div>
  );
}

export function HookResultsPage() {
  const { classId = '', runId = '' } = useParams();
  const { t } = useApp();
  const r = useResource<Results>(`/hook-runs/${runId}/results`);
  const screen = useResource<{ prompt: string; options: string[]; correct: number | null }>(`/hook-runs/${runId}/screen`);
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const optionLabel = (i: number | null) => (i == null ? '—' : 'АБВГ'[i] || String(i + 1));
  return (
    <div className="page">
      <Link className="topic-back" to="/classes">
        <ArrowLeft size={17} />
        {t('Классы', 'Сыныптар')}
      </Link>
      <PageHeader eyebrow={t('ИТОГИ ЗАГАДКИ', 'ЖҰМБАҚ ҚОРЫТЫНДЫСЫ')} title={screen.data?.prompt || t('Загадка к уроку', 'Сабаққа жұмбақ')} />
      <State {...r} retry={r.reload}>
        {r.data && (
          <>
            <div className="hook-summary">
              <div className="panel">
                <UsersRound size={20} />
                <b>
                  {t('Ответили', 'Жауап берді')} {r.data.summary.answered} {t('из', '/')} {r.data.summary.students}
                </b>
                <small>
                  {t('посмотрели', 'көрді')} {r.data.summary.watched}
                </small>
              </div>
              <div className="panel">
                <b>{pct(r.data.summary.before_correct, r.data.summary.answered)}%</b>
                <small>{t('угадали до урока', 'сабаққа дейін тапты')}</small>
              </div>
              <div className="panel">
                <b>{r.data.summary.recheck_answered ? `${pct(r.data.summary.recheck_correct, r.data.summary.recheck_answered)}%` : '—'}</b>
                <small>{t('запомнили через 3 дня', '3 күннен кейін есте сақтады')}</small>
              </div>
            </div>
            <div className="panel hook-results">
              {r.data.students.map((s) => (
                <div className="hook-result-row" key={s.name + (s.before_answer ?? '')}>
                  <b>{s.name}</b>
                  <span>
                    {t('ставка', 'болжам')}: {optionLabel(s.before_answer)}
                    {s.confidence ? ` · ${t(...confidenceLabels[s.confidence])}` : ''}
                    {screen.data?.correct != null && s.before_answer != null
                      ? s.before_answer === screen.data.correct
                        ? ` · ${t('угадал', 'тапты')}`
                        : ` · ${t('не угадал', 'таппады')}`
                      : ''}
                  </span>
                  <span className="muted">{s.reason || ''}</span>
                  <span>
                    {t('повтор', 'қайталау')}: {optionLabel(s.recheck_answer)}
                  </span>
                </div>
              ))}
              {!r.data.students.length && <p className="muted">{t('В классе пока нет учеников', 'Сыныпта әзірге оқушы жоқ')}</p>}
            </div>
            <Link className="button secondary" to={`/classes/${classId}/hooks/${runId}/screen`}>
              <MonitorPlay size={16} />
              {t('Открыть экран класса', 'Сынып экранын ашу')}
            </Link>
          </>
        )}
      </State>
    </div>
  );
}

type ScreenState = {
  run_id: string;
  prompt: string;
  options: string[];
  answered: number;
  students: number;
  votes: number[] | null;
  confident: number | null;
  correct: number | null;
  explanation: string | null;
  join_code: string;
  revealed: boolean;
};

function JoinQr({ code }: { code: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const url = `${window.location.origin}/join/${code}`;
  useEffect(() => {
    if (ref.current)
      void QRCode.toCanvas(ref.current, url, { width: 168, margin: 1, color: { dark: '#0d130c', light: '#ffffff' } });
  }, [url]);
  return <canvas ref={ref} aria-label={`QR: ${url}`} role="img" />;
}

export function ClassScreenPage() {
  const { classId = '', runId = '' } = useParams();
  const { t } = useApp();
  const [s, setS] = useState<ScreenState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<ScreenState>(`/hook-runs/${runId}/screen`)
        .then((v) => {
          if (alive) {
            setS(v);
            setError('');
          }
        })
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [runId]);
  async function act(path: 'show-votes' | 'reveal' | 'restart') {
    if (path === 'restart' && !window.confirm(t('Стереть все ставки и начать заново?', 'Барлық болжамды өшіріп, қайта бастау керек пе?')))
      return;
    setBusy(true);
    try {
      setS(await post(`/hook-runs/${runId}/${path}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!s)
    return (
      <div className="class-screen">
        <State loading={!error} error={error || undefined}>
          {null}
        </State>
      </div>
    );
  const max = Math.max(1, ...(s.votes || [0]));
  const step = s.revealed ? 'restart' : s.votes ? 'reveal' : 'show-votes';
  return (
    <div className="class-screen">
      <header className="screen-top">
        <Link to="/classes" className="screen-exit">
          <ArrowLeft size={18} />
          {t('Классы', 'Сыныптар')}
        </Link>
        <span className="screen-brand">OylaTap · {t('Угадай до урока', 'Сабаққа дейін тап')}</span>
        <Link to={`/classes/${classId}/hooks/${runId}`} className="screen-exit">
          {t('Итоги', 'Қорытынды')}
        </Link>
      </header>
      <main className="screen-main">
        <section className="screen-question">
          <h1>{s.prompt}</h1>
          <div className="screen-answered" aria-live="polite">
            <span>
              {t('Ответили', 'Жауап берді')} {s.answered} {t('из', '/')} {s.students}
            </span>
            <span className="screen-dots" aria-hidden="true">
              {Array.from({ length: Math.min(s.students, 40) }, (_, i) => (
                <i key={i} className={i < s.answered ? 'on' : ''} />
              ))}
            </span>
          </div>
          <ol className="screen-options">
            {s.options.map((o, i) => (
              <li key={i} className={`screen-option ${s.correct === i ? 'correct' : ''} ${s.revealed && s.correct !== i ? 'dim' : ''}`}>
                <span className="screen-letter">{'АБВГ'[i] || i + 1}</span>
                <span className="screen-text">{o}</span>
                {s.votes && (
                  <>
                    <span className="screen-bar">
                      <i style={{ width: `${(100 * s.votes[i]) / max}%` }} />
                    </span>
                    <span className="screen-count">{s.votes[i]}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
          {s.votes && s.confident != null && (
            <p className="screen-confident">
              {t('уверенных', 'сенімді')}: {s.confident} {t('из', '/')} {s.answered}
            </p>
          )}
          {s.revealed && s.explanation && <p className="screen-explanation">{s.explanation}</p>}
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
        </section>
        <aside className="screen-side">
          <div className="screen-join">
            <JoinQr code={s.join_code} />
            <span>{t('Код класса', 'Сынып коды')}</span>
            <b>{s.join_code}</b>
            <small>{window.location.host}/join</small>
          </div>
          <button className={`button ${step === 'restart' ? 'secondary' : 'primary'} screen-action`} disabled={busy} onClick={() => void act(step)}>
            {step === 'show-votes' && t('Показать голоса', 'Дауыстарды көрсету')}
            {step === 'reveal' && t('Раскрыть ответ', 'Жауапты ашу')}
            {step === 'restart' && t('Начать заново', 'Қайта бастау')}
          </button>
        </aside>
      </main>
    </div>
  );
}
