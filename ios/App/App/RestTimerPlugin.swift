import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Drives the rest-timer Live Activity (lock screen + Dynamic Island).
/// JS side: `src/native/liveActivity.ts` / `src/native/restTimer.ts`.
///
/// One activity at a time: `start` updates the running one if there is one
/// (a new set, or ±15 s), so the lock screen never stacks countdowns.
@objc(RestTimerPlugin)
public class RestTimerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestTimerPlugin"
    public let jsName = "RestTimer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard let endsAtMs = call.getDouble("endsAt") else {
            call.reject("endsAt is required")
            return
        }
        let nowMs = Date().timeIntervalSince1970 * 1000
        let startedAtMs = min(call.getDouble("startedAt") ?? nowMs, endsAtMs)
        let label = call.getString("label") ?? ""

        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let state = RestTimerAttributes.ContentState(
                startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
                endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
                label: label
            )
            // Past the end the widget switches to its "rest over" look.
            let content = ActivityContent(state: state, staleDate: state.endsAt)
            Task {
                let running = Activity<RestTimerAttributes>.activities
                if let current = running.first {
                    await current.update(content)
                    for extra in running.dropFirst() {
                        await extra.end(nil, dismissalPolicy: .immediate)
                    }
                    call.resolve(["started": true])
                    return
                }
                guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                    call.resolve(["started": false])
                    return
                }
                do {
                    _ = try Activity.request(
                        attributes: RestTimerAttributes(),
                        content: content,
                        pushType: nil
                    )
                    call.resolve(["started": true])
                } catch {
                    call.resolve(["started": false, "error": error.localizedDescription])
                }
            }
            return
        }
        #endif
        call.resolve(["started": false])
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for activity in Activity<RestTimerAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }
}
