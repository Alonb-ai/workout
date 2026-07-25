# CLAUDE.md — Iron Track

Working memory for future Claude Code sessions in this repo. Keep it concise and update it as the architecture changes.

## Project overview

Iron Track is a **Hebrew (RTL) Progressive Web App** for personal strength training and supplement tracking. It is **offline-first**: all data lives in the user's browser via IndexedDB (Dexie). Built with React 18 + TypeScript strict + Vite + Tailwind + vite-plugin-pwa. Designed mobile-first, installable, and usable in seconds during an active workout.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `http://localhost:5173` (HMR). |
| `npm run build` | Type-check + production build to `dist/`, includes service worker + manifest. |
| `npm run preview` | Serve the production build locally. |
| `npm run type-check` | TypeScript-only check (no emit). |
| `npm run lint` | ESLint (TS/TSX) — kept light. |
| `npm test` | Vitest: pure logic + Dexie persistence (IndexedDB via `fake-indexeddb`). |
| `npm run test:e2e` | Playwright on WebKit at an iPhone viewport — reload-survival and one-tap logging. |
| `npm run verify` | build + smoke + vitest in one shot. The pre-delivery gate. |
| `npx tsx scripts/smoke.ts` | Run math/logic smoke tests for scoring, plate calc, stall detection. |

## Folder layout

```
src/
├── App.tsx                  # Router + bootstrap (seed DB on first run)
├── main.tsx                 # ReactDOM + service worker registration
├── index.css                # Tailwind layers + theme tokens + utility helpers
├── components/              # UI primitives (Modal, ToastHost, NumberInput, AppShell, Icon, …)
├── features/
│   ├── dashboard/           # Home screen: streak, next workout, today's supplements, stall flags
│   ├── workout/             # Active session logger (the core), exercise history
│   ├── plan/                # Plan / Workout / Muscle group / Exercise CRUD + DnD
│   ├── supplements/         # Daily timeline, CRUD, adherence, in-app scheduler
│   ├── progress/            # Charts (volume/score), session journal, session detail
│   └── settings/            # Units, plate inventory, rest timer, backup/import/wipe
├── hooks/                   # useSettings (Dexie-backed), useTick, useNotifications
├── db/
│   ├── db.ts                # Dexie schema (versioned). Edit-then-bump.
│   ├── seed.ts              # First-run seed (the user's "עוצמה Upper/Lower" program)
│   └── queries.ts           # Read-only helpers (exercise history, recent sessions, etc.)
├── store/                   # Zustand: toast, timer, transient workout-session UI
├── utils/                   # Pure functions: scoring, progression, plate math, stall detection, dates, cn
├── types/                   # Domain types (Plan/Workout/Exercise/Session/SetLog/Supplement/…)
└── assets/                  # (currently icons live in /public/icons)
```

### Dexie versions

v1 initial · v2 push fields · v3 `workoutDrafts` · v4 `bodyMeasurements` + profile ·
**v5 backfills `barWeight` on barbell lifts** (`inferBarWeight` in `db/db.ts` — it
returns `null` for "leave alone" and only names it is sure about get a bar, since
a wrong bar weight makes the plate calculator state the wrong load).

### Dexie entities

| Table          | Primary key | Foreign keys / Notes                                                |
| -------------- | ----------- | ------------------------------------------------------------------- |
| `plans`        | `id`        | `isActive` (single active expected), `order`                        |
| `workouts`     | `id`        | `planId`, `code` (e.g. `UA`), `order`                               |
| `muscleGroups` | `id`        | `workoutId`, `order`                                                |
| `exercises`    | `id`        | `muscleGroupId`, `barWeight`, `isMachine`, `seedWeight`             |
| `sessions`     | `id`        | `workoutId`, `planId`, `date`, `status`, `score`, `totalVolume`     |
| `exerciseLogs` | `id`        | `sessionId`, `exerciseId`, **snapshots** of name/target/barWeight   |
| `setLogs`      | `id`        | `exerciseLogId`, `sessionId`, `exerciseId`, `setNumber`, `completed` |
| `supplements`  | `id`        | `daysOfWeek`, `times`, `active`, `order`                            |
| `supplementLogs` | `id`      | `[supplementId+date]`, `scheduledTime`, `status`                    |
| `settings`     | `id="singleton"` | App-wide preferences, plate inventory, dismissed stall flags    |
| `workoutDrafts`| `workoutId`     | Autosaved in-progress session (drafts/notes/sessionDate). One per workout. Wiped on Finish & Save or explicit discard. |

