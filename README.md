# Iron Track

A personal **Hebrew (RTL) Progressive Web App** for strength training and supplement tracking. Offline-first, installable, mobile-first. Log a workout in seconds with last-session weights pre-filled, see instant performance scoring vs. previous sessions, and stay on top of supplement schedules.

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

### Smoke tests (math/logic)

```bash
npx tsx scripts/smoke.ts
```

36 assertions across scoring (Epley 1RM, volume, workout score), plate math (exact, closest-achievable, machine, sparse inventory), and stall detection. Run after touching anything in `src/utils/`.

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

- **Export** — downloads a JSON file with every plan / workout / session / supplement / log.
- **Import** — replaces all data with a previously-exported file (a preview is shown before commit).
- **Reset** — wipes everything and re-runs the first-run seed (the user's "עוצמה Upper/Lower" program).

## Tech stack

React 18 · TypeScript (strict) · Vite · Tailwind · Dexie · Zustand · vite-plugin-pwa · Recharts · Framer Motion · @dnd-kit · date-fns/he

See `CLAUDE.md` for architecture, conventions, scoring rules, and gotchas.
