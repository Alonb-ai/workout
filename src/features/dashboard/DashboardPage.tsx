import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import {
  IconBarbell,
  IconCalendar,
  IconChart,
  IconClock,
  IconFlame,
  IconPill,
  IconSettings,
  IconTrophy,
  IconWarn,
} from '@/components/Icon';
import { formatHebDateFull, todayISO } from '@/utils/dates';
import { computeStreak } from '@/utils/dates';
import { useStallFlags } from './useStallFlags';
import { useTodaySupplements } from '../supplements/useTodaySupplements';
import { computeWeeklyVolume } from './stats';
import { motion } from 'framer-motion';
import { format, parseISO, startOfMonth } from 'date-fns';
import { updateSettings } from '@/hooks/useSettings';
import { useSettings } from '@/hooks/useSettings';

export function DashboardPage() {
  const today = todayISO();
  const navigate = useNavigate();
  const settings = useSettings();

  const activePlan = useLiveQuery(
    async () =>
      (await db.plans.toArray()).find((p) => p.isActive) ??
      (await db.plans.toArray())[0] ??
      null,
    [],
  );
  const workouts = useLiveQuery(
    async () => {
      if (!activePlan) return [];
      return db.workouts.where('planId').equals(activePlan.id).sortBy('order');
    },
    [activePlan?.id],
  );

  const completedSessions = useLiveQuery(async () => {
    const all = await db.sessions.toArray();
    return all
      .filter((s) => s.status === 'completed')
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.startedAt ?? 0) - (a.startedAt ?? 0);
      });
  }, []);

  const supplements = useTodaySupplements();
  const stalls = useStallFlags();

  if (!activePlan) {
    return (
      <div className="pt-6">
        <EmptyState
          title="אין תכנית פעילה"
          description="הוסיפו תכנית כדי להתחיל אימון."
          icon={<IconBarbell size={24} />}
          action={
            <Link to="/plan" className="btn-primary">
              עבור לתכנית
            </Link>
          }
        />
      </div>
    );
  }

  // Next recommended: workout with the oldest "last completed" date (or never).
  const lastByWorkout = new Map<string, string>(); // workoutId -> last date
  for (const s of completedSessions ?? []) {
    if (!lastByWorkout.has(s.workoutId)) lastByWorkout.set(s.workoutId, s.date);
  }
  const nextWorkout = (workouts ?? [])
    .map((w) => ({ w, lastDate: lastByWorkout.get(w.id) ?? '' }))
    .sort((a, b) => {
      if (a.lastDate === b.lastDate) return a.w.order - b.w.order;
      return a.lastDate < b.lastDate ? -1 : 1;
    })[0]?.w;

  const streak = computeStreak((completedSessions ?? []).map((s) => s.date));

  const monthStart = format(startOfMonth(parseISO(today)), 'yyyy-MM-dd');
  const sessionsThisMonth = (completedSessions ?? []).filter((s) => s.date >= monthStart).length;
  const weeklyVolume = computeWeeklyVolume(completedSessions ?? [], today);

  const recentPR =
    (completedSessions ?? [])
      .map((s) => ({ id: s.id, date: s.date, count: s.prCount ?? 0 }))
      .find((s) => s.count > 0);

  return (
    <div className="pt-3">
      <header className="flex items-center justify-between mb-4 px-1">
        <div>
          <p className="text-xs text-fg-muted">{formatHebDateFull(today)}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">היי, מוכן לאימון?</h1>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="btn-icon"
          aria-label="הגדרות"
        >
          <IconSettings />
        </button>
      </header>

      {/* Next workout card */}
      {nextWorkout && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Link
            to="/workout"
            state={{ workoutId: nextWorkout.id }}
            className="block card bg-gradient-to-bl from-accent-soft via-ink-850 to-ink-850 p-4 mb-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wider text-fg-muted">האימון הבא</p>
                <h2 className="text-lg font-bold mt-1 truncate">{nextWorkout.name}</h2>
                <p className="text-xs text-fg-muted mt-1">
                  {lastByWorkout.get(nextWorkout.id)
                    ? `לאחרונה: ${lastByWorkout.get(nextWorkout.id)}`
                    : 'אימון ראשון'}
                </p>
              </div>
              <div className="shrink-0 w-12 h-12 rounded-2xl bg-accent text-ink-950 flex items-center justify-center">
                <IconBarbell size={24} />
              </div>
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent">
              התחל אימון ←
            </div>
          </Link>
        </motion.div>
      )}

      {/* Quick stats */}
      <Section title="סטטיסטיקות">
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={<IconFlame className="text-accent" />} label="רצף ימים" value={String(streak)} sub="אימונים" />
          <Stat icon={<IconCalendar className="text-info" />} label="החודש" value={String(sessionsThisMonth)} sub="אימונים" />
          <Stat
            icon={<IconChart className="text-good" />}
            label="נפח שבועי"
            value={weeklyVolume === 0 ? '—' : `${weeklyVolume.toLocaleString('he-IL')}`}
            sub="ק״ג × חזרות"
          />
          <Stat
            icon={<IconTrophy className="text-warn" />}
            label="שיא אחרון"
            value={recentPR ? recentPR.date : '—'}
            sub={recentPR ? `${recentPR.count} שיאים` : 'אין עדיין'}
          />
        </div>
      </Section>

      {/* Stall flags */}
      {stalls.length > 0 && (
        <Section
          title="המלצות התקדמות"
          description="אזורים שתקועים ב-3 אימונים האחרונים"
        >
          <ul className="space-y-2">
            {stalls.slice(0, 3).map((s) => {
              const dismissed = settings.dismissedStalls[s.exerciseId];
              if (dismissed === s.lastThreeSessionIds[2]) return null;
              return (
                <li key={s.exerciseId} className="card p-3 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-warn-soft text-warn flex items-center justify-center shrink-0">
                    <IconWarn />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{s.exerciseName}</p>
                    <p className="text-xs text-fg-muted">{s.reason}</p>
                    <p className="text-xs mt-1">
                      <span className="text-fg-muted">המלצה: </span>
                      דה-לוד ~10% או החלפת התרגיל לכמה שבועות.
                    </p>
                  </div>
                  <button
                    className="btn-subtle !min-h-9 !px-2 text-xs"
                    onClick={() =>
                      updateSettings({
                        dismissedStalls: {
                          ...settings.dismissedStalls,
                          [s.exerciseId]: s.lastThreeSessionIds[2] ?? '',
                        },
                      })
                    }
                  >
                    סגור
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Today's supplements */}
      <Section
        title="תוספים להיום"
        action={
          <Link to="/supplements" className="text-xs text-accent font-semibold">
            הכל ←
          </Link>
        }
      >
        {supplements.length === 0 ? (
          <div className="card p-3 text-sm text-fg-muted text-center">
            לא הוגדרו תוספים. הוסיפו תוסף ראשון בלשונית התוספים.
          </div>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {supplements.slice(0, 6).map((row) => (
              <li key={`${row.supplement.id}-${row.scheduledTime}`} className="p-3 flex items-center gap-3">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-2xs font-bold shrink-0"
                  style={{ backgroundColor: row.supplement.color + '33', color: row.supplement.color }}
                >
                  {row.supplement.name.slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate text-sm">{row.supplement.name}</p>
                  <p className="text-2xs text-fg-muted">
                    {row.supplement.dose} {row.supplement.unit} · {row.scheduledTime}
                    {row.supplement.withFood ? ' · עם אוכל' : ''}
                  </p>
                </div>
                <span
                  className={`chip ${
                    row.log?.status === 'taken'
                      ? 'border-good/40 text-good bg-good-soft'
                      : row.log?.status === 'skipped'
                        ? 'border-bad/40 text-bad bg-bad-soft'
                        : 'border-line text-fg-muted'
                  }`}
                >
                  {row.log?.status === 'taken'
                    ? '✓ נלקח'
                    : row.log?.status === 'skipped'
                      ? 'דולג'
                      : 'ממתין'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Link to="/workout" className="card p-3 flex items-center gap-3 hover:bg-ink-800 transition-colors">
          <IconBarbell className="text-accent" />
          <span className="text-sm font-semibold">התחל אימון</span>
        </Link>
        <Link to="/progress" className="card p-3 flex items-center gap-3 hover:bg-ink-800 transition-colors">
          <IconChart className="text-info" />
          <span className="text-sm font-semibold">צפה בהתקדמות</span>
        </Link>
        <Link to="/supplements" className="card p-3 flex items-center gap-3 hover:bg-ink-800 transition-colors">
          <IconPill className="text-good" />
          <span className="text-sm font-semibold">נהל תוספים</span>
        </Link>
        <Link to="/settings" className="card p-3 flex items-center gap-3 hover:bg-ink-800 transition-colors">
          <IconClock className="text-warn" />
          <span className="text-sm font-semibold">טיימר מנוחה</span>
        </Link>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-7 h-7 rounded-lg bg-ink-800 border border-line flex items-center justify-center">
          {icon}
        </span>
        <span className="text-2xs text-fg-muted">{label}</span>
      </div>
      <p className="num text-2xl font-bold">{value}</p>
      <p className="text-2xs text-fg-muted">{sub}</p>
    </div>
  );
}
