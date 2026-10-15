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
  role: 'student' | 'teacher';
  grade: number;
  language: 'ru' | 'kk';
};
export type Episode = {
  id: string;
  title: string;
  script: string;
  position: number;
  duration: number;
  has_video: boolean;
  completed: boolean;
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
  review: 'На проверке',
  published: 'Опубликован',
  failed: 'Нужен повтор',
};
