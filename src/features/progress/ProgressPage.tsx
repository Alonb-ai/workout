import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import {
  IconArrowLeft,
  IconBarbell,
  IconChart,
  IconTrophy,
} from '@/components/Icon';
import { sortSessionsDesc } from '@/utils/scoring';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatHebDate } from '@/utils/dates';
import { useMemo } from 'react';
import { format, subDays } from 'date-fns';

export function ProgressPage() {
  const sessions = useLiveQuery(
    () => db.sessions.filter((s) => s.status === 'completed').toArray(),
    [],
  ) ?? [];
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
          date: s.date.slice(5),
          score: s.score ?? 0,
          volume: s.totalVolume ?? 0,
        })),
    [sorted],
  );

  return (
    <div className="pt-3">
      <header className="mb-3">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">התקדמות</p>
        <h1 className="text-2xl font-extrabold">היומן שלך</h1>
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
            <Section title="ציון אימון לאורך זמן">
              <div className="card p-2">
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={scoreSeries} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis yAxisId="left" domain={[0, 100]} />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip
                        contentStyle={{
                          background: '#0b0d10',
                          border: '1px solid #262b33',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="score"
                        stroke="#ff7a1a"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        name="ציון"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="volume"
                        stroke="#3ddc84"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                        name="נפח"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Section>
          )}

          {volumeByMuscle && volumeByMuscle.length > 0 && (
            <Section title="נפח לפי קבוצת שריר" description="60 הימים האחרונים">
              <div className="card p-2">
                <div style={{ width: '100%', height: Math.max(160, volumeByMuscle.length * 28) }}>
                  <ResponsiveContainer>
                    <BarChart data={volumeByMuscle} layout="vertical">
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          background: '#0b0d10',
                          border: '1px solid #262b33',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="vol" fill="#ff7a1a" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Section>
          )}

          <Section title="יומן אימונים">
            <ul className="space-y-2">
              {sorted.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/progress/session/${s.id}`}
                    className="card p-3 flex items-center gap-3 hover:bg-ink-800 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-xl bg-ink-800 border border-line flex flex-col items-center justify-center shrink-0">
                      <p className="text-2xs text-fg-muted">ציון</p>
                      <p className="num text-base font-bold">{s.score ?? '—'}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">
                        <span className="num text-fg-muted me-1.5">{s.workoutCode}</span>
                        {s.workoutName}
                      </p>
                      <p className="text-2xs text-fg-muted">
                        {formatHebDate(s.date)} ·{' '}
                        {(s.totalVolume ?? 0).toLocaleString('he-IL')}kg נפח
                      </p>
                    </div>
                    {(s.prCount ?? 0) > 0 && (
                      <span className="chip border-warn/40 text-warn bg-warn-soft">
                        <IconTrophy size={11} /> {s.prCount}
                      </span>
                    )}
                    <IconArrowLeft size={18} className="text-fg-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

