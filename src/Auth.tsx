import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, BookOpen, LoaderCircle, Clapperboard } from 'lucide-react';
import { Modal } from './components';
import { post, useApp } from './lib';
export default function Auth() {
  const { authOpen, closeAuth, refresh, demo, t } = useApp();
  const nav = useNavigate();
  const [register, setRegister] = useState(false),
    [role, setRole] = useState<'student' | 'teacher' | 'creator'>('student'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function run(data: unknown, path: string) {
    setError('');
    setBusy(true);
    try {
      const r = await post(path, data);
      await refresh();
      closeAuth();
      if (r.user.role !== 'student') nav('/studio');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!authOpen) return null;
  return (
    <Modal
      title={t(
        register ? 'Создай свой аккаунт' : 'Рады тебя видеть',
        register ? 'Аккаунт жасау' : 'Қош келдің',
      )}
      onClose={closeAuth}
    >
      <p className="muted">
        {t(
          'Короткие объяснения школьных тем от тех, кто умеет объяснять.',
          'Мектеп тақырыптарын түсіндіре алатындардан қысқа түсіндірмелер.',
        )}
      </p>
      <div className="segmented">
        <button className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>
          <GraduationCap size={18} />
          {t('Я ученик', 'Оқушымын')}
        </button>
        <button className={role === 'creator' ? 'active' : ''} onClick={() => setRole('creator')}>
          <Clapperboard size={18} />
          {t('Я автор', 'Автормын')}
        </button>
        <button className={role === 'teacher' ? 'active' : ''} onClick={() => setRole('teacher')}>
          <BookOpen size={18} />
          {t('Я учитель', 'Мұғаліммін')}
        </button>
      </div>
      {role === 'creator' && (
        <p className="muted small">
          {t(
            'Знаете тему и умеете объяснять? Расскажите голосом или напишите текст — OylaTap соберёт видео без монтажа и покажет его тем, кто проходит эту тему сейчас. Публикуют взрослые авторы; первые видео проверяет модератор.',
            'Тақырыпты білесіз бе? Дауыспен айтыңыз немесе мәтін жазыңыз — OylaTap видеоны монтажсыз жинап, осы тақырыпты қазір өтіп жүргендерге көрсетеді. Ересек авторлар жариялайды; алғашқы видеоларды модератор тексереді.',
          )}
        </p>
      )}
      {role === 'teacher' && (
        <p className="muted small">
          {t(
            'Всё, что умеет автор, плюс по желанию: класс по коду, общая тема и отчёт об ошибках.',
            'Автордың барлық мүмкіндігі, қаласаңыз: код арқылы сынып, ортақ тақырып және қателер есебі.',
          )}
        </p>
      )}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(
            {
              email: f.get('email'),
              password: f.get('password'),
              ...(register
                ? { name: f.get('name'), grade: Number(f.get('grade') || 7), role }
                : {}),
            },
            register ? '/auth/register' : '/auth/login',
          );
        }}
      >
        {register && (
          <>
            <label>
              {t('Как тебя зовут?', 'Атың кім?')}
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                placeholder="Али"
              />
            </label>
            {role === 'student' && (
              <label>
                {t('Класс', 'Сынып')}
                <select name="grade" defaultValue="7">
                  {[5, 6, 7, 8, 9, 10, 11].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
        <label>
          {t('Пароль', 'Құпиясөз')}
          <input
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete={register ? 'new-password' : 'current-password'}
            placeholder={t('Не меньше 10 символов', 'Кемінде 10 таңба')}
          />
        </label>
        {error && (
          <div className="error-inline" role="alert">
            {error}
          </div>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <>
              {t(register ? 'Создать аккаунт' : 'Войти', register ? 'Аккаунт жасау' : 'Кіру')}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
      <button
        className="text-button auth-switch"
        onClick={() => {
          setRegister(!register);
          setError('');
        }}
      >
        {t(
          register ? 'Уже есть аккаунт? Войти' : 'Первый раз здесь? Создать аккаунт',
          register ? 'Аккаунт бар ма? Кіру' : 'Аккаунт жасау',
        )}
      </button>
      {demo && (
        <div className="demo-box">
          <span>{t('Сначала познакомимся?', 'Алдымен танысайық па?')}</span>
          <p>
            {t(
              'Демо с примерами. Не добавляй личные данные учеников.',
              'Мысалдары бар демо. Оқушылардың жеке деректерін қоспа.',
            )}
          </p>
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() => void run({ role }, '/auth/demo')}
          >
            {
              {
                student: t('Попробовать как ученик', 'Оқушы демосы'),
                teacher: t('Попробовать как учитель', 'Мұғалім демосы'),
                creator: t('Попробовать как автор', 'Автор демосы'),
              }[role]
            }
            <ArrowUp />
          </button>
        </div>
      )}
    </Modal>
  );
}
function ArrowUp() {
  return <ArrowRight size={17} />;
}
