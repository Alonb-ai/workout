#!/usr/bin/env bash
#
# Iron Track — one-shot Worker setup.
#
# What this does for you, in order:
#   1. npm install in worker/
#   2. Verify Cloudflare login (triggers `wrangler login` browser flow if not).
#   3. Create the iron_track_subs KV namespace (or reuse if already there).
#   4. Patch wrangler.toml with the namespace id.
#   5. Generate a VAPID keypair via scripts/generateVapid.ts.
#   6. Set the VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT secrets.
#   7. Deploy the Worker.
#   8. Print the workers.dev URL + the VAPID public key so you can paste them
#      into Iron Track → Settings → "פוש לרקע".
#
# You will be asked:
#   - to log in to Cloudflare in the browser (first run only),
#   - for a contact email used as the VAPID subject (any email works).
#
# Safe to re-run: KV namespace + secrets are upserted, VAPID is regenerated
# (existing push subscriptions will need to be re-enabled in the app).

set -euo pipefail

# Resolve script directory so we always run relative to worker/.
cd "$(dirname "$0")"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
dim() { printf "\033[2m%s\033[0m\n" "$*"; }
ok() { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m!\033[0m %s\n" "$*"; }
err() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing command: $1 — install it and re-run."
    exit 1
  fi
}

bold "==> 1/8  Checking prerequisites"
require_cmd node
require_cmd npm
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node 20+ required (you have $(node -v)). Install from https://nodejs.org/ and retry."
  exit 1
fi
ok "node $(node -v)"

bold "==> 2/8  Installing Worker dependencies"
npm install --silent
ok "deps installed"

bold "==> 3/8  Verifying Cloudflare login"
if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  warn "not logged in — opening browser to authenticate with Cloudflare…"
  npx --yes wrangler login
fi
ACCOUNT_LINE=$(npx --yes wrangler whoami 2>&1 | grep -E "associated with the email|logged in" | head -1 || true)
ok "${ACCOUNT_LINE:-logged in}"

bold "==> 4/8  Creating or reusing KV namespace 'iron_track_subs'"
KV_ID=""
# Try to create first; if it already exists, parse the existing id from the list.
CREATE_OUT=$(npx --yes wrangler kv namespace create iron_track_subs 2>&1 || true)
KV_ID=$(printf '%s\n' "$CREATE_OUT" | grep -oE 'id = "[a-f0-9]+"' | head -1 | cut -d'"' -f2 || true)

if [ -z "$KV_ID" ]; then
  # Fall back to listing.
  LIST_OUT=$(npx --yes wrangler kv namespace list 2>/dev/null || echo "[]")
  KV_ID=$(node -e "
    const data = JSON.parse(process.argv[1] || '[]');
    const found = data.find(n => (n.title || '').endsWith('iron_track_subs'));
    if (found) process.stdout.write(found.id);
  " "$LIST_OUT")
fi

if [ -z "$KV_ID" ]; then
  err "could not create or find the KV namespace. Output was:"
  printf '%s\n' "$CREATE_OUT" >&2
  exit 1
fi
ok "KV namespace id: $KV_ID"

# Patch wrangler.toml so it points at THIS account's namespace. The repo
# ships with the upstream maintainer's id committed; on a fork we overwrite
# it with the one we just created/found above. Idempotent.
CURRENT_ID=$(grep -E '^id = "' wrangler.toml | head -1 | cut -d'"' -f2)
if [ "$CURRENT_ID" = "$KV_ID" ]; then
  dim "wrangler.toml already has this KV id — leaving it alone"
else
  # Portable in-place sed (works on macOS and Linux).
  sed -i.bak -E "s|^id = \".*\"|id = \"$KV_ID\"|" wrangler.toml
  rm -f wrangler.toml.bak
  ok "wrangler.toml id set to $KV_ID"
fi

bold "==> 5/8  Generating VAPID keypair"
GEN_OUTPUT=$(node --no-warnings --experimental-strip-types ../scripts/generateVapid.ts --machine 2>/dev/null \
  || npx --yes tsx ../scripts/generateVapid.ts --machine)
VAPID_PUBLIC=$(printf '%s\n' "$GEN_OUTPUT" | grep '^PUBLIC=' | head -1 | cut -d= -f2)
VAPID_PRIVATE=$(printf '%s\n' "$GEN_OUTPUT" | grep '^PRIVATE=' | head -1 | cut -d= -f2)
if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ]; then
  err "VAPID generation failed. Output was:"
  printf '%s\n' "$GEN_OUTPUT" >&2
  exit 1
fi
ok "keypair generated (public is $((${#VAPID_PUBLIC})) chars, private is $((${#VAPID_PRIVATE})) chars)"

bold "==> 6/8  Setting Worker secrets"
# Default VAPID subject — RFC 8292 says any contact URI works. The push
# service uses it only if a delivery problem needs to be reported.
DEFAULT_EMAIL="iron-track@localhost"
if [ -z "${VAPID_SUBJECT:-}" ]; then
  printf "    Contact email for VAPID subject [%s]: " "$DEFAULT_EMAIL"
  read -r ENTERED_EMAIL
  VAPID_SUBJECT="mailto:${ENTERED_EMAIL:-$DEFAULT_EMAIL}"
fi
printf '%s' "$VAPID_PUBLIC"  | npx --yes wrangler secret put VAPID_PUBLIC_KEY  >/dev/null
printf '%s' "$VAPID_PRIVATE" | npx --yes wrangler secret put VAPID_PRIVATE_KEY >/dev/null
printf '%s' "$VAPID_SUBJECT" | npx --yes wrangler secret put VAPID_SUBJECT     >/dev/null
ok "secrets set (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)"

bold "==> 7/8  Deploying Worker"
DEPLOY_OUT=$(npx --yes wrangler deploy 2>&1 | tee /dev/stderr)
WORKER_URL=$(printf '%s\n' "$DEPLOY_OUT" \
  | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' \
  | head -1 || true)
if [ -z "$WORKER_URL" ]; then
  err "deploy finished but no workers.dev URL was found in the output."
  exit 1
fi
ok "deployed to $WORKER_URL"

bold "==> 8/8  Done!"
cat <<EOF

================================================================
  Paste these two values into Iron Track → Settings → "פוש לרקע":
================================================================

  Backend URL:
    $WORKER_URL

  VAPID Public Key:
    $VAPID_PUBLIC

================================================================

Then go to Supplements → "הפעל פוש לרקע" → "שלח בדיקה".
You should see a notification arrive within seconds — even if the app
is fully closed.

If anything misbehaves, run \`npx wrangler tail\` in this directory
to see live logs from the Worker.

EOF
