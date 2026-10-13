import Foundation

// Tests for the widgets' pure logic (snapshot decoding, the timeline, the
// VPC control's resume checks). Run on macOS by scripts/test-widgets.sh.

var failures = 0
var passes = 0

func check(_ condition: @autoclosure () -> Bool, _ message: String, file: StaticString = #file, line: UInt = #line) {
  if condition() {
    passes += 1
  } else {
    failures += 1
    print("FAIL \(line): \(message)")
  }
}

func date(_ iso: String) -> Date { parseISODate(iso)! }

@main
struct ModelTests {
  static func main() throws {
    let fixture = URL(fileURLWithPath: CommandLine.arguments[1])
    try snapshotTests(fixture)
    timelineTests(fixture)
    linkTests()
    joinTests()
    print("\(passes) passed, \(failures) failed")
    exit(failures == 0 ? 0 : 1)
  }

  static func load(_ fixture: URL) -> HealthSnapshot? {
    HealthSnapshot.decode(try! Data(contentsOf: fixture))
  }

  static func snapshotTests(_ fixture: URL) throws {
    guard let snapshot = load(fixture) else {
      check(false, "the app's snapshot (fixture) decodes")
      return
    }
    check(snapshot.version == 1, "version")
    check(snapshot.currentProjectId == "matt-jenkinson-yz0y92", "current project")
    check(snapshot.directory.count == 3, "directory")
    let p = snapshot.projects["matt-jenkinson-yz0y92"]!
    check(p.generatedAt == date("2026-10-13T12:00:00.000Z"), "ms ISO dates")
    check(p.status == .error, "status")
    check(p.counts.loadBalancers == TileCount(total: 2, error: 1, pending: 0), "LB tile")
    check(p.attention.items.map(\.kind) == ["alb", "domain", "workload"], "items in Home's order")
    check(p.headline == "3 need attention", "headline: \(p.headline)")
    check(p.inline == "Datum · 3 need attention", "inline: \(p.inline)")
    check(p.failing, "failing → red mark")
    check(abs(p.healthyFraction - 1.0 / 4.0) < 0.001, "ring: 1 healthy of 4 counted (\(p.healthyFraction))")
    let quiet = snapshot.projects["quiet"]!
    check(quiet.headline == "All healthy" && quiet.inline == "Datum · all healthy", "healthy copy")
    check(!quiet.failing && quiet.healthyFraction == 1, "healthy ring full when nothing is counted")

    check(HealthSnapshot.decode(Data("{\"version\":2}".utf8)) == nil, "other versions are ignored")
    check(HealthSnapshot.decode(Data("not json".utf8)) == nil, "garbage is ignored")
  }

  static func timelineTests(_ fixture: URL) {
    let snapshot = load(fixture)
    let now = date("2026-10-13T12:05:00Z")

    if case .project(let p, stale: false) = HealthTimeline.resolve(snapshot, choice: .current, at: now) {
      check(p.projectId == "matt-jenkinson-yz0y92", "current project follows the app")
    } else {
      check(false, "current project resolves")
    }
    if case .project(let p, stale: true) = HealthTimeline.resolve(snapshot, choice: .project("quiet"), at: now) {
      check(p.projectName == "Quiet", "a chosen project, 25 min old, is stale")
    } else {
      check(false, "chosen project resolves as stale")
    }
    if case .notLoaded(let name, let ref) = HealthTimeline.resolve(snapshot, choice: .project("unseen"), at: now) {
      check(name == "Unseen" && ref?.orgId == "acme", "a directory project the app hasn't read")
    } else {
      check(false, "unseen project is notLoaded")
    }
    check(HealthTimeline.resolve(nil, choice: .current, at: now) == .signedOut, "no snapshot → signed out")

    let entries = HealthTimeline.entries(snapshot, choice: .current, at: now)
    check(entries.count == 2, "a second entry when the data turns stale")
    check(entries.count == 2 && entries[1].0 == date("2026-10-13T12:15:00Z"), "…at generatedAt + 15 min")
    if entries.count == 2, case .project(_, stale: true) = entries[1].1 {} else { check(false, "second entry stale") }
    check(HealthTimeline.entries(snapshot, choice: .project("quiet"), at: now).count == 1, "already stale: one entry")
    check(
      HealthTimeline.nextRefresh(after: now) == date("2026-10-13T12:35:00Z"), "refresh policy: 30 min fallback")
  }

  static func linkTests() {
    let ref = ProjectRef(projectId: "p-1", projectName: nil, orgId: "org a", orgName: nil)
    check(
      widgetURL(scheme: "net.datum.cloud.staging", path: "/home", ref: ref)?.absoluteString
        == "net.datum.cloud.staging:/home?org=org%20a&project=p-1", "home link with project")
    check(widgetURL(scheme: "net.datum.cloud", path: "home")?.absoluteString == "net.datum.cloud:/home", "bare link")
  }

