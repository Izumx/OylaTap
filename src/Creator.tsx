import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mic,
  Square,
  Upload,
  CheckCheck,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Eye,
  Flag,
  LoaderCircle,
} from 'lucide-react';
import {
  api,
  post,
  useApp,
  useResource,
  subjects,
  statusLabels,
  videoStyles,
  type ModerationFlag,
  type Season,
} from './lib';
import { PageHeader, State, Modal } from './components';
import './creator.css';

// Records or uploads the author's narration for one episode.
export function VoiceInput({
  seasonId,
  episode,
  disabled,
  onSaved,
  onError,
}: {
  seasonId?: string;
  episode: { id?: string; has_voice?: boolean };
  disabled?: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useApp();
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  if (!seasonId || !episode.id)
    return (
      <p className="muted small">
        {t('Сохраните черновик, чтобы записать голос.', 'Дауыс жазу үшін жобаны сақтаңыз.')}
      </p>
    );
  async function upload(file: Blob, name: string) {
    setBusy(true);
    try {
      const f = new FormData();
      f.append('file', file, name);
      await api(`/seasons/${seasonId}/episodes/${episode.id}/voice`, { method: 'POST', body: f });
      setVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
        void upload(new Blob(chunks, { type: r.mimeType || 'audio/webm' }), 'voice.webm');
      };
      r.start();
      recorder.current = r;
      setRecording(true);
    } catch {
      onError(t('Нет доступа к микрофону', 'Микрофонға рұқсат жоқ'));
    }
  }
  return (
    <div className="voice-input">
      <span className={`status ${episode.has_voice ? 'published' : 'draft'}`}>
        {episode.has_voice
          ? t('Голос записан', 'Дауыс жазылды')
          : t('Голоса пока нет', 'Дауыс әлі жоқ')}
      </span>
      {episode.has_voice && (
        <audio controls preload="none" src={`/api/episodes/${episode.id}/voice?v=${version}`} />
      )}
      <div className="voice-actions">
        {recording ? (
          <button
            className="button primary"
            onClick={() => {
              recorder.current?.stop();
              setRecording(false);
            }}
          >
            <Square size={16} />
            {t('Остановить', 'Тоқтату')}
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={disabled || busy}
            onClick={() => void start()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Mic size={16} />}
            {episode.has_voice
              ? t('Перезаписать', 'Қайта жазу')
              : t('Записать голос', 'Дауыс жазу')}
          </button>
        )}
        <label className="button secondary upload-button">
          <Upload size={16} />
          {t('Аудиофайл', 'Аудиофайл')}
          <input
            type="file"
            accept="audio/*"
            disabled={disabled || busy}
            aria-label={t('Загрузить аудиофайл', 'Аудиофайл жүктеу')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file, file.name);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}

export function FlagList({ flags }: { flags: ModerationFlag[] }) {
  const { t } = useApp();
  return (
    <section className="panel flag-list">
      <h3>
        <ShieldAlert size={18} />
        {t('Замечания проверки', 'Тексеру ескертулері')}
      </h3>
      <ul>
        {flags.map((f, i) => (
          <li key={i} className={f.severity}>
            <b>{f.message}</b>
            <small>
              {f.source === 'ai' ? t('ИИ-подсказка', 'ЖИ кеңесі') : t('Правило', 'Ереже')} ·{' '}
              {f.field}
            </small>
            {f.excerpt && <q>{f.excerpt}</q>}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Insights = {
  styles: {
    style: string;
    seasons: number;
    views: number;
    completion_rate: number | null;
    like_rate: number | null;
    understanding_rate: number | null;
    quality: number;
  }[];
  recommended: string | null;
  hints: { en: string; ru: string }[];
  min_views: number;
};
export function StyleAdvice() {
  const { t, locale } = useApp();
  const r = useResource<Insights>('/insights/styles');
  if (!r.data) return null;
  const best = r.data.styles.find((s) => s.style === r.data!.recommended);
  return (
    <div className="style-advice">
      <Sparkles size={18} />
      {best ? (
        <p>
          {t(
            'По данным платформы лучше всего работает стиль',
            'Платформа деректері бойынша үздік стиль',
          )}{' '}
          <b>«{videoStyles[best.style][locale === 'kk' ? 1 : 0]}»</b>:{' '}
          {t('досмотр', 'соңына дейін')} {best.completion_rate ?? '—'}%,{' '}
          {t('верных ответов', 'дұрыс жауап')} {best.understanding_rate ?? '—'}%.
          {r.data.hints
            .filter((h) => !h.en.startsWith('The best performing'))
            .map((h) => ` ${h.ru}`)
            .join('')}
        </p>
      ) : (
        <p>
          {t(
            `Пока мало просмотров, чтобы сравнить стили: нужно хотя бы ${r.data.min_views} на стиль. Выберите тот, что подходит теме.`,
            `Стильдерді салыстыруға көрулер әлі аз. Тақырыпқа сай стильді таңдаңыз.`,
          )}
        </p>
      )}
    </div>
  );
}

type SeasonStat = {
  season_id: string;
  title: string;
  status: string;
  style: string;
  hidden: boolean;
  views: number;
  viewers: number;
  likes: number;
  open_reports: number;
  completion_rate: number | null;
  like_rate: number | null;
  understanding_rate: number | null;
};
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
export function StatsPage() {
  const { t, locale, user } = useApp();
  const r = useResource<{ trust_level: string; seasons: SeasonStat[] }>('/studio/stats');
  const insights = useResource<Insights>('/insights/styles');
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('СТАТИСТИКА', 'СТАТИСТИКА')}
        title={t('Что смотрят и что понимают', 'Не көреді және не түсінеді')}
        description={t(
          'Досмотр — доля просмотров до конца. Понимание — первые ответы на микровопрос после серии. Эти два показателя важнее лайков и сильнее всего влияют на рекомендации.',
          'Соңына дейін көру және сериядан кейінгі алғашқы дұрыс жауаптар ұсыныстарға көбірек әсер етеді.',
        )}
      />
      <div className="inline-note trust-note">
        <ShieldCheck size={18} />
        {user?.trust_level === 'trusted'
          ? t(
              'Проверенный автор: ролики без замечаний автоматической проверки публикуются сразу.',
              'Тексерілген автор: ескертусіз видео бірден жарияланады.',
            )
          : t(
              'Новый автор: публикации в общую ленту проходят модерацию.',
              'Жаңа автор: ортақ лентаға жарияланым модерациядан өтеді.',
            )}
      </div>
      <State {...r} retry={r.reload}>
        {r.data?.seasons.length ? (
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>{t('Ролик', 'Видео')}</th>
                  <th>{t('Статус', 'Күйі')}</th>
                  <th>{t('Зрители', 'Көрермен')}</th>
                  <th>{t('Досмотр', 'Соңына дейін')}</th>
                  <th>{t('Понимание', 'Түсіну')}</th>
                  <th>{t('Лайки', 'Лайк')}</th>
                  <th>{t('Жалобы', 'Шағым')}</th>
                </tr>
              </thead>
              <tbody>
                {r.data.seasons.map((s) => (
                  <tr key={s.season_id}>
                    <td>
                      <Link to={`/studio/${s.season_id}`}>{s.title}</Link>
                      <small className="muted">
                        {' '}
                        · {videoStyles[s.style]?.[locale === 'kk' ? 1 : 0]}
                      </small>
                    </td>
                    <td>
                      <span className={`status ${s.status}`}>
                        {s.hidden ? t('Скрыт', 'Жасырын') : statusLabels[s.status]}
                      </span>
                    </td>
                    <td>{s.viewers}</td>
                    <td>{pct(s.completion_rate)}</td>
                    <td>{pct(s.understanding_rate)}</td>
                    <td>{s.likes}</td>
                    <td>{s.open_reports || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h2>
              {t('Статистика появится после публикации', 'Статистика жариялағаннан кейін шығады')}
            </h2>
            <Link className="button primary" to="/studio/new">
              {t('Создать видео', 'Видео жасау')}
            </Link>
          </div>
        )}
      </State>
      {insights.data && (
        <section className="panel">
          <h2>{t('Стили на платформе', 'Платформадағы стильдер')}</h2>
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>{t('Стиль', 'Стиль')}</th>
                  <th>{t('Роликов', 'Видео')}</th>
                  <th>{t('Просмотров', 'Көру')}</th>
                  <th>{t('Досмотр', 'Соңына дейін')}</th>
                  <th>{t('Понимание', 'Түсіну')}</th>
                </tr>
              </thead>
              <tbody>
                {insights.data.styles.map((s) => (
                  <tr
                    key={s.style}
                    className={s.style === insights.data!.recommended ? 'best' : ''}
                  >
                    <td>{videoStyles[s.style][locale === 'kk' ? 1 : 0]}</td>
                    <td>{s.seasons}</td>
                    <td>{s.views}</td>
                    <td>{pct(s.completion_rate)}</td>
                    <td>{pct(s.understanding_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {t(
              `Сравнение надёжно, когда у стиля не меньше ${insights.data.min_views} просмотров.`,
              `Стильде кемінде ${insights.data.min_views} көру болғанда салыстыру сенімді.`,
            )}
          </p>
        </section>
      )}
    </div>
  );
}

type QueueItem = {
  id: string;
  title: string;
  description: string;
  subject: string;
  language: string;
  grade: number;
  status: string;
  hidden: boolean;
  owner_name: string;
  owner_role: string;
  trust_level: string;
  episode_count: number;
  moderation_flags: ModerationFlag[];
  reports: { reason: string; comment: string; created_at: string }[];
  history: { decision: string; note: string; created_at: string }[];
};
const reasons: Record<string, string> = {
  mistake: 'Ошибка в объяснении',
  unsafe: 'Небезопасно для детей',
  spam: 'Реклама или спам',
  copyright: 'Чужой материал',
  other: 'Другое',
};
export function ModerationPage() {
  const { t, locale, notify } = useApp();
  const queue = useResource<QueueItem[]>('/moderation/queue');
  const [open, setOpen] = useState<QueueItem | null>(null);
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('МОДЕРАЦИЯ', 'МОДЕРАЦИЯ')}
        title={t('Проверка перед общей лентой', 'Ортақ лентаға дейінгі тексеру')}
        description={t(
          'Проверьте факты, правильные ответы и подачу для детей. Автоматические правила и ИИ только подсказывают — решение за вами.',
          'Деректерді, дұрыс жауаптарды және балаларға лайықтығын тексеріңіз. Шешім — сізде.',
        )}
      />
      <State {...queue} retry={queue.reload}>
        {queue.data?.length ? (
          <div className="moderation-list">
            {queue.data.map((x) => (
              <button key={x.id} className="panel moderation-item" onClick={() => setOpen(x)}>
                <span className={`status ${x.hidden ? 'failed' : x.status}`}>
                  {x.hidden
                    ? t('Скрыт по жалобам', 'Шағым бойынша жасырын')
                    : x.status === 'published'
                      ? t('Есть жалобы', 'Шағымдар бар')
                      : statusLabels[x.status]}
                </span>
                <h3>{x.title}</h3>
                <p className="muted small">
                  {subjects[x.subject]?.[locale === 'kk' ? 1 : 0]} · {x.grade} {t('класс', 'сынып')}{' '}
                  · {x.language === 'kk' ? 'Қазақша' : 'Русский'} · {x.owner_name} (
                  {x.owner_role === 'creator' ? t('автор', 'автор') : t('учитель', 'мұғалім')},{' '}
                  {x.trust_level === 'trusted'
                    ? t('проверенный', 'тексерілген')
                    : t('новый', 'жаңа')}
                  )
                </p>
                <p className="small">
                  {x.moderation_flags.length
                    ? `${t('Замечаний проверки', 'Ескерту')}: ${x.moderation_flags.length}`
                    : t('Автоматическая проверка без замечаний', 'Автоматты тексеру ескертусіз')}
                  {x.reports.length ? ` · ${t('Жалоб', 'Шағым')}: ${x.reports.length}` : ''}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <CheckCheck size={36} />
            <h2>{t('Очередь пуста', 'Кезек бос')}</h2>
          </div>
        )}
      </State>
      {open && (
        <ReviewDialog
          item={open}
          onClose={() => setOpen(null)}
          onDone={(message) => {
            setOpen(null);
            queue.reload();
            notify(message);
          }}
        />
      )}
    </div>
  );
}

function ReviewDialog({
  item,
  onClose,
  onDone,
}: {
  item: QueueItem;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useApp();
  const season = useResource<Season>(`/seasons/${item.id}`);
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<string | null>(null);
  async function decide(decision: 'approve' | 'reject' | 'restore' | 'unpublish', message: string) {
    setBusy(true);
    setError('');
    try {
      await post(`/moderation/${item.id}/decision`, { decision, note });
      onDone(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={item.title} onClose={onClose} wide>
      <p className="muted">{item.description}</p>
      {!!item.moderation_flags.length && <FlagList flags={item.moderation_flags} />}
      {!!item.reports.length && (
        <section className="panel flag-list">
          <h3>
            <Flag size={18} />
            {t('Жалобы учеников', 'Оқушылар шағымы')}
          </h3>
          <ul>
            {item.reports.map((r, i) => (
              <li key={i} className="review">
                <b>{reasons[r.reason]}</b>
                {r.comment && <q>{r.comment}</q>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <State {...season} retry={season.reload}>
        {season.data && (
          <div className="review-content">
            {season.data.episodes?.map((ep) => (
              <div key={ep.id} className="review-episode">
                <h4>
                  {ep.position + 1}. {ep.title}
                </h4>
                <p>{ep.script}</p>
                {ep.has_video && (
                  <button className="text-button" onClick={() => setPreview(ep.id)}>
                    <Eye size={15} /> {t('Смотреть серию', 'Серияны көру')}
                  </button>
                )}
                {preview === ep.id && (
                  <video
                    className="preview-video"
                    controls
                    autoPlay
                    playsInline
                    src={`/api/episodes/${ep.id}/video`}
                  />
                )}
              </div>
            ))}
            <h4>{t('Вопросы и правильные ответы', 'Сұрақтар мен дұрыс жауаптар')}</h4>
            <ol className="review-questions">
              {season.data.questions?.map((q, i) => (
                <li key={q.id || i}>
                  <b>{q.prompt}</b>
                  <span>
                    ✓ {q.options[q.correct ?? 0]}
                    {q.purpose === 'final' ? ` · ${t('итоговый', 'қорытынды')}` : ''}
                  </span>
                  <small className="muted">{q.explanation}</small>
                </li>
              ))}
            </ol>
          </div>
        )}
      </State>
      <label className="form-label">
        {t('Комментарий автору', 'Авторға пікір')}
        <textarea
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t(
            'Что исправить: конкретная серия, ошибка, как правильно',
            'Нені түзету керек: нақты серия, қате',
          )}
        />
      </label>
      {error && (
        <div className="error-inline" role="alert">
          {error}
        </div>
      )}
      <div className="moderation-actions">
        {item.status === 'moderation' ? (
          <>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void decide('approve', t('Опубликовано', 'Жарияланды'))}
            >
              <ShieldCheck size={17} />
              {t('Одобрить и опубликовать', 'Мақұлдау және жариялау')}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void decide('reject', t('Возвращено автору', 'Авторға қайтарылды'))}
            >
              {t('Вернуть на доработку', 'Түзетуге қайтару')}
            </button>
          </>
        ) : (
          <>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void decide('restore', t('Жалобы отклонены, ролик в ленте', 'Видео лентада'))
              }
            >
              <ShieldCheck size={17} />
              {t('Жалобы не подтвердились', 'Шағымдар расталмады')}
            </button>
            <button
              className="button secondary danger-button"
              disabled={busy}
              onClick={() =>
                void decide('unpublish', t('Снято с публикации', 'Жариялаудан алынды'))
              }
            >
              {t('Снять с публикации', 'Жариялаудан алу')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
