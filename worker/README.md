# Iron Track Push Worker

A tiny Cloudflare Worker that fires real Web Push notifications to your installed Iron Track PWA, on schedule, even when the app is closed.

## What you get

- HTTP endpoints for the Iron Track frontend to register itself, send updated supplement schedules, and trigger a test push.
- A cron trigger that runs every minute, scans the registered subscriptions, and pushes a notification for any dose whose time matches "now" in the client's local timezone (deduped per day).
- Hand-rolled VAPID + RFC 8291 / aes128gcm encryption — zero npm runtime deps in the Worker; works on the free Cloudflare plan.

## Free? Yes.

- Cloudflare Workers free tier: 100k requests/day. A single user generates a few dozen requests per day.
- Cron triggers + KV storage are included in the free plan.

## One-time setup (~15 minutes)

You need: a Cloudflare account, Node.js 20+, and a couple of minutes to copy/paste values.

```bash
# 1. From the repo root: install the Worker's dev tooling.
cd worker
npm install

# 2. Log in to Cloudflare (opens your browser).
npx wrangler login

# 3. Create a KV namespace for storing subscriptions.
npx wrangler kv namespace create iron_track_subs
# → prints: id = "abc123..." — copy this.

# 4. Edit wrangler.toml and replace REPLACE_ME_WITH_KV_NAMESPACE_ID with the id.

# 5. Generate a VAPID keypair (from the repo root, NOT the worker/ folder):
cd ..
npx tsx scripts/generateVapid.ts
# → prints PUBLIC_KEY and PRIVATE_KEY (both base64url).

# 6. Set them as Worker secrets (from worker/):
cd worker
npx wrangler secret put VAPID_PUBLIC_KEY   # paste the public key
npx wrangler secret put VAPID_PRIVATE_KEY  # paste the private key
npx wrangler secret put VAPID_SUBJECT      # type: mailto:you@example.com

# 7. (Optional but recommended) protect the API with a shared secret so
#    only the Iron Track frontend can enroll subscriptions:
npx wrangler secret put SHARED_SECRET      # type any random string
# Remember this value — you'll paste it into Iron Track's settings too.

# 8. Deploy.
npx wrangler deploy
# → prints: https://iron-track-push.<your-subdomain>.workers.dev
```

Copy that URL — it's the **backend URL** you'll paste into Iron Track's settings.

## Plugging into Iron Track

1. Open Iron Track on your phone.
2. Settings → "פוש לרקע (שרת)".
3. Paste:
   - **Backend URL** — the workers.dev URL printed by `wrangler deploy`.
   - **VAPID public key** — the public key printed by `generateVapid.ts`.
   - **Shared secret** — only if you set one in step 7.
4. Back in Supplements → tap **"הפעל פוש לרקע"**.
5. Tap **"שלח בדיקה"** to confirm a push arrives even with the app closed.

That's it. From now on, whenever you edit your supplement schedule, the app re-syncs to the Worker automatically.

## Operations

- **See logs live**: `npx wrangler tail` — useful while debugging the first push.
- **Rotate the VAPID keys**: regenerate, set as new secrets, redeploy, then re-enable push from the app (existing subscriptions become invalid).
- **Wipe stored subscriptions**: `npx wrangler kv:key list --binding=SUBS` then `delete`.
- **Test the endpoint manually**:
  ```bash
  curl -X POST https://iron-track-push.<sub>.workers.dev/test \
       -H 'Content-Type: application/json' \
       -H 'X-Shared-Secret: <if set>' \
       -d '{"clientId":"<your-client-id-from-the-app>"}'
  ```

## Privacy notes

The Worker stores, per client:
- One Web Push subscription (endpoint + keys) — these aren't useful to anyone but the matching push service for your specific browser.
- Your supplement schedule (name, dose, unit, times, days-of-week) — needed so the cron knows what to send when.
- The client's IANA timezone string — so 8 AM means 8 AM where you live, not in UTC.

No workouts, sets, weights, history, scores, or any other data leaves the device. The KV entries are keyed by a per-client UUID generated locally; there's no email or identifier you could be tracked by.

If you want everything fully local, skip this Worker entirely — the in-app scheduler still fires foreground notifications while Iron Track is open.