**Snapshot fields on logs are intentional.** They preserve session history even if the user later renames or deletes the source exercise.

## Hard conventions (MUST follow)

1. **UI is Hebrew + RTL.** All visible text is Hebrew. `<html dir="rtl" lang="he">`. All code, comments, commit messages, and filenames are English.
2. **All weights are NET.** Plates / machine stack only — bar weight is *excluded* from every stored or scored value. `Exercise.barWeight` exists **only** for the plate calculator. Never add it to a logged or displayed weight.
3. **TypeScript strict mode.** No `any`. No `// @ts-ignore`. Prefer narrow types; snapshot fields are typed explicitly.
4. **No native dialogs.** No `prompt` / `confirm` / `alert`. Use the in-app `Modal` + `confirmDialog()` (`src/components/Confirm.tsx`).
5. **No `localStorage` for app data.** Everything user-relevant is in Dexie. `sessionStorage` is OK for transient UI state (the supplement scheduler uses it to dedupe notifications per session).
6. **Mobile-first.** Touch targets ≥ 44×44 px. Number inputs use `inputmode="decimal"` (see `NumberInput`). Safe-area insets honored via `env(safe-area-inset-*)`.
7. **Never lose data — this is the top priority, above every other concern.** The owner's
   worst experience with this app was losing sessions he forgot to save. The contract:
   - The active workout autosaves to `workoutDrafts` (debounced 500 ms) and is restored on
     mount. The final `Session` is written only on Finish & Save, which then deletes the draft.
   - The draft is **also flushed immediately** on `visibilitychange`→hidden, on `pagehide`,
     and on unmount. iOS can discard a backgrounded PWA tab, so a pending debounce is not a
     safe place for the last set. `persistDraft` takes `(id, snapshot)` explicitly — never
     read them from a closure, or a tab switch writes one workout's sets under another's key.
   - **Inputs commit on every keystroke**, not on blur (`NumberInput`). iOS's decimal keypad
     has no Return key and backgrounding fires no blur, so blur-only commits meant the flush
     wrote a draft missing the number the user had just typed.
   - **A draft containing completed sets is never auto-deleted, at any age.**
     `purgeEmptyWorkoutDrafts` only removes drafts with nothing logged. Drafts dated before
     today are surfaced on the dashboard as "אימון שלא נשמר" with a one-tap `commitDraft`.
   - Export/import/wipe iterate `db.tables` rather than a hand-written list — every
     hand-listed version silently forgot a table added by a later `.version()`.
     `importAll` validates the payload **before** clearing anything.
8. **Dexie schema is versioned.** When changing the shape: add a new `.version(N)` block in `src/db/db.ts` and write the migration. Never mutate an existing version.

## Scoring / progression rules (single source of truth)

- **Volume** = Σ(weight × reps) across *completed* sets.
- **Estimated 1RM** = Epley: `weight × (1 + reps/30)`. Take the best across completed sets.
- **PR** = `topWeight`, `est1RM`, or `volume` strictly greater than any prior session for that exercise.
- **Comparison tag** (per exercise per session): `pr` / `up` (>1%) / `same` / `down` (>1%) / `new` (no prior).
- **Workout score (0–100)** = `0.5 * volumeComponent + 0.25 * prComponent + 0.25 * completionComponent`:
  - `volumeComponent`: ratio of current volume to avg of the last 3 sessions of the same workout; clamped 0.5–1.5, mapped 0–100 (ratio 1.0 → 70).
  - `prComponent`: 0 PRs → 0, 1 → 60, 2 → 85, ≥3 → 100.
  - `completionComponent`: `completedSets / plannedSets * 100`.
- **Stall** detection: an exercise is stalled when neither `topWeight` nor `volume` improved across its last 3 completed sessions. Suggestion: ~10% deload OR substitution; **advisory only**, never mutates data.

All this logic lives in `src/utils/scoring.ts` and `src/utils/stall.ts`. Run `npx tsx scripts/smoke.ts` after changing it.

## Progressive overload (the app's job, not the user's)

`src/utils/progression.ts` decides **what to lift today** for each exercise. It is the
difference between a logbook and a coach, so treat it as load-bearing.

