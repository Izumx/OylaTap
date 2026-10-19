import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  ListChecks,
  Mic,
  Play,
} from 'lucide-react';
import { useApp, useResource, subjects, minutes, testQuestions, type Season } from './lib';
import { SeasonCover, State } from './components';
import { Quiz, Recorder } from './Student';

export function SeasonPage() {
  const { id } = useParams();
  const { user, loading: authLoading, t, locale, login } = useApp();
  const r = useResource<Season>(authLoading ? null : `/seasons/${id}`);
  const [modal, setModal] = useState<'quiz' | 'record' | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    r.reload();
    setModal(null);
  }, [user?.id, r.reload]);
  useEffect(() => {
    setModal(null);
    window.scrollTo(0, 0);
  }, [id]);
  const season = r.data;
  const episodes = season?.episodes || [];
  const watched = episodes.filter((ep) => ep.completed).length;
  const allWatched = episodes.length > 0 && watched === episodes.length;
  const next = episodes.findIndex((ep) => !ep.completed && ep.has_video);
  const resume = next >= 0 ? next : episodes.findIndex((ep) => ep.has_video);
  const latest = season?.attempts?.[0];
  const retelling = season?.retellings?.[0];
  const hasQuiz = Boolean(season && testQuestions(season).length);
  const needsReview = Boolean(latest && latest.score < latest.total);
  const open = (step: 'quiz' | 'record') => {
    if (!user) login();
    else setModal(step);
  };
  const close = () => {
    setModal(null);
    r.reload();
  };
  const play = (index: number) => navigate(`/watch/${id}?episode=${index}`);
  return (
    <div className="page topic-page">
      <Link className="topic-back" to="/library">
        <ArrowLeft size={17} /> {t('Все темы', 'Барлық тақырыптар')}
      </Link>
      <State loading={authLoading || r.loading} error={r.error} retry={r.reload}>
        {season && (
          <>
            <header className="topic-hero">
              <div className="topic-intro">
                <span className="eyebrow">{t('ТЕМА → ПОНИМАНИЕ', 'ТАҚЫРЫП → ТҮСІНУ')}</span>
                <div className="topic-meta">
                  <span>{subjects[season.subject]?.[locale === 'kk' ? 1 : 0]}</span>
                  <span>
                    {season.grade} {t('класс', 'сынып')}
                  </span>
                  <span>{season.language === 'kk' ? 'Қазақша' : 'Русский'}</span>
                </div>
                <h1>{season.title}</h1>
                <p>{season.description}</p>
                <div className="topic-facts">
                  <span>
                    <Play size={15} /> {episodes.length} {t('серии', 'серия')}
                  </span>
                  <span>
                    <Clock3 size={15} />{' '}
                    {minutes(episodes.reduce((sum, ep) => sum + ep.duration, 0))}{' '}
                    {t('мин видео', 'мин видео')}
                  </span>
                  <span>
                    <ListChecks size={15} /> {testQuestions(season).length} {t('вопроса', 'сұрақ')}
                  </span>
                </div>
                <div className="topic-next-step">
                  <strong>{t('Следующий шаг', 'Келесі қадам')}</strong>
                  <p>
                    {!allWatched && resume >= 0
                      ? t(
                          'Посмотри объяснение. После серии — один короткий вопрос.',
                          'Түсіндірмені көр. Әр сериядан кейін бір қысқа сұрақ бар.',
                        )
                      : !latest && hasQuiz
                        ? t(
                            'Серии просмотрены. Проверь, что удалось понять.',
                            'Сериялар көрілді. Не түсінгеніңді тексер.',
                          )
                        : needsReview
                          ? t(
                              'В тесте остались ошибки. Разбери их и вернись к нужной серии.',
                              'Тестте қателер бар. Оларды талдап, қажетті серияны қайта көр.',
                            )
                          : !retelling && latest
                            ? t(
                                'Тест пройден без ошибок. По желанию объясни тему своими словами.',
                                'Тест қатесіз өтті. Қаласаң, тақырыпты өз сөзіңмен түсіндір.',
                              )
                            : t(
                                'Выбери, что повторить, или открой другую тему.',
                                'Қайталау үшін серияны таңда немесе басқа тақырыпты аш.',
                              )}
                  </p>
                  {!allWatched && resume >= 0 ? (
                    <Link className="button primary" to={`/watch/${id}?episode=${resume}`}>
                      <Play size={18} />{' '}
                      {watched
                        ? t('Продолжить просмотр', 'Көруді жалғастыру')
                        : t('Начать с первой серии', 'Бірінші сериядан бастау')}
                    </Link>
                  ) : !latest && hasQuiz ? (
                    <button className="button primary" onClick={() => open('quiz')}>
                      <ListChecks size={18} /> {t('Проверить себя', 'Өзіңді тексеру')}
                    </button>
                  ) : needsReview ? (
                    <Link className="button primary" to={`/attempts/${latest.id}`}>
                      <ListChecks size={18} /> {t('Разобрать ошибки', 'Қателерді талдау')}
                    </Link>
                  ) : !retelling && latest ? (
                    <button className="button primary" onClick={() => open('record')}>
                      <Mic size={18} /> {t('Рассказать своими словами', 'Өз сөзіңмен айту')}
                    </button>
                  ) : (
                    <Link className="button primary" to={user ? '/progress' : '/library'}>
                      {t('Посмотреть прогресс', 'Прогресті көру')} <ArrowRight size={18} />
                    </Link>
                  )}
                </div>
                {!user && (
                  <small className="topic-save-note">
                    {t(
                      'Смотреть можно без входа. Для сохранения результатов войди в аккаунт.',
                      'Кірусіз көруге болады. Нәтижелерді сақтау үшін аккаунтқа кір.',
                    )}
                  </small>
                )}
              </div>
              <div className="topic-cover">
                <SeasonCover season={season} />
              </div>
            </header>

            <section
              className="topic-journey"
              aria-label={t('Твой маршрут по теме', 'Тақырып бойынша жолың')}
            >
              <div className="section-heading">
                <h2>{t('Твой маршрут по теме', 'Тақырып бойынша жолың')}</h2>
                <span className="muted small">{t('В своём темпе', 'Өз қарқыныңмен')}</span>
              </div>
              <ol className="journey-steps">
                <li className={allWatched ? 'done' : 'current'}>
                  <span className="journey-number">{allWatched ? <Check size={18} /> : '1'}</span>
                  <div>
                    <h3>{t('Посмотри серии', 'Серияларды көр')}</h3>
                    <p>
                      {watched}/{episodes.length} {t('просмотрено', 'көрілді')}
                    </p>
                    <small>
                      {t('После каждой — короткий вопрос.', 'Әр сериядан кейін қысқа сұрақ.')}
                    </small>
                  </div>
                  <button
                    className="text-button"
                    disabled={resume < 0}
                    onClick={() => play(resume)}
                  >
                    {allWatched ? t('Повторить', 'Қайталау') : t('Смотреть', 'Көру')}{' '}
                    <ArrowRight size={15} />
                  </button>
                </li>
                <li className={latest ? 'done' : allWatched ? 'current' : ''}>
                  <span className="journey-number">{latest ? <Check size={18} /> : '2'}</span>
                  <div>
                    <h3>{t('Проверь понимание', 'Түсінгеніңді тексер')}</h3>
                    <p>
                      {latest
                        ? t(
                            `Последний результат: ${latest.score} из ${latest.total}`,
                            `Соңғы нәтиже: ${latest.score}/${latest.total}`,
                          )
                        : t('Тест с объяснением ответов', 'Жауаптары түсіндірілетін тест')}
                    </p>
                    <small>
                      {latest && latest.score < latest.total
                        ? t(
                            'Есть что повторить — ошибки помогут выбрать серию.',
                            'Қайталау керек тұстар бар — қате қажетті серияны табуға көмектеседі.',
                          )
                        : t(
                            'Просмотр и понимание считаются отдельно.',
                            'Көру мен түсіну бөлек есептеледі.',
                          )}
                    </small>
                  </div>
                  <button className="text-button" disabled={!hasQuiz} onClick={() => open('quiz')}>
                    {latest ? t('Ещё раз', 'Қайта тапсыру') : t('Пройти тест', 'Тест тапсыру')}{' '}
                    <ArrowRight size={15} />
                  </button>
                </li>
                <li className={retelling ? 'done' : latest ? 'current' : ''}>
                  <span className="journey-number">{retelling ? <Check size={18} /> : '3'}</span>
                  <div>
                    <h3>{t('Объясни своими словами', 'Өз сөзіңмен түсіндір')}</h3>
                    <p>
                      {retelling
                        ? retelling.teacher_score !== null
                          ? t(
                              `Оценка учителя: ${retelling.teacher_score}%`,
                              `Мұғалім бағасы: ${retelling.teacher_score}%`,
                            )
                          : t(
                              'Пересказ сохранён · пока без оценки',
                              'Мазмұндау сақталды · әзірге баға жоқ',
                            )
                        : t('Голосом, с текстовым дополнением', 'Дауыспен, мәтіндік толықтырумен')}
                    </p>
                    <small>
                      {t(
                        'По желанию или по заданию учителя.',
                        'Өз қалауыңмен немесе мұғалім тапсырмасымен.',
                      )}
                    </small>
                  </div>
                  {retelling ? (
                    <Link className="text-button" to="/profile">
                      {t('Мой пересказ', 'Менің мазмұндауым')} <ArrowRight size={15} />
                    </Link>
                  ) : (
                    <button className="text-button" onClick={() => open('record')}>
                      {t('Рассказать', 'Айтып беру')} <ArrowRight size={15} />
                    </button>
                  )}
                </li>
              </ol>
              {user && (
                <div className="assessment-actions topic-history">
                  {latest && (
                    <Link className="button secondary" to={`/attempts/${latest.id}`}>
                      {t('Разобрать последнюю попытку', 'Соңғы талпынысты талдау')}
                      <ArrowRight size={16} />
                    </Link>
                  )}
                  <Link className="text-button" to={`/attempts?season_id=${season.id}`}>
                    {t('История тестов по теме', 'Тақырып тесттерінің тарихы')}
                  </Link>
                </div>
              )}
            </section>

            <section className="topic-episodes" aria-label={t('Серии темы', 'Тақырып сериялары')}>
              <div className="section-heading">
                <h2>{t('Что внутри', 'Ішінде не бар')}</h2>
                <BookOpen size={20} />
              </div>
              <div className="topic-episode-list">
                {episodes.map((ep, index) => (
                  <button
                    key={ep.id}
                    className={ep.completed ? 'completed' : ''}
                    onClick={() => play(index)}
                    disabled={!ep.has_video}
                  >
                    <span className="episode-status">
                      {ep.completed ? <Check size={19} /> : String(index + 1).padStart(2, '0')}
                    </span>
                    <span>
                      <strong>{ep.title}</strong>
                      <small>
                        {ep.duration} {t('сек', 'сек')} ·{' '}
                        {ep.completed
                          ? t('просмотрено', 'көрілді')
                          : !ep.has_video
                            ? t('видео готовится', 'видео дайындалуда')
                            : t('короткая серия', 'қысқа серия')}
                      </small>
                    </span>
                    <Play size={18} />
                  </button>
                ))}
              </div>
            </section>
            <p className="topic-source">
              <BookOpen size={16} />
              <span>{season.source_name}</span>
            </p>
          </>
        )}
      </State>
      {season && modal === 'quiz' && (
        <Quiz
          season={season}
          onClose={close}
          onRecord={() => setModal('record')}
          onReview={(position) => {
            setModal(null);
            const index = episodes.findIndex((ep) => ep.position === position);
            if (index >= 0) play(index);
          }}
        />
      )}
      {season && modal === 'record' && <Recorder season={season} onClose={close} />}
    </div>
  );
}
