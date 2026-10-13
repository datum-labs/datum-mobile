import ExpoModulesCore
import Foundation
import WidgetKit

/// The app's side of the Datum widgets (`DatumWidgets` extension, IOS_WIDGETS=1):
/// writes the health snapshot into the App Group, reloads timelines and
/// controls, and hands over routes that a Control Centre control asked the
/// app to open. The pod is DatumWidgetsBridge, so its Swift module doesn't
/// clash with the extension's.
public class DatumWidgetsModule: Module {
  fileprivate static weak var observing: DatumWidgetsModule?

  public func definition() -> ModuleDefinition {
    Name("DatumWidgets")

    Events("onPendingRoute")

    Function("getInfo") { () -> [String: Any] in
      var info: [String: Any] = ["available": WidgetStore.container != nil]
      if let group = WidgetStore.appGroup { info["appGroup"] = group }
      info["widgetsEmbedded"] = WidgetStore.widgetsEmbedded
      return info
    }

    AsyncFunction("readSnapshot") { () -> String? in
      guard let url = WidgetStore.snapshotURL else { return nil }
      return try? String(contentsOf: url, encoding: .utf8)
    }

    AsyncFunction("writeSnapshot") { (json: String) throws in
      guard let url = WidgetStore.snapshotURL else { throw WidgetsUnavailable() }
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(json.utf8).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("clearSnapshot") { () in
      for url in [WidgetStore.snapshotURL, WidgetStore.requestedURL].compactMap({ $0 }) {
        try? FileManager.default.removeItem(at: url)
      }
      WidgetStore.defaults?.removeObject(forKey: WidgetStore.pendingRouteKey)
      WidgetCenter.shared.reloadAllTimelines()
      ControlCenter.shared.reloadAllControls()
    }

    /// Projects the widgets showed recently (the extension records them), so
    /// a refresh can include projects other than the selected one.
    Function("requestedProjects") { () -> [String] in
      guard let url = WidgetStore.requestedURL, let data = try? Data(contentsOf: url),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: Double]
      else { return [] }
      return map.sorted { $0.value > $1.value }.map(\.key)
    }

    /// A route a control asked the app to open, if it's still fresh. Read once.
    Function("consumePendingRoute") { () -> String? in
      WidgetStore.consumePendingRoute()
    }

    Function("reloadTimelines") {
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("reloadControls") {
      ControlCenter.shared.reloadAllControls()
    }

    OnStartObserving {
      Self.observing = self
      WidgetStore.observePendingRoutes()
    }

    OnStopObserving {
      WidgetStore.stopObservingPendingRoutes()
      if Self.observing === self { Self.observing = nil }
    }
  }

  fileprivate func pendingRouteArrived() {
    sendEvent("onPendingRoute", [:])
  }
}

struct WidgetsUnavailable: Error, CustomStringConvertible {
  var description: String { "This build has no App Group for the widgets." }
}

/// Paths and keys shared with the widget extension.
/// Mirrored in `native/datum-widgets/Shared/WidgetShared.swift`.
enum WidgetStore {
  static let pendingRouteKey = "datum.widgets.pendingRoute"
  /// Routes older than this are ignored: the control was used, then the app wasn't opened.
  static let pendingRouteTTL: TimeInterval = 120

  static var appGroup: String? {
    let group = Bundle.main.object(forInfoDictionaryKey: "DatumAppGroupIdentifier") as? String
    return group?.isEmpty == false ? group : nil
  }

  static var container: URL? {
    appGroup.flatMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }
  }

  static var directory: URL? {
    container?.appendingPathComponent("Library/Application Support/DatumWidgets", isDirectory: true)
  }

  static var snapshotURL: URL? { directory?.appendingPathComponent("health.json") }
  static var requestedURL: URL? { directory?.appendingPathComponent("requested.json") }

  static var defaults: UserDefaults? { appGroup.flatMap { UserDefaults(suiteName: $0) } }

  static var widgetsEmbedded: Bool {
    guard let plugins = Bundle.main.builtInPlugInsURL,
      let names = try? FileManager.default.contentsOfDirectory(atPath: plugins.path)
    else { return false }
    return names.contains("DatumWidgets.appex")
  }

  static func consumePendingRoute() -> String? {
    guard let defaults, let entry = defaults.dictionary(forKey: pendingRouteKey) else { return nil }
    defaults.removeObject(forKey: pendingRouteKey)
    guard let route = entry["route"] as? String, route.hasPrefix("/"),
      let at = entry["at"] as? Double, Date().timeIntervalSince1970 - at < pendingRouteTTL
    else { return nil }
    return route
  }

  // MARK: - Darwin notification (cross-process)

  static var notificationName: CFString? {
    appGroup.map { "\($0).pendingRoute" as CFString }
  }

  private static var observingRoutes = false
  private static let observer = NSObject()
  private static var observerPointer: UnsafeRawPointer { UnsafeRawPointer(Unmanaged.passUnretained(observer).toOpaque()) }

  static func observePendingRoutes() {
    guard !observingRoutes, let name = notificationName else { return }
    observingRoutes = true
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), observerPointer,
      { _, _, _, _, _ in
        DispatchQueue.main.async { DatumWidgetsModule.observing?.pendingRouteArrived() }
      },
      name, nil, .deliverImmediately)
  }

  static func stopObservingPendingRoutes() {
    guard observingRoutes, let name = notificationName else { return }
    observingRoutes = false
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), observerPointer, CFNotificationName(name), nil)
  }
}
