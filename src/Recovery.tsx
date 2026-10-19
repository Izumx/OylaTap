import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, post, useApp } from './lib';

export function RecoveryPage() {
  const { t, locale, refresh, login } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const reset = location.pathname === '/reset-password';
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') || '',
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (reset) {
      // Remove the secret from the address bar and browser history before further navigation.
      window.history.replaceState(window.history.state, '', location.pathname);
      setEnabled(true);
    } else {
      void api<{ enabled: boolean }>('/auth/recovery-status')
        .then((r) => setEnabled(r.enabled))
        .catch(() => setEnabled(false));
    }
  }, [reset, location.pathname]);
  const invalid = reset && !/^[a-f0-9]{64}$/.test(token);
  return (
    <div className="page recovery-page">
      <section className="panel recovery-card">
        <h1>
          {t(
            reset ? 'Новый пароль' : 'Забыли пароль?',
            reset ? 'Жаңа құпиясөз' : 'Құпиясөзді ұмыттыңыз ба?',
          )}
        </h1>
        <p className="muted">
          {t(
            reset
              ? 'Ссылка действует 30 минут. После смены пароля войдите заново на своих устройствах.'
              : 'Укажите email аккаунта. Мы отправим ссылку для смены пароля.',
            reset
              ? 'Сілтеме 30 минут жарамды. Құпиясөзді өзгерткеннен кейін құрылғыларыңызда қайта кіріңіз.'
              : 'Аккаунттың email мекенжайын көрсетіңіз. Құпиясөзді өзгерту сілтемесін жібереміз.',
          )}
        </p>
        {enabled === null && (
          <p role="status">{t('Проверяем доступность…', 'Қолжетімділікті тексеру…')}</p>
        )}
        {enabled === false && (
          <p role="status" className="auth-invitation-note">
            {t(
              'Восстановление через email ещё не подключено. Обратитесь к администратору сервиса.',
              'Email арқылы қалпына келтіру әлі қосылмаған. Қызмет әкімшісіне хабарласыңыз.',
            )}
          </p>
        )}
        {invalid && (
          <p role="alert" className="error-inline">
            {t('Ссылка недействительна. Запросите новую.', 'Сілтеме жарамсыз. Жаңасын сұраңыз.')}
          </p>
        )}
        {done ? (
          <div role="status">
            <p>
              {t(
                reset
                  ? 'Пароль изменён. Теперь можно войти с новым паролем.'
                  : 'Если аккаунт с таким email существует, мы отправим ссылку для восстановления. Проверьте входящие и папку «Спам».',
                reset
                  ? 'Құпиясөз өзгертілді. Енді жаңа құпиясөзбен кіре аласыз.'
                  : 'Мұндай email бар болса, қалпына келтіру сілтемесін жібереміз. Кіріс хаттар мен «Спам» қалтасын тексеріңіз.',
              )}
            </p>
            {reset && (
              <button
                className="button primary"
                onClick={() => {
                  navigate('/');
                  login();
                }}
              >
                {t('Войти', 'Кіру')}
              </button>
            )}
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              const data = new FormData(event.currentTarget);
              try {
                if (reset) {
                  if (data.get('password') !== data.get('confirm'))
                    throw new Error(t('Пароли не совпадают', 'Құпиясөздер сәйкес келмейді'));
                  await post('/auth/password-reset/confirm', {
                    token,
                    password: data.get('password'),
                  });
                  await refresh();
                } else
                  await post('/auth/password-reset/request', {
                    email: data.get('email'),
                    language: locale,
                  });
                setDone(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {reset ? (
              <>
                <label>
                  {t('Новый пароль', 'Жаңа құпиясөз')}
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    required
                    disabled={invalid}
                  />
                </label>
                <label>
                  {t('Повторите пароль', 'Құпиясөзді қайталаңыз')}
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    required
                    disabled={invalid}
                  />
                </label>
                <p className="muted small">{t('От 10 до 128 символов.', '10–128 таңба.')}</p>
              </>
            ) : (
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={!enabled}
                />
              </label>
            )}
            {error && (
              <p className="error-inline" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy || !enabled || invalid}>
              {t(
                busy ? 'Подождите…' : reset ? 'Сохранить пароль' : 'Отправить ссылку',
                busy ? 'Күтіңіз…' : reset ? 'Құпиясөзді сақтау' : 'Сілтемені жіберу',
              )}
            </button>
          </form>
        )}
        {reset && (
          <p>
            <Link to="/forgot-password">{t('Запросить новую ссылку', 'Жаңа сілтеме сұрау')}</Link>
          </p>
        )}
        <p>
          <Link to="/">{t('На главную', 'Басты бетке')}</Link>
        </p>
      </section>
    </div>
  );
}
