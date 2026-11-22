# iOS app (Capacitor) — build & TestFlight

The iOS app is the same web build wrapped in a native shell (Capacitor 8, Swift
Package Manager — no CocoaPods). Native-only code lives in `src/native/` and is
gated on `isNativeApp()`, so the web/PWA build is unchanged.

## What differs in the native app

| Area | Web / PWA | iOS app |
| --- | --- | --- |
| Supplement + body reminders | 30 s in-app tick (`supplements/scheduler.ts`), only while open | iOS local notifications queued by `native/reminders.ts`, fire while closed |
| Backup export | `<a download>` | Share sheet → "Save to Files" (`native/files.ts`) |
| Service worker | registered | not registered |
| Cloudflare push section | shown | hidden (web push does not exist in WKWebView) |
| Rest timer | in-app bar + beep, foreground only | also a lock-screen / Dynamic Island countdown (Live Activity) and a notification with the beep when rest ends (`native/restTimer.ts`) |
| Unsaved workout | dashboard flags a draft untouched for 2 h | also a notification 2 h and 12 h after the last change (`native/workoutReminders.ts`) |

### Rest timer on the lock screen (Live Activity)

The countdown is a Live Activity drawn by the **RestTimerWidgetExtension**
target (`ios/App/RestTimerWidget/`). The app starts / updates / ends it through
its own plugin, `ios/App/App/RestTimerPlugin.swift`, registered in
`AppViewController.swift`; both targets compile `ios/App/Shared/RestTimerAttributes.swift`.
iOS animates the countdown from the end time, so it keeps going while the app
is suspended. Needs iOS 16.2+; on older iOS only the notification fires.

When rest ends with the app in the background, a local notification (id 3000)
rings with `public/rest-end.wav`. While the app is open it is suppressed
(`foreground: false`) because the in-app beep already plays. Supplement and
workout reminders use `public/chime.wav`. iOS plays local notifications
silently unless a sound is named.

Notification ids: 1000–1999 supplements/body, 2000–2099 unsaved workout,
3000 rest timer. Permission is asked on the first rest of a workout if it was
never asked before. Both features have toggles in Settings → אימון.

Reminder queue: rebuilt from scratch whenever supplements, logs from today on,
settings or today's body measurement change, and on every resume. One-shot
notifications (not repeating) so a dose already ticked off never pings; capped
at the 60 earliest because iOS keeps at most 64 pending. Planning logic is the
pure `planReminders()` in `features/supplements/reminderPlan.ts` (unit-tested).

**Storage is separate.** The app runs on `capacitor://localhost`, so its
IndexedDB is not the home-screen PWA's. Data moves only via export (old app) →
import (new app). Deleting the iOS app deletes its data — keep exporting backups.

## First-time setup (Mac)

Requires Node ≥ 22 and Xcode 16+. The lockfile is npm 11's; if `npm ci` complains
about it, run `npx npm@11 ci` instead.

```sh
cd ~/workout
git pull
npm ci
npm run ios:sync      # vite build + copy into ios/ + resolve native plugins
npm run ios:open      # opens ios/App/App.xcodeproj in Xcode
```

In Xcode:

1. Select the **App** project → **App** target → **Signing & Capabilities**.
2. Tick **Automatically manage signing**, pick your **Team** (the paid
   developer account).
3. Do the same for the **RestTimerWidgetExtension** target (same Team). Its
   bundle id must start with the app's: `com.alonb.irontrack.RestTimerWidget`.
4. If the bundle id `com.alonb.irontrack` is taken, change it here (and in
   `capacitor.config.ts`) to something unique, and change the widget's to
   `<new id>.RestTimerWidget`.
5. Plug in the iPhone (or pick it over Wi-Fi), select it as the run
   destination, press ▶︎ to test on the device first. On first run, trust the
   developer profile on the phone: Settings → General → VPN & Device Management.

## Upload to TestFlight

1. In <https://appstoreconnect.apple.com> → Apps → **+** → New App: platform
   iOS, name "Iron Track" (any unique name), primary language Hebrew, bundle id
   `com.alonb.irontrack`, SKU anything (e.g. `irontrack`).
2. In Xcode set the run destination to **Any iOS Device (arm64)**.
3. **Product → Archive**. When the Organizer opens: **Distribute App → App
   Store Connect → Upload**, accept the defaults.
4. Wait for the build to finish processing (email, ~5–30 min). In App Store
   Connect → the app → **TestFlight**, the build appears. Encryption compliance
   is pre-answered (`ITSAppUsesNonExemptEncryption = NO` in Info.plist).
5. Internal Testing → create a group, add yourself, install via the
   **TestFlight** app on the phone.

## Every later update

```sh
git pull && npm ci && npm run ios:sync
```

Then bump the build number (every upload needs a higher one) with
`npm run ios:bump`. It raises it on both the App and the widget target, which
must match. Then Archive → Distribute as above.

## Icons / splash

Sources: `resources/ios-icon-1024.png`, `resources/ios-splash-2732.png`, copied
into `ios/App/App/Assets.xcassets`. Replace both places if the icon changes.
