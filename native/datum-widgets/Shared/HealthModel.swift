import Foundation

// The health snapshot the app writes to the App Group
// (`src/lib/health/snapshot.ts`, SNAPSHOT_VERSION 1), and the pure logic the
// widgets build on. Foundation only, so `scripts/test-widgets.sh` runs it on
// macOS.

struct HealthSnapshot: Codable, Equatable {
  static let version = 1

  var version: Int
  var generatedAt: Date
  var owner: String?
  var currentProjectId: String?
  var projects: [String: ProjectHealth]
  var directory: [ProjectRef]
}

struct ProjectRef: Codable, Equatable, Hashable {
  var projectId: String
  var projectName: String?
  var orgId: String
  var orgName: String?
}

struct TileCount: Codable, Equatable {
  var total: Int
  var error: Int
  var pending: Int

  var healthy: Int { max(0, total - error - pending) }
}

enum BadgeStatus: String, Codable {
  case success, error, pending, unknown
}

enum OverallStatus: String, Codable {
  case healthy, error, pending, unknown
}

struct SnapshotItem: Codable, Equatable, Identifiable {
  var kind: String
  var kindLabel: String
  var name: String
  var title: String
  var status: BadgeStatus
  var label: String
  var url: String

  var id: String { "\(kind)/\(name)" }
}

struct Counts: Codable, Equatable {
  var loadBalancers: TileCount?
  var workloads: TileCount?
  var instances: TileCount?
  var domains: TileCount?

  var all: [TileCount] { [loadBalancers, workloads, instances, domains].compactMap { $0 } }
}

struct Attention: Codable, Equatable {
  var total: Int
  var error: Int
  var pending: Int
  var items: [SnapshotItem]
}

struct ProjectHealth: Codable, Equatable {
  var projectId: String
  var projectName: String
  var orgId: String
  var orgName: String?
  var generatedAt: Date
  var complete: Bool
  var status: OverallStatus
  var counts: Counts
  var attention: Attention
  var url: String
}

extension HealthSnapshot {
  static func decode(_ data: Data) -> HealthSnapshot? {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let raw = try decoder.singleValueContainer().decode(String.self)
      guard let date = parseISODate(raw) else {
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(raw)"))
      }
      return date
    }
    guard let snapshot = try? decoder.decode(HealthSnapshot.self, from: data), snapshot.version == version else {
      return nil
    }
    return snapshot
  }
}

/// `Date.toISOString()`: always milliseconds and `Z`; plain seconds also accepted.
func parseISODate(_ value: String) -> Date? {
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = fractional.date(from: value) { return date }
  return ISO8601DateFormatter().date(from: value)
}

// MARK: - What a widget shows

/// The project a widget asked for: an explicit one, or the app's current project.
enum ProjectChoice: Equatable {
  case current
  case project(String)
}

/// Everything a widget view needs, resolved from the snapshot at a moment.
enum HealthState: Equatable {
  /// No snapshot: signed out, or the app hasn't run since installing the widgets.
  case signedOut
  /// The chosen project isn't in the snapshot yet (open the app to load it).
  case notLoaded(name: String?, ref: ProjectRef?)
  case project(ProjectHealth, stale: Bool)
}

enum HealthTimeline {
  /// Older than this, the widget says when it was updated.
  static let staleAfter: TimeInterval = 15 * 60
  /// The system reloads on the app's writes; this is the fallback.
  static let refreshAfter: TimeInterval = 30 * 60

  static func resolve(_ snapshot: HealthSnapshot?, choice: ProjectChoice, at now: Date) -> HealthState {
    guard let snapshot else { return .signedOut }
    let id: String?
    switch choice {
    case .current: id = snapshot.currentProjectId
    case .project(let chosen): id = chosen
    }
    guard let id else { return .notLoaded(name: nil, ref: nil) }
    guard let project = snapshot.projects[id] else {
      let ref = snapshot.directory.first { $0.projectId == id }
      return .notLoaded(name: ref?.projectName ?? id, ref: ref)
    }
    return .project(project, stale: now.timeIntervalSince(project.generatedAt) >= staleAfter)
  }

