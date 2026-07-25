import { useRef, useState, type ReactNode } from 'react';
import { Section } from '@/components/Section';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import {
  IconBell,
  IconCheck,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@/components/Icon';
import { cn } from '@/utils/cn';
import { useSettings, updateSettings } from '@/hooks/useSettings';
import { toast } from '@/store/toast';
import { confirmDialog } from '@/components/Confirm';
import { exportAll, importAll, summarizeBackup, wipeAll } from './backup';
import { useNotificationPermission, useRequestNotificationPermission } from '@/hooks/useNotifications';
import { seedIfNeeded } from '@/db/seed';

/**
 * One line of a settings list: the label carries the meaning on the leading
 * edge, the control is aligned to the trailing edge of every row so the whole
 * column can be scanned in one pass.
 */
function Row({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 min-h-[56px]">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {sub && <p className="text-2xs text-fg-dim mt-0.5">{sub}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </li>
  );
}

/**
 * A switch rather than a checkbox: the track is a recessed groove and the knob
 * rides on it, which is the same lit/carved logic the rest of the app uses. The
 * real <input> stays in the DOM (screen-reader only) so the label still names it.
 */
function ToggleRow({
  title,
  sub,
  checked,
  onChange,
}: {
  title: string;
  sub?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li>
      <label className="flex items-center gap-3 px-3 py-2.5 min-h-[56px] cursor-pointer">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          {sub && <span className="block text-2xs text-fg-dim mt-0.5">{sub}</span>}
        </span>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className="relative h-7 w-12 shrink-0 field rounded-full transition-colors duration-150
                     peer-checked:bg-accent peer-checked:border-accent peer-checked:shadow-accent-lift
                     peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ring
                     peer-checked:[&>span]:start-[1.375rem] peer-checked:[&>span]:bg-ink-950"
        >
          <span className="absolute top-1/2 -translate-y-1/2 start-1 h-5 w-5 rounded-full bg-fg-dim transition-[inset-inline-start,background-color] duration-150" />
        </span>
      </label>
    </li>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ counts: Record<string, number>; raw: unknown } | null>(null);

  const permission = useNotificationPermission();
  const requestPerm = useRequestNotificationPermission();

  const notificationsOn = settings.notificationsEnabled && permission === 'granted';

  const enableNotifications = async () => {
    const res = await requestPerm();
    if (res === 'granted') {
      await updateSettings({ notificationsEnabled: true });
      toast.success('התראות הופעלו');
    } else {
      toast.warn(res === 'denied' ? 'ההרשאה נדחתה' : 'התראות לא נתמכות');
    }
  };

  const onAddPlate = () => {
    updateSettings({
      plateInventory: [...settings.plateInventory, { weight: 1.25, qty: 2 }],
    });
  };

  const onChangePlate = (idx: number, weight: number, qty: number) => {
    const inv = [...settings.plateInventory];
    inv[idx] = { weight, qty };
    updateSettings({ plateInventory: inv });
  };

  const onRemovePlate = (idx: number) => {
    updateSettings({
      plateInventory: settings.plateInventory.filter((_, i) => i !== idx),
    });
  };

  const onExport = async () => {
    const payload = await exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iron-track-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after the browser has had a chance to start reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    await updateSettings({ lastBackupAt: Date.now() });
    // ponytail: a browser download gives no completion signal — say what we know.
    toast.success('קובץ הגיבוי נשלח להורדה — ודא שנשמר');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onFileSelected = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      // Counted off db.tables by summarizeBackup, so a table added by a future
      // schema version shows up here automatically instead of silently reading
      // as zero rows.
      setImportPreview({ counts: summarizeBackup(parsed), raw: parsed });
    } catch (e) {
      console.error(e);
      toast.error('הקובץ לא תקין');
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      await importAll(importPreview.raw);
      toast.success('הייבוא הושלם');
      setImportPreview(null);
    } catch (e) {
      console.error(e);
      // importAll validates before touching the DB and throws a Hebrew reason
      // ("not an Iron Track backup" / "empty backup") — show it, it's actionable.
      toast.error(e instanceof Error ? e.message : 'הייבוא נכשל');
    } finally {
      setImporting(false);
    }
  };

  const onReset = async () => {
    const ok = await confirmDialog({
      title: 'איפוס כל הנתונים?',
      body: 'פעולה זו תמחק תכניות, אימונים, היסטוריה ותוספים. לא ניתן לבטל.',
      destructive: true,
      confirmLabel: 'איפוס',
    });
    if (!ok) return;
    await wipeAll();
    await seedIfNeeded();
    toast.success('האפליקציה אופסה');
  };

  return (
    <div className="pt-3">
      <header className="mb-4 px-1">
        <p className="eyebrow">הגדרות</p>
        <h1 className="text-2xl font-extrabold tracking-tight mt-0.5">העדפות והנתונים</h1>
      </header>

      <Section title="אימון">
        <ul className="card divide-y divide-line overflow-hidden">
          <Row title="מנוחה ברירת מחדל" sub="שניות · נטענת בכל תרגיל שאין לו זמן משלו">
            <NumberInput
              value={settings.restTimerDefaultSec}
              onChange={(v) =>
                updateSettings({ restTimerDefaultSec: v === '' ? 60 : Math.max(15, Number(v)) })
              }
              step={15}
              min={15}
              withSteppers
              decimals={0}
              className="w-40"
            />
          </Row>
          <ToggleRow
            title="צליל + רטט בסיום מנוחה"
            sub="נשמע גם כשהמסך כבוי, כל עוד האפליקציה בחזית"
            checked={settings.restTimerSound}
            onChange={(v) => updateSettings({ restTimerSound: v })}
          />
        </ul>
      </Section>

      <Section title="התראות">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-3">
            <span
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                notificationsOn
                  ? 'bg-good/[0.12] text-good border border-good/30'
                  : 'bg-ink-800 text-fg-dim border border-line-muted',
              )}
            >
              <IconBell />
            </span>
            <div className="flex-1 min-w-0">
              <p className="eyebrow">התראות תוספים</p>
              <p className={cn('text-sm font-semibold mt-0.5', notificationsOn && 'text-good')}>
                {notificationsOn ? 'פעיל' : 'כבוי'}
              </p>
            </div>
            {!notificationsOn ? (
              <button className="btn-primary !min-h-10 text-xs" onClick={enableNotifications}>
                הפעל
              </button>
            ) : (
              <button
                className="btn-ghost !min-h-10 text-xs"
                onClick={() => updateSettings({ notificationsEnabled: false })}
              >
                כבה
              </button>
            )}
          </div>
          <p className="px-3 pb-3 text-2xs text-fg-dim">
            ב-iOS דרושה התקנה כ-PWA (הוסף למסך הבית) כדי שהתראות יעבדו.
          </p>
        </div>

        <ul className="card divide-y divide-line overflow-hidden mt-2">
          <ToggleRow
            title="תזכורת שבועית למדידת גוף"
            sub="מדלגת אם כבר רשמת מדידה באותו יום"
            checked={settings.bodyReminderEnabled ?? false}
            onChange={(v) => updateSettings({ bodyReminderEnabled: v })}
          />
          {settings.bodyReminderEnabled && (
            <li className="px-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="body-reminder-dow">
                    יום
                  </label>
                  <select
                    id="body-reminder-dow"
                    className="input"
                    value={settings.bodyReminderDow ?? 0}
                    onChange={(e) => updateSettings({ bodyReminderDow: Number(e.target.value) })}
                  >
                    <option value={0}>ראשון</option>
                    <option value={1}>שני</option>
                    <option value={2}>שלישי</option>
                    <option value={3}>רביעי</option>
                    <option value={4}>חמישי</option>
                    <option value={5}>שישי</option>
                    <option value={6}>שבת</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="body-reminder-time">
                    שעה
                  </label>
                  <input
                    id="body-reminder-time"
                    type="time"
                    className="input"
                    value={settings.bodyReminderTime ?? '09:00'}
                    onChange={(e) => updateSettings({ bodyReminderTime: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-2xs text-fg-dim mt-2">
                דורש גם הפעלת "התראות תוספים" למעלה (משתמש באותו ערוץ הרשאה).
              </p>
            </li>
          )}
        </ul>
      </Section>

      <Section
        title="מלאי פלטות"
        description="לחישוב פלטות בלבד. כמות = מספר הפלטות הכולל שברשותך (לא זוגות)."
      >
        <ul className="card divide-y divide-line overflow-hidden">
          <li className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
            <span className="eyebrow w-24">משקל</span>
            <span className="eyebrow flex-1">כמות</span>
          </li>
          {settings.plateInventory
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((p) => {
              const idx = settings.plateInventory.indexOf(p);
              return (
                <li key={idx} className="flex items-center gap-2 px-3 py-2">
                  <NumberInput
                    value={p.weight}
                    onChange={(v) => onChangePlate(idx, v === '' ? 0 : Number(v), p.qty)}
                    ariaLabel="משקל פלטה (kg)"
                    suffix="kg"
                    step={0.25}
                    decimals={2}
                    min={0.25}
                    className="w-24"
                  />
                  <NumberInput
                    value={p.qty}
                    onChange={(v) => onChangePlate(idx, p.weight, v === '' ? 0 : Number(v))}
                    ariaLabel={`כמות פלטות של ${p.weight} ק״ג`}
                    step={1}
                    decimals={0}
                    min={0}
                    className="w-32"
                    withSteppers
                  />
                  {/* Red when you reach for it, not while you read the list. */}
                  <button
                    className="btn-icon !min-w-11 text-fg-ghost hover:text-bad ms-auto"
                    aria-label="מחק"
                    onClick={() => onRemovePlate(idx)}
                  >
                    <IconTrash size={16} />
                  </button>
                </li>
              );
            })}
          <li>
            <button
              className="btn-subtle w-full !justify-start text-xs text-accent-text"
              onClick={onAddPlate}
            >
              <IconPlus size={16} /> הוסף פלטה
            </button>
          </li>
        </ul>
        <p className="relative mt-2 ps-3 text-2xs text-fg-dim leading-relaxed">
          <span className="absolute inset-y-0 start-0 w-[3px] rounded-full bg-warn/70" aria-hidden />
          המשקלים שאתה רושם הם תמיד <strong className="text-fg">נטו</strong> — פלטות/סטאק בלבד,
          ללא משקל המוט. שדה משקל המוט בכל תרגיל משמש{' '}
          <strong className="text-fg">אך ורק</strong> לחישוב הפלטות.
        </p>
      </Section>

      <Section title="גיבוי ונתונים">
        <div className="card p-3 space-y-2">
          <button className="btn-ghost w-full" onClick={onExport}>
            <IconDownload size={16} /> ייצוא לקובץ (JSON)
          </button>
          <button className="btn-ghost w-full" onClick={onPickImport}>
            <IconUpload size={16} /> ייבוא מקובץ…
          </button>
          <p className="text-2xs text-fg-dim text-center pt-0.5">
            {settings.lastBackupAt
              ? `גיבוי אחרון: ${new Date(settings.lastBackupAt).toLocaleString('he-IL')}`
              : 'עוד לא יצא גיבוי מהמכשיר הזה'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileSelected(f);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section
        title="פוש לרקע (Cloudflare Worker)"
        description="התראות שמגיעות גם כשהאפליקציה סגורה. נדרשת התקנת Worker — ראו worker/README.md."
      >
        <div className="card p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">סטטוס</span>
            <span className="flex items-center gap-2">
              {settings.pushLastSyncAt ? (
                <span className="text-2xs text-fg-dim">
                  עודכן {new Date(settings.pushLastSyncAt).toLocaleString('he-IL')}
                </span>
              ) : null}
              <span
                className={cn(
                  'chip',
                  settings.pushSubscribed
                    ? 'border-good/40 text-good bg-good/[0.08]'
                    : 'border-line text-fg-muted',
                )}
              >
                {settings.pushSubscribed ? 'פעיל' : 'לא פעיל'}
              </span>
            </span>
          </div>
          <div>
            <label className="label" htmlFor="push-backend-url">
              Backend URL
            </label>
            <input
              id="push-backend-url"
              className="input text-xs num"
              placeholder="https://iron-track-push.<subdomain>.workers.dev"
              value={settings.pushBackendUrl ?? ''}
              onChange={(e) => updateSettings({ pushBackendUrl: e.target.value.trim() })}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="push-vapid-key">
              VAPID Public Key
            </label>
            <input
              id="push-vapid-key"
              className="input text-xs num"
              placeholder="הדבק כאן את המפתח שהדפיס scripts/generateVapid.ts"
              value={settings.pushVapidPublicKey ?? ''}
              onChange={(e) => updateSettings({ pushVapidPublicKey: e.target.value.trim() })}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="push-shared-secret">
              Shared Secret (אופציונלי)
            </label>
            <input
              id="push-shared-secret"
              className="input text-xs num"
              placeholder="רק אם הגדרתם SHARED_SECRET ב-Worker"
              value={settings.pushSharedSecret ?? ''}
              onChange={(e) => updateSettings({ pushSharedSecret: e.target.value.trim() })}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <p className="text-2xs text-fg-dim">
            ההפעלה והבדיקה עצמן מתבצעות מעמוד התוספים → כפתור "הפעל פוש לרקע".
          </p>
        </div>
      </Section>

      {/* Kept away from everything else, and reading as dangerous without a
          block of red shouting at the user on every visit. */}
      <Section title="אזור מסוכן">
        <div className="card relative overflow-hidden p-3 ps-4 bg-bad/[0.05]">
          <span className="absolute inset-y-0 start-0 w-[3px] bg-bad" aria-hidden />
          <p className="text-sm font-semibold">איפוס האפליקציה</p>
          <p className="text-2xs text-fg-dim mt-1 mb-3">
            מוחק תכניות, אימונים, היסטוריה ותוספים מהמכשיר הזה. לא ניתן לבטל — ייצאו גיבוי קודם.
          </p>
          <button
            className="btn w-full bg-transparent border border-bad/40 text-bad hover:bg-bad/[0.1]"
            onClick={onReset}
          >
            <IconRefresh size={16} /> אפס את כל הנתונים
          </button>
        </div>
      </Section>

      <Modal
        open={!!importPreview}
        onClose={() => setImportPreview(null)}
        title="ייבוא נתונים"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setImportPreview(null)} disabled={importing}>
              ביטול
            </button>
            <button className="btn-primary" onClick={confirmImport} disabled={importing}>
              <IconCheck size={16} /> ייבא והחלף
            </button>
          </>
        }
      >
        {importPreview && (
          <div className="space-y-3">
            <p className="relative ps-3 text-xs text-fg-muted">
              <span className="absolute inset-y-0 start-0 w-[3px] rounded-full bg-warn" aria-hidden />
              הייבוא יחליף את כל הנתונים הקיימים. מומלץ לייצא קודם גיבוי נוכחי.
            </p>
            <ul className="card-flat divide-y divide-line overflow-hidden">
              {Object.entries(importPreview.counts).map(([k, v]) => (
                <li key={k} className="flex justify-between items-center px-3 py-2 text-sm">
                  <span className="text-fg-muted">{k}</span>
                  <span className="num-display">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
