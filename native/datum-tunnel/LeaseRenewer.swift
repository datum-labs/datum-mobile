import Foundation
import os

/// Keeps the device's Connector live while the tunnel is up.
///
/// Mirrors the desktop client's liveness task: read the Connector (it must
/// still exist with this device's key), then set its Lease's
/// `spec.renewTime`, every half lease duration (15 s for the default 30 s
/// lease; datum-connect `heartbeat.rs` `renewal_interval`). The daemon GETs
/// and PUTs the Lease; a JSON merge patch is the same write in one request.
///
/// After a 401/403 it stops sending requests until `renewSoon()` brings a
/// fresh token, rather than retrying a request that can't succeed.
///
/// It uses the user's access token, which the app keeps in the shared
/// Keychain. If it expires while the app stays closed, renewal pauses (the
/// session keeps running) until the app hands over a fresh one.
final class LeaseRenewer: @unchecked Sendable {
  private let config: TunnelConfig
  private let onRevoked: (String) -> Void
  private let log = Logger(subsystem: "net.datum.connect", category: "lease")
  private let queue = DispatchQueue(label: "net.datum.connect.lease")
  private let urlSession: URLSession
  private var timer: DispatchSourceTimer?
  private var leaseName: String?
  private var inFlight = false

  private var lastRenewed: Date?
  private var lastError: String?
  /// Set by a 401/403; cleared when the app hands over a token.
  private var waitingForToken = false
  private var interval = LeaseRenewer.interval(leaseSeconds: LeaseRenewer.defaultLeaseSeconds)

  /// The Lease's duration until its own spec says otherwise (as the desktop client assumes).
  static let defaultLeaseSeconds = 30

  /// Half the lease, at least 10 s.
  static func interval(leaseSeconds: Int) -> TimeInterval {
    max(10, TimeInterval(leaseSeconds) / 2)
  }

  init(config: TunnelConfig, onRevoked: @escaping (String) -> Void) {
    self.config = config
    self.onRevoked = onRevoked
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 8
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    self.urlSession = URLSession(configuration: configuration)
  }

  func start() {
    queue.async { [weak self] in
      guard let self else { return }
      let timer = DispatchSource.makeTimerSource(queue: self.queue)
      timer.schedule(deadline: .now(), repeating: self.interval, leeway: self.leeway)
      timer.setEventHandler { [weak self] in self?.tick() }
      self.timer = timer
      timer.resume()
    }
  }

  func stop() {
    queue.async {
      self.timer?.cancel()
      self.timer = nil
      self.urlSession.invalidateAndCancel()
    }
  }

  /// A fresh token arrived from the app.
  func renewSoon() {
    queue.async {
      self.waitingForToken = false
      self.tick()
    }
  }

  /// A fifth of the interval: lets the system coalesce the extension's wakeups.
  private var leeway: DispatchTimeInterval { .milliseconds(Int(interval * 200)) }

  /// Follow the Lease's own duration. On `queue`.
  private func adopt(leaseSeconds: Int?) {
    guard let leaseSeconds, leaseSeconds > 0 else { return }
    let next = Self.interval(leaseSeconds: leaseSeconds)
    guard next != interval else { return }
    interval = next
    timer?.schedule(deadline: .now() + next, repeating: next, leeway: leeway)
  }

  func snapshot() -> [String: Any] {
    queue.sync {
      var result: [String: Any] = [:]
      if let lastRenewed { result["renewedAt"] = lastRenewed.timeIntervalSince1970 * 1000 }
      if let lastError { result["error"] = lastError }
      return result
    }
  }

  // MARK: - Renewal

  private var base: String {
    "\(config.apiUrl.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/apis/resourcemanager.miloapis.com/v1alpha1/projects/\(config.project)/control-plane"
  }