  /// Entries for now and, if the data turns stale before the next refresh,
  /// for that moment (so "Updated …" appears without a reload).
  static func entries(_ snapshot: HealthSnapshot?, choice: ProjectChoice, at now: Date) -> [(Date, HealthState)] {
    var entries = [(now, resolve(snapshot, choice: choice, at: now))]
    if case .project(let project, stale: false) = entries[0].1 {
      let staleAt = project.generatedAt.addingTimeInterval(staleAfter)
      if staleAt > now, staleAt < now.addingTimeInterval(refreshAfter) {
        entries.append((staleAt, resolve(snapshot, choice: choice, at: staleAt)))
      }
    }
    return entries
  }

  static func nextRefresh(after now: Date) -> Date { now.addingTimeInterval(refreshAfter) }
}

// MARK: - Presentation logic (kept out of the views so it's testable)

extension ProjectHealth {
  /// "All healthy", "1 needs attention", "3 need attention", "Checking…".
  var headline: String {
    switch status {
    case .healthy: return "All healthy"
    case .unknown where attention.total == 0: return "Partly loaded"
    default: return attention.total == 1 ? "1 needs attention" : "\(attention.total) need attention"
    }
  }

  /// Lock Screen inline text.
  var inline: String {
    switch status {
    case .healthy: return "Datum · all healthy"
    case .unknown where attention.total == 0: return "Datum · open the app"
    default: return "Datum · \(attention.total) need\(attention.total == 1 ? "s" : "") attention"
    }
  }

  /// Share of counted resources (LBs, workloads, instances, domains) that are healthy.
  var healthyFraction: Double {
    let tiles = counts.all
    let total = tiles.reduce(0) { $0 + $1.total }
    guard total > 0 else { return status == .healthy ? 1 : 0 }
    return Double(tiles.reduce(0) { $0 + $1.healthy }) / Double(total)
  }

  /// Anything failing (not just pending): the red mark.
  var failing: Bool { attention.error > 0 || counts.all.contains { $0.error > 0 } }
}

/// `<scheme>:/path?org=…&project=…`, as the app's `widgetUrl` builds it.
func widgetURL(scheme: String, path: String, ref: ProjectRef? = nil) -> URL? {
  var allowed = CharacterSet.alphanumerics
  allowed.insert(charactersIn: "-._~")
  let encode = { (value: String) in value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value }
  let query = ref.map { "?org=\(encode($0.orgId))&project=\(encode($0.projectId))" } ?? ""
  return URL(string: "\(scheme):\(path.hasPrefix("/") ? path : "/" + path)\(query)")
}

enum StatusSymbol {
  static func name(for status: OverallStatus) -> String {
    switch status {
    case .healthy: return "checkmark.circle.fill"
    case .error: return "exclamationmark.octagon.fill"
    case .pending: return "clock.fill"
    case .unknown: return "questionmark.circle.fill"
    }
  }

  static func name(for status: BadgeStatus) -> String {
    switch status {
    case .success: return "checkmark.circle.fill"
    case .error: return "xmark.octagon.fill"
    case .pending: return "clock.fill"
    case .unknown: return "minus.circle.fill"
    }
  }

  /// Home's tile symbols, by item kind.
  static func kind(_ kind: String) -> String {
    switch kind {
    case "alb": return "arrow.triangle.branch"
    case "workload": return "shippingbox.fill"
    case "domain": return "globe"
    case "dns": return "list.bullet.rectangle"
    default: return "cube"
    }
  }
}

// MARK: - Sample (widget gallery, placeholder, previews)

extension ProjectHealth {
  /// Gallery and placeholder data.
  static let sample = ProjectHealth(
    projectId: "sample",
    projectName: "Production",
    orgId: "acme",
    orgName: "Acme",
    generatedAt: Date(),
    complete: true,
    status: .error,
    counts: Counts(
      loadBalancers: TileCount(total: 4, error: 1, pending: 0),
      workloads: TileCount(total: 6, error: 0, pending: 1),
      instances: TileCount(total: 12, error: 0, pending: 0),
      domains: TileCount(total: 3, error: 0, pending: 0)),
    attention: Attention(
      total: 2, error: 1, pending: 1,
      items: [
        SnapshotItem(
          kind: "alb", kindLabel: "Load balancer", name: "web", title: "web", status: .error, label: "Failed",
          url: "net.datum.cloud.staging:/home"),
        SnapshotItem(
          kind: "workload", kindLabel: "Workload", name: "api", title: "api", status: .pending, label: "Deploying",
          url: "net.datum.cloud.staging:/home"),
      ]),
    url: "net.datum.cloud.staging:/home")
}
