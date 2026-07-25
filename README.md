# Iron Track

A personal **Hebrew (RTL) Progressive Web App** for strength training and supplement tracking. Offline-first, installable, mobile-first.

It is a coach, not a logbook: before each exercise it tells you **what to lift today** — the weight and the reps — derived from what you actually did last time. Tap ✓ and the prescribed set is logged. Nothing you enter can be lost.

## How the progression works

Double progression, per exercise:

- Hit **every** target set at the **top** of the rep range → the weight goes up one increment and the reps reset to the bottom of the range.
- Short on any set → the weight holds and it asks for one more rep.
- Three sessions with no improvement → it prescribes a deload instead of another identical session.
- The increment is the smallest plate **pair** you actually own (2 × your smallest plate), 2.5 kg on machines, or a per-exercise override you can set under ⋯ → *מוט וקפיצת משקל*.
- 0 kg means bodyweight, and reps are the only progress signal there.

The prescription appears as a coloured strip on each exercise card, with what you did last time underneath it.

## Nothing gets lost

- The active workout autosaves continuously — on every keystroke, not on blur — and is flushed the instant the app is backgrounded or you leave the screen.
- **A workout with logged sets is never auto-deleted.** If you forget to press *סיים ושמור*, it appears on the home screen the next day as **"אימון שלא נשמר"** with a one-tap save that files it under the date you actually trained.
- Backups cover every table in the schema, and an import validates the file *before* touching your data.

> **Weight convention:** every weight in the app — logged, displayed, scored, charted — is **net load only** (plates or machine stack). The bar/handle weight is **never** added to a stored value. The per-exercise `barWeight` is used *only* by the plate calculator to figure out which plates to load.

## Setup

```bash
npm install
npm run dev          # http://localhost:5173
```

### Build

```bash
npm run build        # type-checks then bundles to ./dist (with PWA assets)
npm run preview      # serve ./dist locally
```

### Tests

```bash
npm run verify       # build + smoke assertions + unit tests — the pre-delivery gate
npm run test:e2e     # Playwright on WebKit at an iPhone viewport
```

- `scripts/smoke.ts` — assertions across scoring (Epley 1RM, volume, workout score), plate math, stall detection and benchmarks. Run after touching anything in `src/utils/`.
- `npm test` (Vitest) — the progression engine and the Dexie persistence rules, against a real IndexedDB (`fake-indexeddb`).
- `npm run test:e2e` — drives the real app: reload survival, one-tap logging, the progression prescription changing between sessions, and rescuing a workout you forgot to save.

## Installing as a PWA

The production build is fully installable. After running `npm run build && npm run preview` (or deploying):

- **Android Chrome / Edge:** the address bar shows an install icon → tap *Install*.
- **iOS Safari (16.4+):** open in Safari → Share → *Add to Home Screen*. Web notifications work only after this step.
- **Desktop Chrome / Edge:** address-bar install icon, or the menu → *Install Iron Track*.

The manifest declares `display: standalone`, an orange-accent theme, RTL/Hebrew metadata, and both standard + maskable icons (192/512).

## Notifications behavior

| Platform | Foreground | Background |
| --- | --- | --- |
| Android (PWA installed) | ✅ Notification API + SW | ✅ via Service Worker; OS may delay if app fully closed |
| Desktop browsers | ✅ Notification API + SW | ⚠️ Only if browser is running |
| iOS Safari, *not* installed | ❌ | ❌ |
| iOS PWA (16.4+, installed) | ✅ SW notification | ⚠️ Web Push only when SW is awoken; the in-app scheduler covers any session you have open |

To complement OS-level scheduling (which varies wildly across platforms), Iron Track runs an in-app scheduler that ticks every 30 seconds while the app is open and fires any missed doses for the day. This makes reminders reliable while the app is foreground/backgrounded but **does not guarantee** delivery when the app has been swiped away. For best results on iOS: install to Home Screen and grant notification permission from Settings → Supplements.

## Plate calculator

- The calculator only runs when the exercise has a `barWeight > 0` and isn't marked as a machine/stack lift.
- Plates are loaded in **pairs** (the inventory `qty` is the *total* plates you own, not pairs). The algorithm is greedy from largest plate.
- If your inventory can't reach the exact net weight you entered, the app shows the closest *achievable* load and the remainder (over/under) explicitly. The original net weight is never silently changed.
- Machine/stack exercises display the net weight as-is with no plate suggestion.

## Data & backup

All data lives locally in **IndexedDB** (via Dexie). Nothing leaves your device. From Settings:

- **Export** — downloads a JSON file containing **every table in the schema** (plans, workouts, sessions, sets, supplements, logs, body measurements, settings, in-progress drafts). The file is built from `db.tables`, so a table added by a future schema version is included automatically.
- **Import** — replaces all data with a previously-exported file. A preview of the row counts is shown first, and the payload is validated **before** anything is cleared: a file that isn't an Iron Track backup is rejected without touching your data. Older, flat-format backups still restore.
- **Reset** — wipes everything and re-runs the first-run seed (the user's "עוצמה Upper/Lower" program).

## Tech stack

React 18 · TypeScript (strict) · Vite · Tailwind · Dexie · Zustand · vite-plugin-pwa · Recharts · Framer Motion · @dnd-kit · date-fns/he

See `CLAUDE.md` for architecture, conventions, scoring rules, and gotchas.
