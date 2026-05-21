import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { IconArrowRight, IconChart, IconTrophy } from '@/components/Icon';
import { getExerciseHistory } from '@/db/queries';
import { statsForExercise, compareToPrevious } from '@/utils/scoring';
import { detectStall } from '@/utils/stall';
import { formatHebDate } from '@/utils/dates';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

export function ExerciseHistoryPage() {
  const { exerciseId = '' } = useParams();
  const exercise = useLiveQuery(() => db.exercises.get(exerciseId), [exerciseId]);
  const history = useLiveQuery(
    () => (exerciseId ? getExerciseHistory(exerciseId) : Promise.resolve([])),
    [exerciseId],
  );

  if (!exercise) {
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

  const chartData = stats.map((s) => ({
    date: s.date,
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
        <p className="text-2xs uppercase tracking-wider text-fg-muted">תרגיל</p>
        <h1 className="text-2xl font-extrabold">{exercise.name}</h1>
        <p className="text-xs text-fg-muted">
          יעד: {exercise.targetSets}×{exercise.targetRepsMin}-{exercise.targetRepsMax} ·
          מנוחה {Math.round(exercise.defaultRestSec / 60)} דק׳
          {exercise.barWeight > 0 && ` · מוט ${exercise.barWeight}kg`}
        </p>
      </header>

      {stall && (
        <div className="card p-3 border-warn/40 bg-warn-soft mb-4 flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-warn text-ink-950 flex items-center justify-center shrink-0">
            <IconTrophy />
          </span>
          <div className="text-sm">
            <p className="font-semibold text-warn">סטטוס: תקוע</p>
            <p className="text-xs text-fg-muted mt-1">{stall.reason}</p>
            <p className="text-xs mt-1">
              <span className="text-fg-muted">המלצה: </span>
              דה-לוד של ~10% (כ-{(stall.topWeight * 0.9).toFixed(1)}kg) או החלפת התרגיל לכמה שבועות.
            </p>
          </div>
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
            <div className="card p-2">
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip
                      contentStyle={{
                        background: '#0b0d10',
                        border: '1px solid #262b33',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#9aa3ad' }}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="משקל מקס"
                      stroke="#ff7a1a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="1RM משוער"
                      stroke="#6ec1ff"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="נפח"
                      stroke="#3ddc84"
                      strokeWidth={1.5}
                      dot={false}
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
                  <li key={h.session.id} className="card p-3">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div>
                        <p className="font-semibold text-sm">{formatHebDate(h.session.date)}</p>
                        <p className="text-2xs text-fg-muted">
                          {h.exerciseLog.targetSets}×{h.exerciseLog.targetRepsMin}-{h.exerciseLog.targetRepsMax}
                        </p>
                      </div>
                      <span
                        className={`chip ${
                          tag.kind === 'pr'
                            ? 'border-warn/40 text-warn bg-warn-soft'
                            : tag.kind === 'up'
                              ? 'border-good/40 text-good bg-good-soft'
                              : tag.kind === 'down'
                                ? 'border-bad/40 text-bad bg-bad-soft'
                                : 'border-line text-fg-muted'
                        }`}
                      >
                        {tag.kind === 'pr' && <IconTrophy size={12} />} {tag.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Mini label="משקל מקס" value={`${cur.topWeight}kg × ${cur.topReps}`} />
                      <Mini label="נפח" value={`${cur.volume.toLocaleString('he-IL')}kg`} />
                      <Mini label="1RM" value={`${cur.est1RM.toFixed(1)}`} />
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {h.sets.map((s) => (
                        <div
                          key={s.id}
                          className="num text-xs flex items-center justify-between bg-ink-900 rounded-lg px-2 py-1"
                        >
                          <span>סט {s.setNumber}</span>
                          <span>
                            {s.weight}kg × {s.reps}
                          </span>
                        </div>
                      ))}
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

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-flat p-2">
      <p className="text-2xs text-fg-muted">{label}</p>
      <p className="num text-sm font-bold">{value}</p>
    </div>
  );
}
