import Foundation
import NetworkExtension
import os

/// Datum Connect packet tunnel: one CONNECT-IP session to the project VPC
/// gateway that the app's `ConnectNetworkBinding` approved.
///
/// - Config: `providerConfiguration` (written by the app's DatumVpn module)
///   plus the Connector key and the user's access token from the shared
///   Keychain group.
/// - Data plane: `datum_connect_core` (Rust, UniFFI). It verifies the
///   gateway's grant like `datum-connectd` and moves IP packets.
/// - Liveness: renews the Connector's Lease every 10 s while up, as the
///   daemon does.
final class PacketTunnelProvider: NEPacketTunnelProvider {
  private let log = Logger(subsystem: "net.datum.connect", category: "tunnel")
  private let queue = DispatchQueue(label: "net.datum.connect.tunnel")
  private var session: Session?
  private var config: TunnelConfig?
  private var lease: LeaseRenewer?
  private var stopped = false

  override func startTunnel(
    options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void
  ) {
    setLogSink(sink: OSLogSink(), filter: "info")
    guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
      let config = TunnelConfig(proto.providerConfiguration ?? [:])
    else {
      completionHandler(TunnelError.configuration("The VPN configuration is incomplete. Connect again from the Datum app."))
      return
    }
    self.config = config
    let secretKey: Data
    do {
      guard let key = try SharedKeychain.read(account: SharedKeychain.keyAccount(project: config.project)) else {
        throw TunnelError.configuration("This device's Connector key is missing. Connect again from the Datum app.")
      }
      // The key must be the one the Connector was enrolled with.
      guard try publicKeyFor(secretKey: key) == config.publicKey else {
        throw TunnelError.configuration("This device's Connector key changed. Connect again from the Datum app.")
      }
      secretKey = key
    } catch {
      completionHandler(error)
      return
    }

    log.info("starting tunnel network=\(config.network, privacy: .public) gateway=\(config.gatewayEndpointId, privacy: .public)")
    queue.async { [weak self] in
      guard let self else { return }
      do {
        let session = try startSession(
          config: SessionConfig(
            secretKey: secretKey,
            network: config.network,
            gatewayEndpointId: config.gatewayEndpointId,
            relayUrls: config.relayUrls,
            homeRelayUrls: config.homeRelayUrls,
            clientAddress: config.clientAddress,
            gatewayAddress: config.gatewayAddress,
            routes: config.routes,
            mtu: UInt16(config.mtu)),
          sink: PacketWriter(flow: self.packetFlow),
          observer: StatusForwarder(provider: self))
        self.session = session
        self.setTunnelNetworkSettings(config.networkSettings()) { [weak self] error in
          guard let self else {
            session.stop()
            completionHandler(TunnelError.session("The tunnel stopped while starting."))
            return
          }
          if let error {
            self.log.error("network settings failed: \(error.localizedDescription, privacy: .public)")
            session.stop()
            completionHandler(error)
            return
          }
          self.readPackets()
          let lease = LeaseRenewer(config: config) { [weak self] reason in
            // Deleting the Connector is a revocation boundary (daemon parity).
            self?.cancelTunnelWithError(TunnelError.revoked(reason))
          }
          self.lease = lease
          lease.start()
          completionHandler(nil)
        }
      } catch {
        self.log.error("session failed: \(error.localizedDescription, privacy: .public)")
        completionHandler(error)
      }
    }
  }

  override func stopTunnel(
    with reason: NEProviderStopReason, completionHandler: @escaping () -> Void
  ) {
    log.info("stopping tunnel reason=\(reason.rawValue)")
    stopped = true
    lease?.stop()
    lease = nil
    let session = self.session
    self.session = nil
    queue.async {
      session?.stop()
      completionHandler()
    }
  }

  /// Messages from the app: `{"type":"status"}` and `{"type":"token"}`.
  override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
    let message = (try? JSONSerialization.jsonObject(with: messageData)) as? [String: Any]
    switch message?["type"] as? String {
    case "token":
      lease?.renewSoon()
      completionHandler?(try? JSONSerialization.data(withJSONObject: ["ok": true]))
    default:
      completionHandler?(try? JSONSerialization.data(withJSONObject: statusPayload()))
    }
  }

  private func statusPayload() -> [String: Any] {
    var payload: [String: Any] = [:]
    if let status = session?.status() {
      payload["state"] = "\(status.state)"
      payload["sessionId"] = status.sessionId ?? NSNull()
      payload["clientAddress"] = status.clientAddress
      payload["gatewayAddress"] = status.gatewayAddress
      payload["routes"] = status.routes
      payload["mtu"] = Int(status.mtu)
      payload["packetsSent"] = Double(status.packetsSent)
      payload["packetsReceived"] = Double(status.packetsReceived)
      payload["packetsDropped"] = Double(status.packetsDropped)
      payload["datagramCapacity"] = Double(status.datagramCapacity)
      payload["reconnects"] = Double(status.reconnects)
      payload["lastError"] = status.lastError ?? NSNull()
      payload["errorCode"] = status.errorCode ?? NSNull()
    }
    if let lease = lease?.snapshot() {
      payload["lease"] = lease
    }
    return payload
  }

  fileprivate func handle(_ status: SessionStatus) {
    switch status.state {
    case .reconnecting:
      reasserting = true
    case .connected:
      reasserting = false
    case .failed:
      log.error("session failed: \(status.lastError ?? "unknown", privacy: .public)")
      if !stopped {
        cancelTunnelWithError(TunnelError.session(status.lastError ?? "The Connect session failed."))
      }
    case .connecting, .stopped:
      break
    }
  }

  private func readPackets() {
    packetFlow.readPackets { [weak self] packets, _ in
      guard let self, let session = self.session else { return }
      session.writePackets(packets: packets)
      self.readPackets()
    }
  }
}

// MARK: - Callbacks from the core

/// Packets from the gateway into the tunnel interface.
final class PacketWriter: PacketSink, @unchecked Sendable {
  private weak var flow: NEPacketTunnelFlow?
  private static let ipv6 = NSNumber(value: AF_INET6)
  private static let ipv4 = NSNumber(value: AF_INET)

  init(flow: NEPacketTunnelFlow) {
    self.flow = flow
  }

  func onPacket(packet: Data) {
    let family = (packet.first ?? 0) >> 4 == 4 ? Self.ipv4 : Self.ipv6
    flow?.writePackets([packet], withProtocols: [family])
  }
}

final class StatusForwarder: StatusObserver, @unchecked Sendable {
  private weak var provider: PacketTunnelProvider?

  init(provider: PacketTunnelProvider) {
    self.provider = provider
  }

  func onStatus(status: SessionStatus) {
    DispatchQueue.main.async { [weak provider] in
      provider?.handle(status)
    }
  }
}

final class OSLogSink: LogSink, @unchecked Sendable {
  private let log = Logger(subsystem: "net.datum.connect", category: "core")

  func log(level: LogLevel, message: String) {
    switch level {
    case .error: log.error("\(message, privacy: .public)")
    case .warn: log.warning("\(message, privacy: .public)")
    case .info: log.info("\(message, privacy: .public)")
    case .debug, .trace: log.debug("\(message, privacy: .public)")
    }
  }
}

enum TunnelError: LocalizedError {
  case configuration(String)
  case session(String)
  case revoked(String)

  var errorDescription: String? {
    switch self {
    case .configuration(let message), .session(let message), .revoked(let message):
      return message
    }
  }
}
