import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { db } from '@/db/db';
import { getBodyMeasurementsAsc } from '@/db/queries';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { confirmDialog } from '@/components/Confirm';
import { IconChart, IconEdit, IconPlus, IconTrash } from '@/components/Icon';
import { MeasurementModal } from './MeasurementModal';
import { formatHebDate } from '@/utils/dates';
import { format, parseISO, differenceInDays } from 'date-fns';
import type { BodyMeasurement } from '@/types';

export function BodyPage() {
  const measurements = useLiveQuery(() => getBodyMeasurementsAsc(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BodyMeasurement | undefined>(undefined);

  const onAdd = () => {
    setEditing(undefined);
    setModalOpen(true);
  };
  const onEdit = (m: BodyMeasurement) => {
    setEditing(m);
    setModalOpen(true);
  };
  const onDelete = async (m: BodyMeasurement) => {
    const ok = await confirmDialog({
      title: 'למחוק את המדידה?',
      body: `המדידה מ-${m.date} תימחק. אין שחזור.`,
      confirmLabel: 'מחק',
      cancelLabel: 'ביטול',
      destructive: true,
    });
    if (ok) await db.bodyMeasurements.delete(m.id);
  };

  const list = measurements ?? [];
  const latest = list[list.length - 1];
  const prev = list[list.length - 2];
  const weightDelta =
    latest && prev ? Number((latest.bodyWeight - prev.bodyWeight).toFixed(1)) : null;

  return (
    <div className="pt-3">
      <header className="flex items-center justify-between mb-4 px-1">
        <div>
          <p className="text-2xs uppercase tracking-wider text-fg-muted">גוף</p>
          <h1 className="text-2xl font-extrabold tracking-tight">מדידות גוף</h1>
        </div>
        <button className="btn-primary !min-h-9 !px-3 text-xs" onClick={onAdd}>
          <IconPlus size={14} /> מדידה
        </button>
      </header>

      {list.length === 0 ? (
        <div className="pt-6">
          <EmptyState
            title="עוד לא הזנת מדידות"
            description="הוסף משקל גוף — אופציונלית גם % שומן ומסת שריר מ-InBody. נשמור היסטוריה ונציג מגמות."
            icon={<IconChart size={24} />}
            action={
              <button onClick={onAdd} className="btn-primary">
                הוסף מדידה ראשונה
              </button>
            }
          />
        </div>
      ) : (
        <>
          {latest && (
            <Section>
              <div className="card p-4">
                <p className="text-2xs text-fg-muted">מדידה אחרונה</p>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="num text-4xl font-extrabold">
                    {latest.bodyWeight.toFixed(1)}
                  </span>
                  <span className="text-sm text-fg-muted">kg</span>
                  {weightDelta !== null && weightDelta !== 0 && (
                    <span
                      className={`num text-xs font-semibold ${
                        weightDelta < 0 ? 'text-good' : 'text-warn'
                      }`}
                    >
                      {weightDelta > 0 ? '+' : ''}
                      {weightDelta} kg
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-2 text-xs text-fg-muted">
                  {latest.fatPct !== undefined && (
                    <span>
                      שומן · <span className="num text-fg">{latest.fatPct}%</span>
                    </span>
                  )}
                  {latest.muscleMass !== undefined && (
                    <span>
                      שריר · <span className="num text-fg">{latest.muscleMass} kg</span>
                    </span>
                  )}
                </div>
                <p className="text-2xs text-fg-muted mt-1">
                  {formatHebDate(latest.date)} ·{' '}
                  {differenceInDays(new Date(), parseISO(latest.date))} ימים
                </p>
              </div>
            </Section>
          )}

          {list.length >= 2 && (
            <Section title="מגמה">
              <div className="card p-3">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={list} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tick={{ fontSize: 11 }} domain={['dataMin - 1', 'dataMax + 1']} />
                      <Tooltip
                        contentStyle={{
                          background: '#0b0d10',
                          border: '1px solid #262b33',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelFormatter={(d: string) => format(parseISO(d), 'dd/MM/yyyy')}
                        formatter={(value: number, name: string) => {
                          const label =
                            name === 'bodyWeight'
                              ? 'משקל (kg)'
                              : name === 'fatPct'
                                ? '% שומן'
                                : 'שריר (kg)';
                          return [value, label];
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="bodyWeight"
                        stroke="#ff7a1a"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      {list.some((m) => m.fatPct !== undefined) && (
                        <Line
                          type="monotone"
                          dataKey="fatPct"
                          stroke="#6ec1ff"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-4 mt-2 text-2xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent" /> משקל
                  </span>
                  {list.some((m) => m.fatPct !== undefined) && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-info" /> שומן %
                    </span>
                  )}
                </div>
              </div>
            </Section>
          )}

          <Section title="היסטוריה" description={`${list.length} מדידות`}>
            <ul className="card divide-y divide-line overflow-hidden">
              {[...list].reverse().map((m) => (
                <li key={m.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">
                      <span className="num">{m.bodyWeight.toFixed(1)} kg</span>
                      {m.fatPct !== undefined && (
                        <span className="text-fg-muted text-xs ms-2">
                          · <span className="num">{m.fatPct}%</span> שומן
                        </span>
                      )}
                      {m.muscleMass !== undefined && (
                        <span className="text-fg-muted text-xs ms-2">
                          · <span className="num">{m.muscleMass} kg</span> שריר
                        </span>
                      )}
                    </p>
                    <p className="text-2xs text-fg-muted">{formatHebDate(m.date)}</p>
                    {m.notes && (
                      <p className="text-2xs text-fg-muted mt-0.5 truncate">{m.notes}</p>
                    )}
                  </div>
                  <button
                    className="btn-icon !min-w-8 !min-h-8 text-fg-muted"
                    aria-label="ערוך"
                    onClick={() => onEdit(m)}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    className="btn-icon !min-w-8 !min-h-8 text-bad/80"
                    aria-label="מחק"
                    onClick={() => onDelete(m)}
                  >
                    <IconTrash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      <MeasurementModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(undefined);
        }}
        editing={editing}
      />
    </div>
  );
}
