import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconCopy,
  IconTrophy,
  IconWarn,
} from '@/components/Icon';
import { todayISO } from '@/utils/dates';
import { toast } from '@/store/toast';
import { shareText } from '@/utils/shareText';
import {
  PR_LABEL,
  buildWeeklySummary,
  shiftWeek,
  weekStartOf,
  weeklySummaryText,
  type WeeklySummary,
} from '@/utils/weeklySummary';

/** "22–28 בנובמבר", or "29 בנובמבר – 5 בדצמבר" across a month boundary. */
export function weekLabel(weekStart: string): string {
  const a = parseISO(weekStart);
  const b = addDays(a, 6);
  if (a.getMonth() === b.getMonth()) {
    return `${format(a, 'd')}–${format(b, 'd בMMMM', { locale: he })}`;
  }
  return `${format(a, 'd בMMMM', { locale: he })} – ${format(b, 'd בMMMM', { locale: he })}`;
}

/** "+3" / "−2" against last week. Rendered LTR so the sign stays in front. */
function Delta({ cur, prev, unit = '' }: { cur: number; prev: number; unit?: string }) {
  const d = cur - prev;
  if (prev === 0 && cur === 0) return null;
  const tone = d > 0 ? 'text-good' : d < 0 ? 'text-fg-muted' : 'text-fg-dim';
  return (
    <span className={`num text-2xs ${tone}`}>
      {d === 0 ? (
        'כמו שבוע שעבר'
      ) : (
        <bdi dir="ltr">
          {d > 0 ? '+' : '−'}
          {Math.abs(d).toLocaleString('he-IL')}
          {unit}
        </bdi>
      )}
    </span>
  );
}

function Tile({ label, value, cur, prev }: { label: string; value: string; cur: number; prev: number }) {
  return (
    <div className="field px-2.5 py-2.5 min-w-0">
      <p className="eyebrow truncate">{label}</p>
      <p className="num-display text-2xl leading-none mt-1.5">{value}</p>
      <p className="mt-1 leading-none truncate">
        <Delta cur={cur} prev={prev} />
      </p>
    </div>
  );
}

