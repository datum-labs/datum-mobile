import AppIntents
import Foundation

// Intents that open the app at a route. Compiled into the app and the
// extension: an intent that brings the app forward has to exist in the app
// for the system to run it there. Controls can't open custom-scheme URLs
// (OpenURLIntent needs universal links, which this app doesn't have yet), so
// the route goes through the App Group and the app's `useWidgetLinks`.

/// Opens the app at a route. Not shown in Shortcuts; controls chain to it.
struct OpenDatumRouteIntent: AppIntent {
  static let title: LocalizedStringResource = "Open in Datum"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground(.immediate)

  @Parameter(title: "Route")
  var route: String

  init() {}

  init(route: String) {
    self.route = route
  }

  func perform() async throws -> some IntentResult {
    WidgetShared.openInApp(route)
    return .result()
  }
}

/// "Ask Patch": a new chat with Datum's assistant, from Control Centre, the
/// Lock Screen, the Action button or Shortcuts.
struct AskPatchIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Patch"
  static let description = IntentDescription("Start a new chat with Patch, Datum's assistant, about your current project.")
  static let supportedModes: IntentModes = .foreground(.immediate)

  init() {}

  func perform() async throws -> some IntentResult {
    // A nonce, so a Patch screen that's already open starts over too.
    WidgetShared.openInApp("/assistant?new=\(Int(Date().timeIntervalSince1970 * 1000))")
    return .result()
  }
}
