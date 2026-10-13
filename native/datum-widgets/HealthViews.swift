import SwiftUI
import WidgetKit

// The widgets' views. Datum's look, kept to what reads well at widget size:
// the project name in Canela (navy on light, primary on dark and when
// tinted), system fonts and SF Symbols for everything else, the system
// background, and colour only in status symbols (which are also the parts
// that take the accent when the Home Screen is tinted).

enum DatumStyle {
  static let navy = Color(red: 12 / 255, green: 29 / 255, blue: 49 / 255)
  /// CanelaText-Regular.ttf (UIAppFonts), from @datum-cloud/datum-ui-native.
  static let canela = "CanelaTextLCWeb-Regular"

  static func color(_ status: OverallStatus) -> Color {
    switch status {
    case .healthy: return .green
    case .error: return .red
    case .pending: return .orange
    case .unknown: return .secondary
    }
  }

  static func color(_ status: BadgeStatus) -> Color {
    switch status {
    case .success: return .green
    case .error: return .red
    case .pending: return .orange
    case .unknown: return .secondary
    }
  }
}

struct ProjectTitle: View {
  let text: String
  var size: CGFloat = 17
  @Environment(\.colorScheme) private var scheme
  @Environment(\.widgetRenderingMode) private var mode

  var body: some View {
    Text(text)
      .font(.custom(DatumStyle.canela, size: size, relativeTo: .headline))
      .foregroundStyle(mode == .fullColor && scheme == .light ? AnyShapeStyle(DatumStyle.navy) : AnyShapeStyle(.primary))
      .lineLimit(1)
      .minimumScaleFactor(0.75)
  }
}

struct StatusMark: View {
  let symbol: String
  let color: Color

  init(_ status: OverallStatus) {
    symbol = StatusSymbol.name(for: status)
    color = DatumStyle.color(status)
  }

  init(_ status: BadgeStatus) {
    symbol = StatusSymbol.name(for: status)
    color = DatumStyle.color(status)
  }

  var body: some View {
    Image(systemName: symbol)
      .foregroundStyle(color)
      .widgetAccentable()
  }
}

/// One of Home's tiles, compacted: symbol, count, and a dot when something in it fails.
struct CountCell: View {
  let symbol: String
  let label: String
  let count: TileCount?
  var large = false

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: symbol)
        .font(large ? .footnote : .caption)
        .foregroundStyle(.secondary)
        .frame(width: large ? 18 : 16)
      Text(count.map { "\($0.total)" } ?? "–")
        .font(.system(large ? .title3 : .subheadline, design: .rounded).weight(.semibold))
        .monospacedDigit()
      if let count, count.error > 0 || count.pending > 0 {
        Circle()
          .fill(count.error > 0 ? Color.red : Color.orange)
          .frame(width: 5, height: 5)
          .widgetAccentable()
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibility)
  }

  private var accessibility: String {
    guard let count else { return "\(label): unavailable" }
    var text = "\(label): \(count.total)"
    if count.error > 0 { text += ", \(count.error) failing" }
    if count.pending > 0 { text += ", \(count.pending) pending" }
    return text
  }
}

struct CountGrid: View {
  let counts: Counts

  var body: some View {
    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
      GridRow {
        CountCell(symbol: "arrow.triangle.branch", label: "Load balancers", count: counts.loadBalancers, large: true)
        CountCell(symbol: "shippingbox.fill", label: "Workloads", count: counts.workloads, large: true)
      }
      GridRow {
        CountCell(symbol: "cpu", label: "Instances", count: counts.instances, large: true)
        CountCell(symbol: "globe", label: "Domains", count: counts.domains, large: true)
      }
    }
  }
}

struct CountRow: View {
  let counts: Counts

  var body: some View {
    HStack(spacing: 14) {
      CountCell(symbol: "arrow.triangle.branch", label: "Load balancers", count: counts.loadBalancers)
      CountCell(symbol: "shippingbox.fill", label: "Workloads", count: counts.workloads)
      CountCell(symbol: "cpu", label: "Instances", count: counts.instances)
      CountCell(symbol: "globe", label: "Domains", count: counts.domains)
    }
  }
}

struct UpdatedText: View {
  let date: Date

  var body: some View {
    Text("Updated \(date, style: .relative) ago")
      .font(.caption2)
      .foregroundStyle(.secondary)
      .lineLimit(1)
  }
}

struct Headline: View {
  let project: ProjectHealth
  var font: Font = .footnote.weight(.semibold)

  var body: some View {
    HStack(spacing: 4) {
      StatusMark(project.status)
      Text(project.headline)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .font(font)
  }
}

/// Signed out, or a project the app hasn't loaded yet.
struct MessageView: View {
  let title: String
  let message: String
  var symbol = "exclamationmark.icloud"

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      ProjectTitle(text: title)
      Spacer(minLength: 0)
      Image(systemName: symbol)
        .font(.title3)
        .foregroundStyle(.secondary)
      Text(message)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  static func `for`(_ state: HealthState) -> MessageView? {
    switch state {
    case .signedOut:
      return MessageView(title: "Datum", message: "Open Datum to sign in.", symbol: "person.crop.circle.badge.questionmark")
    case .notLoaded(let name, _):
      return MessageView(
        title: name ?? "Datum",
        message: name == nil ? "Open Datum and choose a project." : "Open Datum to load this project.")
    case .project:
      return nil
    }
  }
}

// MARK: - Small: Project health

struct SmallHealthView: View {
  let state: HealthState