export function WeeklySummaryPage() {
  const thisWeek = weekStartOf(todayISO());
  const [weekStart, setWeekStart] = useState(thisWeek);

  const data = useLiveQuery(async () => {
    const [sessions, logs, sets, measurements] = await Promise.all([
      db.sessions.toArray(),
      db.exerciseLogs.toArray(),
      db.setLogs.toArray(),
      db.bodyMeasurements.toArray(),
    ]);
    return { sessions, logs, sets, measurements };
  }, []);

  const summary: WeeklySummary | null = useMemo(
    () => (data ? buildWeeklySummary({ ...data, weekStart }) : null),
    [data, weekStart],
  );
  const firstWeek = useMemo(() => {
    const dates = (data?.sessions ?? []).filter((s) => s.status === 'completed').map((s) => s.date);
    return dates.length > 0 ? weekStartOf(dates.sort()[0]!) : thisWeek;
  }, [data, thisWeek]);

  const label = weekLabel(weekStart);
  const isCurrent = weekStart === thisWeek;

  async function onShare() {
    if (!summary) return;
    const res = await shareText('סיכום שבועי', weeklySummaryText(summary, label));
    if (res === 'copied') toast.success('הסיכום הועתק');
    else if (res === 'failed') toast.warn('לא ניתן לשתף מהמכשיר הזה');
  }

  const maxSets = summary ? Math.max(1, ...summary.muscles.map((m) => Math.max(m.sets, m.prevSets))) : 1;

  return (
    <div className="pt-3">
      <header className="mb-3 px-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">סיכום שבועי</p>
          <h1 className="text-2xl font-extrabold tracking-tight truncate">{label}</h1>
          <p className="text-2xs text-fg-dim mt-0.5">{isCurrent ? 'השבוע הנוכחי · עד עכשיו' : 'ראשון עד שבת'}</p>
        </div>
        <Link to="/progress" className="btn-ghost !min-h-10 !px-3 text-xs shrink-0">
          התקדמות
        </Link>
      </header>

      {/* Week stepper. RTL: "previous" sits on the right and points right. */}
      <div className="seg !flex w-full items-center mb-4">
        <button
          type="button"
          className="btn-icon !min-w-11 !min-h-11"
          aria-label="שבוע קודם"
          disabled={weekStart <= firstWeek}
          onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
        >
          <IconArrowRight size={18} />
        </button>
        <button
          type="button"
          className="flex-1 text-xs text-fg-muted min-h-11 disabled:opacity-100"
          disabled={isCurrent}
          onClick={() => setWeekStart(thisWeek)}
        >
          {isCurrent ? 'השבוע' : 'חזרה לשבוע הנוכחי'}
        </button>
        <button
          type="button"
          className="btn-icon !min-w-11 !min-h-11"
          aria-label="שבוע הבא"
          disabled={isCurrent}
          onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
        >
          <IconArrowLeft size={18} />
        </button>
      </div>

      {!summary ? (
        <div className="card p-6 text-center text-fg-muted">טוען…</div>
      ) : (
        <>
          <section className="card p-3.5 mb-5" aria-label="סיכום השבוע">
            <div className="grid grid-cols-3 gap-2">
              <Tile label="אימונים" value={String(summary.sessions)} cur={summary.sessions} prev={summary.prevSessions} />
              <Tile label="סטים" value={String(summary.sets)} cur={summary.sets} prev={summary.prevSets} />
              <Tile
                label="נפח (ק״ג)"
                value={summary.volume >= 10000 ? `${Math.round(summary.volume / 1000)}K` : summary.volume.toLocaleString('he-IL')}
                cur={summary.volume}
                prev={summary.prevVolume}
              />
            </div>
            {(summary.strengthChangePct !== null || summary.bodyWeightChange !== null) && (
              <ul className="mt-3 space-y-1.5 text-xs">
                {summary.strengthChangePct !== null && (
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="text-fg-muted">כוח מול הביצוע הקודם ({summary.compared} תרגילים)</span>
                    <bdi
                      dir="ltr"
                      className={`num-display text-base ${
                        summary.strengthChangePct > 0.5
                          ? 'text-good'
                          : summary.strengthChangePct < -0.5
                            ? 'text-bad'
                            : 'text-fg'
                      }`}
                    >
                      {summary.strengthChangePct > 0 ? '+' : ''}
                      {summary.strengthChangePct}%
                    </bdi>
                  </li>
                )}
                {summary.bodyWeightChange !== null && (
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="text-fg-muted">משקל גוף</span>
                    <bdi dir="ltr" className="num-display text-base">
                      {summary.bodyWeightChange > 0 ? '+' : ''}
                      {summary.bodyWeightChange} kg
                    </bdi>
                  </li>
                )}
              </ul>
            )}
          </section>

          {summary.sessions === 0 && (
            <div className="card-flat p-4 mb-5 flex items-center gap-3">
              <span className="text-fg-dim">
                <IconCalendar />
              </span>
              <p className="text-sm text-fg-muted">
                {isCurrent ? 'עוד לא התאמנת השבוע.' : 'לא נרשמו אימונים בשבוע הזה.'}
              </p>
            </div>
          )}

          {summary.prs.length > 0 && (
            <Section title={`שיאים · ${summary.prs.length}`}>
              <ul className="card divide-y divide-line-muted overflow-hidden">
                {summary.prs.map((p) => (
                  <li key={p.exerciseId} className="relative ps-4 pe-3 py-2.5 flex items-center gap-3 bg-good/[0.06]">
                    <span className="absolute inset-y-0 start-0 w-[3px] bg-good" aria-hidden />
                    <span className="text-warn shrink-0">
                      <IconTrophy size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" dir="auto">
                        {p.name}
                      </p>
                      <p className="text-2xs text-fg-muted">
                        {PR_LABEL[p.kind]} · <bdi dir="ltr" className="num">{p.detail}</bdi>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {summary.muscles.length > 0 && (
            <Section title="סטים לפי שריר" description="השבוע מול שבוע שעבר (הפס הדק)">
              <ul className="card p-3 space-y-3">
                {summary.muscles.map((m) => (
                  <li key={m.name}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-medium truncate">{m.name}</span>
                      <span className="flex items-baseline gap-2 shrink-0">
                        <span className="num text-2xs text-fg-dim">{m.volume.toLocaleString('he-IL')} ק״ג</span>
                        <span className="num-display text-sm">{m.sets}</span>
                        <span className="text-2xs text-fg-muted">סטים</span>
                        <Delta cur={m.sets} prev={m.prevSets} />
                      </span>
                    </div>
                    <div className="field h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${m.sets > 0 ? Math.max(3, (m.sets / maxSets) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="h-[3px] mt-1 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-fg-ghost"
                        style={{ width: `${m.prevSets > 0 ? Math.max(3, (m.prevSets / maxSets) * 100) : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {summary.stuck.length > 0 && (
            <Section title={`תקועים · ${summary.stuck.length}`} description="3 אימונים ומעלה בלי שיפור במשקל, בחזרות או בנפח">
              <ul className="card divide-y divide-line-muted overflow-hidden">
                {summary.stuck.map((x) => (
                  <li key={x.exerciseId} className="relative ps-4 pe-3 py-2.5 bg-warn/[0.06]">
                    <span className="absolute inset-y-0 start-0 w-[3px] bg-warn" aria-hidden />
                    <div className="flex items-start gap-3">
                      <span className="text-warn shrink-0 mt-0.5">
                        <IconWarn size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" dir="auto">
                          {x.name}
                        </p>
                        <p className="text-2xs text-fg-muted">
                          <bdi dir="ltr" className="num">{x.detail}</bdi> · {x.outings} אימונים ברצף
                        </p>
                        <p className="text-2xs text-fg-dim mt-0.5">
                          {x.repsToIncrease !== null && x.repsToIncrease > 0 && x.repsToIncrease <= 3
                            ? `קרוב: עוד ${x.repsToIncrease === 1 ? 'חזרה אחת' : `${x.repsToIncrease} חזרות`} ומעלים משקל`
                            : 'שקול להוריד ~10% במשקל ולבנות מחדש, או להחליף תרגיל'}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {summary.sessions > 0 && (
            <button type="button" className="btn-ghost w-full mb-6" onClick={onShare}>
              <IconCopy /> שתף סיכום
            </button>
          )}
        </>
      )}
    </div>
  );
}