- **Double progression.** Hold the weight until every target set is completed at the
  **top** of the rep range, then add one increment and drop back to the bottom.
- **The weakest set at the top weight decides.** `8, 8, 7` in a 6–8 range has not earned
  an increase. Warm-up sets below the top weight are ignored entirely.
- **Increment** = `Exercise.incrementKg` if set → else 2.5 kg for machines → else the
  smallest **owned plate pair** (`smallestPairIncrement`, i.e. 2 × the smallest plate).
  `incrementKg` is an optional, non-indexed field: no Dexie migration needed to add it.
- **Stall outranks hold.** A lift flagged by `detectStall` gets a deload prescription
  instead of another identical session — holding is what caused the stall.
- **0 kg means bodyweight**, and reps are the only progress signal there. Never let the
  engine turn a 0 kg top set into "load 2.5 kg".
- **A first-ever session with no `seedWeight` has no prescription at all** — no ghost
  reps, and the ✓ button stays disabled, so one tap can't log a 0 kg set.

The prescription reaches the UI as `DraftExercise.prescription`, is shown as the coloured
strip at the top of each `ExerciseCard`, and is written into every set row as ghost text.
**Tapping ✓ on an untouched row adopts the ghost values as real numbers** — that one-tap
path is the primary way sets get logged, so don't break it. Anything typed always wins.

Covered by `src/utils/progression.test.ts` and the E2E specs; run both after touching it.

## Design system

Tokens live in `tailwind.config.js`, primitives in `src/index.css` under `@layer
components`. Reference implementations: the `PrescriptionStrip` in
`features/workout/ExerciseCard.tsx` and the hero card + `Stat` tile in
`features/dashboard/DashboardPage.tsx`. Match those rather than inventing a
second language.

**Elevation carries the meaning.** A surface is either lit from above or carved in:

| Class | Use |
| --- | --- |
| `.card` / `.card-flat` | Raised. Hairline top highlight + drop shadow. Content sits on it. |
| `.field` | Recessed: `bg-ink-950` — **darker than the card containing it** — plus an inset shadow. Every input, select, chip track and progress groove. |
| `.card-hero` | The one primary action on a screen, if it has one. Accent gradient bleeding from a corner. At most one per screen. |

An input that is *lighter* than its container reads as a button. That inversion
is most of what makes the app feel finished.

**Type.** `.eyebrow` for the small label above a value or section. `.num-display`
for a number that IS the message (a prescribed weight, a score, a count) — mono,
tabular, tight. `.num` for numbers inside running text. Never render a raw ISO
date as a value; use the `formatHebDate*` helpers.

