import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, GraduationCap, LoaderCircle } from 'lucide-react';
import { post, useApp, useResource } from './lib';
import { State } from './components';

type Invitation = { name: string; joined: boolean };

export function JoinClassPage() {
  const { code = '' } = useParams();
  // A different link must never display the previous class while it is loading.
  return <JoinClass key={code} code={code} />;
}

function JoinClass({ code }: { code: string }) {
  const { user, loading, t, login, refresh, notify } = useApp();
  const invitation = useResource<Invitation>(
    loading ? null : `/invitations/${encodeURIComponent(code)}?account=${user?.id || 'guest'}`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const mounted = useRef(false);
  const account = useRef(user?.id);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    account.current = user?.id;
    setBusy(false);
    setError('');
  }, [user?.id]);
  async function join() {
    const joiningAccount = user?.id;
    const current = () => mounted.current && account.current === joiningAccount;
    setBusy(true);
    setError('');
    try {
      const result = await post('/classes/join', { code });
      if (!current()) return;
      notify(t(`Ты в классе «${result.name}»!`, `«${result.name}» сыныбына қосылдың!`));
      navigate(result.next_path);
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function switchAccount() {
    const originalAccount = user?.id;
    const current = () =>
      mounted.current && (!account.current || account.current === originalAccount);
    setBusy(true);
    setError('');
    try {
      await post('/auth/logout');
      await refresh();
      if (current()) login();
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <div className="page invitation-page">
      <Link className="topic-back" to="/library">
        <ArrowLeft size={17} />
        {t('Библиотека', 'Кітапхана')}
      </Link>
      <section className="panel invitation-card">
        <div className="invitation-symbol" aria-hidden="true">
          <GraduationCap size={34} />
        </div>
        {invitation.error ? (
          <div className="invitation-error" role="alert">
            <h1>{t('Не удалось открыть приглашение', 'Шақыруды ашу мүмкін болмады')}</h1>
            <p>{invitation.error}</p>
            <p>
              {t(
                'Проверь ссылку или попроси учителя отправить её ещё раз.',
                'Сілтемені тексер немесе мұғалімнен қайта жіберуін сұра.',
              )}
            </p>
            <button className="button secondary" onClick={invitation.reload}>
              {t('Попробовать снова', 'Қайта көру')}
            </button>
          </div>
        ) : (
          <State loading={loading || invitation.loading}>
            {invitation.data && (
              <>
                <p className="invitation-caption">{t('Приглашение в класс', 'Сыныпқа шақыру')}</p>
                <h1>{invitation.data.name}</h1>
                <p className="invitation-description">
                  {t(
                    'Учись вместе с классом. После присоединения откроется тема от учителя или список заданий.',
                    'Сыныбыңмен бірге оқы. Қосылғаннан кейін мұғалімнің тақырыбы немесе тапсырмалар тізімі ашылады.',
                  )}
                </p>
                <ol
                  className="invitation-steps"
                  aria-label={t('Как присоединиться', 'Қалай қосылуға болады')}
                >
                  <li className={user ? 'done' : 'current'}>
                    <span>{user ? <Check size={16} /> : '1'}</span>
                    {t('Войди в свой аккаунт', 'Аккаунтыңа кір')}
                  </li>
                  <li className={invitation.data.joined ? 'done' : user ? 'current' : ''}>
                    <span>{invitation.data.joined ? <Check size={16} /> : '2'}</span>
                    {t('Подтверди свой класс', 'Сыныбыңды раста')}
                  </li>
                  <li>
                    <span>3</span>
                    {t('Открой тему от учителя', 'Мұғалімнің тақырыбын аш')}
                  </li>
                </ol>
                {user && user.role !== 'student' ? (
                  <div className="invitation-account">
                    <h2>{t('Нужен аккаунт ученика', 'Оқушы аккаунты қажет')}</h2>
                    <p>
                      {t(
                        'Сейчас открыт аккаунт учителя или автора. Войди под своим ученическим аккаунтом.',
                        'Қазір мұғалім немесе автор аккаунты ашық. Оқушы аккаунтымен кір.',
                      )}
                    </p>
                    <button
                      className="button primary full"
                      disabled={busy}
                      onClick={() => void switchAccount()}
                    >
                      {t('Войти как ученик', 'Оқушы ретінде кіру')}
                    </button>
                  </div>
                ) : user ? (
                  <>
                    <p className="invitation-account-name">
                      {t('Твой аккаунт:', 'Сенің аккаунтың:')} <strong>{user.name}</strong>
                    </p>
                    <button
                      className="button primary full"
                      disabled={busy}
                      onClick={() => void join()}
                    >
                      {busy ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <ArrowRight size={18} />
                      )}
                      {invitation.data.joined
                        ? t('Продолжить обучение', 'Оқуды жалғастыру')
                        : t('Присоединиться к классу', 'Сыныпқа қосылу')}
                    </button>
                    <p className="muted small">
                      {invitation.data.joined
                        ? t(
                            'Ты уже в этом классе. Можно продолжать.',
                            'Сен бұл сыныпқа қосылғансың. Оқуды жалғастыра аласың.',
                          )
                        : t(
                            'Нажимая кнопку, ты присоединяешься к этому классу. Учитель увидит твои работы по заданиям класса.',
                            'Батырманы басып, осы сыныпқа қосыласың. Мұғалім сынып тапсырмалары бойынша жұмыстарыңды көре алады.',
                          )}
                    </p>
                  </>
                ) : (
                  <>
                    <button className="button primary full" onClick={login}>
                      {t('Войти и продолжить', 'Кіру және жалғастыру')}
                      <ArrowRight size={18} />
                    </button>
                    <p className="muted small">
                      {t(
                        'Нет аккаунта? Его можно создать на следующем шаге. Приглашение сохранится.',
                        'Аккаунтың жоқ па? Оны келесі қадамда жасай аласың. Шақыру сақталады.',
                      )}
                    </p>
                  </>
                )}
              </>
            )}
          </State>
        )}
        {error && (
          <p className="error-inline" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
