import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// Shape of the rest-timer Live Activity. Compiled into BOTH the app (which
/// starts / updates / ends the activity) and the RestTimerWidget extension
/// (which draws it), so the two always agree on the encoding.
@available(iOS 16.1, *)
struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the rest started — the left end of the progress bar.
        var startedAt: Date
        /// When the rest ends. iOS counts down to this on its own.
        var endsAt: Date
        /// What the rest is for, usually the exercise name.
        var label: String
    }
}
#endif
