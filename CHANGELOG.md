# Changelog

TestFlight builds of the staging app (Datum Staging (MJ), `net.datum.cloud.staging.mjenkinson`).
Newest first.

## Build 9 (13 Oct 2026)

### New
- **Create a private network.** Use **New private network** on Home, or **+** on the
  Network tab. Give it a name, and choose IPv6 or IPv6 + IPv4. Datum assigns the
  network a private IPv6 /48 automatically, usually within a few seconds.
- **Connect straight away.** "Connect this iPhone" is on by default when you create a
  network. The network screen shows *Waiting* until the network is ready, then joins
  this iPhone to it automatically.
- **Networks first on Home.** Home now opens with your networks and their prefixes.
  The one this iPhone is connected to sits at the top with a *Connected* pill. A
  *See all* link appears when there are more than four.

### Changed
- The Patch message box now curves into the screen's corners when the keyboard is
  down.
- The Networks tile is gone from Home's grid, because the Networks section replaces it.

### Removed
- Subnets are no longer shown, on either the Network tab or a network's screen.

## Build 8 (13 Oct 2026)

### New
- **Home-screen and Lock Screen widgets** showing project health: resource counts,
  failing and pending items, and what needs attention.
- **Control Centre controls:** *Connect to VPC*, which turns the tunnel to your last
  network on or off, and *Ask Patch*.
- The widgets stay current in the background.

### Fixed
- Build 7 was rejected at upload because the control's description mentioned a
  device name (TMS-90626). Build 8 rewords it.

## Build 6 (13 Oct 2026)

### New
- **Instance shell.** Use *Open shell* on an instance to run an interactive terminal
  in the browser-based console.
- Patch uses the same Lucide brain icon as the web portal's assistant.

### Fixed
- Build 5 crashed on launch because the React framework was missing from the
  bundle. Build 6 fixes this, and the release pipeline now checks for it before
  uploading.

## Build 4 (12 Oct 2026)

### New
- **Patch, the assistant.** Chat with Patch from Home, and keep your past
  conversations. Use *Ask Patch about this* on any detail screen.
- **Connect this iPhone to a VPC.** Join a network from its screen through Datum
  Connect, a VPN that routes only that network's private prefix through Datum.

## Build 3 (12 Oct 2026): first TestFlight build

- **Sign in** with your Datum account. Switch organization and project from the
  header.
- **Home:** health tiles for every resource type, plus a *Needs attention* list.
- **Edge:**
  - Load balancers, with hostnames that open in Safari, access logs with request
    detail, and metrics
  - Domains
  - DNS zones
- **Compute:**
  - Workloads and instances
  - Console logs
  - CPU and memory metrics
- **Network:** networks and connectors.
- **Account:** native settings, with your avatar, project and session.
- **Design:**
  - native iOS 26 tab bar, headers and sheets, with untinted Liquid Glass
  - zoom transitions into detail screens
  - an animated Datum splash
  - empty states drawn with the Datum artwork
- **Fixed:** project rows in the switcher sheet didn't respond to taps.
