import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher' | 'creator';
  grade: number;
  language: 'ru' | 'kk';
  trust_level: 'new' | 'trusted';
  is_moderator: boolean;
};
// Teachers and independent authors share the studio.
export const isAuthor = (user: User | null) => user?.role === 'teacher' || user?.role === 'creator';
export type ModerationFlag = {
  code: string;
  severity: 'block' | 'review';
  source: 'rules' | 'ai';
  field: string;
  excerpt: string;
  message: string;
};
export type Episode = {
  id: string;
  title: string;
  script: string;
  position: number;
  duration: number;
  has_video: boolean;
  has_voice?: boolean;
  media_kind?: 'rendered' | 'uploaded';
  completed: boolean;
  likes?: number;
  liked?: boolean;
};
export type Question = {
  purpose?: 'micro' | 'final';
  episode_position?: number;
  id?: string;
  prompt: string;
  options: string[];
  correct?: number;
  explanation?: string;
};
export type DailySession = {
  season_id: string | null;
  episode_ids: string[];
  goal: number;
  correct: number;
  correct_ids?: string[];
  completed_ids?: string[];
  session_complete?: boolean;
  session_date: string;
  mode: 'school' | 'free';
  topic_source?: 'class' | 'assignment' | 'personal' | 'review' | 'library';
  class_name?: string | null;
  topic?: string;
  is_review?: boolean;
  route_done?: number;
  route_total?: number;
  next_episode?: { id: string; title: string; position: number } | null;
  next_step?: 'continue' | 'quiz' | 'retelling' | 'complete';
};
export type Season = {
  id: string;
  title: string;
  description: string;
  subject: string;
  language: string;
  grade: number;
  color: string;
  art: string;
  status: string;
  episode_count: number;
  duration: number;
  completed: number;
  best_score: number | null;
  last_score?: number | null;
  previous_score?: number | null;
  quiz_mode?: 'final' | 'legacy';
  source_name: string;
  source_text?: string;
  render_error?: string;
  style?: 'cards' | 'board' | 'captions';
  voice?: 'none' | 'tts' | 'own';
  topic_id?: string | null;
  topic_title_ru?: string | null;
  topic_title_kk?: string | null;
  owner_id?: string;
  owner_name?: string;
  owner_followed?: boolean;
  owner_role?: string;
  owner_trust?: string;
  hidden?: boolean;
  moderation_flags?: ModerationFlag[];
  moderation_note?: string | null;
  moderation_history?: { decision: string; note: string; created_at: string }[];
  episodes?: Episode[];
  questions?: Question[];
  attempts?: any[];
  retellings?: any[];
};
export function testQuestions(season: Season) {
  const questions = season.questions || [];
  const final = questions.filter((q) => q.purpose === 'final');
  return final.length ? final : questions;
}
export const subjects: Record<string, [string, string]> = {
  'kz-history': ['История Казахстана', 'Қазақстан тарихы'],
  'world-history': ['Всемирная история', 'Дүниежүзі тарихы'],
  'kz-literature': ['Казахская литература', 'Қазақ әдебиеті'],
  'ru-literature': ['Русская литература', 'Орыс әдебиеті'],
  algebra: ['Алгебра', 'Алгебра'],
  geometry: ['Геометрия', 'Геометрия'],
};
export const videoStyles: Record<string, [string, string, string]> = {
  board: ['Доска', 'Тақта', 'Шаги появляются по очереди, формулы выделены. Для задач и решений.'],
  captions: [
    'Субтитры',
    'Субтитрлер',
    'Одна крупная фраза на экране, как в коротких видео. Для историй и фактов.',
  ],
  cards: ['Карточка', 'Карточка', 'Весь текст серии на одном экране. Простой и быстрый вариант.'],
};
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}
export const post = (path: string, data: unknown = {}) =>
  api(path, { method: 'POST', body: JSON.stringify(data) });
export function useResource<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    api<T>(path)
      .then((x) => {
        if (alive) setData(x);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, version]);
  return { data, setData, error, loading, reload: useCallback(() => setVersion((v) => v + 1), []) };
}
type Context = {
  user: User | null;
  loading: boolean;
  demo: boolean;
  locale: 'ru' | 'kk';
  comfort: boolean;
  setComfort: (enabled: boolean) => void;
  t: (ru: string, kk?: string) => string;
  setLocale: (l: 'ru' | 'kk') => void;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
  login: () => void;
  authOpen: boolean;
  closeAuth: () => void;
};
const C = createContext<Context>(null!);
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [demo, setDemo] = useState(false),
    [authOpen, setAuthOpen] = useState(false),
    [toast, setToast] = useState('');
  const [locale, setLocaleState] = useState<'ru' | 'kk'>(() =>
    localStorage.getItem('oylatap-locale') === 'kk' ? 'kk' : 'ru',
  );
  const [comfort, setComfortState] = useState(
    () => localStorage.getItem('oylatap-comfort') !== 'off',
  );
  const refresh = useCallback(async () => {
    const d = await api('/me');
    setUser(d.user);
    setDemo(d.demo);
  }, []);
  useEffect(() => {
    refresh()
      .catch(() => setToast('Не удалось связаться с сервером'))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.comfort = comfort ? 'soft' : 'contrast';
  }, [comfort]);
  const setComfort = (enabled: boolean) => {
    localStorage.setItem('oylatap-comfort', enabled ? 'on' : 'off');
    setComfortState(enabled);
  };
  const setLocale = (l: 'ru' | 'kk') => {
    localStorage.setItem('oylatap-locale', l);
    setLocaleState(l);
    document.documentElement.lang = l;
  };
  return (
    <C.Provider
      value={{
        user,
        loading,
        demo,
        locale,
        comfort,
        setComfort,
        setLocale,
        t: (ru, kk) => (locale === 'kk' ? kk || ru : ru),
        refresh,
        notify: setToast,
        login: () => setAuthOpen(true),
        authOpen,
        closeAuth: () => setAuthOpen(false),
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Закрыть" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </C.Provider>
  );
}
export const useApp = () => useContext(C);
export const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
export const statusLabels: Record<string, string> = {
  draft: 'Черновик',
  rendering: 'Собираем видео',
  review: 'Видео собрано',
  moderation: 'У модератора',
  published: 'Опубликован',
  rejected: 'Нужны правки',
  failed: 'Нужен повтор',
};
