import Foundation
import NetworkExtension
import Security

/// The tunnel's `providerConfiguration`, written by the app's DatumVpn module
/// from the `ConnectNetworkBinding` status. Nothing secret lives here.
struct TunnelConfig {
  let project: String
  let network: String
  let apiUrl: URL
  let connectorName: String
  let publicKey: String
  let gatewayEndpointId: String
  let relayUrls: [String]
  let homeRelayUrls: [String]
  let clientAddress: String
  let gatewayAddress: String
  let routes: [String]
  let mtu: Int

  init?(_ dict: [String: Any]) {
    guard let project = dict["project"] as? String, !project.isEmpty,
      let network = dict["network"] as? String, !network.isEmpty,
      let api = dict["apiUrl"] as? String, let apiUrl = URL(string: api), apiUrl.scheme == "https",
      let connectorName = dict["connectorName"] as? String, !connectorName.isEmpty,
      let publicKey = dict["publicKey"] as? String, publicKey.count == 64,
      let gateway = dict["gatewayEndpointId"] as? String, !gateway.isEmpty,
      let client = dict["clientAddress"] as? String,
      let peer = dict["gatewayAddress"] as? String,
      let routes = dict["routes"] as? [String], !routes.isEmpty
    else { return nil }
    self.project = project
    self.network = network
    self.apiUrl = apiUrl
    self.connectorName = connectorName
    self.publicKey = publicKey
    self.gatewayEndpointId = gateway
    self.relayUrls = dict["relayUrls"] as? [String] ?? []
    self.homeRelayUrls = dict["homeRelayUrls"] as? [String] ?? []
    self.clientAddress = client
    self.gatewayAddress = peer
    self.routes = routes
    self.mtu = (dict["mtu"] as? Int) ?? 1280
  }

  private static func host(_ cidr: String) -> String {
    String(cidr.split(separator: "/").first ?? Substring(cidr))
  }

  /// IPv6 `/128` on the tunnel, only the approved routes, the grant's MTU.
  /// No DNS and no default route: everything else stays on the phone's
  /// normal network.
  func networkSettings() -> NEPacketTunnelNetworkSettings {
    let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: Self.host(gatewayAddress))
    let ipv6 = NEIPv6Settings(addresses: [Self.host(clientAddress)], networkPrefixLengths: [128])
    ipv6.includedRoutes = routes.compactMap { route in
      let parts = route.split(separator: "/")
      guard parts.count == 2, let length = Int(parts[1]) else { return nil }
      return NEIPv6Route(destinationAddress: String(parts[0]), networkPrefixLength: NSNumber(value: length))
    }
    settings.ipv6Settings = ipv6
    settings.mtu = NSNumber(value: mtu)
    return settings
  }
}

/// Keychain items shared with the app (see the DatumVpn module).
enum SharedKeychain {
  static let service = "net.datum.connect"
  static let tokenAccount = "access-token"

  static var accessGroup: String? {
    let group = Bundle.main.object(forInfoDictionaryKey: "DatumKeychainAccessGroup") as? String
    return group?.isEmpty == false ? group : nil
  }

  static func keyAccount(project: String) -> String { "connector-key.\(project)" }

  static func read(account: String) throws -> Data? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else {
      throw TunnelError.configuration("Keychain error \(status)")
    }
    return result as? Data
  }
}
