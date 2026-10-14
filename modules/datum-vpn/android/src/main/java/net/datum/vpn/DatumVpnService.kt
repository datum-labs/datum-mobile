package net.datum.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import uniffi.datum_connect_core.LogLevel
import uniffi.datum_connect_core.LogSink
import uniffi.datum_connect_core.PacketSink
import uniffi.datum_connect_core.Session
import uniffi.datum_connect_core.SessionConfig
import uniffi.datum_connect_core.SessionState
import uniffi.datum_connect_core.SessionStatus
import uniffi.datum_connect_core.StatusObserver
import uniffi.datum_connect_core.publicKeyFor
import uniffi.datum_connect_core.setLogSink
import uniffi.datum_connect_core.startSession

/**
 * Datum Connect on Android: one CONNECT-IP (MASQUE) session to the project
 * VPC gateway the app's ConnectNetworkBinding approved, through a TUN
 * interface that routes only the network's private prefix. The iOS
 * counterpart is native/datum-tunnel/PacketTunnelProvider.swift; both drive
 * the same Rust core (native/connect-core).
 */
class DatumVpnService : VpnService() {
  private var tun: ParcelFileDescriptor? = null
  private var session: Session? = null
  private var lease: LeaseRenewer? = null
  private var reader: Thread? = null
  private val running = AtomicBoolean(false)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown(null)
      return START_NOT_STICKY
    }
    val config = TunnelState.config
    if (config == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    startForegroundNotice(config, connected = false)
    if (running.compareAndSet(false, true)) {
      Thread({ start(config) }, "datum-connect-start").start()
    }
    return START_NOT_STICKY
  }

  override fun onRevoke() {
    // Another VPN took over, or the user turned it off in Settings.
    shutdown("The VPN was turned off in Android settings.")
  }

  override fun onDestroy() {
    shutdown(null)
    super.onDestroy()
  }

  private fun start(config: TunnelConfig) {
    TunnelState.lastError = null
    TunnelState.update("connecting")
    try {
      setLogSink(LogcatSink, "info")
      val seed =
        ConnectorKeys.seed(this, config.project, create = false)
          ?: throw IllegalStateException("This device's Connector key is missing. Connect again from the Datum app.")
      if (publicKeyFor(seed) != config.publicKey) {
        throw IllegalStateException("This device's Connector key changed. Connect again from the Datum app.")
      }

      // Protect the tunnel's own sockets? Not needed: the interface routes
      // only the VPC's ULA prefix, and the gateway is reached over the
      // internet (relays, public addresses), so it never loops back.
      val builder =
        Builder()
          .setSession("Datum · ${config.displayName.ifEmpty { config.network }}")
          .setMtu(config.mtu)
          .addAddress(host(config.clientAddress), 128)
          .setBlocking(true)
      config.routes.forEach { route ->
        val (address, length) = route.split("/")
        builder.addRoute(address, length.toInt())
      }
      val tun = builder.establish() ?: throw IllegalStateException("Android didn't allow the VPN. Connect again from the Datum app.")
      this.tun = tun
      val out = FileOutputStream(tun.fileDescriptor)

      val session =
        startSession(
          SessionConfig(
            secretKey = seed,
            network = config.network,
            gatewayEndpointId = config.gatewayEndpointId,
            relayUrls = config.relayUrls,
            homeRelayUrls = config.homeRelayUrls,
            clientAddress = config.clientAddress,
            gatewayAddress = config.gatewayAddress,
            routes = config.routes,
            mtu = config.mtu.toUShort(),
          ),
          object : PacketSink {
            override fun onPacket(packet: ByteArray) {
              synchronized(out) {
                try {
                  out.write(packet)
                } catch (e: Exception) {
                  Log.w(TAG, "tun write failed: ${e.message}")
                }
              }
            }
          },
          object : StatusObserver {
            override fun onStatus(status: SessionStatus) = handle(status, config)
          },
        )
      this.session = session
      TunnelState.report = { report(session) }
      readPackets(tun, session, config.mtu)

      val lease = LeaseRenewer(config) { reason -> shutdown(reason) }
      this.lease = lease
      TunnelState.onToken = { lease.renewSoon() }
      lease.start()
    } catch (e: Exception) {
      Log.e(TAG, "start failed", e)
      shutdown(e.message ?: "Couldn't start the Connect tunnel.")
    }
  }

  private fun readPackets(tun: ParcelFileDescriptor, session: Session, mtu: Int) {
    val input = FileInputStream(tun.fileDescriptor)
    reader =
      Thread(
          {
            val buffer = ByteArray(maxOf(mtu, 1500) + 64)
            while (running.get()) {
              val length =
                try {
                  input.read(buffer)
                } catch (e: Exception) {
                  if (running.get()) Log.w(TAG, "tun read failed: ${e.message}")
                  break
                }
              if (length > 0) session.writePacket(buffer.copyOf(length))
            }
          },
          "datum-connect-tun",
        )
        .also { it.start() }
  }

  private fun handle(status: SessionStatus, config: TunnelConfig) {
    when (status.state) {
      SessionState.CONNECTED -> {
        TunnelState.update("connected")
        startForegroundNotice(config, connected = true)
      }
      SessionState.RECONNECTING -> TunnelState.update("reasserting")
      SessionState.CONNECTING -> TunnelState.update("connecting")
      SessionState.FAILED -> shutdown(status.lastError ?: "The Connect session failed.")
      SessionState.STOPPED -> Unit
    }
  }

  @Synchronized
  private fun shutdown(error: String?) {
    val wasRunning = running.getAndSet(false)
    lease?.stop()
    lease = null
    TunnelState.onToken = null
    val session = this.session
    this.session = null
    TunnelState.report = null
    try {
      session?.stop()
    } catch (_: Exception) {}
    try {
      tun?.close()
    } catch (_: Exception) {}
    tun = null
    reader?.interrupt()
    reader = null
    if (wasRunning || error != null) TunnelState.update("disconnected", error)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun report(session: Session): Bundle {
    val status = session.status()
    return Bundle().apply {
      putString("state", status.state.name.lowercase())
      putString("sessionId", status.sessionId)
      putString("clientAddress", status.clientAddress)
      putString("gatewayAddress", status.gatewayAddress)
      putStringArrayList("routes", ArrayList(status.routes))
      putInt("mtu", status.mtu.toInt())
      putDouble("packetsSent", status.packetsSent.toDouble())
      putDouble("packetsReceived", status.packetsReceived.toDouble())
      putDouble("packetsDropped", status.packetsDropped.toDouble())
      putDouble("datagramCapacity", status.datagramCapacity.toDouble())
      putDouble("reconnects", status.reconnects.toDouble())
      putString("lastError", status.lastError)
      putString("errorCode", status.errorCode)
      lease?.let { lease ->
        putBundle(
          "lease",
          Bundle().apply {
            lease.renewedAt?.let { putDouble("renewedAt", it.toDouble()) }
            lease.error?.let { putString("error", it) }
          },
        )
      }
    }
  }

  /** The persistent "VPN active" notification Android requires, with Disconnect. */
  private fun startForegroundNotice(config: TunnelConfig, connected: Boolean) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Datum Connect", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while this phone is connected to a Datum network"
        }
      )
    }
    val open =
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
      }
    val stop =
      PendingIntent.getService(
        this,
        1,
        Intent(this, DatumVpnService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE,
      )
    val name = config.displayName.ifEmpty { config.network }
    val notification =
      Notification.Builder(this, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_lock_lock)
        .setContentTitle(if (connected) "Connected to $name" else "Connecting to $name…")
        .setContentText("Datum Connect · ${config.gatewayLocation}")
        .setOngoing(true)
        .setContentIntent(open)
        .addAction(Notification.Action.Builder(null, "Disconnect", stop).build())
        .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private object LogcatSink : LogSink {
    override fun log(level: LogLevel, message: String) {
      when (level) {
        LogLevel.ERROR -> Log.e(CORE_TAG, message)
        LogLevel.WARN -> Log.w(CORE_TAG, message)
        LogLevel.INFO -> Log.i(CORE_TAG, message)
        else -> Log.d(CORE_TAG, message)
      }
    }
  }

  companion object {
    const val ACTION_STOP = "net.datum.vpn.STOP"
    private const val CHANNEL = "datum-connect"
    private const val NOTIFICATION_ID = 7310
    private const val TAG = "DatumConnect"
    private const val CORE_TAG = "DatumConnectCore"

    /** "fd20::1/128" → "fd20::1". */
    fun host(address: String) = address.substringBefore('/')
  }
}
