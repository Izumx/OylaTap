import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  Check,
  Upload,
  FileText,
  Clapperboard,
  BookOpen,
  UsersRound,
  Copy,
  Eye,
  Trash2,
  LoaderCircle,
  RefreshCw,
  Play,
  CheckCheck,
  CalendarDays,
} from 'lucide-react';
import { api, post, useApp, useResource, subjects, statusLabels, type Season } from './lib';
import { PageHeader, State, SeasonCard, Modal } from './components';
import type { ResultRow } from './report-types';

export function StudioPage() {
  const r = useResource<Season[]>('/my-seasons');
  const { t, user } = useApp();
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('СТУДИЯ УЧИТЕЛЯ', 'МҰҒАЛІМ СТУДИЯСЫ')}
        title={t(
          `${user!.name.split(' ')[0]}, история начинается с вас`,
          `${user!.name.split(' ')[0]}, оқиға сізден басталады`,
        )}
        description={t(
          'Ваш материал, ваш сценарий, ваше последнее слово перед публикацией.',
          'Сіздің материал, сценарий және жариялау алдындағы шешіміңіз.',
        )}
        action={
          <Link className="button primary" to="/studio/new">
            <Plus size={18} />
            {t('Создать сезон', 'Маусым жасау')}
          </Link>
        }
      />
      <div className="studio-intro">
        <span className="studio-intro-icon">
          <Clapperboard size={32} />
        </span>
        <div>
          <h2>{t('От материала до «я понял!»', 'Материалдан «түсіндім!» дегенге дейін')}</h2>
          <p>
            {t(
              'Загрузите конспект, соберите серии и добавьте видео из Flow. Можно начать с простых карточек с субтитрами.',
              'Конспект жүктеп, серияларды жинап, Flow видеосын қосыңыз. Субтитрлі карточкалардан бастауға болады.',
            )}
          </p>
        </div>
        <Link to="/studio/new">
          <ArrowRight size={24} />
        </Link>
      </div>
      <div className="section-heading">
        <h2>{t('Мои сезоны', 'Менің маусымдарым')}</h2>
        <span className="muted">
          {r.data?.length || 0} {t('сезонов', 'маусым')}
        </span>
      </div>
      <State {...r} retry={r.reload}>
        {r.data?.length ? (
          <div className="season-grid">
            {r.data.map((s) => (
              <SeasonCard key={s.id} season={s} studio />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Clapperboard size={38} />
            <h2>{t('Создадим первый сезон?', 'Алғашқы маусымды жасаймыз ба?')}</h2>
            <p>{t('Подойдёт текст, конспект или PDF.', 'Мәтін, конспект немесе PDF жарайды.')}</p>
            <Link className="button primary" to="/studio/new">
              {t('Начать', 'Бастау')}
              <Plus size={18} />
            </Link>
          </div>
        )}
      </State>
    </div>
  );
}
type DraftEpisode = { id?: string; title: string; script: string; has_video?: boolean };
type DraftQuestion = {
  purpose?: 'micro' | 'final';
  episode_position?: number;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
};
type Draft = {
  title: string;
  description: string;
  subject: string;
  language: string;
  grade: number;
  source_text: string;
  source_name: string;
  episodes: DraftEpisode[];
  questions: DraftQuestion[];
};
const empty = (): Draft => ({
  title: '',
  description: '',
  subject: 'kz-history',
  language: 'ru',
  grade: 7,
  source_text: '',
  source_name: 'Материал учителя',
  episodes: [],
  questions: [],
});
export function EditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, locale, notify } = useApp();
  const r = useResource<Season>(id ? `/seasons/${id}` : null);
  const ai = useResource<{ draft_enabled: boolean }>('/ai/status');
  const [suggested, setSuggested] = useState<{
    episodes: DraftEpisode[];
    questions: DraftQuestion[];
  } | null>(null);
  const [draft, setDraft] = useState<Draft>(empty),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [visibility, setVisibility] = useState('class'),
    [confirm, setConfirm] = useState(false),
    [preview, setPreview] = useState<DraftEpisode | null>(null),
    [assign, setAssign] = useState(false);
  useEffect(() => {
    if (r.data) {
      const s = r.data;
      setDraft({
        title: s.title,
        description: s.description,
        subject: s.subject,
        language: s.language,
        grade: s.grade,
        source_text: s.source_text || '',
        source_name: s.source_name,
        episodes: s.episodes || [],
        questions: (s.questions || []).map((q) => ({
          ...q,
          episode_position: q.episode_position ?? 0,
          correct: q.correct ?? 0,
          explanation: q.explanation || '',
        })),
      });
    }
  }, [r.data]);
  useEffect(() => {
    if (!id) setDraft(empty());
  }, [id]);
  useEffect(() => {
    if (r.data?.status !== 'rendering') return;
    const timer = setInterval(r.reload, 2500);
    return () => clearInterval(timer);
  }, [r.data?.status, r.reload]);
  const status = r.data?.status || 'draft';
  const locked = ['published', 'rendering'].includes(status);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  async function save(): Promise<string | null> {
    setBusy(true);
    setError('');
    try {
      const v = await api(id ? `/seasons/${id}` : '/seasons', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(draft),
      });
      if (!id) nav(`/studio/${v.id}`, { replace: true });
      else r.reload();
      notify(t('Черновик сохранён', 'Жоба сақталды'));
      return v.id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function split() {
    setError('');
    const words = draft.source_text.trim().split(/\s+/);
    if (words.length < 8) {
      setError(
        t(
          'Добавьте материал: хотя бы несколько предложений.',
          'Бірнеше сөйлемнен тұратын материал қосыңыз.',
        ),
      );
      return;
    }
    const pieces: string[] = [];
    let part = '';
    for (const word of words) {
      if ((part + ' ' + word).length > 420 && part) {
        pieces.push(part);
        part = word;
      } else part = (part + ' ' + word).trim();
    }
    if (part) pieces.push(part);
    if (pieces.length > 10) {
      setError(
        t(
          'Для первого сезона выберите фрагмент до 4 000 символов. Полный материал не удалён.',
          'Алғашқы маусымға 4 000 таңбаға дейінгі үзінді таңдаңыз.',
        ),
      );
      return;
    }
    if (pieces.some((p) => p.length > 500)) {
      setError('В материале есть слишком длинное слово или ссылка. Сократите текст.');
      return;
    }
    set(
      'episodes',
      pieces.map((script, i) => ({ title: `${t('Серия', 'Серия')} ${i + 1}`, script })),
    );
    setStep(1);
  }
  async function uploadVideo(ep: DraftEpisode, file: File) {
    if (!id || !ep.id) {
      setError(t('Сначала сохраните черновик.', 'Алдымен жобаны сақтаңыз.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = new FormData();
      f.append('file', file);
      await api(`/seasons/${id}/episodes/${ep.id}/video`, { method: 'POST', body: f });
      r.reload();
      notify(t('Видео добавлено', 'Видео қосылды'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const steps = [
    t('Материал', 'Материал'),
    t('Сценарий и тест', 'Сценарий және тест'),
    t('Видео и публикация', 'Видео және жариялау'),
  ];
  return (
    <div className="page editor-page">
      <Link className="back-link" to="/studio">
        <ArrowLeft size={17} />
        {t('Мои сезоны', 'Маусымдарым')}
      </Link>
      <PageHeader
        eyebrow={t('ОТ ИДЕИ К ПОНИМАНИЮ', 'ИДЕЯДАН ТҮСІНУГЕ')}
        title={draft.title || t('Новый учебный сезон', 'Жаңа оқу маусымы')}
        action={
          <div className="header-actions">
            <span className={`status ${status}`}>{statusLabels[status]}</span>
            {!locked && (
              <button
                className="button secondary"
                disabled={busy || !draft.episodes.length}
                onClick={() => void save()}
              >
                <Check size={17} />
                {t('Сохранить', 'Сақтау')}
              </button>
            )}
            {status === 'published' && (
              <button className="button primary" onClick={() => setAssign(true)}>
                <UsersRound size={17} />
                {t('Назначить классу', 'Сыныпқа беру')}
              </button>
            )}
          </div>
        }
      />
      <div className="editor-steps">
        {steps.map((label, i) => (
          <button key={i} className={step === i ? 'active' : ''} onClick={() => setStep(i)}>
            <span>{i + 1}</span>
            <b>{label}</b>
            {i < 2 && <ArrowRight size={16} />}
          </button>
        ))}
      </div>
      {error && (
        <div className="error-inline" role="alert">
          {error}
        </div>
      )}
      <State loading={id ? r.loading : false} error={r.error} retry={r.reload}>
        {step === 0 && (
          <div className="editor-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('О чём ваш сезон?', 'Маусым не туралы?')}</h2>
                <FileText size={21} />
              </div>
              <fieldset disabled={locked || busy} className="form-stack">
                <label>
                  {t('Название сезона', 'Маусым атауы')}
                  <input
                    value={draft.title}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder="Казахское ханство: почему всё изменилось"
                    maxLength={100}
                  />
                </label>
                <label>
                  {t('Чему научится ученик?', 'Оқушы нені үйренеді?')}
                  <textarea
                    value={draft.description}
                    onChange={(e) => set('description', e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder={t(
                      'Коротко опишите цель — ученик увидит её перед просмотром.',
                      'Мақсатын қысқаша жазыңыз.',
                    )}
                  />
                </label>
                <label>
                  {t('Предмет', 'Пән')}
                  <select value={draft.subject} onChange={(e) => set('subject', e.target.value)}>
                    {Object.entries(subjects).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v[locale === 'kk' ? 1 : 0]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    {t('Язык сезона', 'Маусым тілі')}
                    <select
                      value={draft.language}
                      onChange={(e) => set('language', e.target.value)}
                    >
                      <option value="ru">Русский</option>
                      <option value="kk">Қазақша</option>
                    </select>
                  </label>
                  <label>
                    {t('Класс', 'Сынып')}
                    <select
                      value={draft.grade}
                      onChange={(e) => set('grade', Number(e.target.value))}
                    >
                      {[5, 6, 7, 8, 9, 10, 11].map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
            </section>
            <section className="panel">
              <h2>{t('Исходный материал', 'Бастапқы материал')}</h2>
              <p className="muted small">
                {t(
                  'Используйте материалы, на которые у вас есть права. PDF с текстом, TXT или MD — до 10 МБ.',
                  'Пайдалануға құқығыңыз бар материалды қосыңыз. PDF, TXT немесе MD — 10 МБ дейін.',
                )}
              </p>
              <fieldset disabled={locked || busy}>
                <label className="upload-zone">
                  <Upload size={28} />
                  <b>{t('Добавить файл', 'Файл қосу')}</b>
                  <span>PDF, TXT, MD</span>
                  <input
                    type="file"
                    accept=".pdf,.txt,.md"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      setError('');
                      try {
                        const f = new FormData();
                        f.append('file', file);
                        const v = await api('/material/extract', { method: 'POST', body: f });
                        setDraft((d) => ({ ...d, source_text: v.text, source_name: v.name }));
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
                <label className="form-label">
                  {t('Или вставьте текст', 'Немесе мәтінді қосыңыз')}
                  <textarea
                    value={draft.source_text}
                    onChange={(e) => set('source_text', e.target.value)}
                    rows={9}
                    maxLength={60000}
                    placeholder={t(
                      'Ваш конспект, учебная цель и важные факты…',
                      'Конспект, оқу мақсаты және маңызды деректер…',
                    )}
                  />
                </label>
                <div className="character-count">{draft.source_text.length}/60 000</div>
              </fieldset>
              <div className="inline-note small">
                <FileText size={18} />
                {t(
                  'Сейчас используется разбиение текста на редактируемые серии. Генерация сценария ИИ ещё не подключена.',
                  'Қазір мәтін өңделетін серияларға бөлінеді. ЖИ сценарийі әлі қосылмаған.',
                )}
              </div>
              <button
                className="button secondary full"
                disabled={locked || busy || !ai.data?.draft_enabled}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    setSuggested(
                      await post('/material/draft', {
                        source_text: draft.source_text,
                        title: draft.title,
                        language: draft.language,
                        grade: draft.grade,
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    <Clapperboard size={18} />
                    {t('Предложить ИИ-черновик', 'ЖИ жобасын ұсыну')}
                  </>
                )}
              </button>
              <p className="muted small ai-note">
                {ai.data?.draft_enabled
                  ? t(
                      'Локальная модель подключена. Ответ займёт некоторое время; материал остаётся в редакторе.',
                      'Жергілікті модель қосылған.',
                    )
                  : t(
                      'ИИ-черновик станет доступен после подключения Ollama. Сейчас можно подготовить серии из своего текста.',
                      'ЖИ жобасы Ollama қосылғаннан кейін қолжетімді.',
                    )}
              </p>
              <button className="button primary full" disabled={locked || busy} onClick={split}>
                {t('Подготовить серии', 'Серияларды дайындау')}
                <ArrowRight size={18} />
              </button>
            </section>
          </div>
        )}
        {step === 1 && (
          <>
            <div className="section-heading">
              <div>
                <h2>{t('Один эпизод — одна мысль', 'Бір эпизод — бір ой')}</h2>
                <p className="muted">
                  {t(
                    'Проверьте факты и сделайте текст удобным для чтения. До 500 символов на серию.',
                    'Деректерді тексеріңіз. Әр серияға 500 таңбаға дейін.',
                  )}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={locked || draft.episodes.length >= 10}
                onClick={() => set('episodes', [...draft.episodes, { title: '', script: '' }])}
              >
                <Plus size={17} />
                {t('Серия', 'Серия')}
              </button>
            </div>
            <div className="episode-editor-list">
              {draft.episodes.map((ep, i) => (
                <section className="panel episode-editor" key={ep.id || i}>
                  <span className="episode-index">{String(i + 1).padStart(2, '0')}</span>
                  <fieldset disabled={locked || busy} className="form-stack">
                    <label>
                      {t('Название серии', 'Серия атауы')}
                      <input
                        value={ep.title}
                        onChange={(e) =>
                          set(
                            'episodes',
                            draft.episodes.map((x, j) =>
                              j === i ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                        maxLength={100}
                      />
                    </label>
                    <label>
                      {t('Текст и субтитры', 'Мәтін және субтитрлер')}
                      <textarea
                        value={ep.script}
                        onChange={(e) =>
                          set(
                            'episodes',
                            draft.episodes.map((x, j) =>
                              j === i ? { ...x, script: e.target.value } : x,
                            ),
                          )
                        }
                        rows={4}
                        maxLength={500}
                      />
                    </label>
                    <small className="muted">{ep.script.length}/500</small>
                  </fieldset>
                  {!locked && (
                    <button
                      className="icon-button danger"
                      aria-label={`Удалить серию ${i + 1}`}
                      onClick={() =>
                        set(
                          'episodes',
                          draft.episodes.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </section>
              ))}
            </div>
            <div className="section-heading question-section-heading">
              <div>
                <h2>{t('Вопросы на понимание', 'Түсінуге арналған сұрақтар')}</h2>
                <p className="muted">
                  {t(
                    'Микровопрос — после серии. Для итогового теста добавьте другие вопросы с объяснениями и связанной серией.',
                    'Микросұрақ сериядан кейін беріледі. Қорытынды тестке түсіндірмесі және байланысты сериясы бар басқа сұрақтар қосыңыз.',
                  )}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={locked || draft.questions.length >= 25}
                onClick={() =>
                  set('questions', [
                    ...draft.questions,
                    {
                      purpose: 'micro',
                      prompt: '',
                      options: ['', '', ''],
                      correct: 0,
                      explanation: '',
                    },
                  ])
                }
              >
                <Plus size={17} />
                {t('Микровопрос', 'Микросұрақ')}
              </button>
              <button
                className="button secondary"
                disabled={
                  locked ||
                  draft.questions.length >= 25 ||
                  draft.questions.filter((q) => q.purpose === 'final').length >= 15
                }
                onClick={() =>
                  set('questions', [
                    ...draft.questions,
                    {
                      purpose: 'final',
                      prompt: '',
                      options: ['', '', ''],
                      correct: 0,
                      explanation: '',
                    },
                  ])
                }
              >
                <Plus size={17} />
                {t('Итоговый вопрос', 'Қорытынды сұрақ')}
              </button>
            </div>
            {draft.questions.map((q, i) => (
              <section className="panel question-editor" key={i}>
                <div className="panel-heading">
                  <h3>
                    {q.purpose === 'final'
                      ? t('Итоговый вопрос', 'Қорытынды сұрақ')
                      : t('Микровопрос', 'Микросұрақ')}{' '}
                    {i + 1}
                  </h3>
                  {!locked && (
                    <button
                      className="icon-button danger"
                      aria-label={`Удалить вопрос ${i + 1}`}
                      onClick={() =>
                        set(
                          'questions',
                          draft.questions.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
                <fieldset disabled={locked || busy} className="form-stack">
                  <label>
                    {t('Назначение вопроса', 'Сұрақтың мақсаты')}
                    <select
                      value={q.purpose || 'micro'}
                      onChange={(e) =>
                        set(
                          'questions',
                          draft.questions.map((x, j) =>
                            j === i ? { ...x, purpose: e.target.value as 'micro' | 'final' } : x,
                          ),
                        )
                      }
                    >
                      <option value="micro">
                        {t('Микровопрос после серии', 'Сериядан кейінгі микросұрақ')}
                      </option>
                      <option value="final">{t('Итоговый тест', 'Қорытынды тест')}</option>
                    </select>
                  </label>
                  <label>
                    {t('Формулировка', 'Сұрақ мәтіні')}
                    <input
                      value={q.prompt}
                      onChange={(e) =>
                        set(
                          'questions',
                          draft.questions.map((x, j) =>
                            j === i ? { ...x, prompt: e.target.value } : x,
                          ),
                        )
                      }
                      maxLength={300}
                    />
                  </label>
                  <div className="question-option-grid">
                    {q.options.map((opt, k) => (
                      <label key={k}>
                        {String.fromCharCode(65 + k)}
                        <input
                          value={opt}
                          onChange={(e) =>
                            set(
                              'questions',
                              draft.questions.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      options: x.options.map((o, n) =>
                                        n === k ? e.target.value : o,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                          maxLength={200}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    {t('После какой серии?', 'Қай сериядан кейін?')}
                    <select
                      aria-label={t('После какой серии?', 'Қай сериядан кейін?')}
                      value={q.episode_position ?? 0}
                      onChange={(e) =>
                        set(
                          'questions',
                          draft.questions.map((x, j) =>
                            j === i ? { ...x, episode_position: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    >
                      {draft.episodes.map((ep, n) => (
                        <option key={n} value={n}>
                          {n + 1}. {ep.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Правильный ответ', 'Дұрыс жауап')}
                    <select
                      aria-label={t('Правильный ответ', 'Дұрыс жауап')}
                      value={q.correct}
                      onChange={(e) =>
                        set(
                          'questions',
                          draft.questions.map((x, j) =>
                            j === i ? { ...x, correct: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    >
                      {q.options.map((_, k) => (
                        <option key={k} value={k}>
                          {String.fromCharCode(65 + k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Объяснение после ответа', 'Жауаптан кейінгі түсіндірме')}
                    <textarea
                      value={q.explanation}
                      onChange={(e) =>
                        set(
                          'questions',
                          draft.questions.map((x, j) =>
                            j === i ? { ...x, explanation: e.target.value } : x,
                          ),
                        )
                      }
                      maxLength={500}
                      rows={2}
                    />
                  </label>
                </fieldset>
              </section>
            ))}
            {!draft.questions.length && (
              <div className="inline-note">
                {t(
                  'Вопросов пока нет. Добавьте их перед публикацией сезона.',
                  'Сұрақтар әлі жоқ. Жариялау алдында қосыңыз.',
                )}
              </div>
            )}
            <div className="editor-footer">
              <button className="button secondary" onClick={() => setStep(0)}>
                <ArrowLeft size={17} />
                {t('Материал', 'Материал')}
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  if (locked || (await save())) setStep(2);
                }}
              >
                {t('К видео', 'Видеоға')}
                <ArrowRight size={18} />
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <section className="panel video-production">
              <div>
                <span className="eyebrow">{t('ВЫБЕРИТЕ СПОСОБ', 'ТӘСІЛДІ ТАҢДАҢЫЗ')}</span>
                <h2>
                  {t('Ролики из Flow или учебные карточки', 'Flow видеосы немесе оқу карточкалары')}
                </h2>
                <p className="muted">
                  {t(
                    'Из Google Flow загрузите MP4 для каждой серии. Для проверки сценария можно собрать вертикальные видео с читаемым текстом, без озвучки.',
                    'Google Flow-дан әр серияның MP4 файлын қосыңыз. Сценарийді тексеру үшін дыбыссыз мәтін видеосын жинауға болады.',
                  )}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={locked || busy || !draft.episodes.length}
                onClick={async () => {
                  const saved = await save();
                  if (!saved) return;
                  setBusy(true);
                  try {
                    await post(`/seasons/${saved}/render`);
                    r.reload();
                    notify(
                      t(
                        'Сборка идёт в фоне. Сценарий сохранён.',
                        'Жинақтау фонда жүреді. Сценарий сақталды.',
                      ),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Clapperboard size={19} />
                {t('Собрать карточки', 'Карточкаларды жинау')}
              </button>
            </section>
            {status === 'rendering' && (
              <div className="render-status">
                <LoaderCircle className="spin" size={24} />
                <div>
                  <b>{t('Собираем серии в фоне', 'Сериялар фонда жиналуда')}</b>
                  <p>
                    {t(
                      'Можно вернуться в студию. Правки сохранены.',
                      'Студияға оралуға болады. Өзгерістер сақталды.',
                    )}
                  </p>
                </div>
              </div>
            )}
            {r.data?.render_error && <div className="error-inline">{r.data.render_error}</div>}
            <div className="video-episode-grid">
              {draft.episodes.map((ep, i) => (
                <section className="panel video-episode" key={ep.id || i}>
                  <div className="panel-heading">
                    <span className={`status ${ep.has_video ? 'published' : 'draft'}`}>
                      {ep.has_video
                        ? t('Видео готово', 'Видео дайын')
                        : t('Видео не добавлено', 'Видео қосылмаған')}
                    </span>
                    <span className="muted">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3>{ep.title}</h3>
                  <p>{ep.script}</p>
                  {ep.has_video && (
                    <button className="button secondary full" onClick={() => setPreview(ep)}>
                      <Eye size={17} />
                      {t('Посмотреть серию', 'Серияны көру')}
                    </button>
                  )}
                  {!locked && (
                    <label className="button secondary upload-button">
                      <Upload size={16} />
                      {t('Загрузить MP4', 'MP4 жүктеу')}
                      <input
                        disabled={busy}
                        type="file"
                        accept="video/mp4,.mp4"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadVideo(ep, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </section>
              ))}
            </div>
            {status !== 'published' && (
              <section className="panel publication-panel">
                <CheckCheck size={30} />
                <div>
                  <h2>{t('Последнее слово — за учителем', 'Соңғы шешім — мұғалімдікі')}</h2>
                  <p>
                    {t(
                      'Проверьте каждую серию, факты, субтитры и правильные ответы перед публикацией.',
                      'Әр серияны, деректі, субтитрді және дұрыс жауаптарды тексеріңіз.',
                    )}
                  </p>
                  <label className="form-label visibility-label">
                    {t('Кто увидит сезон', 'Маусымды кім көреді')}
                    <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                      <option value="class">
                        {t('Только назначенные классы', 'Тек берілген сыныптар')}
                      </option>
                      <option value="public">
                        {t('Все пользователи библиотеки', 'Кітапхананың барлық пайдаланушылары')}
                      </option>
                    </select>
                  </label>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={confirm}
                      onChange={(e) => setConfirm(e.target.checked)}
                    />
                    {t(
                      'Я проверил(а) материалы и подтверждаю публикацию',
                      'Материалдарды тексердім және жариялауды растаймын',
                    )}
                  </label>
                </div>
                <button
                  className="button primary"
                  disabled={!id || !confirm || busy || status === 'rendering'}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await post(`/seasons/${id}/publish`, { confirmed: true, visibility });
                      r.reload();
                      notify(t('Сезон опубликован!', 'Маусым жарияланды!'));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Опубликовать', 'Жариялау')}
                  <ArrowRight size={17} />
                </button>
              </section>
            )}
            {status === 'published' && (
              <section className="panel publication-panel">
                <CheckCheck size={30} />
                <div>
                  <h2>{t('Сезон в библиотеке', 'Маусым кітапханада')}</h2>
                  <p>
                    {t(
                      'Назначьте его классу и посмотрите, что поняли ученики.',
                      'Сыныпқа беріп, оқушылардың түсінгенін көріңіз.',
                    )}
                  </p>
                </div>
                <button className="button primary" onClick={() => setAssign(true)}>
                  {t('Назначить классу', 'Сыныпқа беру')}
                  <ArrowRight size={18} />
                </button>
                <Link className="button secondary" to={`/watch/${id}`}>
                  <Play size={17} />
                  {t('Открыть ленту', 'Лентаны ашу')}
                </Link>
              </section>
            )}
          </>
        )}
      </State>
      {suggested && (
        <Modal
          title={t('ИИ предложил черновик', 'ЖИ жоба ұсынды')}
          onClose={() => setSuggested(null)}
        >
          <p className="muted">
            {t(
              'Проверьте смысл и факты. Этот вариант заменит серии и вопросы в редакторе; публикация остаётся за вами.',
              'Мағынасы мен деректерін тексеріңіз. Бұл нұсқа редактордағы сериялар мен сұрақтарды ауыстырады.',
            )}
          </p>
          <div className="chapter-list">
            {suggested.episodes.map((e, i) => (
              <div className="ai-episode" key={i}>
                <h3>
                  {i + 1}. {e.title}
                </h3>
                <p>{e.script}</p>
              </div>
            ))}
          </div>
          <p className="muted small">
            {suggested.questions.length} {t('вопросов с объяснениями', 'түсіндірмелі сұрақ')}
          </p>
          <button
            className="button primary full"
            onClick={() => {
              setDraft((d) => ({ ...d, ...suggested }));
              setSuggested(null);
              setStep(1);
            }}
          >
            {t('Использовать и редактировать', 'Қолдану және өңдеу')}
            <ArrowRight size={18} />
          </button>
        </Modal>
      )}
      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <video
            className="preview-video"
            controls
            playsInline
            src={`/api/episodes/${preview.id}/video`}
          />
        </Modal>
      )}
      {assign && id && <AssignModal seasonId={id} onClose={() => setAssign(false)} />}
    </div>
  );
}
function AssignModal({ seasonId, onClose }: { seasonId: string; onClose: () => void }) {
  const r = useResource<any[]>('/classes');
  const { t, notify } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const next = new Date();
  next.setDate(next.getDate() + 7);
  return (
    <Modal title={t('Назначить сезон классу', 'Маусымды сыныпқа беру')} onClose={onClose}>
      <State {...r} retry={r.reload}>
        {r.data?.length ? (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await post('/assignments', {
                  season_id: seasonId,
                  class_id: f.get('class'),
                  due_at: new Date(f.get('due') as string).toISOString(),
                });
                notify(t('Задание появилось у учеников', 'Тапсырма оқушыларға берілді'));
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Класс', 'Сынып')}
              <select name="class">
                {r.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Срок выполнения', 'Орындау мерзімі')}
              <input
                type="datetime-local"
                name="due"
                defaultValue={new Date(next.getTime() - next.getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)}
                required
              />
            </label>
            <p className="muted small">
              {t(
                'Ученики смогут продолжить после срока. Результаты сохраняются отдельно от просмотра.',
                'Оқушылар мерзімнен кейін жалғастыра алады. Нәтижелер бөлек сақталады.',
              )}
            </p>
            {error && (
              <p className="error-inline" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              <SendIcon />
              {t('Назначить', 'Беру')}
            </button>
          </form>
        ) : (
          <div className="empty-state compact">
            <p>{t('Сначала создайте класс.', 'Алдымен сынып жасаңыз.')}</p>
            <Link className="button primary" to="/classes" onClick={onClose}>
              {t('Мои классы', 'Сыныптарым')}
            </Link>
          </div>
        )}
      </State>
    </Modal>
  );
}
function SendIcon() {
  return <ArrowRight size={17} />;
}
export function ClassesPage() {
  const catalog = useResource<Season[]>('/catalog');
  const r = useResource<any[]>('/classes'),
    a = useResource<any[]>('/assignments');
  const { t, notify } = useApp();
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('УЧИМСЯ ВМЕСТЕ', 'БІРГЕ ҮЙРЕНЕМІЗ')}
        title={t('Ваши классы', 'Сыныптарыңыз')}
        description={t(
          'Ученикам нужен только код приглашения и свой аккаунт.',
          'Оқушыларға шақыру коды және жеке аккаунты қажет.',
        )}
        action={
          <button className="button primary" onClick={() => setShow(true)}>
            <Plus size={18} />
            {t('Добавить класс', 'Сынып қосу')}
          </button>
        }
      />
      <State {...r} retry={r.reload}>
        {r.data?.length ? (
          <div className="class-grid">
            {r.data.map((c) => (
              <section className="panel class-card" key={c.id}>
                <span className="class-icon">
                  <UsersRound size={28} />
                </span>
                <h2>{c.name}</h2>
                <p>
                  {c.students} {t('учеников', 'оқушы')} ·{' '}
                  {a.data?.filter((x) => x.class_id === c.id).length || 0}{' '}
                  {t('заданий', 'тапсырма')}
                </p>
                <label className="form-label class-topic-label">
                  {t('Сейчас проходим', 'Қазір оқып жатырмыз')}
                  <select
                    aria-label={`Текущая тема ${c.name}`}
                    value={c.current_season_id || ''}
                    onChange={async (e) => {
                      try {
                        await api(`/classes/${c.id}/topic`, {
                          method: 'PATCH',
                          body: JSON.stringify({ season_id: e.target.value }),
                        });
                        r.reload();
                        a.reload();
                        notify(
                          t('Тема обновлена для всего класса', 'Тақырып бүкіл сыныпқа жаңартылды'),
                        );
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <option value="" disabled>
                      {t('Выберите тему', 'Тақырыпты таңдаңыз')}
                    </option>
                    {catalog.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="invite-code">
                  <div>
                    <small>{t('КОД ПРИГЛАШЕНИЯ', 'ШАҚЫРУ КОДЫ')}</small>
                    <b>{c.code}</b>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Скопировать код ${c.name}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(c.code);
                        notify(t('Код скопирован', 'Код көшірілді'));
                      } catch {
                        notify(t('Скопируйте код вручную', 'Кодты қолмен көшіріңіз'));
                      }
                    }}
                  >
                    <Copy size={20} />
                  </button>
                </div>
                <p className="small muted">
                  {t(
                    'Попросите учеников открыть «Задания» и ввести этот код.',
                    'Оқушылар «Тапсырмалар» бетінде осы кодты енгізсін.',
                  )}
                </p>
                <Link className="button secondary full" to={`/results?class_id=${c.id}`}>
                  {t('Результаты класса', 'Сынып нәтижелері')}
                  <ArrowRight size={16} />
                </Link>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <UsersRound size={35} />
            <h2>{t('Здесь будет ваш первый класс', 'Алғашқы сыныбыңыз осында болады')}</h2>
            <button className="button primary" onClick={() => setShow(true)}>
              {t('Создать класс', 'Сынып жасау')}
            </button>
          </div>
        )}
      </State>
      <div className="section-heading">
        <h2>{t('Назначенные сезоны', 'Берілген маусымдар')}</h2>
      </div>
      <State {...a} retry={a.reload}>
        {a.data?.length ? (
          <div className="teacher-assignments">
            {a.data.map((v) => (
              <div className="panel" key={v.id}>
                <div>
                  <h3>{v.title}</h3>
                  <p>{v.class_name}</p>
                </div>
                <span>
                  <CalendarDays size={16} />
                  {new Date(v.due_at).toLocaleDateString('ru-RU')}
                </span>
                <Link className="button secondary" to={`/learn/${v.season_id}`}>
                  {t('Открыть', 'Ашу')}
                  <ArrowRight size={16} />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            {t(
              'После публикации сезона можно назначить его классу из студии.',
              'Жарияланған маусымды студиядан сыныпқа беріңіз.',
            )}
          </p>
        )}
      </State>
      {show && (
        <Modal title={t('Новый класс', 'Жаңа сынып')} onClose={() => setShow(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await post('/classes', { name: new FormData(e.currentTarget).get('name') });
                r.reload();
                setShow(false);
                notify(t('Класс создан', 'Сынып жасалды'));
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Название класса', 'Сынып атауы')}
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                placeholder="7 Б · История Казахстана"
              />
            </label>
            {error && (
              <p className="error-inline" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {t('Создать и получить код', 'Жасау және код алу')}
              <ArrowRight size={18} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
export function ReviewModal({
  data,
  onClose,
  onSaved,
}: {
  data: ResultRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, notify } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={t(`Пересказ · ${data.name}`, `Мазмұндау · ${data.name}`)} onClose={onClose}>
      <p className="muted">{data.title}</p>
      <audio src={`/api/retellings/${data.retelling_id}/audio`} controls className="audio-player" />
      <div className="review-criteria">
        <b>{t('На что смотрим', 'Нені бағалаймыз')}</b>
        <span>
          {t(
            'Ключевые факты · Причинные связи · Свои слова',
            'Негізгі деректер · Себеп-салдар · Өз сөзі',
          )}
        </span>
        <small>
          {t(
            'Акцент и манера речи не определяют знания.',
            'Акцент пен сөйлеу мәнері білімді анықтамайды.',
          )}
        </small>
      </div>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError('');
          try {
            await api(`/retellings/${data.retelling_id}/review`, {
              method: 'PATCH',
              body: JSON.stringify({
                score: Number(f.get('score')),
                feedback: f.get('feedback'),
                transcript: f.get('transcript'),
              }),
            });
            notify(t('Обратная связь сохранена', 'Кері байланыс сақталды'));
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t('Текст пересказа — можно уточнить', 'Мазмұндау мәтіні')}
          <textarea
            name="transcript"
            defaultValue={data.transcript || ''}
            rows={4}
            maxLength={10000}
          />
        </label>
        <label>
          {t('Ваша оценка, 0–100', 'Бағаңыз, 0–100')}
          <input
            type="number"
            name="score"
            required
            min={0}
            max={100}
            defaultValue={data.teacher_score ?? 80}
          />
        </label>
        <label>
          {t('Что получилось и что повторить', 'Не жақсы болды және нені қайталау керек')}
          <textarea
            name="feedback"
            rows={3}
            required
            minLength={3}
            maxLength={2000}
            defaultValue={data.feedback || ''}
          />
        </label>
        {error && (
          <p className="error-inline" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          <Check size={17} />
          {t('Сохранить отзыв', 'Пікірді сақтау')}
        </button>
      </form>
    </Modal>
  );
}
