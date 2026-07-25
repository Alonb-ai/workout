import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ToastHost } from './components/ToastHost';
import { ConfirmProvider } from './components/Confirm';
import { ErrorBoundary } from './components/ErrorBoundary';
import { seedIfNeeded, ensureSettings } from './db/seed';
import { purgeEmptyWorkoutDrafts } from './db/queries';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { WorkoutPage } from './features/workout/WorkoutPage';
import { PlanPage } from './features/plan/PlanPage';
import { SupplementsPage } from './features/supplements/SupplementsPage';
import { ProgressPage } from './features/progress/ProgressPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { startSupplementScheduler } from './features/supplements/scheduler';
import { attachSubscriptionRenewer } from './features/push/webPush';
import { SessionDetailPage } from './features/progress/SessionDetailPage';
import { ExerciseHistoryPage } from './features/workout/ExerciseHistoryPage';
import { BodyPage } from './features/body/BodyPage';

export function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSettings();
        await seedIfNeeded();
        // Drop only EMPTY abandoned drafts (>24h). Drafts with logged sets are
        // kept forever and surfaced on the dashboard — losing a session because
        // the user forgot to press Save is the one failure mode that matters.
        await purgeEmptyWorkoutDrafts(24);
        // Start in-app supplement scheduler (also handles delivering notifications).
        startSupplementScheduler();
        // Listen for SW-relayed pushsubscriptionchange and auto-resubscribe.
        attachSubscriptionRenewer();
      } catch (err) {
        console.error('Bootstrap failed:', err);
        setBootError(err instanceof Error ? err.message : String(err));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (bootError) {
    // ponytail: no in-app rescue here — if Dexie won't open there is nothing to
    // export anyway. Upgrade only if a partial-failure mode shows up in practice.
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="card p-4 max-w-sm w-full text-center space-y-3">
          <p className="text-sm font-semibold">שגיאה בטעינת הנתונים</p>
          <p className="text-2xs text-fg-muted break-words">{bootError}</p>
          <button className="btn-primary w-full" onClick={() => location.reload()}>
            רענן
          </button>
        </div>
      </div>
    );
  }

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
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/workout" element={<WorkoutPage />} />
            <Route
              path="/workout/exercise/:exerciseId/history"
              element={<ExerciseHistoryPage />}
            />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/supplements" element={<SupplementsPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route
              path="/progress/session/:sessionId"
              element={<SessionDetailPage />}
            />
            <Route path="/body" element={<BodyPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        <ToastHost />
        <ConfirmProvider />
      </HashRouter>
    </ErrorBoundary>
  );
}
