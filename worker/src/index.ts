/**
 * Iron Track push backend.
 *
 * Endpoints:
 *   POST /subscribe   — store/update subscription + schedule for a client.
 *   POST /unsubscribe — remove a client's subscription.
 *   POST /test        — fire an immediate test push.
 *
 * Cron (every minute) iterates all stored subscriptions and sends pushes
 * for any schedule entry whose local time (in the client's IANA timezone)
 * matches "right now" and hasn't been delivered yet today.
 */

import { sendWebPush, type PushSubscriptionJSON } from './webpush';

interface Env {
  SUBS: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  SHARED_SECRET?: string;
}

interface ScheduleEntry {
  name: string;
  dose: number;
  unit: string;
  withFood: boolean;
  times: string[]; // HH:MM
  daysOfWeek: number[]; // 0..6 (0=Sun)
}

interface StoredSubscription {
  clientId: string;
  subscription: PushSubscriptionJSON;
  schedule: ScheduleEntry[];
  timezone: string;
  updatedAt: number;
}

const KV_PREFIX = 'sub:';
const SENT_PREFIX = 'sent:';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shared-Secret',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

function checkAuth(req: Request, env: Env): boolean {
  if (!env.SHARED_SECRET) return true;
  const given = req.headers.get('X-Shared-Secret');
  return given === env.SHARED_SECRET;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, name: 'iron-track-push', vapidConfigured: !!env.VAPID_PUBLIC_KEY });
    }

    if (req.method !== 'POST') {
      return json({ error: 'method not allowed' }, { status: 405 });
    }

    if (!checkAuth(req, env)) {
      return json({ error: 'unauthorized' }, { status: 401 });
    }

    if (url.pathname === '/subscribe') {
      const body = await req.json().catch(() => null) as Partial<StoredSubscription> | null;
      if (!body || !body.clientId || !body.subscription || !Array.isArray(body.schedule)) {
        return json({ error: 'invalid body' }, { status: 400 });
      }
      const record: StoredSubscription = {
        clientId: body.clientId,
        subscription: body.subscription,
        schedule: body.schedule,
        timezone: body.timezone || 'Asia/Jerusalem',
        updatedAt: Date.now(),
      };
      await env.SUBS.put(KV_PREFIX + body.clientId, JSON.stringify(record));
      return json({ ok: true });
    }

    if (url.pathname === '/unsubscribe') {
      const body = await req.json().catch(() => null) as { clientId?: string } | null;
      if (!body?.clientId) return json({ error: 'missing clientId' }, { status: 400 });
      await env.SUBS.delete(KV_PREFIX + body.clientId);
      return json({ ok: true });
    }

    if (url.pathname === '/test') {
      const body = await req.json().catch(() => null) as { clientId?: string } | null;
      if (!body?.clientId) return json({ error: 'missing clientId' }, { status: 400 });
      const raw = await env.SUBS.get(KV_PREFIX + body.clientId);
      if (!raw) return json({ error: 'unknown clientId' }, { status: 404 });
      const record = JSON.parse(raw) as StoredSubscription;
      const result = await sendWebPush({
        subscription: record.subscription,
        payload: JSON.stringify({
          title: 'Iron Track — בדיקה ✅',
          body: 'אם אתה רואה את ההודעה הזו, פוש לרקע עובד.',
          tag: 'iron-track-test',
        }),
        vapidPublicKey: env.VAPID_PUBLIC_KEY,
        vapidPrivateKey: env.VAPID_PRIVATE_KEY,
        vapidSubject: env.VAPID_SUBJECT,
      });
      if (result.gone) await env.SUBS.delete(KV_PREFIX + body.clientId);
      return json(result, { status: result.ok ? 200 : 502 });
    }

    return json({ error: 'not found' }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};

async function runCron(env: Env): Promise<void> {
  // List all subscriptions. KV.list is paginated; we loop until done.
  let cursor: string | undefined;
  let totalSent = 0;
  let totalDropped = 0;
  do {
    const page = await env.SUBS.list({ prefix: KV_PREFIX, cursor });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const k of page.keys) {
      const raw = await env.SUBS.get(k.name);
      if (!raw) continue;
      const record = JSON.parse(raw) as StoredSubscription;
      const result = await processSubscription(record, env);
      totalSent += result.sent;
      totalDropped += result.dropped;
      if (result.subscriptionGone) {
        await env.SUBS.delete(k.name);
      }
    }
  } while (cursor);
  if (totalSent > 0 || totalDropped > 0) {
    console.log(`cron tick — sent=${totalSent} dropped=${totalDropped}`);
  }
}

interface CronResult {
  sent: number;
  dropped: number;
  subscriptionGone: boolean;
}

/**
 * Resolve the current and previous minute in the subscription's local
 * timezone, then fire any scheduled doses whose time matches either one and
 * that we haven't already sent (dedupe via SENT_PREFIX KV entries with 36h
 * TTL). Two-minute window pairs with the every-2-minutes cron so no
 * scheduled HH:MM falls in a dead minute.
 */
async function processSubscription(record: StoredSubscription, env: Env): Promise<CronResult> {
  const moments = candidateMoments(record.timezone);
  const result: CronResult = { sent: 0, dropped: 0, subscriptionGone: false };

  for (const item of record.schedule) {
    for (const time of item.times) {
      const moment = moments.find((m) => m.hhmm === time);
      if (!moment) continue;
      if (item.daysOfWeek.length > 0 && !item.daysOfWeek.includes(moment.dow)) continue;
      const dedupKey = `${SENT_PREFIX}${record.clientId}:${moment.date}:${item.name}:${time}`;
      const already = await env.SUBS.get(dedupKey);
      if (already) continue;
      const body = `${item.dose} ${item.unit}${item.withFood ? ' · עם אוכל' : ''} · ${time}`;
      const push = await sendWebPush({
        subscription: record.subscription,
        payload: JSON.stringify({
          title: `תזכורת: ${item.name}`,
          body,
          tag: `iron-track:${item.name}:${time}`,
          data: { url: '/#/supplements' },
        }),
        vapidPublicKey: env.VAPID_PUBLIC_KEY,
        vapidPrivateKey: env.VAPID_PRIVATE_KEY,
        vapidSubject: env.VAPID_SUBJECT,
      });
      if (push.gone) {
        result.subscriptionGone = true;
        result.dropped++;
        // Don't keep trying other items for a dead subscription.
        return result;
      }
      if (push.ok) {
        result.sent++;
        // 36h TTL so a dose can't fire twice the same day if the cron retries.
        await env.SUBS.put(dedupKey, '1', { expirationTtl: 36 * 3600 });
      } else {
        console.log(
          `push failed for ${record.clientId} ${item.name}@${time}: ${push.status} ${push.body ?? ''}`,
        );
      }
    }
  }
  return result;
}

/** Both the current minute and the one before it (handles midnight rollover). */
function candidateMoments(tz: string): { date: string; dow: number; hhmm: string }[] {
  const now = new Date();
  const prev = new Date(now.getTime() - 60 * 1000);
  return [partsInTimezone(now, tz), partsInTimezone(prev, tz)];
}

function partsInTimezone(when: Date, tz: string): { date: string; dow: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(when);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const date = `${map.year}-${map.month}-${map.day}`;
  const hh = map.hour === '24' ? '00' : map.hour;
  const hhmm = `${hh}:${map.minute}`;
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[map.weekday ?? ''] ?? 0;
  return { date, dow, hhmm };
}

