import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { Provider } from './lib';
import { Shell, Private } from './components';
import Auth from './Auth';
import { ReminderTicker } from './Learning';
import { SeasonPage } from './SeasonPage';
import { HistoryPage, AttemptPage, PracticePage } from './Assessments';
import { Feed, LibraryPage, AssignmentsPage, ProgressPage, ProfilePage } from './Student';
import { StudioPage, EditorPage, ClassesPage } from './Teacher';
import { ResultsPage } from './Results';
import { StatsPage, ModerationPage } from './Creator';
import './style.css';
import './comfort.css';
import './reports.css';
import './polish.css';
function App() {
  const loc = useLocation();
  return (
    <Shell feed={loc.pathname === '/' || loc.pathname.startsWith('/watch/')}>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/watch/:id" element={<Feed />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/learn/:id" element={<SeasonPage />} />
        <Route
          path="/attempts"
          element={
            <Private>
              <HistoryPage />
            </Private>
          }
        />
        <Route
          path="/attempts/:id"
          element={
            <Private>
              <AttemptPage />
            </Private>
          }
        />
        <Route
          path="/attempts/:id/practice"
          element={
            <Private>
              <PracticePage />
            </Private>
          }
        />
        <Route
          path="/assignments"
          element={
            <Private>
              <AssignmentsPage />
            </Private>
          }
        />
        <Route
          path="/progress"
          element={
            <Private>
              <ProgressPage />
            </Private>
          }
        />
        <Route
          path="/profile"
          element={
            <Private>
              <ProfilePage />
            </Private>
          }
        />
        <Route
          path="/studio"
          element={
            <Private author>
              <StudioPage />
            </Private>
          }
        />
        <Route
          path="/studio/new"
          element={
            <Private author>
              <EditorPage />
            </Private>
          }
        />
        <Route
          path="/studio/:id"
          element={
            <Private author>
              <EditorPage />
            </Private>
          }
        />
        <Route
          path="/stats"
          element={
            <Private author>
              <StatsPage />
            </Private>
          }
        />
        <Route
          path="/moderation"
          element={
            <Private moderator>
              <ModerationPage />
            </Private>
          }
        />
        <Route
          path="/classes"
          element={
            <Private teacher>
              <ClassesPage />
            </Private>
          }
        />
        <Route
          path="/results"
          element={
            <Private teacher>
              <ResultsPage />
            </Private>
          }
        />
        <Route
          path="*"
          element={
            <div className="empty-state">
              <h1>Страница не найдена</h1>
              <Link className="button primary" to="/">
                Открыть ленту
              </Link>
            </div>
          }
        />
      </Routes>
      <Auth />
      <ReminderTicker />
    </Shell>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider>
        <App />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register('/sw.js').catch(() => {});
