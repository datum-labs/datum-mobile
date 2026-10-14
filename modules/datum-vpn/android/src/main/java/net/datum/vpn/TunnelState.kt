package net.datum.vpn

import android.os.Bundle
import java.util.concurrent.CopyOnWriteArraySet

/** Non-secret tunnel configuration (the JS `VpnStartOptions`). */
data class TunnelConfig(
  val project: String,
  val network: String,
  val displayName: String,
  val apiUrl: String,
  val connectorName: String,
  val publicKey: String,
  val bindingName: String,
  val gatewayName: String,
  val gatewayLocation: String,
  val gatewayEndpointId: String,
  val relayUrls: List<String>,
  val homeRelayUrls: List<String>,
  val clientAddress: String,
  val gatewayAddress: String,
  val routes: List<String>,
  val mtu: Int,
)

/**
 * Shared between the module and the service, which run in the app's process:
 * the tunnel's status, its configuration, the user's access token (memory
 * only; the tunnel can't outlive the process) and status listeners.
 */
object TunnelState {
  @Volatile var status: String = "disconnected"
    private set
  @Volatile var config: TunnelConfig? = null
  @Volatile var connectedAt: Long? = null
  @Volatile var accessToken: String? = null
  @Volatile var lastError: String? = null
  @Volatile var report: (() -> Bundle?)? = null
  /** Set by the running service: renew the Lease now with a fresh token. */
  @Volatile var onToken: (() -> Unit)? = null

  private val listeners = CopyOnWriteArraySet<(Bundle) -> Unit>()

  fun addListener(listener: (Bundle) -> Unit) = listeners.add(listener)

  fun removeListener(listener: (Bundle) -> Unit) = listeners.remove(listener)

  fun update(next: String, error: String? = null) {
    status = next
    if (next == "connected" && connectedAt == null) connectedAt = System.currentTimeMillis()
    if (next == "disconnected") connectedAt = null
    if (error != null) lastError = error
    val snapshot = describe()
    listeners.forEach { it(snapshot) }
  }

  /** The JS `VpnState`. */
  fun describe(): Bundle =
    Bundle().apply {
      putString("status", status)
      putBoolean("enabled", config != null)
      config?.let {
        putString("project", it.project)
        putString("network", it.network)
        putString("clientAddress", it.clientAddress)
        putString("gatewayAddress", it.gatewayAddress)
        putStringArrayList("routes", ArrayList(it.routes))
        putInt("mtu", it.mtu)
        putString("gatewayLocation", it.gatewayLocation)
      }
      connectedAt?.let { putDouble("connectedAt", it.toDouble()) }
      val tunnel = report?.invoke() ?: lastError?.let { error ->
        Bundle().apply {
          putString("state", "failed")
          putString("lastError", error)
        }
      }
      tunnel?.let { putBundle("tunnel", it) }
    }
}
