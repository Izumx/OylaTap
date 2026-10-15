import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  Clapperboard,
  Play,
  Library,
  ClipboardList,
  ListChecks,
  UserRound,
  LogOut,
  Plus,
  UsersRound,
  ChartNoAxesCombined,
  X,
  LoaderCircle,
  ArrowRight,
  Globe2,
  Sparkles,
  Moon,
} from 'lucide-react';
import { useApp, post, type Season, subjects, minutes } from './lib';
export function Logo() {
  return (
    <Link className="logo" to="/" aria-label="OylaTap — главная">
      <span className="logo-mark">
        <Play size={19} fill="currentColor" />
      </span>
      oyla<span>tap</span>
      <span className="logo-dot">.</span>
    </Link>
  );
}
export function Shell({ children, feed = false }: { children: ReactNode; feed?: boolean }) {
  const { user, t, locale, setLocale, login, notify, refresh, comfort, setComfort } = useApp();
  const location = useLocation();
  const navClass = (href: string, active: boolean) =>
    active || (href === '/library' && location.pathname.startsWith('/learn/')) ? 'active' : '';
  const studentLinks = [
    ['/', 'Лента', 'Лента', Play],
    ['/library', 'Сезоны', 'Маусымдар', Library],
    ['/assignments', 'Задания', 'Тапсырмалар', ClipboardList],
    ['/progress', 'Мой прогресс', 'Менің прогресім', ChartNoAxesCombined],
  ] as const;
  const teacherLinks = [
    ['/studio', 'Мои сезоны', 'Менің маусымдарым', Clapperboard],
    ['/classes', 'Классы', 'Сыныптар', UsersRound],
    ['/results', 'Результаты', 'Нәтижелер', ChartNoAxesCombined],
    ['/library', 'Библиотека', 'Кітапхана', Library],
  ] as const;
  const links = user?.role === 'teacher' ? teacherLinks : studentLinks;
  return (
    <div className={`app-shell ${feed ? 'feed-layout' : ''}`}>
      <aside className="sidebar">
        <Logo />
        <div className="side-label">
          {user?.role === 'teacher'
            ? t('ПРОСТРАНСТВО УЧИТЕЛЯ', 'МҰҒАЛІМ КАБИНЕТІ')
            : t('ТВОЁ ПРОСТРАНСТВО', 'СЕНІҢ КЕҢІСТІГІҢ')}
        </div>
        <nav>
          {user?.role === 'teacher' && (
            <NavLink to="/" end>
              <Play size={21} />
              <span>{t('Лента', 'Лента')}</span>
            </NavLink>
          )}
          {links.map(([href, ru, kk, Icon]) => (
            <NavLink
              key={href}
              to={href}
              end={href === '/'}
              className={({ isActive }) => navClass(href, isActive)}
            >
              <Icon size={21} />
              <span>{t(ru, kk)}</span>
            </NavLink>
          ))}
        </nav>
        {user?.role === 'teacher' ? (
          <Link className="button primary create-link" to="/studio/new">
            <Plus size={18} />
            {t('Создать сезон', 'Маусым жасау')}
          </Link>
        ) : (
          <div className="side-note">
            <span className="tiny-pill">{t('ПО ЧУТЬ-ЧУТЬ, КАЖДЫЙ ДЕНЬ', 'КҮНДЕ АЗ-АЗДАН')}</span>
            <Sparkles size={25} />
            <p>{t('Понимание начинается с любопытства.', 'Түсіну қызығушылықтан басталады.')}</p>
            <small>{t('Без гонки за баллами. В своём темпе.', 'Өз қарқыныңмен үйрен.')}</small>
          </div>
        )}
        <div className="sidebar-bottom">
          <button
            className="comfort-control"
            aria-pressed={comfort}
            onClick={() => setComfort(!comfort)}
          >
            <Moon size={17} />
            <span>{t('Спокойный режим', 'Жайлы режим')}</span>
            <span className={`mini-switch ${comfort ? 'on' : ''}`} aria-hidden="true" />
          </button>
          <button
            className="language-control"
            onClick={() => setLocale(locale === 'ru' ? 'kk' : 'ru')}
            aria-label={t('Сменить язык', 'Тілді ауыстыру')}
          >
            <Globe2 size={16} />
            <span>Русский / Қазақша</span>
            <b>{locale.toUpperCase()}</b>
          </button>
          {user ? (
            <>
              <Link className="account" to="/profile">
                <span className="avatar">{user.name.slice(0, 1)}</span>
                <span>
                  <b>{user.name.split(' ')[0]}</b>
                  <small>
                    {user.role === 'teacher'
                      ? t('Учитель', 'Мұғалім')
                      : t(`${user.grade} класс`, `${user.grade} сынып`)}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </Link>
              <button
                className="logout"
                onClick={async () => {
                  try {
                    await post('/auth/logout');
                    await refresh();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <LogOut size={15} />
                {t('Выйти', 'Шығу')}
              </button>
            </>
          ) : (
            <button className="button secondary full" onClick={login}>
              <UserRound size={17} />
              {t('Войти в аккаунт', 'Кіру')}
            </button>
          )}
        </div>
      </aside>
      <header className="mobile-header">
        <Logo />
        <div>
          <button
            className="comfort-mobile"
            aria-label={t('Спокойный режим', 'Жайлы режим')}
            aria-pressed={comfort}
            onClick={() => setComfort(!comfort)}
          >
            <Moon size={18} />
          </button>
          <button
            className="language-pill"
            aria-label={t('Сменить язык', 'Тілді ауыстыру')}
            onClick={() => setLocale(locale === 'ru' ? 'kk' : 'ru')}
          >
            {locale.toUpperCase()}
          </button>
          <Link className="mobile-account" aria-label="Аккаунт" to="/profile">
            <UserRound size={19} />
          </Link>
        </div>
      </header>
      <main className="main">{children}</main>
      <nav className="bottom-nav">
        {links.map(([href, ru, kk, Icon]) => (
          <NavLink
            key={href}
            to={href}
            end={href === '/'}
            className={({ isActive }) => navClass(href, isActive)}
          >
            <Icon size={22} />
            <span>{t(ru, kk)}</span>
          </NavLink>
        ))}
        <NavLink to="/profile">
          <UserRound size={21} />
          <span>{t('Профиль', 'Профиль')}</span>
        </NavLink>
      </nav>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function State({
  loading,
  error,
  retry,
  children,
}: {
  loading?: boolean;
  error?: string;
  retry?: () => void;
  children: ReactNode;
}) {
  const { t } = useApp();
  if (loading)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" size={28} />
        <p>{t('Загружаем…', 'Жүктелуде…')}</p>
      </div>
    );
  if (error)
    return (
      <div className="empty-state">
        <h2>{t('Не удалось загрузить', 'Жүктеу мүмкін болмады')}</h2>
        <p>{error}</p>
        <button className="button primary" onClick={retry}>
          {t('Попробовать снова', 'Қайта көру')}
        </button>
      </div>
    );
  return <>{children}</>;
}
export function Private({ children, teacher = false }: { children: ReactNode; teacher?: boolean }) {
  const { user, loading, login, t } = useApp();
  if (loading) return <State loading>{null}</State>;
  if (!user)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <UserRound size={28} />
        </div>
        <h1>{t('Здесь начинается твоё обучение', 'Оқу осы жерден басталады')}</h1>
        <p>
          {t(
            'Войди, чтобы сохранять прогресс, получать задания и рассказывать своими словами.',
            'Прогресті сақтау және тапсырмаларды алу үшін кір.',
          )}
        </p>
        <button className="button primary" onClick={login}>
          {t('Войти или попробовать демо', 'Кіру немесе демоны көру')}
          <ArrowRight size={17} />
        </button>
      </div>
    );
  if (teacher && user.role !== 'teacher')
    return (
      <div className="empty-state">
        <h2>{t('Это кабинет учителя', 'Бұл мұғалім кабинеті')}</h2>
        <Link className="button primary" to="/">
          {t('Вернуться к обучению', 'Оқуға оралу')}
        </Link>
      </div>
    );
  return <>{children}</>;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function SeasonArt({
  art = 'history',
  color = 'sage',
  className = '',
}: {
  art?: string;
  color?: string;
  className?: string;
}) {
  const palettes: Record<string, [string, string, string]> = {
    sage: ['#bce8a3', '#215b48', '#f3e5b1'],
    peach: ['#f4b08d', '#873e2a', '#ffe8bd'],
    lilac: ['#c7b9f5', '#504170', '#ebe1fc'],
    blue: ['#99c8ed', '#264f6e', '#d4eaf3'],
  };
  const [bg, ink, light] = palettes[color] || palettes.sage;
  return (
    <svg className={`season-art ${className}`} viewBox="0 0 400 300" fill="none" aria-hidden="true">
      <rect width="400" height="300" fill={bg} />
      <circle cx="335" cy="65" r="95" fill={light} opacity=".45" />
      <path d="M-30 266Q90 160 216 245T460 210V340H-30Z" fill={ink} opacity=".1" />
      <g stroke={ink} strokeWidth="3" strokeLinejoin="round">
        {art === 'history' ? (
          <>
            <path d="m66 248 53-77 95 7 45 70" fill={light} />
            <path d="M105 174 151 95l34 83" fill={ink} />
            <path d="M147 99h47l-16 20h-31" fill={ink} />
            <path d="M154 99v-35" />
            <path d="M229 250V113l27-29 28 29v137" fill={light} />
            <path d="M217 119h80M239 156h31M239 173h31M239 190h31" />
            <path d="M302 250v-84l21-25 22 25v84" fill={ink} />
            <path d="M257 85V58" />
            <circle cx="257" cy="51" r="7" fill={ink} />
            <path d="M46 250h315" />
            <path d="m194 251 22-57 19 57" fill={ink} />
          </>
        ) : art === 'route' ? (
          <>
            <path d="M42 230q60-130 125-64t89-89 113-35" strokeDasharray="7 8" strokeWidth="5" />
            <circle cx="50" cy="225" r="14" fill={light} />
            <circle cx="193" cy="171" r="12" fill={light} />
            <circle cx="297" cy="60" r="14" fill={light} />
            <path d="m227 245 57-66 54 66" fill={ink} />
            <path d="m99 251 30-91 42 91" fill={light} />
            <path d="M216 137h37v49h-37z" fill={light} />
            <path d="m213 137 20-22 24 22" fill={ink} />
            <path d="m270 94 14 8-14 6" />
          </>
        ) : (
          <>
            <path
              d="M84 91q60-25 118 12 56-37 113-12v133q-65-15-113 16-52-31-118-16Z"
              fill={light}
            />
            <path d="M202 103v137M100 126q40-13 79 7M100 149q40-13 79 7M100 174q40-13 79 7M224 126q36-13 69-7M224 149q36-13 69-7M224 174q36-13 69-7" />
            <path d="m287 248 18-102 27-30 9 18-20 104Z" fill={ink} />
            <path d="m321 238-9 27-25-17" fill={light} />
            <path d="m65 53 6 14 15 5-15 5-6 14-5-14-15-5 15-5Z" fill={ink} />
          </>
        )}
      </g>
      <g fill={ink}>
        <circle cx="51" cy="119" r="3" />
        <circle cx="354" cy="125" r="3" />
        <path d="m326 30 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z" />
      </g>
    </svg>
  );
}
export function SeasonCard({ season, studio = false }: { season: Season; studio?: boolean }) {
  const { t, locale } = useApp();
  return (
    <Link className="season-card" to={studio ? `/studio/${season.id}` : `/learn/${season.id}`}>
      <div className="card-art">
        <SeasonArt art={season.art} color={season.color} />
        <span className="card-language">{season.language === 'kk' ? 'ҚАЗ' : 'РУС'}</span>
        <span className="card-play">
          <Play size={21} fill="currentColor" />
        </span>
        <span className="card-duration">
          {minutes(season.duration)} {t('мин', 'мин')}
        </span>
      </div>
      <div className="card-body">
        <div className="card-subject">
          {subjects[season.subject]?.[locale === 'kk' ? 1 : 0]}{' '}
          <span>
            · {season.grade} {t('класс', 'сынып')}
          </span>
        </div>
        <h3>{season.title}</h3>
        <p>{season.description}</p>
        <div className="card-footer">
          <span>
            {season.episode_count} {t('серии', 'серия')}
          </span>
          {studio ? (
            <span className={`status ${season.status}`}>
              {
                (
                  {
                    draft: 'Черновик',
                    rendering: 'Сборка',
                    review: 'На проверке',
                    published: 'Опубликован',
                    failed: 'Нужен повтор',
                  } as Record<string, string>
                )[season.status]
              }
            </span>
          ) : season.completed > 0 ? (
            <span className="mint">
              {season.completed}/{season.episode_count} {t('просмотрено', 'көрілді')}
            </span>
          ) : (
            <span>
              {t('Открыть тему', 'Тақырыпты ашу')}
              <ArrowUpRight size={14} />
            </span>
          )}
        </div>
        {!studio && season.best_score !== null && (
          <div className="card-test-result">
            <ListChecks size={14} /> {t('Лучший результат теста:', 'Тесттің үздік нәтижесі:')}{' '}
            {season.best_score}%
          </div>
        )}
        {season.completed > 0 && (
          <div className="progress-track">
            <i style={{ width: `${(season.completed / season.episode_count) * 100}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}
