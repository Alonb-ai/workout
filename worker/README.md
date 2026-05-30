# Iron Track Push Worker

A tiny Cloudflare Worker that fires real Web Push notifications to your installed Iron Track PWA, on schedule, even when the app is closed.

## What you get

- HTTP endpoints for the Iron Track frontend to register itself, send updated supplement schedules, and trigger a test push.
- A cron trigger that runs every minute, scans the registered subscriptions, and pushes a notification for any dose whose time matches "now" in the client's local timezone (deduped per day).
- Hand-rolled VAPID + RFC 8291 / aes128gcm encryption — zero npm runtime deps in the Worker; works on the free Cloudflare plan.

## Free? Yes.

- Cloudflare Workers free tier: 100k requests/day. A single user generates a few dozen requests per day.
- Cron triggers + KV storage are included in the free plan.

## One-time setup (~5 minutes)

You need: a Cloudflare account (free), Node.js 20+.

```bash
# 1. Clone the repo (if you haven't already).
git clone https://github.com/Alonb-ai/workout.git
cd workout

# 2. Run the setup script — it handles login, KV namespace, VAPID keys,
#    secrets, and deploy for you.
bash worker/setup.sh
```

The script will:
- Open your browser once to log you in to Cloudflare.
- Ask once for a contact email (any email; used only by push services if a delivery problem needs to be reported).
- Print, at the end, the two values you paste into Iron Track:
  - **Backend URL** — `https://iron-track-push.<your-subdomain>.workers.dev`
  - **VAPID Public Key** — a long base64url string.

### Manual steps (if you prefer not to use setup.sh)

<details><summary>expand</summary>

```bash
cd worker
npm install
npx wrangler login
# Only if you're forking — replace the committed KV id in wrangler.toml:
#   npx wrangler kv namespace create iron_track_subs
#   (then paste the printed id over the one in wrangler.toml)
cd ..
npx tsx scripts/generateVapid.ts                            # copy both keys
cd worker
npx wrangler secret put VAPID_PUBLIC_KEY                    # paste the public key
npx wrangler secret put VAPID_PRIVATE_KEY                   # paste the private key
npx wrangler secret put VAPID_SUBJECT                       # mailto:you@example.com
npx wrangler secret put SHARED_SECRET                       # OPTIONAL — protects /subscribe
npx wrangler deploy
```

</details>

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
