import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import {
  IconBarbell,
  IconCalendar,
  IconChart,
  IconCheck,
  IconEdit,
  IconFlame,
  IconList,
  IconSettings,
  IconTrophy,
  IconWarn,
} from '@/components/Icon';
import { formatHebDate, formatHebDateFull, todayISO } from '@/utils/dates';
import { daysSinceLastWorkout } from '@/utils/dates';
import { commitDraft } from '../workout/buildSession';
import { getLatestBodyMeasurement } from '@/db/queries';
import { toast } from '@/store/toast';
import { useStallFlags } from './useStallFlags';
import { useTodaySupplements } from '../supplements/useTodaySupplements';
import { computeWeeklyVolume } from './stats';
import { motion } from 'framer-motion';
import { format, differenceInDays, parseISO, startOfMonth } from 'date-fns';
import { updateSettings } from '@/hooks/useSettings';
import { useSettings } from '@/hooks/useSettings';

export function DashboardPage() {
  const today = todayISO();
  const navigate = useNavigate();
  const settings = useSettings();
  const [committing, setCommitting] = useState<string | null>(null);

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
  const drafts = useLiveQuery(
    async () => (await db.workoutDrafts.toArray()).sort((a, b) => b.updatedAt - a.updatedAt),
    [],
  );
  // The one correct implementation, in queries.ts — the inline sort here had no
  // tiebreak for same-date rows, so "latest" disagreed between screens.
  const latestBody = useLiveQuery(() => getLatestBodyMeasurement(), []);

  // `undefined` = the query hasn't resolved; `null` = there really is no plan.
  // Conflating them replaced the whole dashboard with "אין תכנית פעילה" for a
  // frame on every single visit.
  if (activePlan === undefined) {
    return <div className="card p-6 text-center text-fg-muted mt-6">טוען…</div>;
  }

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

  const daysSince = daysSinceLastWorkout((completedSessions ?? []).map((s) => s.date));

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

      {/* In-progress drafts. A draft dated before today is a workout the user
          logged and forgot to save — it gets a one-tap rescue instead of a
          "continue editing" link, because forgetting to save is the single
          biggest way this app used to lose his data. */}
      {drafts && drafts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-5 space-y-2"
        >
          {drafts.map((d) => {
            const totalSets = d.drafts.reduce((s, ex) => s + ex.targetSets, 0);
            const doneSets = d.drafts.reduce(
              (s, ex) => s + ex.sets.filter((x) => x.completed).length,
              0,
            );
            const forgotten = d.sessionDate < today && doneSets > 0;

            if (forgotten) {
              return (
                <div
                  key={d.workoutId}
                  className="card border-warn/50 bg-warn-soft/30 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-warn-soft text-warn flex items-center justify-center">
                      <IconWarn size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-2xs uppercase tracking-wider text-warn">
                        אימון שלא נשמר
                      </p>
                      <p className="font-bold truncate text-sm">{d.workoutName}</p>
                      <p className="text-2xs text-fg-muted num">
                        {formatHebDate(d.sessionDate)} · {doneSets}/{totalSets} סטים
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-primary flex-1 !min-h-10 text-xs"
                      disabled={committing === d.workoutId}
                      onClick={async () => {
                        setCommitting(d.workoutId);
                        try {
                          const res = await commitDraft(d);
                          toast.success(`האימון נשמר · ציון ${res.score}`);
                        } catch (e) {
                          console.error(e);
                          toast.error('שמירת האימון נכשלה. נסו שוב.');
                        } finally {
                          setCommitting(null);
                        }
                      }}
                    >
                      <IconCheck size={14} />
                      {committing === d.workoutId ? 'שומר…' : 'שמור עכשיו'}
                    </button>
                    <Link
                      to="/workout"
                      state={{ workoutId: d.workoutId }}
                      className="btn-ghost !min-h-10 text-xs"
                    >
                      <IconEdit size={14} /> עריכה
                    </Link>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={d.workoutId}
                to="/workout"
                state={{ workoutId: d.workoutId }}
                className="block card border-accent/40 bg-accent-soft/30 p-3 flex items-center gap-3"
              >
                <div className="shrink-0 w-10 h-10 rounded-xl bg-accent text-ink-950 flex items-center justify-center">
                  <IconEdit size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-2xs uppercase tracking-wider text-accent">המשך טיוטה</p>
                  <p className="font-bold truncate text-sm">{d.workoutName}</p>
                  <p className="text-2xs text-fg-muted num">
                    {doneSets}/{totalSets} סטים · נשמרה {format(new Date(d.updatedAt), 'HH:mm')}
                  </p>
                </div>
                <span className="text-accent text-xs font-semibold">המשך ←</span>
              </Link>
            );
          })}
        </motion.div>
      )}

      {/* Next workout card */}
      {nextWorkout && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* The screen's one job. The workout code is set as a display figure,
              the muscle groups read underneath it, and starting is a real
              button rather than a line of orange text pretending to be one. */}
          <Link
            to="/workout"
            state={{ workoutId: nextWorkout.id }}
            className="card-hero block p-4 mb-5 active:scale-[0.99] transition-transform duration-150"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">האימון הבא</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="num-display text-3xl leading-none text-accent-text">
                    {nextWorkout.code}
                  </span>
                  <h2 className="text-base font-bold truncate">
                    {nextWorkout.name.split('—')[0]?.trim()}
                  </h2>
                </div>
                <p className="text-xs text-fg-muted mt-1.5 truncate">
                  {nextWorkout.name.split('—')[1]?.trim() ?? ''}
                </p>
                <p className="text-2xs text-fg-dim mt-1">
                  {lastByWorkout.get(nextWorkout.id)
                    ? `לאחרונה ${formatHebDate(lastByWorkout.get(nextWorkout.id)!)}`
                    : 'עוד לא ביצעת אותו'}
                </p>
              </div>
              <span className="shrink-0 w-12 h-12 rounded-2xl bg-accent text-ink-950 flex items-center justify-center shadow-accent-lift">
                <IconBarbell size={24} />
              </span>
            </div>
            <span className="btn-primary w-full mt-4 !min-h-11 text-sm">התחל אימון</span>
          </Link>
        </motion.div>
      )}

      {/* Quick stats */}
      <Section title="סטטיסטיקות">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            icon={<IconFlame className="text-accent" />}
            label="מאז אימון"
            value={daysSince === null ? '—' : daysSince === 0 ? 'היום' : String(daysSince)}
            sub={daysSince === null ? 'עוד לא התאמנת' : daysSince === 0 ? 'כל הכבוד' : 'ימים'}
          />
          <Stat icon={<IconCalendar className="text-info" />} label="החודש" value={String(sessionsThisMonth)} sub="אימונים" />
          <Stat
            icon={<IconChart className="text-good" />}
            label="נפח שבועי"
            value={weeklyVolume === 0 ? '—' : `${weeklyVolume.toLocaleString('he-IL')}`}
            sub="ק״ג × חזרות"
          />
          {/* Was rendering the raw ISO date ("2026-07-23") as a display figure. */}
          <Stat
            icon={<IconTrophy className="text-warn" />}
            label="שיא אחרון"
            value={recentPR ? String(recentPR.count) : '—'}
            sub={recentPR ? `שיאים · ${formatHebDate(recentPR.date)}` : 'אין עדיין'}
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
                    {s.deload && (
                      <p className="text-xs mt-1">
                        <span className="text-fg-muted">דה-לוד: </span>
                        <span className="num">
                          {s.deload.fromKg.toFixed(1)} → {s.deload.toKg.toFixed(1)} kg
                        </span>
                        <span className="text-fg-muted"> (–{s.deload.pct}%)</span>
                      </p>
                    )}
                    {s.substitutes && s.substitutes.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        <span className="text-2xs text-fg-muted shrink-0">או החלף ל:</span>
                        {s.substitutes.slice(0, 2).map((sub) => (
                          <span
                            key={sub.id}
                            className="chip border-info/40 text-info bg-info-soft truncate max-w-[10rem]"
                          >
                            {sub.name}
                          </span>
                        ))}
                      </div>
                    )}
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

      {/* Body measurement chip — surfaces the last weigh-in or nudges first entry */}
      <Section title="גוף">
        <Link
          to="/body"
          className="card p-3 flex items-center gap-3 hover:bg-ink-800 transition-colors"
        >
          <span className="w-10 h-10 rounded-xl bg-info-soft text-info flex items-center justify-center">
            <IconList />
          </span>
          {latestBody ? (
            <div className="flex-1 min-w-0">
              <p className="flex items-baseline gap-1.5">
                <span className="num-display text-lg leading-none">
                  {latestBody.bodyWeight.toFixed(1)}
                </span>
                <span className="text-2xs text-fg-muted">ק״ג</span>
                {latestBody.fatPct !== undefined && (
                  <>
                    <span className="text-fg-ghost">·</span>
                    <span className="num-display text-sm leading-none">{latestBody.fatPct}%</span>
                    <span className="text-2xs text-fg-muted">שומן</span>
                  </>
                )}
              </p>
              <p className="text-2xs text-fg-dim mt-1">
                לפני {differenceInDays(new Date(), parseISO(latestBody.date))} ימים
              </p>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">הוסף מדידת גוף ראשונה</p>
              <p className="text-2xs text-fg-muted">משקל · % שומן · מסת שריר</p>
            </div>
          )}
          <span className="text-info text-xs font-semibold">פתח ←</span>
        </Link>
      </Section>

      {/* ponytail: the four "quick links" that used to sit here were the bottom
          tab bar again, one scroll further down. Deleted. */}
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
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg bg-ink-800 border border-line-muted flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5">
          {icon}
        </span>
        <span className="eyebrow truncate">{label}</span>
      </div>
      <p className="num-display text-2xl mt-2 leading-none">{value}</p>
      <p className="text-2xs text-fg-dim mt-1 truncate">{sub}</p>
    </div>
  );
}
