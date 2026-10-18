import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCheck, Heart, UsersRound, Clapperboard } from 'lucide-react';
import { post, useApp, useResource, type Season } from './lib';
import { State, SeasonCard } from './components';

type Author = {
  id: string;
  name: string;
  role: 'teacher' | 'creator';
  trust_level: 'new' | 'trusted';
  followers: number;
  following: boolean;
  likes: number;
  seasons: Season[];
};

// Russian counts: 1 подписчик, 2 подписчика, 5 подписчиков. Kazakh nouns do not change.
const ru = (n: number, forms: [string, string, string]) => {
  const d = n % 10,
    h = n % 100;
  return forms[d === 1 && h !== 11 ? 0 : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 1 : 2];
};

// Concept 3.0: people follow people. The page shows only what the author published
// and a one-way follow; there is no way to contact the author from here.
export function AuthorPage() {
  const { id } = useParams();
  const r = useResource<Author>(`/authors/${id}`);
  const { t, user, login, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const a = r.data;
  async function toggle() {
    if (!a) return;
    if (!user) {
      login();
      return;
    }
    setBusy(true);
    try {
      const v = await post(`/authors/${a.id}/follow`, { following: !a.following });
      r.setData({ ...a, ...v });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <State loading={r.loading} error={r.error} retry={r.reload}>
      {a && (
        <div className="author-page">
          <header className="author-head">
            <span className="author-avatar" aria-hidden="true">
              {a.name.slice(0, 1)}
            </span>
            <div>
              <div className="eyebrow">
                {a.role === 'teacher' ? t('УЧИТЕЛЬ', 'МҰҒАЛІМ') : t('АВТОР', 'АВТОР')}
              </div>
              <h1>
                {a.name}
                {a.trust_level === 'trusted' && (
                  <CheckCheck size={22} aria-label={t('Проверенный автор', 'Тексерілген автор')} />
                )}
              </h1>
              <div className="author-stats">
                <span>
                  <UsersRound size={15} />
                  <b>{a.followers}</b>{' '}
                  {t(ru(a.followers, ['подписчик', 'подписчика', 'подписчиков']), 'жазылушы')}
                </span>
                <span>
                  <Clapperboard size={15} />
                  <b>{a.seasons.length}</b>{' '}
                  {t(ru(a.seasons.length, ['тема', 'темы', 'тем']), 'тақырып')}
                </span>
                <span>
                  <Heart size={15} />
                  <b>{a.likes}</b> {t(ru(a.likes, ['лайк', 'лайка', 'лайков']), 'лайк')}
                </span>
              </div>
            </div>
            {a.id !== user?.id && (
              <button
                className={`button ${a.following ? 'secondary' : 'primary'}`}
                aria-pressed={a.following}
                disabled={busy}
                onClick={() => void toggle()}
              >
                {a.following ? t('Вы подписаны', 'Жазылдыңыз') : t('Подписаться', 'Жазылу')}
              </button>
            )}
          </header>
          {a.seasons.length ? (
            <div className="season-grid">
              {a.seasons.map((s) => (
                <SeasonCard key={s.id} season={s} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>{t('Пока нет опубликованных тем', 'Әзірге жарияланған тақырып жоқ')}</h2>
            </div>
          )}
        </div>
      )}
    </State>
  );
}