  var body: some View {
    if case .project(let project, let stale) = state {
      VStack(alignment: .leading, spacing: 0) {
        ProjectTitle(text: project.projectName)
        Headline(project: project)
          .padding(.top, 3)
        Spacer(minLength: 8)
        CountGrid(counts: project.counts)
        if stale {
          UpdatedText(date: project.generatedAt)
            .padding(.top, 7)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else if let message = MessageView.for(state) {
      message
    }
  }
}

// MARK: - Medium: Needs attention

extension EnvironmentValues {
  /// Previews render rows without `Link` (ImageRenderer can't draw one).
  @Entry var datumLinksDisabled = false
}

struct AttentionRow: View {
  let item: SnapshotItem

  var body: some View {
    HStack(spacing: 7) {
      StatusMark(item.status)
        .font(.subheadline)
      Text(item.title)
        .font(.subheadline.weight(.medium))
        .lineLimit(1)
        .layoutPriority(1)
      Text(item.kindLabel)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      Spacer(minLength: 4)
      Text(item.label)
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(.fill.tertiary, in: Capsule())
    }
    .accessibilityElement(children: .combine)
  }
}

struct MediumHealthView: View {
  let state: HealthState
  @Environment(\.datumLinksDisabled) private var linksDisabled

  var body: some View {
    if case .project(let project, let stale) = state {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          ProjectTitle(text: project.projectName)
          Spacer(minLength: 4)
          if !project.attention.items.isEmpty {
            Headline(project: project, font: .caption.weight(.semibold))
          }
        }
        if project.attention.items.isEmpty {
          healthy(project)
        } else {
          rows(project, stale: stale)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else if let message = MessageView.for(state) {
      message
    }
  }

  @ViewBuilder
  private func healthy(_ project: ProjectHealth) -> some View {
    Spacer(minLength: 6)
    HStack(spacing: 10) {
      StatusMark(project.status == .healthy ? .healthy : .unknown)
        .font(.title2)
      VStack(alignment: .leading, spacing: 1) {
        Text(project.status == .healthy ? "All healthy" : "Partly loaded")
          .font(.headline)
        Text(
          project.status == .healthy
            ? "No failing or pending resources in this project."
            : "Some lists couldn't be read. Open Datum to retry."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      }
    }
    Spacer(minLength: 6)
    HStack {
      CountRow(counts: project.counts)
      Spacer(minLength: 4)
      if project.generatedAt.timeIntervalSinceNow < -HealthTimeline.staleAfter {
        UpdatedText(date: project.generatedAt)
      }
    }
  }

  @ViewBuilder
  private func rows(_ project: ProjectHealth, stale: Bool) -> some View {
    let more = project.attention.total - project.attention.items.count
    let footer = stale || project.attention.total > 4
    let shown = Array(project.attention.items.prefix(footer ? 3 : 4))
    VStack(alignment: .leading, spacing: 7) {
      ForEach(shown) { item in
        if !linksDisabled, let url = URL(string: item.url) {
          Link(destination: url) { AttentionRow(item: item) }
        } else {
          AttentionRow(item: item)
        }
      }
    }
    .padding(.top, 9)
    Spacer(minLength: 0)
    if footer {
      HStack {
        let hidden = more + project.attention.items.count - shown.count
        if hidden > 0 {
          Text("+\(hidden) more")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 4)
        if stale { UpdatedText(date: project.generatedAt) }
      }
    }
  }
}

// MARK: - Lock Screen

struct CircularHealthView: View {
  let state: HealthState

  var body: some View {
    switch state {
    case .project(let project, _):
      ZStack {
        Circle()
          .stroke(.tertiary, lineWidth: 4.5)
        Circle()
          .trim(from: 0, to: max(0.02, project.healthyFraction))
          .stroke(style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .widgetAccentable()
        if project.attention.total > 0 {
          Text("\(project.attention.total)")
            .font(.system(.title3, design: .rounded).weight(.semibold))
            .minimumScaleFactor(0.6)
        } else {
          Image(systemName: project.status == .healthy ? "checkmark" : "ellipsis")
            .font(.title3.weight(.semibold))
        }
      }
      .padding(3)
      .overlay(alignment: .topTrailing) {
        if project.failing {
          Image(systemName: "exclamationmark.circle.fill")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(.white, .red)
            .widgetAccentable()
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(project.projectName): \(project.headline)")
    default:
      ZStack {
        Circle().stroke(.tertiary, lineWidth: 4.5)
        Image(systemName: "person.crop.circle.badge.questionmark")
          .font(.title3)
      }
      .padding(3)
      .accessibilityLabel("Datum: open the app")
    }
  }
}

struct InlineHealthView: View {
  let state: HealthState

  var body: some View {
    switch state {
    case .project(let project, _):
      Label(
        project.inline,
        systemImage: project.failing
          ? "exclamationmark.triangle.fill" : project.status == .healthy ? "checkmark.circle" : "clock")
    case .signedOut:
      Label("Datum · sign in", systemImage: "person.crop.circle")
    case .notLoaded:
      Label("Datum · open the app", systemImage: "arrow.clockwise")
    }
  }
}

// MARK: - Links

extension HealthState {
  /// Tapping the widget: Home with the project selected.
  var homeURL: URL? {
    switch self {
    case .project(let project, _): return URL(string: project.url)
    case .notLoaded(_, let ref): return widgetURL(scheme: WidgetShared.scheme, path: "/home", ref: ref)
    case .signedOut: return widgetURL(scheme: WidgetShared.scheme, path: "/home")
    }
  }
}
