import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { IconArrowLeft, IconBarbell, IconChart, IconTrophy } from '@/components/Icon';
import { sortSessionsDesc } from '@/utils/scoring';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatHebDate, formatHebDateFull } from '@/utils/dates';
import { useMemo } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { he } from 'date-fns/locale';

/** Palette-matched chart chrome. Axes are hairlines, ticks are quiet. */
const AXIS_TICK = { fontSize: 10, fill: '#6a727d' } as const;

interface TipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: { full?: string };
}

/**
 * RTL tooltip. `.recharts-tooltip-wrapper` is already flipped back to rtl in
 * index.css, so this is laid out like any other card: label on top, one row per
 * series, the figure trailing.
 */
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

/** ≥80 is a strong session, ≥60 a solid one. Quiet colour, no badge. */
function scoreTone(score: number | undefined): string {
  if (score === undefined) return 'text-fg-dim';
  if (score >= 80) return 'text-good';
  if (score >= 60) return 'text-accent-text';
  return 'text-fg';
}

export function ProgressPage() {
  const sessions =
    useLiveQuery(() => db.sessions.filter((s) => s.status === 'completed').toArray(), []) ?? [];
  const sorted = sortSessionsDesc(sessions);

  // Volume per muscle group across the last 60 days
  const volumeByMuscle = useLiveQuery(async () => {
    const logs = await db.exerciseLogs.toArray();
    const sets = await db.setLogs.toArray();
    const setsByLog = new Map<string, typeof sets>();
    for (const s of sets) {
      const arr = setsByLog.get(s.exerciseLogId) ?? [];
      arr.push(s);
      setsByLog.set(s.exerciseLogId, arr);
    }
    const sessMap = new Map(sessions.map((s) => [s.id, s]));
    const cutoff = format(subDays(new Date(), 60), 'yyyy-MM-dd');
    const totals = new Map<string, number>();
    for (const log of logs) {
      const sess = sessMap.get(log.sessionId);
      if (!sess || sess.status !== 'completed' || sess.date < cutoff) continue;
      const ls = setsByLog.get(log.id) ?? [];
      const vol = ls.reduce((s, x) => (x.completed ? s + x.weight * x.reps : s), 0);
      totals.set(log.muscleGroupName, (totals.get(log.muscleGroupName) ?? 0) + vol);
    }
    return Array.from(totals.entries())
      .map(([name, vol]) => ({ name, vol: Math.round(vol) }))
      .sort((a, b) => b.vol - a.vol);
  }, [sessions.length]);

  const scoreSeries = useMemo(
    () =>
      [...sorted]
        .reverse()
        .slice(-20)
        .map((s) => ({
          // Never an ISO fragment on the axis — "07-25" is a database value.
          label: format(parseISO(s.date), 'd/M'),
          full: formatHebDate(s.date),
          score: s.score ?? 0,
          volume: s.totalVolume ?? 0,
        })),
    [sorted],
  );

  const latest = sorted[0];
  const previous = sorted[1];
  const scoreDelta =
    latest?.score !== undefined && previous?.score !== undefined
      ? latest.score - previous.score
      : null;

  const maxMuscleVol = volumeByMuscle?.[0]?.vol ?? 0;

  // Journal grouped by month — a flat list of 60 rows has no landmarks.
  const months = useMemo(() => {
    const out: { key: string; label: string; items: typeof sorted }[] = [];
    for (const s of sorted) {
      const key = s.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(s);
      else
        out.push({
          key,
          label: format(parseISO(s.date), 'MMMM yyyy', { locale: he }),
          items: [s],
        });
    }
    return out;
  }, [sorted]);

  return (
    <div className="pt-3">
      <header className="mb-4 px-1">
        <p className="eyebrow">התקדמות</p>
        <h1 className="text-2xl font-extrabold tracking-tight">היומן שלך</h1>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          title="אין עדיין אימונים שמורים"
          description="לאחר אימון אחד תופיע כאן התקדמות."
          icon={<IconChart />}
          action={
            <Link to="/workout" className="btn-primary">
              <IconBarbell /> התחל אימון
            </Link>
          }
        />
      ) : (
        <>
          {scoreSeries.length > 0 && (
            <section className="card overflow-hidden mb-5">
              {/* The screen's headline: the last score, set as a figure, with the
                  trend it sits on drawn underneath it. */}
              <div className="flex items-end justify-between gap-3 px-3.5 pt-3">
                <div className="min-w-0">
                  <p className="eyebrow">ציון אחרון</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className={`num-display text-4xl leading-none ${scoreTone(latest?.score)}`}>
                      {latest?.score ?? '—'}
                    </span>
                    {scoreDelta !== null && scoreDelta !== 0 && (
                      <span
                        className={`num text-xs font-bold ${scoreDelta > 0 ? 'text-good' : 'text-bad'}`}
                      >
                        {scoreDelta > 0 ? '+' : ''}
                        {scoreDelta}
                      </span>
                    )}
                  </div>
                  {latest && (
                    <p className="text-2xs text-fg-dim mt-1 truncate">
                      {formatHebDateFull(latest.date)}
                    </p>
                  )}
                </div>
                <p className="eyebrow shrink-0 pb-1">{scoreSeries.length} אימונים אחרונים</p>
              </div>

              <div className="mt-2" style={{ width: '100%', height: 168 }}>
                <ResponsiveContainer>
                  <ComposedChart data={scoreSeries} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <defs>
                      <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff7a1a" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#ff7a1a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {/* Horizontal rules only — vertical gridlines just add noise. */}
                    <CartesianGrid vertical={false} stroke="#1e232a" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={AXIS_TICK}
                      minTickGap={18}
                    />
                    <YAxis
                      yAxisId="left"
                      domain={[0, 100]}
                      ticks={[0, 50, 100]}
                      width={26}
                      axisLine={false}
                      tickLine={false}
                      tick={AXIS_TICK}
                    />
                    {/* The volume series stays, its axis does not: two numeric
                        scales on a phone-width chart is chrome, not information. */}
                    <YAxis yAxisId="right" orientation="right" hide />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: '#2c323a', strokeWidth: 1 }} />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="score"
                      stroke="#ff7a1a"
                      strokeWidth={2}
                      fill="url(#scoreFill)"
                      dot={false}
                      activeDot={{ r: 3.5, fill: '#ff7a1a', stroke: '#06080b', strokeWidth: 2 }}
                      name="ציון"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="volume"
                      stroke="#6ec1ff"
                      strokeOpacity={0.55}
                      strokeWidth={1.25}
                      strokeDasharray="3 3"
                      dot={false}
                      activeDot={{ r: 3, fill: '#6ec1ff', stroke: '#06080b', strokeWidth: 2 }}
                      name="נפח"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {volumeByMuscle && volumeByMuscle.length > 0 && (
            <Section title="נפח לפי קבוצת שריר" description="60 הימים האחרונים">
              {/* Hand-drawn bars rather than a Recharts BarChart: the chart had to
                  be forced LTR to render, and a groove-and-fill row is both denser
                  and natively RTL. */}
              <ul className="card p-3 space-y-2.5">
                {volumeByMuscle.map((m) => (
                  <li key={m.name}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-medium truncate">{m.name}</span>
                      <span className="num text-2xs text-fg-muted shrink-0">
                        {m.vol.toLocaleString('he-IL')} ק״ג
                      </span>
                    </div>
                    <div className="field h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${maxMuscleVol > 0 ? Math.max(2, (m.vol / maxMuscleVol) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="יומן אימונים">
            <div className="space-y-4">
              {months.map((group) => (
                <div key={group.key}>
                  <p className="eyebrow px-1 mb-1.5">
                    {group.label} · {group.items.length}
                  </p>
                  <ul className="space-y-2">
                    {group.items.map((s) => (
                      <li key={s.id}>
                        <Link
                          to={`/progress/session/${s.id}`}
                          className="card p-2.5 flex items-center gap-3 active:scale-[0.99] transition-transform duration-150"
                        >
                          {/* The score is the figure the row is about — recessed
                              well, so it reads as a reading, not a button. */}
                          <div className="field shrink-0 w-14 h-14 flex flex-col items-center justify-center gap-0.5">
                            <span className="eyebrow leading-none">ציון</span>
                            <span
                              className={`num-display text-xl leading-none ${scoreTone(s.score)}`}
                            >
                              {s.score ?? '—'}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1.5">
                              <span className="num-display text-sm text-accent-text shrink-0">
                                {s.workoutCode}
                              </span>
                              <span className="font-semibold text-sm truncate">{s.workoutName}</span>
                            </div>
                            <p className="text-2xs text-fg-muted mt-0.5 truncate">
                              {formatHebDate(s.date)}
                            </p>
                            <p className="text-2xs text-fg-dim mt-0.5">
                              <span className="num">
                                {(s.totalVolume ?? 0).toLocaleString('he-IL')}kg נפח
                              </span>
                            </p>
                          </div>

                          {(s.prCount ?? 0) > 0 && (
                            <span className="chip shrink-0 border-warn/25 bg-warn/[0.07] text-warn">
                              <IconTrophy size={11} /> {s.prCount}
                            </span>
                          )}
                          <IconArrowLeft size={16} className="text-fg-ghost shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
