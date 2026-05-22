import { useEffect, useState } from 'react';
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
  IconClock,
  IconEdit,
  IconPill,
  IconPlus,
  IconTrash,
  IconX,
} from '@/components/Icon';
import { NumberInput } from '@/components/NumberInput';
import { useDaySupplements } from './useTodaySupplements';
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

export function SupplementsPage() {
  const today = todayISO();
  const [viewDate, setViewDate] = useState<string>(today);
  const isToday = viewDate === today;
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

  // Adherence over last 30 days
  const adherence = useLiveQuery(async () => {
    const allLogs = await db.supplementLogs.toArray();
    return computeAdherence(sups, allLogs, today);
  }, [sups.length, today]);

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
    const exists = await db.supplements.get(draft.id);
    if (exists) {
      await db.supplements.put({ ...draft, updatedAt: now() });
      toast.success('עודכן');
    } else {
      await db.supplements.add(draft);
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

  return (
    <div className="pt-3">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-2xs uppercase tracking-wider text-fg-muted">תוספים</p>
          <h1 className="text-2xl font-extrabold">{formatHebDateFull(today)}</h1>
        </div>
        <button onClick={openCreate} className="btn-primary !min-h-9 !px-2 text-xs">
          <IconPlus size={14} /> תוסף
        </button>
      </header>

      {/* Day navigator: lets you browse past days and back-fill missed doses. */}
      <div className="card p-2 mb-3 flex items-center gap-2">
        <button
          className="btn-icon !min-w-9 !min-h-9"
          onClick={() => shiftDate(-1)}
          aria-label="יום קודם"
        >
          <IconArrowRight size={18} />
        </button>
        <button
          className="flex-1 min-w-0 px-2 py-1.5 text-sm font-semibold flex items-center justify-center gap-2"
          onClick={() => setViewDate(today)}
          title={isToday ? '' : 'חזור להיום'}
        >
          <IconCalendar size={14} className="text-fg-muted" />
          <span className="truncate">{formatHebDate(viewDate)}</span>
          {!isToday && (
            <span className="chip border-line text-fg-muted text-2xs">חזור להיום</span>
          )}
        </button>
        <input
          type="date"
          className="bg-transparent text-xs text-fg-muted border-0 outline-none num"
          value={viewDate}
          max={today}
          onChange={(e) => {
            if (!e.target.value) return;
            if (isAfter(parseISO(e.target.value), parseISO(today))) return;
            setViewDate(e.target.value);
          }}
          aria-label="בחירת תאריך"
        />
        <button
          className="btn-icon !min-w-9 !min-h-9 disabled:opacity-30"
          onClick={() => shiftDate(1)}
          disabled={isToday}
          aria-label="יום הבא"
        >
          <IconArrowLeft size={18} />
        </button>
      </div>

      {/* Notifications card */}
      <div className="card p-3 mb-4">
        <div className="flex items-center gap-3">
          <span
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              settings.notificationsEnabled && permission === 'granted'
                ? 'bg-good text-ink-950'
                : 'bg-ink-700 text-fg-muted'
            }`}
          >
            <IconBell />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">תזכורות לפי שעה</p>
            <p className="text-2xs text-fg-muted">
              {iosNeedsInstall
                ? 'באייפון צריך להתקין את האפליקציה למסך הבית כדי לקבל התראות.'
                : permission === 'unsupported'
                  ? 'הדפדפן הזה לא תומך בהתראות. נסו דפדפן עדכני.'
                  : settings.notificationsEnabled && permission === 'granted'
                    ? 'פעיל. ב-iOS דרושה התקנה כ-PWA למסך הבית.'
                    : permission === 'denied'
                      ? 'ההרשאה נחסמה. יש לשנות ידנית בהגדרות הדפדפן.'
                      : 'לא פעיל. הפעלת התראות תשלח תזכורות בשעות שנקבעו.'}
            </p>
          </div>
          {permission === 'granted' && settings.notificationsEnabled ? (
            <button className="btn-ghost !min-h-9 !px-2 text-xs" onClick={disableNotifications}>
              כבה
            </button>
          ) : (
            <button
              className="btn-primary !min-h-9 !px-2 text-xs"
              onClick={enableNotifications}
              disabled={permission === 'denied' || permission === 'unsupported'}
            >
              הפעל
            </button>
          )}
        </div>

        {iosNeedsInstall && (
          <div className="mt-3 pt-3 border-t border-line text-xs text-fg-muted space-y-1.5">
            <p className="font-semibold text-fg">איך מתקינים באייפון:</p>
            <ol className="list-decimal pr-4 space-y-1">
              <li>פותחים את האתר ב-Safari (חייב Safari, לא כרום).</li>
              <li>לוחצים על אייקון השיתוף ⬆️ (בתחתית).</li>
              <li>בוחרים "הוסף למסך הבית" / "Add to Home Screen".</li>
              <li>פותחים את האפליקציה מהאייקון החדש במסך הבית.</li>
              <li>חוזרים לכאן ולוחצים "הפעל".</li>
            </ol>
            <p className="pt-1">דרוש iOS 16.4 ומעלה.</p>
          </div>
        )}
      </div>

      {/* Background-push card (Cloudflare Worker driven) */}
      <div className="card p-3 mb-4">
        <div className="flex items-center gap-3">
          <span
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              settings.pushSubscribed ? 'bg-accent text-ink-950' : 'bg-ink-700 text-fg-muted'
            }`}
          >
            <IconBell />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">פוש לרקע (עובד גם כשהאפליקציה סגורה)</p>
            <p className="text-2xs text-fg-muted">
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
                <Link to="/settings" className="text-accent font-semibold ms-1">הגדרות</Link>
              ) : null}
            </p>
          </div>
          {settings.pushSubscribed ? (
            <>
              <button
                className="btn-ghost !min-h-9 !px-2 text-xs"
                onClick={handleTestPush}
                disabled={pushBusy}
              >
                שלח בדיקה
              </button>
              <button
                className="btn-ghost !min-h-9 !px-2 text-xs"
                onClick={handleDisablePush}
                disabled={pushBusy}
              >
                כבה
              </button>
            </>
          ) : (
            <button
              className="btn-primary !min-h-9 !px-2 text-xs"
              onClick={handleEnablePush}
              disabled={pushBusy || !settings.pushBackendUrl || !settings.pushVapidPublicKey}
            >
              הפעל פוש לרקע
            </button>
          )}
        </div>
      </div>

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
          <ul className="card divide-y divide-line overflow-hidden">
            {rows.map((row) => (
              <motion.li
                key={`${row.supplement.id}-${row.scheduledTime}`}
                layout
                className="p-3 flex items-center gap-3"
              >
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center font-bold shrink-0"
                  style={{ backgroundColor: row.supplement.color + '33', color: row.supplement.color }}
                >
                  {row.supplement.name.slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate text-sm">{row.supplement.name}</p>
                  <p className="text-2xs text-fg-muted">
                    {row.supplement.dose} {row.supplement.unit}
                    {row.supplement.withFood ? ' · עם אוכל' : ''}
                  </p>
                </div>
                <span className="num text-xs text-fg-muted flex items-center gap-1">
                  <IconClock size={12} /> {row.scheduledTime}
                </span>
                {row.log?.status === 'taken' ? (
                  <>
                    <button
                      className="btn !min-h-9 !px-2 text-2xs bg-good text-ink-950"
                      aria-label="נלקח · לחיצה ארוכה לאיפוס"
                      onClick={() => onClearLog(row.supplement.id, row.scheduledTime)}
                    >
                      <IconCheck size={14} />
                    </button>
                  </>
                ) : row.log?.status === 'skipped' ? (
                  <>
                    <button
                      className="btn-icon !min-w-9 !min-h-9 text-good"
                      aria-label="סמן כנלקח"
                      onClick={() => onLog(row.supplement.id, row.scheduledTime, 'taken')}
                    >
                      <IconCheck size={16} />
                    </button>
                    <button
                      className="btn-icon !min-w-9 !min-h-9 text-bad"
                      aria-label="אפס סימון"
                      onClick={() => onClearLog(row.supplement.id, row.scheduledTime)}
                    >
                      <IconX size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn-icon !min-w-9 !min-h-9 text-good"
                      aria-label="נלקח"
                      onClick={() => onLog(row.supplement.id, row.scheduledTime, 'taken')}
                    >
                      <IconCheck size={16} />
                    </button>
                    <button
                      className="btn-icon !min-w-9 !min-h-9 text-bad/80"
                      aria-label="דלג"
                      onClick={() => onLog(row.supplement.id, row.scheduledTime, 'skipped')}
                    >
                      <IconX size={16} />
                    </button>
                  </>
                )}
              </motion.li>
            ))}
          </ul>
        )}
      </Section>

      {/* Adherence */}
      {adherence && adherence.weekly && adherence.weekly.length > 0 && (
        <Section title="היענות (30 ימים)">
          <div className="card p-3">
            <div className="flex items-baseline gap-3 mb-2">
              <p className="num text-3xl font-extrabold text-good">{adherence.weeklyPct}%</p>
              <p className="text-2xs text-fg-muted">היענות שבועית</p>
              <p className="num text-lg font-bold text-info ms-auto">{adherence.monthlyPct}%</p>
              <p className="text-2xs text-fg-muted">חודשית</p>
            </div>
            <div style={{ width: '100%', height: 140 }}>
              <ResponsiveContainer>
                <LineChart data={adherence.weekly} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={(d) => (d as string).slice(5)} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: '#0b0d10',
                      border: '1px solid #262b33',
                      borderRadius: 8,
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
          <ul className="space-y-2">
            {sups.map((s) => (
              <li key={s.id} className="card p-3 flex items-center gap-3">
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center font-bold shrink-0"
                  style={{ backgroundColor: s.color + '33', color: s.color }}
                >
                  {s.name.slice(0, 1) || '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate text-sm">{s.name}</p>
                  <p className="text-2xs text-fg-muted truncate">
                    {s.dose} {s.unit} · {s.times.join(', ')} · {' '}
                    {s.daysOfWeek.length === 7 ? 'כל יום' : s.daysOfWeek.map((d) => DAYS_HE_SHORT[d]).join(' ')}
                  </p>
                </div>
                <button
                  className="btn-icon !min-w-9 !min-h-9"
                  aria-label="ערוך"
                  onClick={() => openEdit(s)}
                >
                  <IconEdit size={16} />
                </button>
                <button
                  className="btn-icon !min-w-9 !min-h-9 text-bad/80"
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
    <div className="space-y-3">
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="w-5 h-5 accent-orange-500"
          checked={draft.withFood}
          onChange={(e) => onChange({ ...draft, withFood: e.target.checked })}
        />
        עם אוכל
      </label>

      <div>
        <label className="label">ימים בשבוע</label>
        <div className="flex gap-1.5 flex-wrap">
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
                className={`w-9 h-9 rounded-xl font-bold text-sm border ${
                  on ? 'bg-accent text-ink-950 border-accent' : 'bg-ink-800 border-line text-fg-muted'
                }`}
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
            <div key={i} className="inline-flex items-center gap-1 bg-ink-800 border border-line rounded-xl px-2 py-1">
              <input
                type="time"
                value={t}
                onChange={(e) => {
                  const next = [...draft.times];
                  next[i] = e.target.value || '08:00';
                  onChange({ ...draft, times: next.sort() });
                }}
                className="bg-transparent text-sm num focus:outline-none"
                aria-label={`שעה ${i + 1}`}
              />
              <button
                type="button"
                className="btn-icon !min-w-7 !min-h-7 text-bad/80"
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
            className="btn-subtle !min-h-9 !px-2 text-xs"
            onClick={() => onChange({ ...draft, times: [...draft.times, '12:00'].sort() })}
          >
            <IconPlus size={14} /> הוסף שעה
          </button>
        </div>
      </div>

      <div>
        <label className="label">צבע</label>
        <div className="flex gap-2 flex-wrap">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="w-8 h-8 rounded-full border-2"
              style={{
                backgroundColor: c,
                borderColor: c === draft.color ? '#ffffff' : 'transparent',
              }}
              aria-label={`צבע ${c}`}
              onClick={() => onChange({ ...draft, color: c })}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="w-5 h-5 accent-orange-500"
          checked={draft.active}
          onChange={(e) => onChange({ ...draft, active: e.target.checked })}
        />
        פעיל
      </label>
    </div>
  );
}
