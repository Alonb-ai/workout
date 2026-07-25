import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { IconArrowRight, IconChart, IconTrophy, IconWarn } from '@/components/Icon';
import { getExerciseHistory, getLatestBodyMeasurement } from '@/db/queries';
import { statsForExercise, compareToPrevious } from '@/utils/scoring';
import { detectStall } from '@/utils/stall';
import { computeProgressionRate, suggestDeload, findSubstitutes } from '@/utils/insights';
import {
  matchStrengthLift,
  assessStrength,
  STRENGTH_LEVEL_LABELS,
} from '@/utils/benchmarks';
import { useSettings } from '@/hooks/useSettings';
import { formatHebDate, formatHM } from '@/utils/dates';
import { format, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';

const AXIS_TICK = { fontSize: 10, fill: '#6a727d' } as const;

interface TipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: { full?: string };
}

/** Palette-matched, RTL tooltip. See the twin in ProgressPage. */
function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const title = payload[0]?.payload?.full ?? String(label ?? '');
  return (
    <div className="card-flat shadow-raised px-2.5 py-2 min-w-[9rem]">
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="space-y-1">
        {payload.map((e) => (
          <li key={String(e.name)} className="flex items-center gap-2 text-2xs">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: e.color ?? '#6a727d' }}
              aria-hidden
            />
            <span className="text-fg-muted">{e.name}</span>
            <span className="num-display text-fg ms-auto">
              {typeof e.value === 'number' ? e.value.toLocaleString('he-IL') : e.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * An advisory note: a 3px rule on the leading edge and a tint of a few percent.
 * All three insights share it, so they read as one column of remarks instead of
 * three cards competing for the top of the screen.
 */
function InsightCard({
  tone,
  icon,
  eyebrow,
  children,
}: {
  tone: 'accent' | 'info' | 'warn';
  icon: React.ReactNode;
  eyebrow: React.ReactNode;
  children: React.ReactNode;
}) {
  const rule =
    tone === 'warn' ? 'bg-warn' : tone === 'info' ? 'bg-info' : 'bg-accent';
  const tint =
    tone === 'warn' ? 'bg-warn/[0.07]' : tone === 'info' ? 'bg-info/[0.06]' : 'bg-accent/[0.07]';
  const text =
    tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-info' : 'text-accent-text';

  return (
    <div className={`card relative overflow-hidden flex items-start gap-2.5 p-3 ${tint}`}>
      <span className={`absolute inset-y-0 start-0 w-[3px] ${rule}`} aria-hidden />
      <span className={`shrink-0 mt-0.5 ${text}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`eyebrow ${text}`}>{eyebrow}</p>
        {children}
      </div>
    </div>
  );
}

const TAG_STYLE: Record<string, string> = {
  pr: 'border-warn/25 bg-warn/[0.07] text-warn',
  up: 'border-good/25 bg-good/[0.06] text-good',
  down: 'border-bad/25 bg-bad/[0.06] text-bad',
};

export function ExerciseHistoryPage() {
  const { exerciseId = '' } = useParams();

  // EVERY hook runs unconditionally, before any early return. `useLiveQuery`
  // always yields `undefined` on the first render, so a guard placed above the
  // later hooks changed the hook count between render 1 and render 2 — React
  // threw, and with no error boundary the entire app unmounted to a white
  // screen every single time this page was opened.
  // `?? null` distinguishes "still loading" (undefined) from "no such exercise".
  const exercise = useLiveQuery(
    async () => (exerciseId ? ((await db.exercises.get(exerciseId)) ?? null) : null),
    [exerciseId],
  );
  const history = useLiveQuery(
    async () => (exerciseId ? getExerciseHistory(exerciseId) : []),
    [exerciseId],
  );
  const allExercises = useLiveQuery(() => db.exercises.toArray(), []);
  const settings = useSettings();
  const latestBody = useLiveQuery(() => getLatestBodyMeasurement(), []);

  if (exercise === undefined) {
    return <div className="card p-6 text-center text-fg-muted mt-6">טוען…</div>;
  }

  if (exercise === null) {
    return (
      <div className="pt-6">
        <Link to="/workout" className="btn-subtle"><IconArrowRight size={16} /> חזרה</Link>
        <EmptyState title="תרגיל לא נמצא" icon={<IconChart />} />
      </div>
    );
  }

  const safeHistory = history ?? [];
  const stats = safeHistory.map((h) =>
    statsForExercise(h.session.id, exercise.id, h.session.date, h.sets, h.exerciseLog.targetSets),
  );
  const stall = detectStall(stats, exercise.name);
  const progression = computeProgressionRate(stats);
  const deload = stall ? suggestDeload(stats) : null;
  const subs = stall ? findSubstitutes(exercise.id, allExercises ?? [], 3) : [];

  // Strength-standard benchmark — only for the big lifts and only when we have
  // both a current bodyweight and the user's sex on file.
  const liftKey = matchStrengthLift(exercise.name);
  const bestEst1Rm = stats.reduce((m, s) => Math.max(m, s.est1RM), 0);
  const strength =
    liftKey && bestEst1Rm > 0 && latestBody && settings.bodyProfile?.sex
      ? assessStrength(liftKey, bestEst1Rm, latestBody.bodyWeight, settings.bodyProfile.sex)
      : null;

  const lastStat = stats[stats.length - 1];
  const prevStat = stats[stats.length - 2];
  const topDelta =
    lastStat && prevStat ? Number((lastStat.topWeight - prevStat.topWeight).toFixed(2)) : 0;

  const chartData = stats.map((s) => ({
    date: s.date,
    full: formatHebDate(s.date),
    'משקל מקס': s.topWeight,
    'נפח': s.volume,
    '1RM משוער': Number(s.est1RM.toFixed(1)),
  }));

  return (
    <div className="pt-3">
      <Link to="/workout" className="btn-subtle !min-h-9 !px-2 text-xs mb-2 inline-flex">
        <IconArrowRight size={14} /> חזרה לאימון
      </Link>

      <header className="mb-4">
        <p className="eyebrow">תרגיל</p>
        <h1 className="text-2xl font-extrabold tracking-tight">{exercise.name}</h1>
        <p className="text-2xs text-fg-muted mt-1">
          יעד: {exercise.targetSets}×{exercise.targetRepsMin}-{exercise.targetRepsMax} ·
          מנוחה {formatHM(exercise.defaultRestSec)}
          {exercise.barWeight > 0 && ` · מוט ${exercise.barWeight}kg`}
        </p>
      </header>

      {(progression || strength || stall) && (
        <div className="space-y-2 mb-5">
          {progression && (
            <InsightCard tone="accent" icon={<IconChart size={16} />} eyebrow="קצב התקדמות">
              <p className="mt-0.5">
                <span
                  className={`num-display text-base ${progression.kgPerMonth >= 0 ? 'text-good' : 'text-bad'}`}
                >
                  {progression.kgPerMonth >= 0 ? '+' : ''}
                  {progression.kgPerMonth} kg / חודש
                </span>
                <span className="num text-2xs text-fg-muted ms-1.5">
                  ({progression.pctPerMonth >= 0 ? '+' : ''}
                  {progression.pctPerMonth}%)
                </span>
              </p>
              <p className="text-2xs text-fg-dim mt-1">
                משקל מקס לאורך {progression.spanDays} ימים ({progression.sampleSize} אימונים)
              </p>
            </InsightCard>
          )}

          {strength && (
            <InsightCard
              tone="info"
              icon={<IconTrophy size={16} />}
              eyebrow={`סטנדרט כוח · ${STRENGTH_LEVEL_LABELS[strength.level]}`}
            >
              <p className="text-xs text-fg-muted mt-1">
                1RM משוער <span className="num text-fg">{strength.oneRm.toFixed(1)}kg</span> ·{' '}
                משקל גוף <span className="num text-fg">{strength.bodyWeight.toFixed(1)}kg</span> ·{' '}
                יחס <span className="num text-fg">×{strength.ratio}</span>
              </p>
              {strength.nextLevel && strength.nextLevelKg !== null && (
                <p className="text-xs mt-1">
                  <span className="text-fg-muted">לרמת </span>
                  <span className="font-semibold">{STRENGTH_LEVEL_LABELS[strength.nextLevel]}</span>
                  <span className="text-fg-muted">: </span>
                  <span className="num text-fg">{strength.nextLevelKg}kg</span>
                </p>
              )}
            </InsightCard>
          )}

          {stall && (
            <InsightCard tone="warn" icon={<IconWarn size={16} />} eyebrow="סטטוס: תקוע">
              <p className="text-xs text-fg-muted mt-1">{stall.reason}</p>
              {deload && (
                <p className="text-xs mt-1">
                  <span className="text-fg-muted">דה-לוד: </span>
                  <span className="num text-fg">
                    {deload.fromKg.toFixed(1)} → {deload.toKg.toFixed(1)} kg
                  </span>
                  <span className="text-fg-muted"> (–{deload.pct}%)</span>
                </p>
              )}
              {subs.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  <span className="text-2xs text-fg-dim shrink-0">או החלף ל:</span>
                  {subs.map((sub) => (
                    <span
                      key={sub.id}
                      className="chip border-info/25 bg-info/[0.06] text-info truncate max-w-[10rem]"
                    >
                      {sub.name}
                    </span>
                  ))}
                </div>
              )}
            </InsightCard>
          )}
        </div>
      )}

      {safeHistory.length === 0 ? (
        <EmptyState
          title="אין היסטוריה לתרגיל זה"
          description="לאחר השלמת אימון הנתונים יופיעו כאן."
          icon={<IconChart />}
        />
      ) : (
        <>
          <Section title="התקדמות">
            <div className="card overflow-hidden pb-3">
              {/* The lift's current working weight is the answer this page owes
                  the user; the curve behind it is the evidence. */}
              <div className="flex items-end justify-between gap-3 px-3.5 pt-3">
                <div className="min-w-0">
                  <p className="eyebrow">משקל מקס אחרון</p>
                  <p className="mt-1 flex items-baseline gap-1.5 leading-none">
                    <span className="num-display text-3xl">{lastStat?.topWeight ?? 0}</span>
                    <span className="text-2xs text-fg-muted">kg</span>
                    {topDelta !== 0 && (
                      <span
                        className={`num text-xs font-bold ${topDelta > 0 ? 'text-good' : 'text-bad'}`}
                      >
                        {topDelta > 0 ? '+' : ''}
                        {topDelta}
                      </span>
                    )}
                  </p>
                </div>
                <p className="eyebrow shrink-0 pb-1">{safeHistory.length} אימונים</p>
              </div>
              <div className="mt-2" style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="#1e232a" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => format(parseISO(d), 'd/M')}
                      axisLine={false}
                      tickLine={false}
                      tick={AXIS_TICK}
                      minTickGap={18}
                    />
                    <YAxis
                      yAxisId="left"
                      width={30}
                      axisLine={false}
                      tickLine={false}
                      tick={AXIS_TICK}
                    />
                    {/* Volume shares the plot but not a second visible scale. */}
                    <YAxis yAxisId="right" orientation="right" hide />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: '#2c323a', strokeWidth: 1 }} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="משקל מקס"
                      stroke="#ff7a1a"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3.5, fill: '#ff7a1a', stroke: '#06080b', strokeWidth: 2 }}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="1RM משוער"
                      stroke="#6ec1ff"
                      strokeOpacity={0.7}
                      strokeWidth={1.25}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={{ r: 3, fill: '#6ec1ff', stroke: '#06080b', strokeWidth: 2 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="נפח"
                      stroke="#3ddc84"
                      strokeOpacity={0.5}
                      strokeWidth={1.25}
                      dot={false}
                      activeDot={{ r: 3, fill: '#3ddc84', stroke: '#06080b', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Section>

          <Section title="היסטוריה לפי אימון">
            <ul className="space-y-2">
              {[...safeHistory].reverse().map((h, i) => {
                const idx = safeHistory.length - 1 - i;
                const cur = stats[idx]!;
                const prev = idx > 0 ? stats[idx - 1]! : null;
                const allPrev = stats.slice(0, idx);
                const tag = compareToPrevious(cur, prev, allPrev);
                return (
                  <li key={h.session.id} className="card overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line/60">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {formatHebDate(h.session.date)}
                        </p>
                        <p className="text-2xs text-fg-dim">
                          יעד {h.exerciseLog.targetSets}×{h.exerciseLog.targetRepsMin}-
                          {h.exerciseLog.targetRepsMax}
                        </p>
                      </div>
                      <span
                        className={`chip shrink-0 ${TAG_STYLE[tag.kind] ?? 'border-line text-fg-dim'}`}
                      >
                        {tag.kind === 'pr' && <IconTrophy size={12} />} {tag.label}
                      </span>
                    </div>

                    <div className="p-2.5">
                      <div className="grid grid-cols-3 gap-1.5">
                        <Mini label="משקל מקס" value={`${cur.topWeight}kg × ${cur.topReps}`} />
                        <Mini label="נפח" value={`${cur.volume.toLocaleString('he-IL')}kg`} />
                        <Mini label="1RM" value={`${cur.est1RM.toFixed(1)}`} />
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        {h.sets.map((s) => (
                          <div
                            key={s.id}
                            className="field flex items-center justify-between px-2 py-1 rounded-lg"
                          >
                            <span className="num text-2xs text-fg-dim">סט {s.setNumber}</span>
                            <span className="num-display text-xs">
                              {s.weight}kg × {s.reps}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

/** A figure inside a card is recessed — the card is the raised surface, not it. */
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="field px-2 py-1.5">
      <p className="eyebrow truncate">{label}</p>
      <p className="num-display text-sm mt-0.5">{value}</p>
    </div>
  );
}
