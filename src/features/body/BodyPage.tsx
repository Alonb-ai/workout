import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'framer-motion';
import {
  ComposedChart,
  Area,
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
import { ProfileModal } from './ProfileModal';
import { formatHebDate } from '@/utils/dates';
import { format, parseISO, differenceInDays, isToday, isYesterday } from 'date-fns';
import { he } from 'date-fns/locale';
import { useSettings } from '@/hooks/useSettings';
import {
  computeFFMI,
  categorizeBodyFat,
  isProfileComplete,
  FFMI_CATEGORY_LABEL,
  BODY_FAT_CATEGORY_LABEL,
} from '@/utils/benchmarks';
import type { BodyMeasurement } from '@/types';

const WEIGHT_COLOR = '#ff7a1a';
const FAT_COLOR = '#6ec1ff';

/** Tooltip series labels. The old inline ternary had a dead 'שריר' branch. */
const SERIES_LABEL: Record<string, string> = {
  bodyWeight: 'משקל (kg)',
  fatPct: '% שומן',
};

/**
 * Dense-list date: no weekday, so the row's second line still fits the phone.
 * Still never a raw ISO string.
 */
function shortHebDate(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return 'היום';
  if (isYesterday(d)) return 'אתמול';
  return format(d, 'd בMMMM', { locale: he });
}

export function BodyPage() {
  const measurements = useLiveQuery(() => getBodyMeasurementsAsc(), []);
  const settings = useSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
      // Never a raw ISO date in front of the user.
      body: `המדידה מ-${formatHebDate(m.date)} תימחק. אין שחזור.`,
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
  const deltaDays =
    latest && prev ? differenceInDays(parseISO(latest.date), parseISO(prev.date)) : null;
  const daysAgo = latest ? differenceInDays(new Date(), parseISO(latest.date)) : 0;

  const profile = settings.bodyProfile;
  const sex = profile?.sex ?? 'male';
  const ffmi =
    latest && latest.fatPct !== undefined && profile?.heightCm
      ? computeFFMI(latest.bodyWeight, latest.fatPct, profile.heightCm, sex)
      : null;
  const fatCategory =
    latest && latest.fatPct !== undefined ? categorizeBodyFat(latest.fatPct, sex) : null;
  const profileComplete = isProfileComplete(profile);
  const hasFat = list.some((m) => m.fatPct !== undefined);

  // The two secondary readings on the latest measurement, as a recessed strip
  // inside the hero. Built as a list so one-of-two renders full width.
  const subStats: { label: string; value: string; unit: string }[] = [];
  if (latest?.fatPct !== undefined)
    subStats.push({ label: 'אחוז שומן', value: String(latest.fatPct), unit: '%' });
  if (latest?.muscleMass !== undefined)
    subStats.push({ label: 'מסת שריר', value: String(latest.muscleMass), unit: 'kg' });

  return (
    <div className="pt-3">
      <header className="flex items-center justify-between mb-4 px-1">
        <div>
          <p className="eyebrow">גוף</p>
          <h1 className="text-2xl font-extrabold tracking-tight">מדידות גוף</h1>
        </div>
        <button className="btn-primary !min-h-10 !px-3.5 text-xs" onClick={onAdd}>
          <IconPlus size={15} /> מדידה
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
              {/* The screen's one job: the last weigh-in, as a figure, with the
                  trend it makes against the previous one. */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="card-hero p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">מדידה אחרונה</p>
                    <p className="flex items-baseline gap-1.5 mt-1.5">
                      <span className="num-display text-[2.75rem] leading-none">
                        {latest.bodyWeight.toFixed(1)}
                      </span>
                      <span className="text-sm text-fg-muted">kg</span>
                    </p>
                    <p className="text-2xs text-fg-dim mt-2">
                      {formatHebDate(latest.date)}
                      {daysAgo > 1 && ` · לפני ${daysAgo} ימים`}
                    </p>
                  </div>

                  {weightDelta !== null && (
                    <div className="field shrink-0 px-3 py-2 text-center min-w-[5.25rem]">
                      {weightDelta === 0 ? (
                        <p className="text-xs font-semibold text-fg-muted leading-none py-0.5">
                          ללא שינוי
                        </p>
                      ) : (
                        <p className="flex items-baseline justify-center gap-1 leading-none">
                          <span
                            className={
                              weightDelta > 0 ? 'text-accent-text text-xs' : 'text-info text-xs'
                            }
                            aria-hidden
                          >
                            {weightDelta > 0 ? '▲' : '▼'}
                          </span>
                          <span className="num-display text-base">
                            {Math.abs(weightDelta).toFixed(1)}
                          </span>
                          <span className="text-2xs text-fg-muted">kg</span>
                        </p>
                      )}
                      <p className="text-2xs text-fg-dim mt-1.5 leading-none">
                        {deltaDays === null || deltaDays === 0
                          ? 'מהקודמת'
                          : `ב-${deltaDays} ימים`}
                      </p>
                    </div>
                  )}
                </div>

                {subStats.length > 0 && (
                  <div className="field mt-4 grid divide-x divide-line-muted"
                    style={{ gridTemplateColumns: `repeat(${subStats.length}, minmax(0, 1fr))` }}
                  >
                    {subStats.map((s) => (
                      <div key={s.label} className="px-3 py-2.5">
                        <p className="eyebrow">{s.label}</p>
                        <p className="flex items-baseline gap-1 mt-1">
                          <span className="num-display text-lg leading-none">{s.value}</span>
                          <span className="text-2xs text-fg-muted">{s.unit}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </Section>
          )}

          {/* Profile + benchmarks: visible only if there's at least one
              measurement to compare against. */}
          {latest && (
            <Section
              title="פרופיל ובנצ'מרקים"
              description={
                profileComplete
                  ? `יחס למתאמן ${sex === 'male' ? 'זכר' : 'נקבה'}${profile?.heightCm ? ` · ${profile.heightCm}cm` : ''}`
                  : 'הזן גובה ומין כדי לראות FFMI וסטנדרטים'
              }
              action={
                <button
                  className="btn-ghost !min-h-9 !px-3 text-xs shrink-0"
                  onClick={() => setProfileOpen(true)}
                >
                  {profileComplete ? 'ערוך פרופיל' : 'הגדר פרופיל'}
                </button>
              }
            >
              {fatCategory || ffmi ? (
                <div className="grid grid-cols-2 gap-2">
                  {fatCategory && latest.fatPct !== undefined && (
                    <div className="card-flat p-3">
                      <p className="eyebrow truncate">קטגוריית שומן</p>
                      <p className="flex items-baseline gap-1 mt-2">
                        <span className="num-display text-2xl leading-none">{latest.fatPct}</span>
                        <span className="text-2xs text-fg-muted">%</span>
                      </p>
                      <p className="text-2xs text-fg-dim mt-1 truncate">
                        {BODY_FAT_CATEGORY_LABEL[fatCategory]}
                      </p>
                    </div>
                  )}
                  {ffmi && (
                    <div className="card-flat p-3">
                      <p className="eyebrow truncate">FFMI</p>
                      <p className="num-display text-2xl leading-none mt-2">{ffmi.normalized}</p>
                      <p className="text-2xs text-fg-dim mt-1 truncate">
                        {FFMI_CATEGORY_LABEL[ffmi.category]}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="card-flat p-3 text-2xs text-fg-muted">
                  {!profileComplete
                    ? 'FFMI וקטגוריית שומן דורשים גובה ומין בפרופיל, ואחוז שומן במדידה.'
                    : 'הוסף אחוז שומן במדידה כדי לקבל FFMI וקטגוריית שומן.'}
                </p>
              )}
              <p className="text-2xs text-fg-dim mt-2 px-1">
                סטנדרטי כוח לתרגילים גדולים מוצגים בדף ההיסטוריה של כל תרגיל.
              </p>
            </Section>
          )}

          {list.length >= 2 && (
            <Section
              title="מגמה"
              action={
                <div className="seg !flex px-2 py-1 gap-3 text-2xs text-fg-muted shrink-0">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden /> משקל
                  </span>
                  {hasFat && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-info" aria-hidden /> שומן %
                    </span>
                  )}
                </div>
              }
            >
              <div className="card p-2 pt-3">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={list} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="bodyWeightFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={WEIGHT_COLOR} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={WEIGHT_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 4" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      {/* Weight (~80) and fat% (~15) need separate axes, or the
                          shared domain flattens the weight trend to a line. */}
                      <YAxis
                        yAxisId="w"
                        axisLine={false}
                        tickLine={false}
                        width={46}
                        domain={['dataMin - 1', 'dataMax + 1']}
                      />
                      {hasFat && (
                        <YAxis
                          yAxisId="f"
                          orientation="right"
                          axisLine={false}
                          tickLine={false}
                          width={34}
                          domain={['dataMin - 1', 'dataMax + 1']}
                        />
                      )}
                      <Tooltip
                        cursor={{ stroke: '#2c323a', strokeWidth: 1 }}
                        contentStyle={{
                          background: '#0b0d10',
                          border: '1px solid #262b33',
                          borderRadius: 12,
                          fontSize: 12,
                          boxShadow: '0 16px 40px -20px #000000e6',
                        }}
                        labelStyle={{ color: '#6a727d', fontSize: 11, marginBottom: 2 }}
                        labelFormatter={(d: string) => format(parseISO(d), 'dd/MM/yyyy')}
                        formatter={(value: number, name: string) => [
                          value,
                          SERIES_LABEL[name] ?? name,
                        ]}
                      />
                      <Area
                        yAxisId="w"
                        type="monotone"
                        dataKey="bodyWeight"
                        stroke={WEIGHT_COLOR}
                        strokeWidth={2}
                        fill="url(#bodyWeightFill)"
                        dot={{ r: 2.5, fill: WEIGHT_COLOR, strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                        // The sweep-in costs 1.5s of blank chart on every visit,
                        // and re-runs whenever the live query re-emits.
                        isAnimationActive={false}
                      />
                      {hasFat && (
                        <Line
                          yAxisId="f"
                          type="monotone"
                          dataKey="fatPct"
                          stroke={FAT_COLOR}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={{ r: 2.5, fill: FAT_COLOR, strokeWidth: 0 }}
                          activeDot={{ r: 4 }}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Section>
          )}

          <Section title="היסטוריה" description={`${list.length} מדידות`}>
            <ul className="card divide-y divide-line-muted overflow-hidden">
              {[...list].reverse().map((m, i, rows) => {
                const before = rows[i + 1];
                const d = before
                  ? Number((m.bodyWeight - before.bodyWeight).toFixed(1))
                  : null;
                return (
                  <li key={m.id} className="ps-3 pe-1 py-1.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="num-display text-base shrink-0">
                          {m.bodyWeight.toFixed(1)} kg
                        </span>
                        {d !== null && d !== 0 && (
                          <span
                            className={`text-2xs font-semibold shrink-0 ${
                              d > 0 ? 'text-accent-text' : 'text-info'
                            }`}
                          >
                            <span aria-hidden>{d > 0 ? '▲' : '▼'}</span>{' '}
                            <span className="num">{Math.abs(d).toFixed(1)}</span>
                          </span>
                        )}
                        <span className="text-2xs text-fg-dim ms-auto truncate">
                          {shortHebDate(m.date)}
                        </span>
                      </div>
                      {(m.fatPct !== undefined || m.muscleMass !== undefined) && (
                        <p className="text-2xs text-fg-dim truncate">
                          {m.fatPct !== undefined && (
                            <>
                              <span className="num">{m.fatPct}%</span> שומן
                            </>
                          )}
                          {m.fatPct !== undefined && m.muscleMass !== undefined && ' · '}
                          {m.muscleMass !== undefined && (
                            <>
                              <span className="num">{m.muscleMass} kg</span> שריר
                            </>
                          )}
                        </p>
                      )}
                      {m.notes && (
                        <p className="text-2xs text-fg-ghost mt-0.5 truncate">{m.notes}</p>
                      )}
                    </div>
                    <button
                      className="btn-icon !min-w-11 !min-h-11 text-fg-dim"
                      aria-label="ערוך"
                      onClick={() => onEdit(m)}
                    >
                      <IconEdit size={16} />
                    </button>
                    {/* Destructive, but not shouting red while you read the list. */}
                    <button
                      className="btn-icon !min-w-11 !min-h-11 text-fg-ghost hover:text-bad"
                      aria-label="מחק"
                      onClick={() => onDelete(m)}
                    >
                      <IconTrash size={16} />
                    </button>
                  </li>
                );
              })}
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
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        initial={profile}
      />
    </div>
  );
}
