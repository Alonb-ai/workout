import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { disablePush, enablePush, sendTestPush, syncSchedule } from '@/features/push/webPush';
import { db, newId, now } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBell,
  IconCalendar,
  IconCheck,
  IconEdit,
  IconPill,
  IconPlus,
  IconTrash,
  IconX,
} from '@/components/Icon';
import { NumberInput } from '@/components/NumberInput';
import { cn } from '@/utils/cn';
import { useDaySupplements, type TodayRow } from './useTodaySupplements';
import { todayISO, formatHebDateFull, formatHebDate, DAYS_HE_SHORT } from '@/utils/dates';
import { addDays, format, isAfter, parseISO } from 'date-fns';
import type { Supplement, SupplementLog } from '@/types';
import { toast } from '@/store/toast';
import { confirmDialog } from '@/components/Confirm';
import { useSettings, updateSettings } from '@/hooks/useSettings';
import { useRequestNotificationPermission, useNotificationPermission, usePlatformInfo } from '@/hooks/useNotifications';
import { computeAdherence } from './adherence';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { motion } from 'framer-motion';

const DEFAULT_COLORS = ['#ff7a1a', '#6ec1ff', '#3ddc84', '#ffd166', '#ff5c6c', '#bf6dff', '#7ee3a1', '#f59e0b'];

/** 44×44 is the floor for anything a thumb has to hit mid-morning, half awake. */
const TAP = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl transition-[transform,background,color,border-color] duration-150 active:scale-95';
/**
 * Green means one of two things and never both at once: solid = "take this now"
 * (there is exactly one such button on the screen), soft = "already taken".
 * Every other dose keeps a neutral tick so the eye lands on the live one.
 */
const TAKE_NOW = `${TAP} bg-good text-ink-950 shadow-soft`;
const TAKE_DONE = `${TAP} border border-good/30 bg-good/[0.14] text-good`;
const TAKE_IDLE = `${TAP} border border-line bg-ink-800/60 text-fg-muted hover:border-good/30 hover:text-good`;
/** Red when you reach for it, not while you read. */
const QUIET = `${TAP} text-fg-ghost hover:bg-bad/10 hover:text-bad`;

/**
 * A dose is one of five things, and the row has to say which from arm's length.
 * Tint + a 3px rule on the leading edge, per the prescription strip — a solid
 * status slab out-shouts the supplement name it belongs to.
 */
type DoseState = 'taken' | 'skipped' | 'next' | 'late' | 'pending';

const DOSE_STYLE: Record<DoseState, { rule: string; tint: string; text: string; note: string }> = {
  taken: { rule: 'bg-good', tint: 'bg-good/[0.06]', text: 'text-fg-dim', note: '' },
  skipped: { rule: 'bg-bad/60', tint: 'bg-bad/[0.05]', text: 'text-fg-dim', note: '' },
  next: { rule: 'bg-accent', tint: 'bg-accent/[0.07]', text: 'text-accent-text', note: 'הבא' },
  late: { rule: 'bg-warn', tint: 'bg-warn/[0.07]', text: 'text-warn', note: 'באיחור' },
  pending: { rule: '', tint: '', text: 'text-fg', note: '' },
};

