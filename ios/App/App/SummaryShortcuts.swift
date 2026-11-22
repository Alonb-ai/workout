import Foundation
import Capacitor
#if canImport(AppIntents)
import AppIntents
#endif

/// Workout summaries for iOS Shortcuts.
///
/// The workout data lives in the web view's IndexedDB, which native code can't
/// read. So the web layer (`src/native/shortcutSummaries.ts`) renders the text
/// and stores it here whenever sessions change; the App Intents below just
/// return that text, so a Shortcut can use it without the app opening — e.g.
/// a weekly automation that mails the summary to an AI assistant.
enum SummaryKeys {
    static let lastWorkout = "summary.lastWorkout"
    static let weekly = "summary.weekly"
    static let weekStart = "summary.weekStart"
    static let updatedAt = "summary.updatedAt"
}

@objc(SummaryStorePlugin)
public class SummaryStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SummaryStorePlugin"
    public let jsName = "SummaryStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    @objc func save(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        defaults.set(call.getString("lastWorkout") ?? "", forKey: SummaryKeys.lastWorkout)
        defaults.set(call.getString("weekly") ?? "", forKey: SummaryKeys.weekly)
        defaults.set(call.getString("weekStart") ?? "", forKey: SummaryKeys.weekStart)
        defaults.set(call.getDouble("updatedAt") ?? 0, forKey: SummaryKeys.updatedAt)
        call.resolve()
    }
}

enum SummaryText {
    static let noData = "אין עדיין נתונים. פתח את Iron Track פעם אחת כדי שהסיכום יתעדכן."

    static func lastWorkout() -> String {
        let text = UserDefaults.standard.string(forKey: SummaryKeys.lastWorkout) ?? ""
        return text.isEmpty ? noData : text
    }

    /// The stored weekly text covers the week it was rendered in. If the app
    /// hasn't been opened since a new week started, say so instead of
    /// presenting last week's numbers as this week's.
    static func weekly() -> String {
        let defaults = UserDefaults.standard
        let text = defaults.string(forKey: SummaryKeys.weekly) ?? ""
        if text.isEmpty { return noData }
        let stored = defaults.string(forKey: SummaryKeys.weekStart) ?? ""
        if stored == currentWeekStart() { return text }
        return "השבוע עוד לא נרשמו אימונים באפליקציה.\n\nהסיכום האחרון שנשמר:\n" + text
    }

    /// Sunday of the current week, yyyy-MM-dd — must match `weekStartISO` in
    /// `src/utils/summaryText.ts`.
    static func currentWeekStart(now: Date = Date()) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 1 // Sunday
        cal.timeZone = .current
        let start = cal.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let f = DateFormatter()
        f.calendar = cal
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: start)
    }
}

#if canImport(AppIntents)
@available(iOS 16.0, *)
struct LastWorkoutSummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "סיכום האימון האחרון"
    static var description = IntentDescription(
        "הטקסט של האימון האחרון שנשמר: כל תרגיל עם הסטים, הפעם הקודמת וההערות."
    )
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: SummaryText.lastWorkout())
    }
}

@available(iOS 16.0, *)
struct WeeklySummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "סיכום שבועי"
    static var description = IntentDescription(
        "סיכום השבוע הנוכחי (ראשון עד שבת): אימונים, נפח, שיאים והשוואה לשבוע הקודם."
    )
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: SummaryText.weekly())
    }
}

@available(iOS 16.0, *)
struct IronTrackShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LastWorkoutSummaryIntent(),
            phrases: ["סיכום האימון האחרון ב-\(.applicationName)"]
        )
        AppShortcut(
            intent: WeeklySummaryIntent(),
            phrases: ["סיכום שבועי ב-\(.applicationName)"]
        )
    }
}
#endif
