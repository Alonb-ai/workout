import ActivityKit
import SwiftUI
import WidgetKit

/// Widget extension that draws the rest-timer Live Activity. It has no home
/// screen widgets — only the lock-screen banner and the Dynamic Island.
///
/// The countdown is `Text(timerInterval:)` / `ProgressView(timerInterval:)`,
/// which iOS animates by itself from the dates in the content state, so it
/// keeps running while the app is suspended. When `endsAt` passes, the
/// activity goes stale (staleDate = endsAt) and switches to "rest over".
@main
struct RestTimerWidgetBundle: WidgetBundle {
    var body: some Widget {
        RestTimerLiveActivity()
    }
}

private let accent = Color(red: 1.0, green: 0.541, blue: 0.165)      // #ff8a2a
private let accentText = Color(red: 1.0, green: 0.635, blue: 0.341)  // #ffa257
private let good = Color(red: 0.247, green: 0.812, blue: 0.494)
private let background = Color(red: 0.043, green: 0.051, blue: 0.063) // #0b0d10

private extension RestTimerAttributes.ContentState {
    /// A valid closed range even if the dates arrive out of order.
    var interval: ClosedRange<Date> {
        let start = min(startedAt, endsAt)
        return start...endsAt
    }
    var title: String { label.isEmpty ? "מנוחה" : label }
}

struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            LockScreenView(state: context.state, isStale: context.isStale)
                .environment(\.layoutDirection, .rightToLeft)
                .activityBackgroundTint(background)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let state = context.state
            let over = context.isStale || state.endsAt <= Date()
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(over ? "המנוחה נגמרה" : state.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    } icon: {
                        Image(systemName: over ? "checkmark.circle.fill" : "timer")
                            .foregroundColor(over ? good : accent)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(state: state, over: over)
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .foregroundColor(over ? good : .white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !over {
                        ProgressView(timerInterval: state.interval, countsDown: false) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                        .tint(accent)
                    }
                }
            } compactLeading: {
                Image(systemName: over ? "checkmark.circle.fill" : "timer")
                    .foregroundColor(over ? good : accent)
            } compactTrailing: {
                Countdown(state: state, over: over)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .foregroundColor(over ? good : accentText)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: over ? "checkmark.circle.fill" : "timer")
                    .foregroundColor(over ? good : accent)
            }
        }
    }
}

/// Remaining time, counted down by iOS itself; "0:00" once over.
private struct Countdown: View {
    let state: RestTimerAttributes.ContentState
    let over: Bool

    var body: some View {
        if over {
            Text("0:00").monospacedDigit()
        } else {
            Text(timerInterval: state.interval, countsDown: true, showsHours: false)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct LockScreenView: View {
    let state: RestTimerAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let over = isStale || state.endsAt <= Date()
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(over ? "המנוחה נגמרה" : "מנוחה")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(over ? good : accentText)
                    Text(over ? "הזמן לסט הבא" : state.title)
                        .font(.headline)
                        .foregroundColor(.white)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Countdown(state: state, over: over)
                    .font(.system(size: 40, weight: .bold, design: .monospaced))
                    .foregroundColor(over ? good : .white)
                    .environment(\.layoutDirection, .leftToRight)
            }
            if !over {
                ProgressView(timerInterval: state.interval, countsDown: false) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .tint(accent)
            }
        }
        .padding(16)
    }
}
