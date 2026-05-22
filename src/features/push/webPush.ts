import { db, newId } from '@/db/db';
import { ensureSettings } from '@/db/seed';
import { updateSettings } from '@/hooks/useSettings';
import type { AppSettings } from '@/types';

/**
 * Frontend Web Push glue:
 *  - subscribes via the SW's PushManager,
 *  - POSTs the subscription + the current supplement schedule to the Cloudflare
 *    Worker so it can fire pushes from a cron on schedule,
 *  - keeps the stored schedule in sync whenever supplements change.
 *
 * All config lives in AppSettings (pushBackendUrl, pushVapidPublicKey, pushSharedSecret).
 */

interface SyncPayload {
  clientId: string;
  subscription: PushSubscriptionJSON;
  schedule: ScheduleEntry[];
  timezone: string;
}

interface ScheduleEntry {
  name: string;
  dose: number;
  unit: string;
  withFood: boolean;
  times: string[];
  daysOfWeek: number[];
}

export interface PushConfigError {
  reason: 'missing-backend' | 'missing-vapid' | 'no-permission' | 'no-sw' | 'subscribe-failed' | 'sync-failed';
  message: string;
}

function urlBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new ArrayBuffer(raw.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return out;
}

async function getOrCreateClientId(settings: AppSettings): Promise<string> {
  if (settings.pushClientId && settings.pushClientId.length > 0) return settings.pushClientId;
  const id = newId();
  await updateSettings({ pushClientId: id });
  return id;
}

async function buildSchedule(): Promise<ScheduleEntry[]> {
  const sups = await db.supplements.filter((s) => s.active).sortBy('order');
  return sups.map((s) => ({
    name: s.name,
    dose: s.dose,
    unit: s.unit,
    withFood: s.withFood,
    times: s.times,
    daysOfWeek: s.daysOfWeek,
  }));
}

function authHeaders(settings: AppSettings): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.pushSharedSecret) headers['X-Shared-Secret'] = settings.pushSharedSecret;
  return headers;
}

function normalizeUrl(url: string, path: string): string {
  return `${url.replace(/\/$/, '')}${path}`;
}

/** Get an existing PushSubscription (if any) without creating a new one. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Subscribe (or reuse an existing subscription), POST to the backend with the
 * current schedule, and persist the success state in settings.
 */
export async function enablePush(settings: AppSettings): Promise<PushConfigError | null> {
  if (!settings.pushBackendUrl) {
    return { reason: 'missing-backend', message: 'יש להגדיר את כתובת ה-Backend בהגדרות.' };
  }
  if (!settings.pushVapidPublicKey) {
    return { reason: 'missing-vapid', message: 'יש להגדיר את ה-VAPID Public Key בהגדרות.' };
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { reason: 'no-sw', message: 'הדפדפן לא תומך ב-Service Worker.' };
  }
  if (typeof Notification === 'undefined') {
    return { reason: 'no-sw', message: 'הדפדפן לא חושף את ממשק ההתראות. באייפון יש להתקין כ-PWA.' };
  }

  // Permission
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return { reason: 'no-permission', message: 'ההרשאה להתראות נדחתה.' };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(settings.pushVapidPublicKey),
      });
    } catch (e) {
      console.error('pushManager.subscribe failed', e);
      return {
        reason: 'subscribe-failed',
        message: 'נכשלה הרשמה ל-Push. ייתכן שה-VAPID Public Key שגוי.',
      };
    }
  }

  const ok = await syncWithBackend(settings, sub);
  if (!ok.ok) {
    return { reason: 'sync-failed', message: ok.message };
  }
  await updateSettings({ pushSubscribed: true, pushLastSyncAt: Date.now() });
  return null;
}

/**
 * Re-sync the current schedule to the backend without re-subscribing. Called
 * automatically when supplements change. Safe no-op if push isn't enabled.
 */
export async function syncSchedule(): Promise<{ ok: boolean; message: string }> {
  const settings = await ensureSettings();
  if (!settings.pushSubscribed || !settings.pushBackendUrl) {
    return { ok: false, message: 'push not enabled' };
  }
  const sub = await getExistingSubscription();
  if (!sub) {
    await updateSettings({ pushSubscribed: false });
    return { ok: false, message: 'no subscription' };
  }
  const res = await syncWithBackend(settings, sub);
  if (res.ok) {
    await updateSettings({ pushLastSyncAt: Date.now() });
  }
  return res;
}

async function syncWithBackend(
  settings: AppSettings,
  sub: PushSubscription,
): Promise<{ ok: boolean; message: string }> {
  const clientId = await getOrCreateClientId(settings);
  const schedule = await buildSchedule();
  const payload: SyncPayload = {
    clientId,
    subscription: sub.toJSON() as PushSubscriptionJSON,
    schedule,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem',
  };
  try {
    const res = await fetch(normalizeUrl(settings.pushBackendUrl!, '/subscribe'), {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, message: `שרת החזיר ${res.status}: ${txt.slice(0, 120)}` };
    }
    return { ok: true, message: 'synced' };
  } catch (e) {
    console.error('sync failed', e);
    return { ok: false, message: 'אין חיבור לשרת. בדוק את ה-URL.' };
  }
}

/** Unsubscribe locally and on the backend. */
export async function disablePush(): Promise<void> {
  const settings = await ensureSettings();
  const sub = await getExistingSubscription();
  if (sub && settings.pushBackendUrl && settings.pushClientId) {
    await fetch(normalizeUrl(settings.pushBackendUrl, '/unsubscribe'), {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({ clientId: settings.pushClientId }),
    }).catch(() => {});
  }
  if (sub) await sub.unsubscribe().catch(() => {});
  await updateSettings({ pushSubscribed: false });
}

/** Trigger an immediate test push via the backend. */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const settings = await ensureSettings();
  if (!settings.pushSubscribed || !settings.pushBackendUrl || !settings.pushClientId) {
    return { ok: false, message: 'הפעילו קודם פוש לרקע.' };
  }
  try {
    const res = await fetch(normalizeUrl(settings.pushBackendUrl, '/test'), {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({ clientId: settings.pushClientId }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, message: `שרת החזיר ${res.status}: ${txt.slice(0, 120)}` };
    }
    return { ok: true, message: 'נשלח. אמור להגיע תוך שניות.' };
  } catch (e) {
    console.error(e);
    return { ok: false, message: 'אין חיבור לשרת.' };
  }
}

/**
 * Listen for pushsubscriptionchange events the SW relays to clients. When
 * received, attempt to re-subscribe and re-sync with the backend.
 */
export function attachSubscriptionRenewer(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data?.type === 'iron-track:pushsubscriptionchange') {
      const settings = await ensureSettings();
      if (settings.pushSubscribed) {
        await enablePush(settings);
      }
    }
  });
}
