import CryptoKit
import ExpoModulesCore
import Foundation
import NetworkExtension
import Security

/// Options for `start`: everything the packet tunnel needs that isn't secret.
/// Stored as the tunnel's `providerConfiguration` (visible in Settings' VPN
/// detail, so never a key or token).
struct StartOptions: Record {
  @Field var project: String = ""
  @Field var network: String = ""
  @Field var displayName: String = ""
  @Field var apiUrl: String = ""
  @Field var connectorName: String = ""
  @Field var publicKey: String = ""
  @Field var bindingName: String = ""
  @Field var gatewayName: String = ""
  @Field var gatewayLocation: String = ""
  @Field var gatewayEndpointId: String = ""
  @Field var relayUrls: [String] = []
  @Field var homeRelayUrls: [String] = []
  @Field var clientAddress: String = ""
  @Field var gatewayAddress: String = ""
  @Field var routes: [String] = []
  @Field var mtu: Int = 1280
}

enum DatumVpnError: Error, CustomStringConvertible {
  case unavailable(String)
  case keychain(OSStatus)
  case tunnel(String)

  var description: String {
    switch self {
    case .unavailable(let reason): return reason
    case .keychain(let status): return "Keychain error \(status)"
    case .tunnel(let message): return message
    }
  }
}

/// Wraps `NETunnelProviderManager` for the Datum Connect packet tunnel
/// (`DatumTunnel` extension) and keeps the Connector key in the Keychain
/// group the extension shares.
public class DatumVpnModule: Module {
  private var statusObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("DatumVpn")

    Events("onStatusChange")

    Function("getAvailability") { () -> [String: Any] in
      Self.availability()
    }

    AsyncFunction("ensureConnectorKey") { (project: String) throws -> String in
      try Self.requireAvailable()
      return try SharedKeychain.connectorPublicKey(project: project, create: true) ?? ""
    }

    AsyncFunction("getConnectorKey") { (project: String) throws -> String? in
      guard Self.availability()["available"] as? Bool == true else { return nil }
      return try SharedKeychain.connectorPublicKey(project: project, create: false)
    }

    AsyncFunction("setAccessToken") { (token: String) async throws in
      try Self.requireAvailable()
      try SharedKeychain.write(account: SharedKeychain.tokenAccount, data: Data(token.utf8))
      // Tell a running tunnel to pick it up for its next Lease renewal.
      if let session = try await Self.manager()?.connection as? NETunnelProviderSession,
        session.status == .connected || session.status == .reasserting
      {
        _ = try? await Self.send(session, message: ["type": "token"])
      }
    }

    AsyncFunction("start") { (options: StartOptions) async throws in
      try Self.requireAvailable()
      let providerId = Self.providerBundleIdentifier!
      let manager = try await Self.manager() ?? NETunnelProviderManager()
      let proto = NETunnelProviderProtocol()
      proto.providerBundleIdentifier = providerId
      proto.serverAddress = "Datum Connect · \(options.gatewayLocation)"
      proto.providerConfiguration = Self.configuration(options)
      proto.disconnectOnSleep = false
      manager.protocolConfiguration = proto
      manager.localizedDescription = "Datum · \(options.displayName.isEmpty ? options.network : options.displayName)"
      manager.isEnabled = true
      // First save asks the user to allow the VPN configuration.
      try await manager.saveToPreferences()
      try await manager.loadFromPreferences()
      guard let session = manager.connection as? NETunnelProviderSession else {
        throw DatumVpnError.tunnel("The VPN configuration has no tunnel session.")
      }
      try session.startTunnel(options: nil)
    }

    AsyncFunction("stop") { () async throws in
      guard let manager = try await Self.manager() else { return }
      manager.connection.stopVPNTunnel()
    }

    AsyncFunction("removeConfiguration") { () async throws in
      guard let manager = try await Self.manager() else { return }
      manager.connection.stopVPNTunnel()
      try await manager.removeFromPreferences()
    }

    AsyncFunction("getStatus") { () async throws -> [String: Any] in
      guard Self.availability()["available"] as? Bool == true,
        let manager = try await Self.manager()
      else {
        return ["status": "invalid"]
      }
      var result = Self.describe(manager)
      if let session = manager.connection as? NETunnelProviderSession,
        session.status == .connected || session.status == .reasserting || session.status == .connecting,
        let reply = try? await Self.send(session, message: ["type": "status"])
      {
        result["tunnel"] = reply
      }
      return result
    }

    OnStartObserving { [weak self] in
      self?.statusObserver = NotificationCenter.default.addObserver(
        forName: .NEVPNStatusDidChange, object: nil, queue: .main
      ) { [weak self] note in
        guard let connection = note.object as? NEVPNConnection,
          let manager = connection.manager as? NETunnelProviderManager,
          (manager.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier
            == Self.providerBundleIdentifier
        else { return }
        self?.sendEvent("onStatusChange", Self.describe(manager))
      }
    }

    OnStopObserving { [weak self] in
      if let observer = self?.statusObserver {
        NotificationCenter.default.removeObserver(observer)
        self?.statusObserver = nil
      }
    }
  }

  // MARK: - Availability

