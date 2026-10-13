import Foundation

// Compiled into the app and the DatumWidgets extension (see
// plugins/with-datum-widgets.js). Paths and keys mirror
// `modules/datum-widgets/ios/DatumWidgetsModule.swift` (`WidgetStore`).

enum WidgetShared {
  static let pendingRouteKey = "datum.widgets.pendingRoute"

  static func info(_ key: String) -> String? {
    let value = Bundle.main.object(forInfoDictionaryKey: key) as? String
    return value?.isEmpty == false ? value : nil
  }

  static var appGroup: String? { info("DatumAppGroupIdentifier") }
  /// The app's URL scheme (`net.datum.cloud.staging`, …).
  static var scheme: String { info("DatumURLScheme") ?? "net.datum.cloud.staging" }

  static var defaults: UserDefaults? { appGroup.flatMap { UserDefaults(suiteName: $0) } }

  static var directory: URL? {
    appGroup
      .flatMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }?
      .appendingPathComponent("Library/Application Support/DatumWidgets", isDirectory: true)
  }

  static var snapshotURL: URL? { directory?.appendingPathComponent("health.json") }
  static var requestedURL: URL? { directory?.appendingPathComponent("requested.json") }

  /// Leave a route for the app to open when it comes up (the app reads it
  /// once, within two minutes), and wake it if it's running.
  static func openInApp(_ route: String) {
    guard route.hasPrefix("/"), let defaults else { return }
    defaults.set(["route": route, "at": Date().timeIntervalSince1970], forKey: pendingRouteKey)
    if let group = appGroup {
      CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName("\(group).pendingRoute" as CFString), nil,
        nil, true)
    }
  }
}
