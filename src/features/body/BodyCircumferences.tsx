import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import { formatHebDate } from '@/utils/dates';
import type { BodyMeasurement } from '@/types';
import { CIRCUMFERENCES, circumferenceChange, type CircumferenceKey } from './bodyMetrics';

const COLOR = '#6ec1ff';

/**
 * One tape-measure line at a time, picked from chips. Five lines on one small
 * chart is spaghetti; the chips double as a summary of each field's change.
 */
export function BodyCircumferences({ list }: { list: BodyMeasurement[] }) {
  const available = useMemo(
    () =>
      CIRCUMFERENCES.map((c) => ({ ...c, change: circumferenceChange(list, c.key) })).filter(
        (c) => c.change !== null,
      ),
    [list],
  );
  const [picked, setPicked] = useState<CircumferenceKey | null>(null);
  const active = available.find((c) => c.key === picked) ?? available[0];

  const data = useMemo(
    () =>
      active
        ? list
            .filter((m) => m[active.key] !== undefined)
            .map((m) => ({ date: m.date, value: m[active.key] as number }))
        : [],
    [list, active],
  );

  if (!active) return null;

  return (
    <div className="card p-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="היקף">
        {available.map((c) => {
          const d = c.change!;
          const on = c.key === active.key;
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPicked(c.key)}
              className={`min-h-11 px-3 rounded-xl text-xs flex items-baseline gap-1.5 ${
                on ? 'card-flat text-fg' : 'field text-fg-muted'
              }`}
            >
              <span className="font-semibold">{c.label}</span>
              <span className="num">{d.last}</span>
              {d.count > 1 && d.delta !== 0 && (
                <bdi dir="ltr" className={`num text-2xs ${d.delta < 0 ? 'text-info' : 'text-accent-text'}`}>
                  {d.delta > 0 ? '+' : '−'}
                  {Math.abs(d.delta)}
                </bdi>
              )}
            </button>
          );
        })}
      </div>

      {data.length >= 2 ? (
        <div className="h-40 mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="circFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={COLOR} stopOpacity={0} />
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
              <YAxis axisLine={false} tickLine={false} width={40} domain={['dataMin - 1', 'dataMax + 1']} />
              <Tooltip
                cursor={{ stroke: '#2c323a', strokeWidth: 1 }}
                contentStyle={{
                  background: '#0b0d10',
                  border: '1px solid #262b33',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#6a727d', fontSize: 11, marginBottom: 2 }}
                labelFormatter={(d: string) => formatHebDate(d)}
                formatter={(value: number) => [`${value} ס״מ`, active.label]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={COLOR}
                strokeWidth={2}
                fill="url(#circFill)"
                dot={{ r: 2.5, fill: COLOR, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-2xs text-fg-dim mt-3 px-0.5">גרף יופיע אחרי מדידה שנייה של {active.label}.</p>
      )}
    </div>
  );
}