  static func joinTests() {
    let config: [String: Any] = [
      "project": "matt-jenkinson-yz0y92", "network": "default", "displayName": "Default",
      "apiUrl": "https://api.staging.env.datum.net", "connectorName": "connect-abc",
      "publicKey": String(repeating: "a", count: 64), "bindingName": "binding-1", "gatewayName": "gw-1",
      "gatewayEndpointId": String(repeating: "e", count: 64), "clientAddress": "fd00::2/128",
      "gatewayAddress": "fd00::1/128", "routes": ["fd00::/64"], "mtu": 1280,
    ]
    guard let join = TunnelJoin(config) else {
      check(false, "providerConfiguration parses")
      return
    }
    check(TunnelJoin(config.merging(["apiUrl": "http://x"]) { $1 }) == nil, "https only")
    check(TunnelJoin(config.merging(["routes": [String]()]) { $1 }) == nil, "routes required")
    check(
      join.bindingURL?.absoluteString
        == "https://api.staging.env.datum.net/apis/resourcemanager.miloapis.com/v1alpha1/projects/matt-jenkinson-yz0y92/control-plane/apis/connect.datumapis.com/v1alpha1/namespaces/default/connectnetworkbindings/binding-1",
      "binding URL")

    // Tokens
    func jwt(_ exp: Double) -> String {
      let payload = try! JSONSerialization.data(withJSONObject: ["exp": exp])
      let b64 = payload.base64EncodedString().replacingOccurrences(of: "=", with: "")
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      return "eyJhbGciOiJub25lIn0.\(b64).sig"
    }
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    check(JoinCheck.tokenUsable(jwt(1_800_000_000 + 600), at: now), "token with 10 min left")
    check(!JoinCheck.tokenUsable(jwt(1_800_000_000 + 30), at: now), "token about to expire")
    check(!JoinCheck.tokenUsable("nope", at: now), "not a JWT")
    check(!JoinCheck.tokenUsable(nil, at: now), "no token")

    // Binding
    func binding(
      accepted: Bool = true, generation: Int = 3, observed: Int = 3, routes: [String] = ["fd00::/64"],
      endpoint: String? = String(repeating: "e", count: 64), connector: String = "connect-abc"
    ) -> [String: Any] {
      var status: [String: Any] = [
        "assignedAddress": "fd00::2/128", "peerAddress": "fd00::1/128", "routes": routes,
        "conditions": [
          ["type": "Accepted", "status": accepted ? "True" : "False", "observedGeneration": observed]
        ],
      ]
      if let endpoint { status["endpointID"] = endpoint }
      return [
        "metadata": ["name": "binding-1", "generation": generation],
        "spec": ["connectorRef": connector, "gatewayRef": "gw-1"],
        "status": status,
      ]
    }
    check(JoinCheck.bindingProblem(binding(), gateway: nil, join: join) == nil, "accepted binding resumes")
    check(JoinCheck.bindingProblem(nil, gateway: nil, join: join) != nil, "left (binding deleted)")
    check(JoinCheck.bindingProblem(binding(accepted: false), gateway: nil, join: join) != nil, "not accepted")
    check(JoinCheck.bindingProblem(binding(observed: 2), gateway: nil, join: join) != nil, "stale condition")
    check(
      JoinCheck.bindingProblem(binding(routes: ["fd01::/64"]), gateway: nil, join: join) != nil, "routes changed")
    check(
      JoinCheck.bindingProblem(binding(connector: "other"), gateway: nil, join: join) != nil, "another connector")
    let noEndpoint = binding(endpoint: nil)
    check(JoinCheck.bindingNeedsGateway(noEndpoint), "endpoint from the gateway")
    let gateway: [String: Any] = ["status": ["endpointID": String(repeating: "e", count: 64)]]
    check(JoinCheck.bindingProblem(noEndpoint, gateway: gateway, join: join) == nil, "gateway endpoint matches")
    check(
      JoinCheck.bindingProblem(noEndpoint, gateway: ["status": ["endpointID": "f"]], join: join) != nil,
      "gateway changed")

    // Connector
    let connector: [String: Any] = ["metadata": ["name": "connect-abc"], "spec": ["publicKey": join.publicKey]]
    check(JoinCheck.connectorProblem(connector, join: join) == nil, "connector still ours")
    check(JoinCheck.connectorProblem(nil, join: join) != nil, "connector deleted")
    check(
      JoinCheck.connectorProblem(["spec": ["publicKey": "b"]], join: join) != nil, "connector re-keyed")

    check(
      JoinCheck.networkRoute(join, org: "personal-org")
        == "/networks/default?project=matt-jenkinson-yz0y92&org=personal-org", "reconnect route")
  }
}
