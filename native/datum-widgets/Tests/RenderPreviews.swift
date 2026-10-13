import AppKit
import CoreText
import SwiftUI
import WidgetKit

// Renders the widget views to PNGs on macOS (ImageRenderer), at iPhone widget
// sizes, in light and dark: a look at the layout without a device. The
// system's own chrome (corner radius, tinting, vibrancy) isn't reproduced.
// Usage: render <snapshot.json> <font.ttf> <out-dir>

struct Frame<Content: View>: View {
  let size: CGSize
  let scheme: ColorScheme
  let padding: CGFloat
  @ViewBuilder let content: Content

  var body: some View {
    content
      .padding(padding)
      .frame(width: size.width, height: size.height)
      .background(scheme == .dark ? Color(white: 0.11) : Color.white)
      .clipShape(RoundedRectangle(cornerRadius: padding > 0 ? 22 : 0, style: .continuous))
      .environment(\.colorScheme, scheme)
      .environment(\.datumLinksDisabled, true)
      .padding(12)
      .background(scheme == .dark ? Color(white: 0.02) : Color(white: 0.92))
  }
}

@main
struct RenderPreviews {
  @MainActor
  static func main() throws {
    let args = CommandLine.arguments
    let snapshot = HealthSnapshot.decode(try Data(contentsOf: URL(fileURLWithPath: args[1])))!
    CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: args[2]) as CFURL, .process, nil)
    let out = URL(fileURLWithPath: args[3])
    let now = snapshot.generatedAt.addingTimeInterval(60)

    let failing = HealthTimeline.resolve(snapshot, choice: .current, at: now)
    let healthy = HealthTimeline.resolve(snapshot, choice: .project("quiet"), at: now)
    let notLoaded = HealthTimeline.resolve(snapshot, choice: .project("unseen"), at: now)

    let small = CGSize(width: 170, height: 170)
    let medium = CGSize(width: 364, height: 170)
    var images: [(String, AnyView)] = []
    for scheme in [ColorScheme.light, .dark] {
      let tag = scheme == .dark ? "dark" : "light"
      images += [
        ("small-failing-\(tag)", AnyView(Frame(size: small, scheme: scheme, padding: 16) { SmallHealthView(state: failing) })),
        ("small-healthy-stale-\(tag)", AnyView(Frame(size: small, scheme: scheme, padding: 16) { SmallHealthView(state: healthy) })),
        ("medium-failing-\(tag)", AnyView(Frame(size: medium, scheme: scheme, padding: 16) { MediumHealthView(state: failing) })),
        ("medium-healthy-\(tag)", AnyView(Frame(size: medium, scheme: scheme, padding: 16) { MediumHealthView(state: healthy) })),
        ("small-not-loaded-\(tag)", AnyView(Frame(size: small, scheme: scheme, padding: 16) { SmallHealthView(state: notLoaded) })),
      ]
    }
    // Lock Screen: monochrome on a dark wallpaper, as the system draws them.
    images += [
      ("lock-circular-failing", AnyView(Frame(size: CGSize(width: 76, height: 76), scheme: .dark, padding: 0) { CircularHealthView(state: failing) }.environment(\.widgetRenderingMode, .vibrant))),
      ("lock-circular-healthy", AnyView(Frame(size: CGSize(width: 76, height: 76), scheme: .dark, padding: 0) { CircularHealthView(state: healthy) }.environment(\.widgetRenderingMode, .vibrant))),
      ("lock-inline-failing", AnyView(Frame(size: CGSize(width: 260, height: 24), scheme: .dark, padding: 0) { InlineHealthView(state: failing) }.environment(\.widgetRenderingMode, .vibrant))),
      ("lock-inline-healthy", AnyView(Frame(size: CGSize(width: 260, height: 24), scheme: .dark, padding: 0) { InlineHealthView(state: healthy) }.environment(\.widgetRenderingMode, .vibrant))),
      // Tinted Home Screen: the title drops navy; the system tints the accentable parts.
      ("small-failing-accented", AnyView(Frame(size: small, scheme: .dark, padding: 16) { SmallHealthView(state: failing) }.environment(\.widgetRenderingMode, .accented))),
    ]

    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    for (name, view) in images {
      let renderer = ImageRenderer(content: view)
      renderer.scale = 3
      guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
        let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
      else {
        print("could not render \(name)")
        continue
      }
      let file = out.appendingPathComponent("widget-\(name).png")
      try png.write(to: file)
      print(file.path)
    }
  }
}
