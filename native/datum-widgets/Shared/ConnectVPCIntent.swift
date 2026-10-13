import AppIntents
import CryptoKit
import Foundation
import NetworkExtension
import Security
import WidgetKit

// "Connect to VPC" (iOS 18 control; IOS_VPN=1 builds only). Compiled into the
// app and the DatumWidgets extension; both carry the packet-tunnel
// entitlement, the shared Keychain group and the App Group, so the toggle
// works in whichever process the system runs it (normally the extension,
// without opening the app).
//
// On:  restart the saved DatumTunnel configuration, but only after checking
//      that the last join still stands (Connector key, Connector, binding
//      accepted with the same grant), using the access token the app shares
//      in the Keychain. Otherwise (left, revoked, changed, or the token has
//      expired) open the app at the network's screen to connect again.
// Off: stop the tunnel and keep the join (binding), so On can resume it.
//      The app's own Disconnect still leaves the network (deletes the binding).

enum VPCControl {
  static let kind = "net.datum.widgets.connect-vpc"

  static var providerBundleIdentifier: String? { WidgetShared.info("DatumVpnProviderBundleIdentifier") }

  static func manager() async throws -> NETunnelProviderManager? {
    guard let provider = providerBundleIdentifier else { return nil }
    let managers = try await NETunnelProviderManager.loadAllFromPreferences()
    return managers.first {
      ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == provider
    }
  }

  static func join(of manager: NETunnelProviderManager) -> TunnelJoin? {
    let config = (manager.protocolConfiguration as? NETunnelProviderProtocol)?.providerConfiguration ?? [:]
    return TunnelJoin(config)
  }

  static func isActive(_ status: NEVPNStatus) -> Bool {
    status == .connected || status == .connecting || status == .reasserting
  }

  /// The app clears the widget snapshot on sign-out: no snapshot, no resume.
  static var signedIn: Bool {
    WidgetShared.snapshotURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
  }

  /// The org for a project, from the widgets' snapshot directory (for the reconnect link).
  static func org(of project: String) -> String? {
    guard let url = WidgetShared.snapshotURL, let data = try? Data(contentsOf: url),
      let snapshot = HealthSnapshot.decode(data)
    else { return nil }
    return snapshot.projects[project]?.orgId ?? snapshot.directory.first { $0.projectId == project }?.orgId
  }
}

/// Mirrors the DatumVpn module's `SharedKeychain` (read only).
enum VPCKeychain {
  static let service = "net.datum.connect"
  static let tokenAccount = "access-token"

  static func read(_ account: String) -> Data? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    if let group = WidgetShared.info("DatumKeychainAccessGroup") { query[kSecAttrAccessGroup as String] = group }
    var result: AnyObject?
    return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess ? result as? Data : nil
  }

  static var accessToken: String? { read(tokenAccount).flatMap { String(data: $0, encoding: .utf8) } }

  /// The Connector key is still on this device and is the one the tunnel was configured with.
  static func hasConnectorKey(_ join: TunnelJoin) -> Bool {
    guard let seed = read("connector-key.\(join.project)"),
      let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    else { return false }
    let hex = key.publicKey.rawRepresentation.map { String(format: "%02x", $0) }.joined()
    return hex == join.publicKey
  }
}

enum VPCResume {
  enum Verdict {
    case resume
    case reconnect(String)
  }

  /// Can the saved tunnel be restarted as is?
  static func check(_ join: TunnelJoin, now: Date = Date()) async -> Verdict {
    guard VPCKeychain.hasConnectorKey(join) else { return .reconnect("This device's Connector key is missing.") }
    let token = VPCKeychain.accessToken
    guard let token, JoinCheck.tokenUsable(token, at: now) else {
      return .reconnect("Open Datum to check this device can still join.")
    }
    let session = URLSession(configuration: .ephemeral)
    defer { session.finishTasksAndInvalidate() }
    do {
      let connector = try await get(join.connectorURL, token: token, session: session)
      if let problem = JoinCheck.connectorProblem(connector, join: join) { return .reconnect(problem) }
      let binding = try await get(join.bindingURL, token: token, session: session)
      let gateway =
        JoinCheck.bindingNeedsGateway(binding) ? try await get(join.gatewayURL, token: token, session: session) : nil
      if let problem = JoinCheck.bindingProblem(binding, gateway: gateway, join: join) { return .reconnect(problem) }
      return .resume
    } catch {
      return .reconnect("Couldn't reach Datum to check the network.")
    }
  }

  struct HTTPFailure: Error {}

  /// The object, nil on 404; throws on anything else that isn't 2xx.
  static func get(_ url: URL?, token: String, session: URLSession) async throws -> [String: Any]? {
    guard let url else { throw HTTPFailure() }
    var request = URLRequest(url: url, timeoutInterval: 8)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 { return nil }
    guard (200..<300).contains(status) else { throw HTTPFailure() }
    return try JSONSerialization.jsonObject(with: data) as? [String: Any]
  }
}

/// The control's action. `value` is the toggle's new state.
struct ConnectVPCIntent: SetValueIntent {
  static let title: LocalizedStringResource = "Connect to VPC"
  static let description = IntentDescription(
    "Turns the Datum Connect tunnel to the VPC you joined last on or off.")

  @Parameter(title: "Connected")
  var value: Bool

  init() {}

  func perform() async throws -> some IntentResult {
    defer { ControlCenter.shared.reloadControls(ofKind: VPCControl.kind) }
    guard let manager = try? await VPCControl.manager(), let join = VPCControl.join(of: manager) else {
      // Never connected on this device (or the configuration was removed).
      return .result(opensIntent: OpenDatumRouteIntent(route: "/(network)/network?segment=networks"))
    }
    if !value {
      // Pause: the binding (and its grant) stays, so turning it on can resume.
      manager.connection.stopVPNTunnel()
      return .result()
    }
    if VPCControl.isActive(manager.connection.status) { return .result() }

    let route = JoinCheck.networkRoute(join, org: VPCControl.org(of: join.project))
    guard VPCControl.signedIn, case .resume = await VPCResume.check(join) else {
      return .result(opensIntent: OpenDatumRouteIntent(route: route))
    }
    do {
      // iOS disables the configuration when another VPN app connects.
      if !manager.isEnabled {
        manager.isEnabled = true
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
      }
      try manager.connection.startVPNTunnel()
      return .result()
    } catch {
      return .result(opensIntent: OpenDatumRouteIntent(route: route))
    }
  }
}