**Colour.** Orange *text* on dark uses `text-accent-text` (#ffa257) — the pure
accent vibrates at small sizes. Status colours go on as a very low-alpha tint
(`bg-good/[0.06]`) plus a 3px full-strength rule on the leading edge; never fill
a block with a status colour, it out-shouts the content it belongs to.
Destructive controls are `text-fg-ghost hover:text-bad` — red when you reach for
it, not while you read.

**Fonts are bundled** (`@fontsource-variable/*`, imported in `main.tsx`), not
fetched from a CDN. An offline-first PWA that loses its typography the moment
the gym wifi drops is not offline-first. Never reintroduce a `<link>` to
fonts.googleapis.com.

**Motion** is short (`duration: 0.18`) and cheap. Never put framer-motion's
`layout` prop on a component that re-renders while the user types — it made
framer measure and tween all six exercise cards on every keystroke.

**Accessible names are an API.** 51 Playwright tests find controls by their
Hebrew `aria-label` and visible button text. Restyling is free; renaming a
control is a breaking change.

## Verification ritual (do this before declaring any task done)

1. `npm run verify` — build + smoke + vitest. All three must be clean.
2. `npm run test:e2e` — Playwright, must be all green. It is the only thing that proves
   IndexedDB actually survives a reload.
3. `npm run dev` and exercise the actual flow being changed. Console must be clean (no warnings).
4. Re-check the self-test checklist items in the README that the change touches (data persistence, plate calc edge cases, RTL, PWA install, etc.).
5. Never deliver red.

### Never clamp a user's number into validity

`NumberInput` clamps to `min`/`max` **on blur**, and pressing a modal's save
button blurs first — so a `min` on an input is not validation, it is a silent
rewrite that reaches the DB before any guard runs. A typed `0` was stored as a
real 20.0 kg body measurement, with a success toast. Where a wrong value must be
refused rather than corrected (measurements, anything the user is asserting as
fact), leave `min`/`max` off the input and range-check in the save handler with
a specific Hebrew message.

### Hooks rule (learned the hard way)

There is **no error boundary** in this app, so a React invariant violation unmounts the
whole thing to a white screen. `useLiveQuery` always returns `undefined` on the first
render, so **every hook must be called before any conditional return** — an early `if
(!x) return …` placed above later hooks changes the hook count between render 1 and 2 and
crashes the app on every visit. Where "loading" and "not found" must be told apart, have
the query return `?? null`: `undefined` = loading, `null` = missing.

## Gotchas & decisions

- **RTL with date inputs.** Browser-native `<input type="date">` is direction-sensitive; we display it inline rather than wrapping in custom UI so the OS picker renders correctly.
- **Recharts is LTR.** The chart wrapper sets `direction: ltr` so axis labels and tooltips render correctly even on an RTL page (see `src/index.css`).
- **iOS Notifications.** Web Push fires from a Service Worker registered on a PWA installed to Home Screen on iOS 16.4+. Outside that, only **foreground** scheduling works via `Notification.requestPermission` + `showNotification`. The `supplements/scheduler.ts` runs a 30s tick while the app is open to catch missed doses in-session. Be explicit with the user about these limits.
- **Background push** comes from `worker/` — a Cloudflare Worker (hand-rolled VAPID + RFC 8291) that stores subscriptions in KV and fires pushes from a cron trigger. The frontend (`features/push/webPush.ts`) re-syncs the schedule whenever supplements change. SW lives at `src/sw.ts` and uses `injectManifest` (NOT `generateSW`) so we can add a custom `push` event handler — when changing PWA strategy, both files must stay in sync.
- **Cloudflare KV free-tier ceiling.** The cron runs every **2 minutes** (`*/2 * * * *`) — every-minute cron blew past the 1,000 list ops/day cap. To compensate, `processSubscription` matches HH:MM against *both* the current minute and the previous one (see `candidateMoments` in `worker/src/index.ts`); the existing `SENT_PREFIX` dedupe key (per `date+name+time`) keeps things idempotent so the overlap can't double-fire. When changing cron cadence, keep the match window ≥ the cron interval.
- **Rest timer sound.** Schedules two short beeps via `AudioContext` *absolute* time at `start(rest)` (see `RestTimerBar.tsx`) so they fire even if the main thread is throttled (background tab). Also acquires the Wake Lock API while a timer is active. On iOS PWA, switching to another app suspends the AudioContext — no audio fires; that's a browser limit, not ours. The `setTimeout`-driven SW `showNotification` is a best-effort fallback for backgrounded tabs.
- **Plate math operates in 0.01 kg integer cents** to avoid floating-point drift on 1.25 / 2.5 plates. Plates are loaded in **pairs** (`qty` is the total plates owned, not pairs).
- **`PromiseExtended` vs `Promise`.** `useLiveQuery(() => cond ? db... : Promise.resolve([]), …)` produces an inferred type that confuses TS — always wrap with `useLiveQuery(async () => { if (!cond) return []; return db... })`.
- **Dexie transactions.** Reads inside an `rw` transaction don't reliably reflect uncommitted writes from the same transaction in all browsers — when a save needs to read history (e.g. to compute PRs), do the reads *before* opening the transaction, then write inside it. See `features/workout/buildSession.ts`.
- **No `prompt/confirm/alert`.** Already enforced by lint hygiene; reach for `Modal` + `confirmDialog` instead.

## Adding a new screen / module

1. Drop it under `src/features/<name>/`.
2. Add the route in `src/App.tsx` (lazy-load only if it ships >100kb of code).
3. If it needs new persistence, add fields to the relevant entity in `src/types/index.ts`, then **bump the Dexie version** in `src/db/db.ts` with an upgrade function.
4. UI: use the existing primitives (`card`, `btn-primary`, `btn-ghost`, `NumberInput`, `Modal`, `Section`, `EmptyState`).
5. Wire any new top-level navigation through the bottom tab bar in `components/AppShell.tsx`.
6. Update this CLAUDE.md if the architecture shifted.
