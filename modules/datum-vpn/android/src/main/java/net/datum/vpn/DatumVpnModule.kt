package net.datum.vpn

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import uniffi.datum_connect_core.publicKeyFor

/** The JS `VpnStartOptions`. */
class StartOptions : Record {
  @Field val project: String = ""
  @Field val network: String = ""
  @Field val displayName: String = ""
  @Field val apiUrl: String = ""
  @Field val connectorName: String = ""
  @Field val publicKey: String = ""
  @Field val bindingName: String = ""
  @Field val gatewayName: String = ""
  @Field val gatewayLocation: String = ""
  @Field val gatewayEndpointId: String = ""
  @Field val relayUrls: List<String> = emptyList()
  @Field val homeRelayUrls: List<String> = emptyList()
  @Field val clientAddress: String = ""
  @Field val gatewayAddress: String = ""
  @Field val routes: List<String> = emptyList()
  @Field val mtu: Int = 1280

  fun toConfig() =
    TunnelConfig(
      project, network, displayName, apiUrl, connectorName, publicKey, bindingName, gatewayName,
      gatewayLocation, gatewayEndpointId, relayUrls, homeRelayUrls, clientAddress, gatewayAddress, routes, mtu,
    )
}

private class VpnException(message: String) : CodedException("ERR_DATUM_VPN", message, null)

/**
 * Android side of the `DatumVpn` module (same API as iOS): this device's
 * Connector keys, the VPN consent prompt, and starting/stopping
 * [DatumVpnService].
 */
class DatumVpnModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw VpnException("The app isn't ready.")

  private var pendingStart: Pair<TunnelConfig, Promise>? = null
  private val listener: (Bundle) -> Unit = { sendEvent("onStatusChange", it) }

  override fun definition() = ModuleDefinition {
    Name("DatumVpn")
    Events("onStatusChange")

    // Android runs VpnService in emulators and on devices alike; nothing to configure.
    Function("getAvailability") { mapOf("available" to true, "reason" to "ok") }

    AsyncFunction("ensureConnectorKey") { project: String ->
      publicKeyFor(ConnectorKeys.seed(context, project, create = true)!!)
    }

    AsyncFunction("getConnectorKey") { project: String ->
      ConnectorKeys.seed(context, project, create = false)?.let { publicKeyFor(it) }
    }

    AsyncFunction("setAccessToken") { token: String ->
      TunnelState.accessToken = token
      TunnelState.onToken?.invoke()
    }

    AsyncFunction("start") { options: StartOptions, promise: Promise ->
      val config = options.toConfig()
      val consent = VpnService.prepare(context)
      if (consent == null) {
        launch(config)
        promise.resolve(null)
        return@AsyncFunction
      }
      // First connect (or another VPN app took over): ask the user.
      val activity = appContext.currentActivity ?: throw VpnException("Open the Datum app to connect.")
      pendingStart?.second?.reject(VpnException("Superseded by a newer connect."))
      pendingStart = config to promise
      activity.startActivityForResult(consent, REQUEST_VPN)
    }

    AsyncFunction("stop") { ->
      context.startService(Intent(context, DatumVpnService::class.java).setAction(DatumVpnService.ACTION_STOP))
      Unit
    }

    AsyncFunction("removeConfiguration") { ->
      context.startService(Intent(context, DatumVpnService::class.java).setAction(DatumVpnService.ACTION_STOP))
      TunnelState.config = null
      TunnelState.update(TunnelState.status)
    }

    AsyncFunction("getStatus") { -> TunnelState.describe() }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_VPN) return@OnActivityResult
      val (config, promise) = pendingStart ?: return@OnActivityResult
      pendingStart = null
      if (payload.resultCode == Activity.RESULT_OK) {
        launch(config)
        promise.resolve(null)
      } else {
        promise.reject(VpnException("The VPN permission was declined."))
      }
    }

    OnStartObserving { TunnelState.addListener(listener) }
    OnStopObserving { TunnelState.removeListener(listener) }
  }

  private fun launch(config: TunnelConfig) {
    TunnelState.config = config
    TunnelState.lastError = null
    context.startForegroundService(Intent(context, DatumVpnService::class.java))
  }

  companion object {
    private const val REQUEST_VPN = 7311
  }
}