  private func tick() {
    guard !inFlight, !waitingForToken else { return }
    guard let tokenData = try? SharedKeychain.read(account: SharedKeychain.tokenAccount),
      let token = String(data: tokenData, encoding: .utf8), !token.isEmpty
    else {
      lastError = "No access token. Open the Datum app."
      return
    }
    inFlight = true
    Task {
      defer { queue.async { self.inFlight = false } }
      do {
        let leaseSeconds = try await renew(token: token)
        queue.async {
          self.lastRenewed = Date()
          self.lastError = nil
          self.adopt(leaseSeconds: leaseSeconds)
        }
      } catch let error as RenewError {
        queue.async { self.lastError = error.message }
        switch error {
        case .revoked(let message):
          log.error("connector revoked: \(message, privacy: .public)")
          onRevoked(message)
        case .unauthorized:
          log.warning("lease renewal unauthorized; waiting for a fresh token from the app")
          queue.async { self.waitingForToken = true }
        case .failed(let message):
          log.warning("lease renewal failed: \(message, privacy: .public)")
        }
      } catch {
        queue.async { self.lastError = error.localizedDescription }
      }
    }
  }

  /// Renews the Lease; returns its `spec.leaseDurationSeconds` when known.
  private func renew(token: String) async throws -> Int? {
    // The Connector must still exist with this device's key; deletion is
    // the revocation boundary.
    let connectorURL = "\(base)/apis/connect.datumapis.com/v1alpha1/namespaces/default/connectors/\(config.connectorName)"
    let (data, status) = try await request("GET", connectorURL, token: token)
    if status == 404 {
      throw RenewError.revoked("This device's Connector was deleted.")
    }
    try check(status)
    let connector = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    let spec = connector?["spec"] as? [String: Any]
    if spec?["publicKey"] as? String != config.publicKey {
      throw RenewError.revoked("Connector \(config.connectorName) now belongs to another device.")
    }
    let statusObject = connector?["status"] as? [String: Any]
    let leaseRef = statusObject?["leaseRef"]
    let name = (leaseRef as? String) ?? ((leaseRef as? [String: Any])?["name"] as? String)
    guard let name, !name.isEmpty else {
      // The controller creates the Lease after observing the Connector.
      return nil
    }
    leaseName = name
    let leaseURL = "\(base)/apis/coordination.k8s.io/v1/namespaces/default/leases/\(name)"
    let body = try JSONSerialization.data(withJSONObject: ["spec": ["renewTime": Self.microTime(Date())]])
    let (leaseData, patchStatus) = try await request(
      "PATCH", leaseURL, token: token, body: body, contentType: "application/merge-patch+json")
    if patchStatus == 404 { return nil }
    try check(patchStatus)
    let lease = (try? JSONSerialization.jsonObject(with: leaseData)) as? [String: Any]
    return (lease?["spec"] as? [String: Any])?["leaseDurationSeconds"] as? Int
  }

  private func check(_ status: Int) throws {
    if status == 401 || status == 403 { throw RenewError.unauthorized }
    if !(200..<300).contains(status) { throw RenewError.failed("HTTP \(status)") }
  }

  private func request(
    _ method: String, _ url: String, token: String, body: Data? = nil, contentType: String? = nil
  ) async throws -> (Data, Int) {
    guard let url = URL(string: url) else { throw RenewError.failed("invalid URL") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
    request.httpBody = body
    let (data, response) = try await urlSession.data(for: request)
    return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
  }

  /// RFC 3339 with microseconds (`chrono::SecondsFormat::Micros`).
  static func microTime(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(identifier: "UTC")
    return formatter.string(from: date).replacingOccurrences(of: "Z", with: "000Z")
  }
}

enum RenewError: Error {
  case revoked(String)
  case unauthorized
  case failed(String)

  var message: String {
    switch self {
    case .revoked(let message), .failed(let message): return message
    case .unauthorized: return "Authorization expired. Open the Datum app to keep this device's Connector live."
    }
  }
}
