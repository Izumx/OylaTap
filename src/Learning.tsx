import { useState, useEffect } from 'react';
import {
  Bell,
  Check,
  BookOpen,
  Compass,
  Landmark,
  Globe2,
  Feather,
  Sigma,
  Triangle,
  ChevronDown,
} from 'lucide-react';
import { api, post, useApp, useResource, subjects, type Season } from './lib';
import { State } from './components';
export function LearningPreferences() {
  const icons = {
    'kz-history': Landmark,
    'world-history': Globe2,
    'kz-literature': BookOpen,
    'ru-literature': Feather,
    'world-literature': BookOpen,
    algebra: Sigma,
    geometry: Triangle,
  };
  const r = useResource<any>('/learning-preferences'),
    catalog = useResource<Season[]>('/catalog');
  const { t, locale, notify } = useApp();
  const [value, setValue] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (r.data) setValue(r.data);
  }, [r.data]);
  return (
    <section className="panel learning-preferences" id="profile-learning">
      <div className="profile-section-title">
        <Compass size={22} />
        <h2>{t('Твой учебный маршрут', 'Сенің оқу бағытың')}</h2>
      </div>
      <p className="muted small">
        {t(
          'Выбери интересы — подберём темы для тебя. Тема класса всегда идёт первой.',
          'Қызығушылықтарыңды таңда — тақырыптар ұсынамыз. Сынып тақырыбы бірінші.',
        )}
      </p>
      <State {...r} retry={r.reload}>
        {value && (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api('/learning-preferences', {
                  method: 'PATCH',
                  body: JSON.stringify(value),
                });
                r.reload();
                notify(t('Учебный план сохранён', 'Оқу жоспары сақталды'));
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Моя текущая тема', 'Қазіргі тақырыбым')}
              <select
                aria-label="Моя текущая тема"
                value={value.current_season_id || ''}
                onChange={(e) => setValue({ ...value, current_season_id: e.target.value || null })}
              >
                <option value="">{t('Подобрать тему для меня', 'Маған тақырып таңдау')}</option>
                {catalog.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label>{t('Что интересно?', 'Не қызықты?')}</label>
            <div className="interest-options">
              {Object.entries(subjects).map(([key, names]) => {
                const Icon = icons[key as keyof typeof icons];
                return (
                  <label key={key} className={value.interests.includes(key) ? 'selected' : ''}>
                    <Icon size={23} aria-hidden="true" />
                    <span>{names[locale === 'kk' ? 1 : 0]}</span>
                    <input
                      type="checkbox"
                      checked={value.interests.includes(key)}
                      onChange={(e) =>
                        setValue({
                          ...value,
                          interests: e.target.checked
                            ? [...value.interests, key]
                            : value.interests.filter((x: string) => x !== key),
                        })
                      }
                    />
                  </label>
                );
              })}
            </div>
            <details className="profile-reminder">
              <summary>
                <Bell size={19} />
                <span>{t('Напоминание', 'Еске салу')}</span>
                <small>
                  {value.reminder_enabled ? t('Включено', 'Қосулы') : t('Выключено', 'Өшірулі')}
                </small>
                <ChevronDown size={16} />
              </summary>
              <div className="reminder-setting">
                <Bell size={20} />
                <div>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={value.reminder_enabled}
                      onChange={async (e) => {
                        const enabled = e.target.checked;
                        if (
                          enabled &&
                          'Notification' in window &&
                          Notification.permission === 'default'
                        ) {
                          await Notification.requestPermission();
                        }
                        setValue({ ...value, reminder_enabled: enabled });
                      }}
                    />
                    <span>{t('Одно напоминание в день', 'Күніне бір еске салу')}</span>
                  </label>
                  <p className="muted small">
                    {t(
                      'Сейчас напоминание приходит, пока приложение открыто. С 21:00 до 08:00 — тишина.',
                      'Қазір еске салу қолданба ашық кезде келеді. 21:00–08:00 — тыныш уақыт.',
                    )}
                  </p>
                </div>
              </div>
              <label>
                {t('Время по Казахстану (UTC+5)', 'Қазақстан уақыты (UTC+5)')}
                <input
                  aria-label="Время напоминания"
                  type="time"
                  value={value.reminder_time}
                  min="08:00"
                  max="20:59"
                  onChange={(e) => setValue({ ...value, reminder_time: e.target.value })}
                  required
                />
              </label>
            </details>
            <button className="button primary" disabled={busy}>
              <Check size={17} />
              {t('Сохранить учебный план', 'Оқу жоспарын сақтау')}
            </button>
          </form>
        )}
      </State>
    </section>
  );
}
export function ReminderTicker() {
  const { user, notify } = useApp();
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await post('/reminders/claim');
        if (r.show && alive) {
          notify(r.text);
          if (
            'Notification' in window &&
            Notification.permission === 'granted' &&
            'serviceWorker' in navigator
          ) {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration?.showNotification('OylaTap', {
              body: r.text,
              icon: '/icon-192.png',
              tag: 'oylatap-daily',
            });
          }
        }
      } catch {}
    };
    void check();
    const timer = setInterval(check, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [user?.id]);
  return null;
}
