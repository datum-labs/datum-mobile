import AppIntents
import SwiftUI
import WidgetKit

#if DATUM_VPN
  import NetworkExtension
#endif

/// Home Screen and Lock Screen widgets, plus Control Centre controls.
/// "Connect to VPC" is only in IOS_VPN=1 builds (DATUM_VPN).
@main
struct DatumWidgetsBundle: WidgetBundle {
  var body: some Widget {
    ProjectHealthWidget()
    NeedsAttentionWidget()
    HealthAccessoryWidget()
    AskPatchControl()
    #if DATUM_VPN
      ConnectVPCControl()
    #endif
  }
}

struct HealthEntryView: View {
  let entry: HealthEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .widgetURL(entry.state.homeURL)
      .containerBackground(for: .widget) {
        if family == .systemSmall || family == .systemMedium {
          Color(uiColor: .systemBackground)
        } else {
          Color.clear
        }
      }
  }

  @ViewBuilder
  private var content: some View {
    switch family {
    case .systemMedium: MediumHealthView(state: entry.state)
    case .accessoryCircular: CircularHealthView(state: entry.state)
    case .accessoryInline: InlineHealthView(state: entry.state)
    default: SmallHealthView(state: entry.state)
    }
  }
}

struct ProjectHealthWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "net.datum.widgets.project-health", intent: ProjectHealthIntent.self, provider: HealthProvider()) {
      HealthEntryView(entry: $0)
    }
    .configurationDisplayName("Project health")
    .description("Your project's status and resource counts, as on Home.")
    .supportedFamilies([.systemSmall])
  }
}

struct NeedsAttentionWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "net.datum.widgets.needs-attention", intent: ProjectHealthIntent.self, provider: HealthProvider()) {
      HealthEntryView(entry: $0)
    }
    .configurationDisplayName("Needs attention")
    .description("The resources in your project that are failing or still coming up.")
    .supportedFamilies([.systemMedium])
  }
}

struct HealthAccessoryWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "net.datum.widgets.health-accessory", intent: ProjectHealthIntent.self, provider: HealthProvider()) {
      HealthEntryView(entry: $0)
    }
    .configurationDisplayName("Datum health")
    .description("Whether anything in your project needs attention.")
    .supportedFamilies([.accessoryCircular, .accessoryInline])
  }
}

// MARK: - Controls

struct AskPatchControl: ControlWidget {
  static let kind = "net.datum.widgets.ask-patch"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: AskPatchIntent()) {
        Label("Ask Patch", systemImage: "brain")
      }
    }
    .displayName("Ask Patch")
    .description("Start a new chat with Patch, Datum's assistant.")
  }
}

#if DATUM_VPN
  struct VPCControlValue {
    var isOn: Bool
    var network: String?
    var configured: Bool
  }

  struct VPCValueProvider: ControlValueProvider {
    var previewValue: VPCControlValue { VPCControlValue(isOn: false, network: "default", configured: true) }

    func currentValue() async throws -> VPCControlValue {
      guard let manager = try? await VPCControl.manager() else {
        return VPCControlValue(isOn: false, network: nil, configured: false)
      }
      let join = VPCControl.join(of: manager)
      return VPCControlValue(
        isOn: VPCControl.isActive(manager.connection.status), network: join?.displayName, configured: join != nil)
    }
  }

  struct ConnectVPCControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
      StaticControlConfiguration(kind: VPCControl.kind, provider: VPCValueProvider()) { value in
        ControlWidgetToggle("Connect to VPC", isOn: value.isOn, action: ConnectVPCIntent()) { isOn in
          Label(
            isOn ? (value.network ?? "Connected") : (value.configured ? "Off" : "Set up in Datum"),
            systemImage: isOn ? "point.3.filled.connected.trianglepath.dotted" : "point.3.connected.trianglepath.dotted")
        }
      }
      .displayName("Connect to VPC")
      .description("Datum Connect: this iPhone's tunnel to the VPC it joined last.")
    }
  }
#endif