export function SupplementsPage() {
  // An installed PWA is resumed, not reloaded — so keep `today` fresh on a timer
  // and on resume, otherwise a tap after midnight logs the dose to yesterday.
  const [today, setToday] = useState<string>(todayISO);
  // Wall-clock HH:MM, used only to decide which pending dose is overdue.
  const [nowHM, setNowHM] = useState<string>(() => format(new Date(), 'HH:mm'));
  const [viewDate, setViewDate] = useState<string>(today);
  const isToday = viewDate === today;

  useEffect(() => {
    const sync = () => {
      setToday(todayISO());
      setNowHM(format(new Date(), 'HH:mm'));
    };
    const id = window.setInterval(sync, 30_000);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  useEffect(() => setViewDate(today), [today]);
  const sups = useLiveQuery(() => db.supplements.orderBy('order').toArray(), []) ?? [];
  const rows = useDaySupplements(viewDate);
  const settings = useSettings();
  const permission = useNotificationPermission();
  const requestPerm = useRequestNotificationPermission();
  const platform = usePlatformInfo();
  const iosNeedsInstall = permission === 'unsupported' && platform.isIOS && !platform.isStandalone;

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Supplement | null>(null);

  const shiftDate = (delta: number) => {
    const next = format(addDays(parseISO(viewDate), delta), 'yyyy-MM-dd');
    // Don't allow navigating into the future.
    if (isAfter(parseISO(next), parseISO(today))) return;
    setViewDate(next);
  };

  // Adherence over last 30 days. Read supplements *inside* the query so Dexie
  // observes that table too and edits (times/days/active) recompute immediately.
  const adherence = useLiveQuery(async () => {
    const allSups = await db.supplements.toArray();
    const allLogs = await db.supplementLogs.toArray();
    return computeAdherence(allSups, allLogs, today);
  }, [today]);

  // Rows arrive sorted by time. The first unlogged one is the dose to act on —
  // it is either coming up or already late, and nothing else on the screen
  // should compete with it.
  const takenCount = rows.filter((r) => r.log?.status === 'taken').length;
  const pendingCount = rows.filter((r) => !r.log).length;
  const overdueCount = isToday
    ? rows.filter((r) => !r.log && r.scheduledTime < nowHM).length
    : 0;
  const nextIndex = rows.findIndex((r) => !r.log);
  const pct = rows.length === 0 ? 0 : Math.round((takenCount / rows.length) * 100);

  const doseState = (row: TodayRow, index: number): DoseState => {
    if (row.log?.status === 'taken') return 'taken';
    if (row.log?.status === 'skipped') return 'skipped';
    if (index !== nextIndex) return 'pending';
    return isToday && row.scheduledTime < nowHM ? 'late' : 'next';
  };

  const openCreate = () => {
    const t = now();
    setDraft({
      id: newId(),
      name: '',
      dose: 1,
      unit: 'כמוסה',
      color: DEFAULT_COLORS[sups.length % DEFAULT_COLORS.length]!,
      withFood: false,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      times: ['08:00'],
      active: true,
      order: sups.length,
      createdAt: t,
      updatedAt: t,
    });
    setEditorOpen(true);
  };

  const openEdit = (s: Supplement) => {
    setDraft({ ...s });
    setEditorOpen(true);
  };

  const onSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('יש להזין שם לתוסף');
      return;
    }
    // An empty daysOfWeek means "every day" downstream, and empty times means the
    // supplement vanishes from the timeline and from all reminders. Reject both —
    // the "פעיל" checkbox is the way to pause a supplement.
    if (draft.daysOfWeek.length === 0) {
      toast.error('בחר לפחות יום אחד בשבוע');
      return;
    }
    if (draft.times.length === 0) {
      toast.error('בחר לפחות שעה אחת');
      return;
    }
    // Sort + dedupe here, not while editing: duplicate times break the timeline
    // (same React key, one log driving two rows).
    const times = [...new Set(draft.times)].sort();
    const exists = await db.supplements.get(draft.id);
    if (exists) {
      await db.supplements.put({ ...draft, times, updatedAt: now() });
      toast.success('עודכן');
    } else {
      await db.supplements.add({ ...draft, times });
      toast.success('נוסף');
    }
    setEditorOpen(false);
  };

  const onLog = async (
    supplementId: string,
    scheduledTime: string,
    status: 'taken' | 'skipped',
  ) => {
    const existing = await db.supplementLogs
      .where('[supplementId+date]')
      .equals([supplementId, viewDate])
      .toArray();
    const match = existing.find((l) => l.scheduledTime === scheduledTime);
    if (match) {
      await db.supplementLogs.update(match.id, {
        status,
        takenAt: status === 'taken' ? Date.now() : (match.takenAt ?? undefined),
      });
    } else {
      const log: SupplementLog = {
        id: newId(),
        supplementId,
        date: viewDate,
        scheduledTime,
        status,
        ...(status === 'taken' ? { takenAt: Date.now() } : {}),
      };
      await db.supplementLogs.add(log);
    }
  };

  const onClearLog = async (supplementId: string, scheduledTime: string) => {
    // Tap-to-clear was easy to hit by accident (the button is large and lives
    // mid-scroll). Confirm before discarding the log so an accidental tap is
    // recoverable.
    const ok = await confirmDialog({
      title: 'לאפס את הסימון?',
      body: `הסימון של ${scheduledTime} יוסר. תוכל לסמן שוב אחר כך.`,
      confirmLabel: 'אפס',
      cancelLabel: 'ביטול',
      destructive: true,
    });
    if (!ok) return;
    const existing = await db.supplementLogs
      .where('[supplementId+date]')
      .equals([supplementId, viewDate])
      .toArray();
    const match = existing.find((l) => l.scheduledTime === scheduledTime);
    if (match) await db.supplementLogs.delete(match.id);
  };

  const enableNotifications = async () => {
    const res = await requestPerm();
    if (res === 'granted') {
      await updateSettings({ notificationsEnabled: true });
      toast.success('התראות הופעלו');
    } else if (res === 'unsupported') {
      toast.error('הדפדפן לא תומך בהתראות');
    } else {
      toast.warn('ההרשאה לא ניתנה — ההתראות מנוטרלות');
    }
  };

  const disableNotifications = async () => {
    await updateSettings({ notificationsEnabled: false });
    toast.info('התראות נוטרלו');
  };

  const [pushBusy, setPushBusy] = useState(false);

  const handleEnablePush = async () => {
    setPushBusy(true);
    try {
      const err = await enablePush(settings);
      if (err) {
        toast.error(err.message);
        return;
      }
      toast.success('פוש לרקע הופעל');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      await disablePush();
      toast.info('פוש לרקע נוטרל');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    try {
      const res = await sendTestPush();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } finally {
      setPushBusy(false);
    }
  };

  // Auto re-sync schedule whenever supplements change while push is enabled.
  useEffect(() => {
    if (!settings.pushSubscribed) return;
    const t = setTimeout(() => {
      void syncSchedule();
    }, 600);
    return () => clearTimeout(t);
  }, [sups, settings.pushSubscribed]);

  const notificationsOn = settings.notificationsEnabled && permission === 'granted';

  return (
    <div className="pt-3">
      <header className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="eyebrow">תוספים</p>
          <h1 className="mt-0.5 truncate text-xl font-extrabold">{formatHebDateFull(today)}</h1>
        </div>
        <button onClick={openCreate} className="btn-primary shrink-0 !min-h-9 !px-3 text-xs">
          <IconPlus size={14} /> תוסף
        </button>
      </header>

      {/* Day navigator. One recessed track — the arrows and the picker ride
          inside it, so it reads as a control strip and not as another card
          competing with the timeline below. */}
      <div className="field mb-4 flex items-center gap-1 p-1">
        <button
          className="btn-icon"
          onClick={() => shiftDate(-1)}
          aria-label="יום קודם"
        >
          <IconArrowRight size={18} />
        </button>
        <button
          className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold transition-colors duration-150 hover:bg-ink-900"
          onClick={() => setViewDate(today)}
          title={isToday ? '' : 'חזור להיום'}
        >
          <span className={cn('truncate', isToday ? 'text-fg' : 'text-accent-text')}>
            {formatHebDate(viewDate)}
          </span>
          {!isToday && (
            <span className="chip shrink-0 border-accent/30 bg-accent-soft text-accent-text">
              חזור להיום
            </span>
          )}
        </button>
        {/* The native picker is better than anything we'd build; it just doesn't
            need to look like a form field. Transparent input over an icon. */}
        <span className="relative shrink-0">
          <span className="btn-icon pointer-events-none text-fg-dim">
            <IconCalendar size={18} />
          </span>
          <input
            type="date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={viewDate}
            max={today}
            onChange={(e) => {
              if (!e.target.value) return;
              if (isAfter(parseISO(e.target.value), parseISO(today))) return;
              setViewDate(e.target.value);
            }}
            aria-label="בחירת תאריך"
          />
        </span>
        <button
          className="btn-icon disabled:opacity-25"
          onClick={() => shiftDate(1)}
          disabled={isToday}
          aria-label="יום הבא"
        >
          <IconArrowLeft size={18} />
        </button>
      </div>

      {/* The timeline is the screen. Everything under it is maintenance. */}
      <Section
        title={isToday ? 'היום' : formatHebDate(viewDate)}
        description={isToday ? 'לוח הזמנים של המנות להיום' : 'סימון רטרואקטיבי של מנות שכבר נלקחו'}
      >
        {rows.length === 0 ? (
          <EmptyState
            title={isToday ? 'אין תוספים פעילים להיום' : 'אין תוספים פעילים לתאריך זה'}
            description={
              sups.length === 0
                ? 'הוסיפו תוסף ראשון כדי להתחיל.'
                : `התוספים שלכם לא מתוזמנים ל${isToday ? 'היום' : 'יום זה'} (יום ראשון/שני/...).`
            }
            icon={<IconPill />}
            action={
              <button className="btn-primary" onClick={openCreate}>
                <IconPlus /> הוסף תוסף
              </button>
            }
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="card overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-3">
              <div className="flex items-baseline gap-1.5">
                <span className="num-display text-2xl leading-none">{takenCount}</span>
                <span className="num text-sm leading-none text-fg-dim">/ {rows.length}</span>
                <span className="text-2xs text-fg-muted">מנות</span>
                {pendingCount > 0 && (
                  <span className={cn('eyebrow ms-auto', overdueCount > 0 ? 'text-warn' : 'text-fg-dim')}>
                    {overdueCount > 0 ? `${overdueCount} באיחור` : `${pendingCount} ממתינות`}
                  </span>
                )}
              </div>
              {/* Recessed groove, accent-free: the fill is the only lit pixel. */}
              <div className="field mt-2.5 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-good transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <ul className="divide-y divide-line-muted border-t border-line">
              {rows.map((row, i) => (
                <DoseRow
                  key={`${row.supplement.id}-${row.scheduledTime}`}
                  row={row}
                  state={doseState(row, i)}
                  onTake={() => onLog(row.supplement.id, row.scheduledTime, 'taken')}
                  onSkip={() => onLog(row.supplement.id, row.scheduledTime, 'skipped')}
                  onClear={() => onClearLog(row.supplement.id, row.scheduledTime)}
                />
              ))}
            </ul>
          </motion.div>
        )}
      </Section>

      {/* Adherence. Hidden entirely until something has actually been scheduled —
          a "0%" on a fresh install reads as "you missed everything". */}
      {adherence && adherence.monthlyPct !== null && (
        <Section title="היענות (30 ימים)">
          <div className="card p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="eyebrow">שבוע אחרון</p>
                <p className="num-display mt-1 text-2xl leading-none text-good">
                  {adherence.weeklyPct === null ? '—' : `${adherence.weeklyPct}%`}
                </p>
              </div>
              <div>
                <p className="eyebrow">חודש אחרון</p>
                <p className="num-display mt-1 text-2xl leading-none text-info">
                  {adherence.monthlyPct}%
                </p>
              </div>
            </div>
            <div className="field mt-3 px-1 py-2">
              <div style={{ width: '100%', height: 120 }}>
                <ResponsiveContainer>
                  <LineChart data={adherence.weekly} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => (d as string).slice(5)}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis domain={[0, 100]} width={28} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: '#0b0d10',
                        border: '1px solid #262b33',
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pct"
                      stroke="#3ddc84"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="ניהול תוספים">
        {sups.length === 0 ? (
          <EmptyState
            title="אין תוספים"
            description="הוסיפו את התוסף הראשון."
            icon={<IconPill />}
            action={
              <button onClick={openCreate} className="btn-primary">
                <IconPlus /> הוסף תוסף ראשון
              </button>
            }
          />
        ) : (
          <ul className="card divide-y divide-line-muted overflow-hidden">
            {sups.map((s) => (
              <li
                key={s.id}
                className={cn('flex items-center gap-2.5 px-2.5 py-2', !s.active && 'opacity-55')}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                  style={{ backgroundColor: s.color + '2b', color: s.color }}
                  aria-hidden="true"
                >
                  {s.name.slice(0, 1) || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    {!s.active && (
                      <span className="chip shrink-0 border-line text-fg-dim">מושהה</span>
                    )}
                  </div>
                  <p className="truncate text-2xs text-fg-dim">
                    <span className="num">{s.dose}</span> {s.unit} ·{' '}
                    <span className="num">{s.times.join(' · ')}</span> ·{' '}
                    {s.daysOfWeek.length === 7 ? 'כל יום' : s.daysOfWeek.map((d) => DAYS_HE_SHORT[d]).join(' ')}
                  </p>
                </div>
                <button className="btn-icon shrink-0" aria-label="ערוך" onClick={() => openEdit(s)}>
                  <IconEdit size={16} />
                </button>
                <button
                  className={QUIET}
                  aria-label="מחק"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `למחוק "${s.name}"?`,
                      body: 'יומן ההיענות לתוסף זה יישאר שמור.',
                      destructive: true,
                      confirmLabel: 'מחק',
                    });
                    if (!ok) return;
                    await db.supplements.delete(s.id);
                    toast.success('נמחק');
                  }}
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Two identical notification cards used to sit above the timeline, so the
          first thing on the screen every morning was setup you did once. One
          card, two rows, at the bottom. */}
      <Section title="תזכורות">
        <div className="card divide-y divide-line-muted overflow-hidden">
          <ReminderRow
            on={notificationsOn}
            title="תזכורות לפי שעה"
            description={
              iosNeedsInstall
                ? 'באייפון צריך להתקין את האפליקציה למסך הבית כדי לקבל התראות.'
                : permission === 'unsupported'
                  ? 'הדפדפן הזה לא תומך בהתראות. נסו דפדפן עדכני.'
                  : notificationsOn
                    ? 'פעיל. ב-iOS דרושה התקנה כ-PWA למסך הבית.'
                    : permission === 'denied'
                      ? 'ההרשאה נחסמה. יש לשנות ידנית בהגדרות הדפדפן.'
                      : 'לא פעיל. הפעלת התראות תשלח תזכורות בשעות שנקבעו.'
            }
            actions={
              notificationsOn ? (
                <button className="btn-ghost flex-1 !min-h-10 text-xs" onClick={disableNotifications}>
                  כבה
                </button>
              ) : (
                <button
                  className="btn-primary flex-1 !min-h-10 text-xs"
                  onClick={enableNotifications}
                  disabled={permission === 'denied' || permission === 'unsupported'}
                >
                  הפעל
                </button>
              )
            }
          >
            {iosNeedsInstall && (
              <div className="field mt-2.5 space-y-1.5 p-3 text-2xs leading-relaxed text-fg-muted">
                <p className="font-semibold text-fg">איך מתקינים באייפון:</p>
                <ol className="list-decimal space-y-1 pr-4">
                  <li>פותחים את האתר ב-Safari (חייב Safari, לא כרום).</li>
                  <li>לוחצים על אייקון השיתוף ⬆️ (בתחתית).</li>
                  <li>בוחרים "הוסף למסך הבית" / "Add to Home Screen".</li>
                  <li>פותחים את האפליקציה מהאייקון החדש במסך הבית.</li>
                  <li>חוזרים לכאן ולוחצים "הפעל".</li>
                </ol>
                <p className="pt-1">דרוש iOS 16.4 ומעלה.</p>
              </div>
            )}
          </ReminderRow>

          <ReminderRow
            on={!!settings.pushSubscribed}
            title="פוש לרקע (עובד גם כשהאפליקציה סגורה)"
            description={
              <>
                {settings.pushSubscribed
                  ? `מסונכרן עם השרת${
                      settings.pushLastSyncAt
                        ? ` · ${new Date(settings.pushLastSyncAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
                        : ''
                    }`
                  : !settings.pushBackendUrl || !settings.pushVapidPublicKey
                    ? 'יש להגדיר Backend URL ו-VAPID Key ב'
                    : 'מוגדר אך לא פעיל. לחץ "הפעל".'}
                {!settings.pushBackendUrl || !settings.pushVapidPublicKey ? (
                  <Link to="/settings" className="ms-1 font-semibold text-accent-text">
                    הגדרות
                  </Link>
                ) : null}
              </>
            }
            actions={
              settings.pushSubscribed ? (
                <>
                  <button
                    className="btn-ghost flex-1 !min-h-10 text-xs"
                    onClick={handleTestPush}
                    disabled={pushBusy}
                  >
                    שלח בדיקה
                  </button>
                  <button
                    className="btn-ghost flex-1 !min-h-10 text-xs"
                    onClick={handleDisablePush}
                    disabled={pushBusy}
                  >
                    כבה
                  </button>
                </>
              ) : (
                <button
                  className="btn-primary flex-1 !min-h-10 text-xs"
                  onClick={handleEnablePush}
                  disabled={pushBusy || !settings.pushBackendUrl || !settings.pushVapidPublicKey}
                >
                  הפעל פוש לרקע
                </button>
              )
            }
          />
        </div>
      </Section>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={draft && (sups.some((s) => s.id === draft.id) ? 'עריכת תוסף' : 'תוסף חדש')}
        size="lg"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditorOpen(false)}>
              ביטול
            </button>
            <button className="btn-primary" onClick={onSave}>
              <IconCheck size={16} /> שמור
            </button>
          </>
        }
      >
        {draft && <SupplementForm draft={draft} onChange={setDraft} />}
      </Modal>
    </div>
  );
}

// ============================================================================
// Timeline row
// ============================================================================

/**
 * One dose. Time leads (the list is a clock), the supplement's colour chip
 * identifies it, and the state is carried by the leading rule + tint rather
 * than by a badge that would need reading.
 */
function DoseRow({
  row,
  state,
  onTake,
  onSkip,
  onClear,
}: {
  row: TodayRow;
  state: DoseState;
  onTake: () => void;
  onSkip: () => void;
  onClear: () => void;
}) {
  const style = DOSE_STYLE[state];
  const sup = row.supplement;
  const settled = state === 'taken' || state === 'skipped';

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('relative flex items-center gap-2 px-2.5 py-2 transition-colors duration-150', style.tint)}
    >
      {style.rule && (
        <span className={cn('absolute inset-y-0 start-0 w-[3px]', style.rule)} aria-hidden="true" />
      )}

      <div className="w-12 shrink-0 text-center">
        <p className={cn('num-display text-sm leading-none', style.text)}>{row.scheduledTime}</p>
        {style.note && <p className={cn('eyebrow mt-1 leading-none', style.text)}>{style.note}</p>}
      </div>

      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
          settled && 'opacity-50',
        )}
        style={{ backgroundColor: sup.color + '2b', color: sup.color }}
        aria-hidden="true"
      >
        {sup.name.slice(0, 1) || '?'}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-semibold',
            state === 'taken' && 'text-fg-muted',
            state === 'skipped' && 'text-fg-dim line-through decoration-fg-ghost',
          )}
        >
          {sup.name}
        </p>
        <p className="truncate text-2xs text-fg-dim">
          <span className="num">{sup.dose}</span> {sup.unit}
          {sup.withFood ? ' · עם אוכל' : ''}
        </p>
      </div>

      {state === 'taken' ? (
        <button type="button" className={TAKE_DONE} aria-label="נלקח · לחץ לאיפוס" onClick={onClear}>
          <IconCheck size={18} />
        </button>
      ) : state === 'skipped' ? (
        <>
          <button type="button" className={TAKE_IDLE} aria-label="סמן כנלקח" onClick={onTake}>
            <IconCheck size={18} />
          </button>
          <button type="button" className={QUIET} aria-label="אפס סימון" onClick={onClear}>
            <IconX size={18} />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={state === 'pending' ? TAKE_IDLE : TAKE_NOW}
            aria-label="נלקח"
            onClick={onTake}
          >
            <IconCheck size={18} />
          </button>
          <button type="button" className={QUIET} aria-label="דלג" onClick={onSkip}>
            <IconX size={18} />
          </button>
        </>
      )}
    </motion.li>
  );
}

// ============================================================================
// Reminder row
// ============================================================================

function ReminderRow({
  on,
  title,
  description,
  actions,
  children,
}: {
  on: boolean;
  title: string;
  description: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="p-3">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'field flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            on ? 'text-good' : 'text-fg-ghost',
          )}
        >
          <IconBell size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          <p className="mt-1 text-2xs leading-relaxed text-fg-muted">{description}</p>
        </div>
      </div>
      {children}
      <div className="mt-2.5 flex items-center gap-2">{actions}</div>
    </div>
  );
}

// ============================================================================
// Form
// ============================================================================

function SupplementForm({
  draft,
  onChange,
}: {
  draft: Supplement;
  onChange: (s: Supplement) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="label">שם התוסף</label>
        <input
          className="input"
          autoFocus
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="למשל: קריאטין, ויטמין D3, מגנזיום"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">מינון</label>
          <NumberInput
            value={draft.dose}
            onChange={(v) => onChange({ ...draft, dose: v === '' ? 0 : Number(v) })}
            min={0}
            step={0.5}
            decimals={2}
          />
        </div>
        <div>
          <label className="label">יחידה</label>
          <input
            className="input"
            value={draft.unit}
            onChange={(e) => onChange({ ...draft, unit: e.target.value })}
            placeholder="כמוסה / מ״ג / מ״ל / כף"
          />
        </div>
      </div>

      <div>
        <label className="label">ימים בשבוע</label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS_HE_SHORT.map((d, i) => {
            const on = draft.daysOfWeek.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    daysOfWeek: on
                      ? draft.daysOfWeek.filter((x) => x !== i)
                      : [...draft.daysOfWeek, i].sort(),
                  })
                }
                className={cn(
                  'h-11 w-11 rounded-xl text-sm font-bold transition-colors duration-150',
                  on
                    ? 'border border-accent bg-accent text-ink-950 shadow-accent-lift'
                    : 'field text-fg-muted hover:text-fg',
                )}
                aria-pressed={on}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="label">שעות מתוזמנות</label>
        <div className="flex flex-wrap items-center gap-2">
          {draft.times.map((t, i) => (
            <div key={i} className="field inline-flex items-center gap-1 py-1 pe-1 ps-2">
              <input
                type="time"
                value={t}
                onChange={(e) => {
                  // No sort() here — it reorders under the index keys and the
                  // focused input starts writing over a different slot. onSave sorts.
                  const next = [...draft.times];
                  next[i] = e.target.value || '08:00';
                  onChange({ ...draft, times: next });
                }}
                className="num bg-transparent text-sm focus:outline-none"
                aria-label={`שעה ${i + 1}`}
              />
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-ghost transition-colors duration-150 hover:text-bad"
                onClick={() =>
                  onChange({ ...draft, times: draft.times.filter((_, j) => j !== i) })
                }
                aria-label="הסר שעה"
              >
                <IconX size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-subtle !min-h-11 !px-3 text-xs"
            onClick={() => {
              if (draft.times.includes('12:00')) {
                toast.warn('12:00 כבר קיים — ערוך את השעה הקיימת');
                return;
              }
              onChange({ ...draft, times: [...draft.times, '12:00'] });
            }}
          >
            <IconPlus size={14} /> הוסף שעה
          </button>
        </div>
      </div>

      <div>
        <label className="label">צבע</label>
        <div className="field flex flex-wrap gap-2 p-2">
          {DEFAULT_COLORS.map((c) => {
            const selected = c === draft.color;
            return (
              <button
                key={c}
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 text-ink-950 transition-transform duration-150 active:scale-95"
                style={{
                  backgroundColor: c,
                  borderColor: selected ? '#ffffff' : 'transparent',
                  boxShadow: selected ? '0 0 0 2px rgba(255,255,255,0.25)' : undefined,
                }}
                aria-label={`צבע ${c}${selected ? ' · נבחר' : ''}`}
                aria-pressed={selected}
                onClick={() => onChange({ ...draft, color: c })}
              >
                {selected && <IconCheck size={16} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card-flat divide-y divide-line-muted overflow-hidden">
        <label className="flex cursor-pointer items-center gap-3 p-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-orange-500"
            checked={draft.withFood}
            onChange={(e) => onChange({ ...draft, withFood: e.target.checked })}
          />
          עם אוכל
        </label>
        <label className="flex cursor-pointer items-center gap-3 p-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-orange-500"
            checked={draft.active}
            onChange={(e) => onChange({ ...draft, active: e.target.checked })}
          />
          פעיל
        </label>
      </div>
    </div>
  );
}
