package net.datum.vpn

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Keeps this device's Connector live while the tunnel is up, as the desktop
 * client (and the iOS LeaseRenewer) do: every half lease duration (15 s for
 * the default 30 s lease), check the Connector still exists with this
 * device's key, then set its Lease's `spec.renewTime`. A deleted or
 * reassigned Connector revokes the tunnel. After a 401/403 it waits for the
 * app's next token instead of retrying.
 */
class LeaseRenewer(private val config: TunnelConfig, private val onRevoked: (String) -> Unit) {
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val http = OkHttpClient.Builder().callTimeout(8, TimeUnit.SECONDS).build()
  private var task: ScheduledFuture<*>? = null
  @Volatile var renewedAt: Long? = null
    private set
  @Volatile var error: String? = null
    private set
  /** Set by a 401/403; cleared when the app hands over a token. Executor thread only. */
  private var waitingForToken = false
  private var intervalMs = renewalIntervalMs(DEFAULT_LEASE_SECONDS)

  private val base: String
    get() =
      "${config.apiUrl.trimEnd('/')}/apis/resourcemanager.miloapis.com/v1alpha1/projects/${config.project}/control-plane"

  fun start() {
    task = executor.schedule({ loop() }, 0, TimeUnit.MILLISECONDS)
  }

  /** One renewal, then the next after the (lease-derived) interval. */
  private fun loop() {
    tick()
    // stop() may shut the executor down between the check and the schedule.
    if (!executor.isShutdown) {
      runCatching { task = executor.schedule({ loop() }, intervalMs, TimeUnit.MILLISECONDS) }
    }
  }

  fun stop() {
    task?.cancel(true)
    executor.shutdownNow()
  }

  /** A fresh access token arrived from the app. */
  fun renewSoon() {
    executor.execute {
      waitingForToken = false
      tick()
    }
  }

  private fun tick() {
    if (waitingForToken) return
    val token = TunnelState.accessToken
    if (token.isNullOrEmpty()) {
      error = "No access token. Open the Datum app."
      return
    }
    try {
      renew(token)?.let { seconds -> if (seconds > 0) intervalMs = renewalIntervalMs(seconds) }
      renewedAt = System.currentTimeMillis()
      error = null
    } catch (revoked: Revoked) {
      error = revoked.message
      Log.e(TAG, "connector revoked: ${revoked.message}")
      onRevoked(revoked.message ?: "This device's Connector was revoked.")
    } catch (unauthorized: Unauthorized) {
      error = "Authorization expired. Open the Datum app to keep this device's Connector live."
      Log.w(TAG, "lease renewal unauthorized; waiting for a fresh token")
      waitingForToken = true
    } catch (e: Exception) {
      error = e.message
      Log.w(TAG, "lease renewal failed: ${e.message}")
    }
  }

  /** Renews the Lease; returns its `spec.leaseDurationSeconds` when known. */
  private fun renew(token: String): Int? {
    val connectorUrl = "$base/apis/connect.datumapis.com/v1alpha1/namespaces/default/connectors/${config.connectorName}"
    val (connectorStatus, body) = call(Request.Builder().url(connectorUrl).get(), token)
    if (connectorStatus == 404) throw Revoked("This device's Connector was deleted.")
    check(connectorStatus)
    val connector = JSONObject(body)
    if (connector.optJSONObject("spec")?.optString("publicKey") != config.publicKey) {
      throw Revoked("Connector ${config.connectorName} now belongs to another device.")
    }
    val leaseRef = connector.optJSONObject("status")?.opt("leaseRef")
    val leaseName = (leaseRef as? String) ?: (leaseRef as? JSONObject)?.optString("name")
    // The controller creates the Lease after it observes the Connector.
    if (leaseName.isNullOrEmpty()) return null
    val leaseUrl = "$base/apis/coordination.k8s.io/v1/namespaces/default/leases/$leaseName"
    val patch = JSONObject().put("spec", JSONObject().put("renewTime", microTime(Date())))
    val (patchStatus, leaseBody) =
      call(
        Request.Builder().url(leaseUrl).patch(patch.toString().toRequestBody("application/merge-patch+json".toMediaType())),
        token,
      )
    if (patchStatus == 404) return null
    check(patchStatus)
    val seconds = runCatching { JSONObject(leaseBody).optJSONObject("spec")?.optInt("leaseDurationSeconds", 0) }.getOrNull()
    return seconds?.takeIf { it > 0 }
  }

  private fun call(builder: Request.Builder, token: String): Pair<Int, String> {
    val request = builder.header("Authorization", "Bearer $token").header("Accept", "application/json").build()
    http.newCall(request).execute().use { response -> return response.code to (response.body?.string() ?: "") }
  }

  private fun check(status: Int) {
    if (status == 401 || status == 403) throw Unauthorized()
    if (status !in 200..299) throw IllegalStateException("HTTP $status")
  }

  private class Revoked(message: String) : Exception(message)

  private class Unauthorized : Exception()

  companion object {
    private const val TAG = "DatumConnectLease"

    /** The Lease's duration until its own spec says otherwise (as the desktop client assumes). */
    private const val DEFAULT_LEASE_SECONDS = 30

    /** Half the lease, at least 10 s. */
    fun renewalIntervalMs(leaseSeconds: Int): Long = maxOf(10_000L, leaseSeconds * 500L)

    /** RFC 3339 with microseconds (`chrono::SecondsFormat::Micros`). */
    fun microTime(date: Date): String =
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'000Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(date)
  }
}
