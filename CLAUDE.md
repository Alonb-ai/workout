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
├── utils/                   # Pure functions: scoring, plate math, stall detection, dates, cn
├── types/                   # Domain types (Plan/Workout/Exercise/Session/SetLog/Supplement/…)
└── assets/                  # (currently icons live in /public/icons)
```

### Dexie entities (v1 schema)

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

**Snapshot fields on logs are intentional.** They preserve session history even if the user later renames or deletes the source exercise.

## Hard conventions (MUST follow)

1. **UI is Hebrew + RTL.** All visible text is Hebrew. `<html dir="rtl" lang="he">`. All code, comments, commit messages, and filenames are English.
2. **All weights are NET.** Plates / machine stack only — bar weight is *excluded* from every stored or scored value. `Exercise.barWeight` exists **only** for the plate calculator. Never add it to a logged or displayed weight.
3. **TypeScript strict mode.** No `any`. No `// @ts-ignore`. Prefer narrow types; snapshot fields are typed explicitly.
4. **No native dialogs.** No `prompt` / `confirm` / `alert`. Use the in-app `Modal` + `confirmDialog()` (`src/components/Confirm.tsx`).
5. **No `localStorage` for app data.** Everything user-relevant is in Dexie. `sessionStorage` is OK for transient UI state (the supplement scheduler uses it to dedupe notifications per session).
6. **Mobile-first.** Touch targets ≥ 44×44 px. Number inputs use `inputmode="decimal"` (see `NumberInput`). Safe-area insets honored via `env(safe-area-inset-*)`.
7. **Never lose data on refresh.** All persistence goes through Dexie. The in-memory logger draft is rebuilt from DB on mount; the `Session` is only written on Finish & Save.
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

## Verification ritual (do this before declaring any task done)

1. `npm run build` — must succeed (TS strict + Vite both clean).
2. `npx tsx scripts/smoke.ts` — must report `0 failed`.
3. `npm run dev` and exercise the actual flow being changed. Console must be clean (no warnings).
4. Re-check the self-test checklist items in the README that the change touches (data persistence, plate calc edge cases, RTL, PWA install, etc.).
5. Never deliver red.

## Gotchas & decisions

- **RTL with date inputs.** Browser-native `<input type="date">` is direction-sensitive; we display it inline rather than wrapping in custom UI so the OS picker renders correctly.
- **Recharts is LTR.** The chart wrapper sets `direction: ltr` so axis labels and tooltips render correctly even on an RTL page (see `src/index.css`).
- **iOS Notifications.** Web Push fires from a Service Worker registered on a PWA installed to Home Screen on iOS 16.4+. Outside that, only **foreground** scheduling works via `Notification.requestPermission` + `showNotification`. The `supplements/scheduler.ts` runs a 30s tick while the app is open to catch missed doses in-session. Be explicit with the user about these limits.
- **Background push** comes from `worker/` — a Cloudflare Worker (hand-rolled VAPID + RFC 8291) that stores subscriptions in KV and fires pushes from a cron trigger. The frontend (`features/push/webPush.ts`) re-syncs the schedule whenever supplements change. SW lives at `src/sw.ts` and uses `injectManifest` (NOT `generateSW`) so we can add a custom `push` event handler — when changing PWA strategy, both files must stay in sync.
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
