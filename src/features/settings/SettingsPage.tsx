import { useRef, useState } from 'react';
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
  IconWarn,
} from '@/components/Icon';
import { useSettings, updateSettings } from '@/hooks/useSettings';
import { toast } from '@/store/toast';
import { confirmDialog } from '@/components/Confirm';
import { exportAll, importAll, wipeAll } from './backup';
import { useNotificationPermission, useRequestNotificationPermission } from '@/hooks/useNotifications';
import { seedIfNeeded } from '@/db/seed';

export function SettingsPage() {
  const settings = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ counts: Record<string, number>; raw: unknown } | null>(null);

  const permission = useNotificationPermission();
  const requestPerm = useRequestNotificationPermission();

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
    a.click();
    URL.revokeObjectURL(url);
    await updateSettings({ lastBackupAt: Date.now() });
    toast.success('הגיבוי הורד');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onFileSelected = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const counts: Record<string, number> = {};
      const data = parsed as Record<string, unknown>;
      for (const key of [
        'plans',
        'workouts',
        'muscleGroups',
        'exercises',
        'sessions',
        'exerciseLogs',
        'setLogs',
        'supplements',
        'supplementLogs',
      ]) {
        const arr = data[key];
        counts[key] = Array.isArray(arr) ? arr.length : 0;
      }
      setImportPreview({ counts, raw: parsed });
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
      toast.error('הייבוא נכשל');
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
      <header className="mb-3">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">הגדרות</p>
        <h1 className="text-2xl font-extrabold">העדפות והנתונים</h1>
      </header>

      <Section title="כללי">
        <div className="card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">יחידת משקל</p>
              <p className="text-2xs text-fg-muted">מומלץ ק״ג</p>
            </div>
            <div className="flex gap-1">
              {(['kg', 'lb'] as const).map((u) => (
                <button
                  key={u}
                  data-active={settings.unit === u}
                  className="pill-tab"
                  onClick={() => updateSettings({ unit: u })}
                >
                  {u === 'kg' ? 'ק״ג' : 'פאונד'}
                </button>
              ))}
            </div>
          </div>

          <div className="divider" />

          <div>
            <p className="text-sm font-semibold mb-1">מנוחה ברירת מחדל</p>
            <div className="flex items-center gap-2">
              <NumberInput
                value={settings.restTimerDefaultSec}
                onChange={(v) =>
                  updateSettings({ restTimerDefaultSec: v === '' ? 60 : Math.max(15, Number(v)) })
                }
                step={15}
                min={15}
                withSteppers
                decimals={0}
              />
              <span className="text-xs text-fg-muted">שניות</span>
            </div>
          </div>

          <div className="divider" />

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500"
              checked={settings.restTimerSound}
              onChange={(e) => updateSettings({ restTimerSound: e.target.checked })}
            />
            <span className="text-sm">צליל + רטט בסיום מנוחה</span>
          </label>
        </div>
      </Section>

      <Section title="התראות תוספים">
        <div className="card p-3 flex items-center gap-3">
          <span
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              settings.notificationsEnabled && permission === 'granted'
                ? 'bg-good text-ink-950'
                : 'bg-ink-700 text-fg-muted'
            }`}
          >
            <IconBell />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {settings.notificationsEnabled && permission === 'granted' ? 'פעיל' : 'כבוי'}
            </p>
            <p className="text-2xs text-fg-muted">
              ב-iOS דרושה התקנה כ-PWA (הוסף למסך הבית) כדי שהתראות יעבדו.
            </p>
          </div>
          {permission !== 'granted' || !settings.notificationsEnabled ? (
            <button className="btn-primary !min-h-9 !px-2 text-xs" onClick={enableNotifications}>
              הפעל
            </button>
          ) : (
            <button
              className="btn-ghost !min-h-9 !px-2 text-xs"
              onClick={() => updateSettings({ notificationsEnabled: false })}
            >
              כבה
            </button>
          )}
        </div>
      </Section>

      <Section
        title="מלאי פלטות"
        description="לחישוב פלטות בלבד. כמות = מספר הפלטות הכולל שברשותך (לא זוגות)."
      >
        <ul className="card p-3 space-y-2">
          {settings.plateInventory
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((p) => {
              const idx = settings.plateInventory.indexOf(p);
              return (
                <li key={idx} className="flex items-center gap-2">
                  <NumberInput
                    value={p.weight}
                    onChange={(v) =>
                      onChangePlate(idx, v === '' ? 0 : Number(v), p.qty)
                    }
                    suffix="kg"
                    step={0.25}
                    decimals={2}
                    min={0.25}
                    className="w-28"
                  />
                  <NumberInput
                    value={p.qty}
                    onChange={(v) =>
                      onChangePlate(idx, p.weight, v === '' ? 0 : Number(v))
                    }
                    step={1}
                    decimals={0}
                    min={0}
                    className="w-24"
                    withSteppers
                  />
                  <button
                    className="btn-icon !min-w-9 !min-h-9 text-bad/80 ms-auto"
                    aria-label="מחק"
                    onClick={() => onRemovePlate(idx)}
                  >
                    <IconTrash size={16} />
                  </button>
                </li>
              );
            })}
          <li>
            <button className="btn-subtle !min-h-9 !px-2 text-xs w-full" onClick={onAddPlate}>
              <IconPlus size={14} /> הוסף פלטה
            </button>
          </li>
        </ul>
        <div className="card-flat p-3 mt-2 text-2xs text-fg-muted flex items-start gap-2">
          <IconWarn size={14} className="text-warn shrink-0 mt-0.5" />
          <span>
            המשקלים שאתה רושם הם תמיד <strong className="text-fg">נטו</strong> — פלטות/סטאק בלבד, ללא משקל המוט.
            שדה משקל המוט בכל תרגיל משמש <strong className="text-fg">אך ורק</strong> לחישוב הפלטות.
          </span>
        </div>
      </Section>

      <Section
        title="פוש לרקע (Cloudflare Worker)"
        description="התראות אמיתיות שמגיעות גם כשהאפליקציה סגורה לחלוטין. נדרשת התקנת Worker ב-Cloudflare — ראו worker/README.md."
      >
        <div className="card p-3 space-y-3">
          <div>
            <label className="label">Backend URL</label>
            <input
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
            <label className="label">VAPID Public Key</label>
            <input
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
            <label className="label">Shared Secret (אופציונלי)</label>
            <input
              className="input text-xs num"
              placeholder="רק אם הגדרתם SHARED_SECRET ב-Worker"
              value={settings.pushSharedSecret ?? ''}
              onChange={(e) => updateSettings({ pushSharedSecret: e.target.value.trim() })}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div className="text-2xs text-fg-muted bg-ink-900 rounded-xl p-2.5 border border-line space-y-1">
            <p>
              <strong className="text-fg">סטטוס:</strong>{' '}
              {settings.pushSubscribed ? (
                <span className="text-good">פעיל</span>
              ) : (
                <span className="text-fg-muted">לא פעיל</span>
              )}
              {settings.pushLastSyncAt ? (
                <span className="ms-2 text-fg-muted">
                  · עודכן: {new Date(settings.pushLastSyncAt).toLocaleString('he-IL')}
                </span>
              ) : null}
            </p>
            <p>
              ההפעלה והבדיקה עצמן מתבצעות מעמוד התוספים → כפתור "הפעל פוש לרקע".
            </p>
          </div>
        </div>
      </Section>

      <Section title="גיבוי ונתונים">
        <div className="card p-3 space-y-2">
          <button className="btn-ghost w-full" onClick={onExport}>
            <IconDownload size={16} /> ייצוא לקובץ (JSON)
          </button>
          <button className="btn-ghost w-full" onClick={onPickImport}>
            <IconUpload size={16} /> ייבוא מקובץ…
          </button>
          {settings.lastBackupAt && (
            <p className="text-2xs text-fg-muted text-center">
              גיבוי אחרון: {new Date(settings.lastBackupAt).toLocaleString('he-IL')}
            </p>
          )}
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

      <Section title="איפוס">
        <button className="btn w-full bg-bad-soft text-bad border border-bad/40" onClick={onReset}>
          <IconRefresh size={16} /> אפס את כל הנתונים
        </button>
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
          <div className="space-y-2">
            <p className="text-xs text-fg-muted">
              הייבוא יחליף את כל הנתונים הקיימים. מומלץ לייצא קודם גיבוי נוכחי.
            </p>
            <ul className="text-sm space-y-1">
              {Object.entries(importPreview.counts).map(([k, v]) => (
                <li key={k} className="flex justify-between border-b border-line py-1">
                  <span>{k}</span>
                  <span className="num">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
