import Foundation

// "Connect to VPC" control: may the saved tunnel resume without the app?
// Foundation only, so `scripts/test-widgets.sh` runs it on macOS.
//
// The app's Connect (src/resources/connect) joins a network: it enrolls this
// device's Connector, creates a ConnectNetworkBinding and waits for the
// gateway to accept it, then saves the binding's grant (addresses, routes,
// gateway endpoint) as the tunnel's providerConfiguration. The control only
// restarts that tunnel, so it must first prove the grant still stands, the
// way the daemon checks a binding before using it.

/// The last join, from the tunnel's providerConfiguration (written by the
/// DatumVpn module's `start`).
struct TunnelJoin: Equatable {
  let project: String
  let network: String
  let displayName: String
  let apiUrl: URL
  let connectorName: String
  let publicKey: String
  let bindingName: String
  let gatewayName: String
  let gatewayEndpointId: String
  let clientAddress: String
  let gatewayAddress: String
  let routes: [String]

  init?(_ dict: [String: Any]) {
    func text(_ key: String) -> String? {
      let value = dict[key] as? String
      return value?.isEmpty == false ? value : nil
    }
    guard let project = text("project"), let network = text("network"),
      let api = text("apiUrl"), let apiUrl = URL(string: api), apiUrl.scheme == "https",
      let connectorName = text("connectorName"), let publicKey = text("publicKey"), publicKey.count == 64,
      let bindingName = text("bindingName"), let gatewayName = text("gatewayName"),
      let gatewayEndpointId = text("gatewayEndpointId"),
      let clientAddress = text("clientAddress"), let gatewayAddress = text("gatewayAddress"),
      let routes = dict["routes"] as? [String], !routes.isEmpty
    else { return nil }
    self.project = project
    self.network = network
    self.displayName = text("displayName") ?? network
    self.apiUrl = apiUrl
    self.connectorName = connectorName
    self.publicKey = publicKey
    self.bindingName = bindingName
    self.gatewayName = gatewayName
    self.gatewayEndpointId = gatewayEndpointId
    self.clientAddress = clientAddress
    self.gatewayAddress = gatewayAddress
    self.routes = routes
  }

  private var projectBase: String {
    let api = apiUrl.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return "\(api)/apis/resourcemanager.miloapis.com/v1alpha1/projects/\(project)/control-plane"
  }

  private func connect(_ plural: String, _ name: String) -> URL? {
    URL(string: "\(projectBase)/apis/connect.datumapis.com/v1alpha1/namespaces/default/\(plural)/\(name)")
  }

  var bindingURL: URL? { connect("connectnetworkbindings", bindingName) }
  var gatewayURL: URL? { connect("connectgateways", gatewayName) }
  var connectorURL: URL? { connect("connectors", connectorName) }
}

enum JoinCheck {
  /// The shared access token is used only while it has this long left.
  static let tokenMargin: TimeInterval = 60

  /// The JWT's `exp`, without verifying it (the API does that).
  static func tokenExpiry(_ token: String) -> Date? {
    let parts = token.split(separator: ".")
    guard parts.count >= 2 else { return nil }
    var payload = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while payload.count % 4 != 0 { payload += "=" }
    guard let data = Data(base64Encoded: payload),
      let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let exp = claims["exp"] as? Double
    else { return nil }
    return Date(timeIntervalSince1970: exp)
  }

  static func tokenUsable(_ token: String?, at now: Date) -> Bool {
    guard let token, let expiry = tokenExpiry(token) else { return false }
    return expiry.timeIntervalSince(now) > tokenMargin
  }

  /// `successor::current_condition`: True at the object's current generation.
  static func currentCondition(_ object: [String: Any], _ type: String) -> Bool {
    let metadata = object["metadata"] as? [String: Any]
    guard let generation = (metadata?["generation"] as? NSNumber)?.intValue, generation > 0 else { return false }
    let conditions = (object["status"] as? [String: Any])?["conditions"] as? [[String: Any]] ?? []
    return conditions.contains {
      $0["type"] as? String == type && $0["status"] as? String == "True"
        && ($0["observedGeneration"] as? NSNumber)?.intValue == generation
    }
  }

  /// Why the binding no longer backs the saved tunnel, or nil when it does.
  /// `gateway` is only needed when the binding doesn't carry the endpoint ID.
  static func bindingProblem(_ binding: [String: Any]?, gateway: [String: Any]?, join: TunnelJoin) -> String? {
    guard let binding else { return "This iPhone left the network." }
    if (binding["metadata"] as? [String: Any])?["deletionTimestamp"] != nil {
      return "This iPhone is leaving the network."
    }
    let spec = binding["spec"] as? [String: Any] ?? [:]
    guard spec["connectorRef"] as? String == join.connectorName, spec["gatewayRef"] as? String == join.gatewayName
    else { return "The network binding changed." }
    guard currentCondition(binding, "Accepted") else { return "The network hasn't accepted this iPhone." }
    let status = binding["status"] as? [String: Any] ?? [:]
    guard status["assignedAddress"] as? String == join.clientAddress,
      status["peerAddress"] as? String == join.gatewayAddress
    else { return "The network assigned new addresses." }
    guard Set(status["routes"] as? [String] ?? []) == Set(join.routes) else {
      return "The network's routes changed."
    }
    let endpoint =
      (status["endpointID"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? ((gateway?["status"] as? [String: Any])?["endpointID"] as? String)
    guard endpoint == join.gatewayEndpointId else { return "The VPC gateway changed." }
    return nil
  }

  static func bindingNeedsGateway(_ binding: [String: Any]?) -> Bool {
    let endpoint = (binding?["status"] as? [String: Any])?["endpointID"] as? String
    return endpoint?.isEmpty ?? true
  }

  /// Deleting the Connector is the revocation boundary (as for the daemon).
  static func connectorProblem(_ connector: [String: Any]?, join: TunnelJoin) -> String? {
    guard let connector else { return "This iPhone's Connector was deleted." }
    if (connector["metadata"] as? [String: Any])?["deletionTimestamp"] != nil {
      return "This iPhone's Connector is being deleted."
    }
    let spec = connector["spec"] as? [String: Any] ?? [:]
    guard spec["publicKey"] as? String == join.publicKey else {
      return "This iPhone's Connector belongs to another device."
    }
    return nil
  }

  /// The network's screen, selecting its project (the org comes from the widget directory).
  static func networkRoute(_ join: TunnelJoin, org: String?) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    let encode = { (value: String) in value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value }
    var route = "/networks/\(encode(join.network))?project=\(encode(join.project))"
    if let org { route += "&org=\(encode(org))" }
    return route
  }
}
