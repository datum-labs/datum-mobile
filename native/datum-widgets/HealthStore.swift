import AppIntents
import Foundation
import WidgetKit

/// Reads the app's snapshot. The extension never calls the API for health:
/// the app computes it with the same status helpers as Home (and is the only
/// OIDC refresher), so the widget can't disagree with the app.
enum HealthStore {
  static func load() -> HealthSnapshot? {
    guard let url = WidgetShared.snapshotURL, let data = try? Data(contentsOf: url) else { return nil }
    return HealthSnapshot.decode(data)
  }

  /// Tell the app which projects widgets are showing, so its refreshes include them.
  static func recordRequested(_ projectId: String?, at now: Date = Date()) {
    guard let projectId, let url = WidgetShared.requestedURL else { return }
    var map = (try? Data(contentsOf: url))
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Double] } ?? [:]
    let last = map[projectId] ?? 0
    // Recorded at most hourly; entries older than a week are dropped.
    guard now.timeIntervalSince1970 - last > 3600 else { return }
    map[projectId] = now.timeIntervalSince1970
    map = map.filter { now.timeIntervalSince1970 - $0.value < 7 * 24 * 3600 }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? JSONSerialization.data(withJSONObject: map) { try? data.write(to: url, options: .atomic) }
  }
}

// MARK: - Configuration: which project

struct ProjectEntity: AppEntity {
  static let currentId = "current"
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static let defaultQuery = ProjectQuery()

  var id: String
  var name: String
  var subtitle: String?

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: subtitle.map { "\($0)" })
  }

  /// Follows the app's selected project.
  static let current = ProjectEntity(id: currentId, name: "Current project", subtitle: "Follows the Datum app")

  init(id: String, name: String, subtitle: String?) {
    self.id = id
    self.name = name
    self.subtitle = subtitle
  }

  init(_ ref: ProjectRef) {
    self.init(id: ref.projectId, name: ref.projectName ?? ref.projectId, subtitle: ref.orgName ?? ref.orgId)
  }

  var choice: ProjectChoice { id == Self.currentId ? .current : .project(id) }
}

struct ProjectQuery: EntityQuery {
  func entities(for identifiers: [ProjectEntity.ID]) async throws -> [ProjectEntity] {
    let directory = HealthStore.load()?.directory ?? []
    return identifiers.map { id in
      if id == ProjectEntity.currentId { return .current }
      return directory.first { $0.projectId == id }.map(ProjectEntity.init)
        ?? ProjectEntity(id: id, name: id, subtitle: nil)
    }
  }

  func suggestedEntities() async throws -> [ProjectEntity] {
    let directory = HealthStore.load()?.directory ?? []
    let sorted = directory.sorted {
      ($0.orgName ?? $0.orgId, $0.projectName ?? $0.projectId) < ($1.orgName ?? $1.orgId, $1.projectName ?? $1.projectId)
    }
    return [.current] + sorted.map(ProjectEntity.init)
  }

  func defaultResult() async -> ProjectEntity? { .current }
}

struct ProjectHealthIntent: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Project"
  static let description = IntentDescription("Choose the Datum project this widget shows.")

  @Parameter(title: "Project")
  var project: ProjectEntity?

  init() {}

  init(project: ProjectEntity?) {
    self.project = project
  }

  var choice: ProjectChoice { project?.choice ?? .current }
}

// MARK: - Timeline

struct HealthEntry: TimelineEntry {
  let date: Date
  let state: HealthState
}

struct HealthProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> HealthEntry {
    HealthEntry(date: Date(), state: .project(.sample, stale: false))
  }

  func snapshot(for configuration: ProjectHealthIntent, in context: Context) async -> HealthEntry {
    if context.isPreview, HealthStore.load() == nil {
      return HealthEntry(date: Date(), state: .project(.sample, stale: false))
    }
    return HealthEntry(date: Date(), state: HealthTimeline.resolve(HealthStore.load(), choice: configuration.choice, at: Date()))
  }

  func timeline(for configuration: ProjectHealthIntent, in context: Context) async -> Timeline<HealthEntry> {
    let now = Date()
    let snapshot = HealthStore.load()
    let entries = HealthTimeline.entries(snapshot, choice: configuration.choice, at: now)
    if case .project(let project, _) = entries[0].1 {
      HealthStore.recordRequested(project.projectId, at: now)
    } else if case .project(let id) = configuration.choice {
      HealthStore.recordRequested(id, at: now)
    }
    return Timeline(
      entries: entries.map { HealthEntry(date: $0.0, state: $0.1) },
      policy: .after(HealthTimeline.nextRefresh(after: now)))
  }
}
