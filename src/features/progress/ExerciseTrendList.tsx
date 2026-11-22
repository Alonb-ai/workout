import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExerciseTrend } from '@/utils/progressMetrics';
import { formatTopSets } from '@/utils/progressMetrics';
import { formatHebDate } from '@/utils/dates';
import { IconArrowLeft } from '@/components/Icon';

const STATUS: Record<ExerciseTrend['status'], { label: string; text: string; rule: string }> = {
  up: { label: 'עולה', text: 'text-good', rule: 'bg-good' },
  flat: { label: 'יציב', text: 'text-fg-muted', rule: 'bg-fg-ghost' },
  down: { label: 'יורד', text: 'text-bad', rule: 'bg-bad' },
  new: { label: 'חדש', text: 'text-info', rule: 'bg-info' },
};

/**
 * Inline SVG sparkline of the measure. Hand-drawn rather than one Recharts
 * instance per row: 30 charts on one screen is a lot of SVG measuring for a
 * shape that only needs to say "up" or "down". Time runs left → right, the
 * same as every Recharts chart in the app.
 */
function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const W = 72;
  const H = 24;
  if (values.length < 2) return <span className="w-[72px] shrink-0" aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = 2 + (i / (values.length - 1)) * (W - 4);
    const y = H - 2 - ((v - min) / span) * (H - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1]!.split(',');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={`shrink-0 ${tone}`} aria-hidden>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />
      <circle cx={last[0]} cy={last[1]} r={2.25} fill="currentColor" />
    </svg>
  );
}

function TrendRow({ t, linkable }: { t: ExerciseTrend; linkable: boolean }) {
  const st = STATUS[t.status];
  const recent = t.points.slice(-8).map((p) => p.measure);
  const body = (
    <>
      <span className={`absolute inset-y-0 start-0 w-[3px] ${st.rule}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{t.name}</p>
        <p className="num text-2xs text-fg-muted mt-0.5 truncate" dir="ltr" style={{ textAlign: 'right' }}>
          {formatTopSets(t.latest)}
        </p>
        <p className="text-2xs text-fg-dim mt-0.5 truncate">
          {formatHebDate(t.latest.date)}
          {t.repsToIncrease !== null && t.repsToIncrease > 0 && t.repsToIncrease <= 3 && (
            <span className="text-accent-text">
              {' · '}
              {t.repsToIncrease === 1 ? 'חסרה חזרה אחת לעלייה' : `חסרות ${t.repsToIncrease} חזרות לעלייה`}
            </span>
          )}
          {t.repsToIncrease === 0 && <span className="text-good"> · הגעת ליעד, הזמן לעלות במשקל</span>}
        </p>
      </div>
      <Sparkline values={recent} tone={st.text} />
      <div className="w-14 shrink-0 text-end">
        <p dir="ltr" className={`num-display text-sm text-end ${st.text}`}>
          {t.changePct === null ? '—' : `${t.changePct > 0 ? '+' : ''}${t.changePct}%`}
        </p>
        <p className={`eyebrow ${st.text}`}>{st.label}</p>
      </div>
      {linkable && <IconArrowLeft size={14} className="text-fg-ghost shrink-0" />}
    </>
  );
  const cls = 'card relative overflow-hidden p-2.5 ps-3.5 flex items-center gap-2.5';
  return linkable ? (
    <Link
      to={`/workout/exercise/${t.exerciseId}/history`}
      className={`${cls} active:scale-[0.99] transition-transform duration-150`}
      aria-label={`היסטוריה: ${t.name}`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Rows shown before "show all": the journal shouldn't sink below 30 cards. */
const COLLAPSED = 8;

/**
 * Every exercise trained in the window, each against its own baseline.
 * `existing` holds the ids still in the plan — a deleted exercise keeps its
 * row (its history is real) but has no history page to open.
 */
export function ExerciseTrendList({
  trends,
  existing,
}: {
  trends: ExerciseTrend[];
  existing: Set<string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? trends : trends.slice(0, COLLAPSED);
  const counts = { up: 0, flat: 0, down: 0 };
  for (const t of trends) if (t.status !== 'new') counts[t.status]++;
  return (
    <>
      <div className="flex gap-2 mb-2 px-1 text-2xs">
        <span className="chip border-good/25 bg-good/[0.06] text-good">{counts.up} עולים</span>
        <span className="chip">{counts.flat} יציבים</span>
        <span className="chip border-bad/25 bg-bad/[0.06] text-bad">{counts.down} יורדים</span>
      </div>
      <ul className="space-y-2">
        {shown.map((t) => (
          <li key={t.exerciseId}>
            <TrendRow t={t} linkable={existing.has(t.exerciseId)} />
          </li>
        ))}
      </ul>
      {trends.length > COLLAPSED && (
        <button type="button" className="btn-ghost w-full mt-2" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'הצג פחות' : `הצג את כל ${trends.length} התרגילים`}
        </button>
      )}
    </>
  );
}