  static var providerBundleIdentifier: String? {
    Bundle.main.object(forInfoDictionaryKey: "DatumVpnProviderBundleIdentifier") as? String
  }

  static func availability() -> [String: Any] {
    #if targetEnvironment(simulator)
      return ["available": false, "reason": "simulator"]
    #else
      guard let provider = providerBundleIdentifier, !provider.isEmpty,
        SharedKeychain.accessGroup != nil
      else {
        return ["available": false, "reason": "not-configured"]
      }
      let plugins = Bundle.main.builtInPlugInsURL
      let embedded =
        plugins.map {
          (try? FileManager.default.contentsOfDirectory(atPath: $0.path))?
            .contains { $0.hasSuffix(".appex") } ?? false
        } ?? false
      if !embedded {
        return ["available": false, "reason": "not-configured"]
      }
      return ["available": true, "reason": "ok", "providerBundleIdentifier": provider]
    #endif
  }

  static func requireAvailable() throws {
    let availability = availability()
    if availability["available"] as? Bool != true {
      let reason = availability["reason"] as? String ?? "unavailable"
      throw DatumVpnError.unavailable(
        reason == "simulator"
          ? "VPN tunnels don't run in the Simulator."
          : "This build doesn't include the Datum VPN extension.")
    }
  }

  // MARK: - Manager

  static func manager() async throws -> NETunnelProviderManager? {
    guard let providerId = providerBundleIdentifier else { return nil }
    let managers = try await NETunnelProviderManager.loadAllFromPreferences()
    return managers.first {
      ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerId
    }
  }

  static func configuration(_ o: StartOptions) -> [String: Any] {
    [
      "project": o.project,
      "network": o.network,
      "displayName": o.displayName,
      "apiUrl": o.apiUrl,
      "connectorName": o.connectorName,
      "publicKey": o.publicKey,
      "bindingName": o.bindingName,
      "gatewayName": o.gatewayName,
      "gatewayLocation": o.gatewayLocation,
      "gatewayEndpointId": o.gatewayEndpointId,
      "relayUrls": o.relayUrls,
      "homeRelayUrls": o.homeRelayUrls,
      "clientAddress": o.clientAddress,
      "gatewayAddress": o.gatewayAddress,
      "routes": o.routes,
      "mtu": o.mtu,
    ]
  }

  static func describe(_ manager: NETunnelProviderManager) -> [String: Any] {
    let config =
      (manager.protocolConfiguration as? NETunnelProviderProtocol)?.providerConfiguration ?? [:]
    var result: [String: Any] = [
      "status": statusName(manager.connection.status),
      "enabled": manager.isEnabled,
    ]
    for key in ["project", "network", "clientAddress", "gatewayAddress", "routes", "mtu", "gatewayLocation"] {
      if let value = config[key] { result[key] = value }
    }
    if let date = manager.connection.connectedDate {
      result["connectedAt"] = date.timeIntervalSince1970 * 1000
    }
    return result
  }

  static func statusName(_ status: NEVPNStatus) -> String {
    switch status {
    case .invalid: return "invalid"
    case .disconnected: return "disconnected"
    case .connecting: return "connecting"
    case .connected: return "connected"
    case .reasserting: return "reasserting"
    case .disconnecting: return "disconnecting"
    @unknown default: return "invalid"
    }
  }

  static func send(_ session: NETunnelProviderSession, message: [String: Any]) async throws -> [String: Any]? {
    let data = try JSONSerialization.data(withJSONObject: message)
    return try await withCheckedThrowingContinuation { continuation in
      do {
        try session.sendProviderMessage(data) { reply in
          let object = reply.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
          continuation.resume(returning: object)
        }
      } catch {
        continuation.resume(throwing: error)
      }
    }
  }
}

/// The Keychain items the app and the `DatumTunnel` extension share.
/// Mirrored in `native/datum-tunnel/SharedKeychain.swift`.
enum SharedKeychain {
  static let service = "net.datum.connect"
  static let tokenAccount = "access-token"

  static var accessGroup: String? {
    let group = Bundle.main.object(forInfoDictionaryKey: "DatumKeychainAccessGroup") as? String
    return group?.isEmpty == false ? group : nil
  }

  static func keyAccount(project: String) -> String { "connector-key.\(project)" }

  /// The project's Connector public key (hex), generating and storing an
  /// ed25519 key on first use. The private key never leaves the Keychain
  /// except to the tunnel extension.
  static func connectorPublicKey(project: String, create: Bool) throws -> String? {
    let account = keyAccount(project: project)
    if let seed = try read(account: account) {
      let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
      return hex(key.publicKey.rawRepresentation)
    }
    guard create else { return nil }
    let key = Curve25519.Signing.PrivateKey()
    try write(account: account, data: key.rawRepresentation)
    return hex(key.publicKey.rawRepresentation)
  }

  static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  static func baseQuery(account: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
    return query
  }

  static func read(account: String) throws -> Data? {
    var query = baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw DatumVpnError.keychain(status) }
    return result as? Data
  }

  static func write(account: String, data: Data) throws {
    let query = baseQuery(account: account)
    // The tunnel runs while the phone is locked after first unlock.
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var add = query
      add.merge(attributes) { _, new in new }
      status = SecItemAdd(add as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw DatumVpnError.keychain(status) }
  }
}
