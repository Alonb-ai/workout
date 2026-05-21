import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ToastHost } from './components/ToastHost';
import { ConfirmProvider } from './components/Confirm';
import { seedIfNeeded, ensureSettings } from './db/seed';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { WorkoutPage } from './features/workout/WorkoutPage';
import { PlanPage } from './features/plan/PlanPage';
import { SupplementsPage } from './features/supplements/SupplementsPage';
import { ProgressPage } from './features/progress/ProgressPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { startSupplementScheduler } from './features/supplements/scheduler';
import { SessionDetailPage } from './features/progress/SessionDetailPage';
import { ExerciseHistoryPage } from './features/workout/ExerciseHistoryPage';

export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await ensureSettings();
      await seedIfNeeded();
      setReady(true);
      // Start in-app supplement scheduler (also handles delivering notifications).
      startSupplementScheduler();
    })();
  }, []);

  if (!ready) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-fg-muted">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulseRing" />
          <span>טוען…</span>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/workout" element={<WorkoutPage />} />
          <Route path="/workout/exercise/:exerciseId/history" element={<ExerciseHistoryPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/supplements" element={<SupplementsPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/progress/session/:sessionId" element={<SessionDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastHost />
      <ConfirmProvider />
    </BrowserRouter>
  );
}
