import UIKit
import Capacitor

/// The app's web view controller. Exists only to register plugins that live in
/// the app target itself rather than in an npm package.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RestTimerPlugin())
        bridge?.registerPluginInstance(SummaryStorePlugin())
    }
}
