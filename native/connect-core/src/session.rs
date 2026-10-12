//! CONNECT-IP session lifecycle, following `daemon/src/local_ip.rs` `join`.
//!
//! Differences from the daemon are deliberate and limited to the adapter: the
//! "TUN" is the host's packet callbacks (`NEPacketTunnelFlow` on iOS), so no
//! interface or route is created here. Grant verification, reconnect policy,
//! retryable errors and backoff are the daemon's.

use std::{
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use bytes::Bytes;
use connect_transport::{Transport, TransportConfig, ip};
use iroh::{EndpointAddr, RelayMode};
use tokio::{runtime::Runtime, sync::mpsc, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use crate::{
    ConnectError, PacketSink, SessionConfig, SessionState, SessionStatus, StatusObserver,
    config::{self, Validated},
};

/// The daemon waits this long for a home relay before enrolling.
const RELAY_TIMEOUT: Duration = Duration::from_secs(15);
/// The daemon's CONNECT-IP setup budget (`local_ip::join`).
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);
/// Packets queued from the host while the transport is busy. Beyond this the
/// host's packets are dropped and counted, like a full TUN queue.
const OUTGOING_QUEUE: usize = 1024;
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        // Two workers keep the Network Extension's footprint small; the packet
        // path is one task per session.
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("datum-connect")
            .enable_all()
            .build()
            .expect("tokio runtime")
    })
}

#[derive(Debug, Clone)]
struct Snapshot {
    state: SessionState,
    session_id: Option<String>,
    last_error: Option<String>,
    error_code: Option<String>,
}

struct Inner {
    valid: Validated,
    cancel: CancellationToken,
    transport: Transport,
    outgoing: mpsc::Sender<Bytes>,
    snapshot: Mutex<Snapshot>,
    active: Mutex<Option<Arc<ip::IpSession>>>,
    observer: Arc<dyn StatusObserver>,
    sent: AtomicU64,
    received: AtomicU64,
    /// Local drops: full queue plus retired sessions' policy drops.
    dropped: AtomicU64,
    reconnects: AtomicU64,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl Inner {
    fn status(&self) -> SessionStatus {
        let snapshot = self
            .snapshot
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let stats = self
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|session| session.stats())
            .unwrap_or_default();
        SessionStatus {
            state: snapshot.state,
            session_id: snapshot.session_id,
            client_address: self.valid.client_address.to_string(),
            gateway_address: self.valid.gateway_address.to_string(),
            routes: self.valid.routes.iter().map(ToString::to_string).collect(),
            mtu: self.valid.mtu,
            packets_sent: self.sent.load(Ordering::Relaxed),
            packets_received: self.received.load(Ordering::Relaxed),
            packets_dropped: self.dropped.load(Ordering::Relaxed) + stats.packets_dropped,
            datagram_capacity: stats.effective_datagram_ip_capacity as u64,
            reconnects: self.reconnects.load(Ordering::Relaxed),
            last_error: snapshot.last_error,
            error_code: snapshot.error_code,
        }
    }

    fn set(&self, state: SessionState, error: Option<(&str, String)>) {
        {
            let mut snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
            snapshot.state = state;
            match error {
                Some((code, message)) => {
                    snapshot.error_code = Some(code.to_owned());
                    snapshot.last_error = Some(message);
                }
                None if state == SessionState::Connected => {
                    snapshot.error_code = None;
                    snapshot.last_error = None;
                }
                None => {}
            }
        }
        self.observer.on_status(self.status());
    }

    fn replace_session(&self, session: Arc<ip::IpSession>) {
        let previous = self
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .replace(session.clone());
        if let Some(previous) = previous {
            self.dropped
                .fetch_add(previous.stats().packets_dropped, Ordering::Relaxed);
        }
        self.snapshot
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session_id = Some(session.session_id.clone());
    }

    fn state(&self) -> SessionState {
        self.snapshot
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .state
    }
}

/// A running CONNECT-IP attachment. Dropping it stops the session.
#[derive(uniffi::Object)]
pub struct Session {
    inner: Arc<Inner>,
}

#[uniffi::export]
impl Session {
    /// One IP packet from the host (for example `packetFlow.readPackets`).
    /// Never blocks: if the queue is full the packet is dropped and counted.
    pub fn write_packet(&self, packet: Vec<u8>) {
        self.enqueue(Bytes::from(packet));
    }

    /// A batch of IP packets, in order.
    pub fn write_packets(&self, packets: Vec<Vec<u8>>) {
        for packet in packets {
            self.enqueue(Bytes::from(packet));
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.inner.status()
    }

    /// Close the session and the endpoint. Idempotent.
    pub fn stop(&self) {
        let inner = self.inner.clone();
        inner.cancel.cancel();
        let task = inner.task.lock().unwrap_or_else(|e| e.into_inner()).take();
        let shutdown = async move {
            if let Some(task) = task {
                let _ = tokio::time::timeout(STOP_TIMEOUT, task).await;
            }
            let _ = tokio::time::timeout(STOP_TIMEOUT, inner.transport.shutdown()).await;
            if inner.state() != SessionState::Failed {
                inner.set(SessionState::Stopped, None);
            }
        };
        if tokio::runtime::Handle::try_current().is_ok() {
            // Called from a callback on a transport thread: don't block it.
            runtime().spawn(shutdown);
        } else {
            runtime().block_on(shutdown);
        }
    }
}

impl Session {
    fn enqueue(&self, packet: Bytes) {
        if self.inner.cancel.is_cancelled() {
            return;
        }
        if let Err(mpsc::error::TrySendError::Full(_)) = self.inner.outgoing.try_send(packet) {
            self.inner.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.inner.cancel.cancel();
    }
}

pub(crate) fn start(
    config: SessionConfig,
    sink: Arc<dyn PacketSink>,
    observer: Arc<dyn StatusObserver>,
) -> Result<Arc<Session>, ConnectError> {
    let valid = config::validate(&config)?;
    if tokio::runtime::Handle::try_current().is_ok() {
        return Err(ConnectError::InvalidConfig {
            message: "start_session must not be called from a transport thread".into(),
        });
    }
    runtime().block_on(async move {
        let transport = bind(&valid).await?;
        let cancel = CancellationToken::new();
        let peer = gateway_addr(&valid);
        let session = match connect_verified(&transport, &peer, &valid, &cancel).await {
            Ok(session) => Arc::new(session),
            Err(error) => {
                cancel.cancel();
                transport.shutdown().await;
                return Err(error);
            }
        };
        let (outgoing, incoming) = mpsc::channel(OUTGOING_QUEUE);
        let inner = Arc::new(Inner {
            valid,
            cancel,
            transport,
            outgoing,
            snapshot: Mutex::new(Snapshot {
                state: SessionState::Connected,
                session_id: None,
                last_error: None,
                error_code: None,
            }),
            active: Mutex::new(None),
            observer,
            sent: AtomicU64::new(0),
            received: AtomicU64::new(0),
            dropped: AtomicU64::new(0),
            reconnects: AtomicU64::new(0),
            task: Mutex::new(None),
        });
        inner.replace_session(session.clone());
        tracing::info!(
            network = %inner.valid.network,
            gateway = %inner.valid.gateway,
            session_id = %session.session_id,
            assigned_address = %inner.valid.client_address,
            stage = "connect_ip_ready",
            "CONNECT-IP attachment ready"
        );
        inner.set(SessionState::Connected, None);
        let task = tokio::spawn(supervise(inner.clone(), session, incoming, sink, peer));
        *inner.task.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
        Ok(Arc::new(Session { inner }))
    })
}

async fn bind(valid: &Validated) -> Result<Transport, ConnectError> {
    let mut transport_config = TransportConfig::new(valid.secret_key.clone());
    if !valid.home_relay_urls.is_empty() {
        transport_config =
            transport_config.relay_mode(RelayMode::custom(valid.home_relay_urls.clone()));
    }
    let transport = Transport::bind(transport_config).await.map_err(|error| {
        ConnectError::RelayUnavailable {
            message: format!("could not open the Connect endpoint: {error}"),
        }
    })?;
    if tokio::time::timeout(RELAY_TIMEOUT, transport.endpoint().online())
        .await
        .is_err()
    {
        transport.shutdown().await;
        return Err(ConnectError::RelayUnavailable {
            message: "Could not connect to a Connect relay within 15 seconds. Check the network connection and try again.".into(),
        });
    }
    Ok(transport)
}

fn gateway_addr(valid: &Validated) -> EndpointAddr {
    let mut peer = EndpointAddr::new(valid.gateway);
    for relay in &valid.relay_urls {
        peer = peer.with_relay_url(relay.clone());
    }
    peer
}

/// `ip::connect` plus the daemon's exact grant check.
async fn connect_verified(
    transport: &Transport,
    peer: &EndpointAddr,
    valid: &Validated,
    cancel: &CancellationToken,
) -> Result<ip::IpSession, ConnectError> {
    let connector = transport.endpoint_id().to_string();
    let session = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        ip::connect(
            transport.endpoint(),
            peer.clone(),
            &valid.network,
            cancel.clone(),
        ),
    )
    .await
    .map_err(|_| ConnectError::Timeout {
        message: "CONNECT-IP gateway setup timed out".into(),
    })?
    .map_err(|error| {
        tracing::warn!(network = %valid.network, connector = %connector, peer = %valid.gateway, %error,
            stage = "connect_ip_setup_failed", "CONNECT-IP setup failed");
        handshake_error(&valid.network, &connector, error)
    })?;
    if !config::grant_matches(
        valid,
        session.config.address,
        session.config.mtu,
        &session.config.routes,
    ) {
        tracing::warn!(network = %valid.network, granted_address = %session.config.address,
            granted_mtu = session.config.mtu, granted_routes = ?session.config.routes,
            stage = "connect_ip_grant_mismatch", "gateway grant differs from the binding");
        session.cancel();
        return Err(ConnectError::GrantMismatch {
            message: "Gateway IP assignment or routes differ from the approved binding; nothing was connected. Disconnect and connect again to pick up the gateway's current assignment.".into(),
        });
    }
    Ok(session)
}

/// The daemon's `local_ip::retryable_connect_error`.
fn retryable(error: &ip::Error) -> bool {
    matches!(
        error,
        ip::Error::Closed | ip::Error::Timeout | ip::Error::Transport | ip::Error::Io(_)
    )
}

/// The daemon's `local_ip::handshake_error`, worded for the app.
fn handshake_error(network: &str, connector: &str, error: ip::Error) -> ConnectError {
    match error {
        ip::Error::DatagramsUnsupported => ConnectError::DatagramsUnsupported {
            message: format!(
                "Cannot join network {network:?}: the connection does not support QUIC DATAGRAM. CONNECT-IP has no reliable-stream fallback."
            ),
        },
        ip::Error::InsufficientDatagramMtu {
            required,
            available,
        } => ConnectError::DatagramMtuInsufficient {
            message: format!(
                "Cannot join network {network:?}: the approved IP MTU is {required} bytes, but this path can carry only {available} IP bytes per QUIC datagram."
            ),
        },
        ip::Error::RejectedWithReason {
            status,
            reason,
            session_id,
        } if status.as_u16() == 403 && reason == ip::RejectionReason::PeerNetworkNotApproved => {
            ConnectError::GatewayApprovalRequired {
                message: format!(
                    "The gateway has no approval for network {network:?} and Connector {connector}. Diagnostic session_id: {session_id}"
                ),
            }
        }
        ip::Error::RejectedWithReason {
            status,
            reason,
            session_id,
        } => ConnectError::Handshake {
            message: format!(
                "The gateway rejected CONNECT-IP for network {network:?} (HTTP {}, reason: {reason}). Diagnostic session_id: {session_id}",
                status.as_u16()
            ),
        },
        ip::Error::Rejected(status) if status.as_u16() == 403 => {
            ConnectError::GatewayApprovalRequired {
                message: format!(
                    "The gateway has not approved network {network:?} for Connector {connector} yet."
                ),
            }
        }
        ip::Error::Rejected(status) if status.as_u16() == 503 => ConnectError::GatewaySetupFailed {
            message: format!(
                "The gateway could not prepare its attachment for network {network:?}."
            ),
        },
        ip::Error::Timeout => ConnectError::Timeout {
            message: "CONNECT-IP gateway setup timed out".into(),
        },
        error => ConnectError::Handshake {
            message: format!("CONNECT-IP setup for network {network:?} failed: {error}"),
        },
    }
}

async fn supervise(
    inner: Arc<Inner>,
    mut session: Arc<ip::IpSession>,
    mut incoming: mpsc::Receiver<Bytes>,
    sink: Arc<dyn PacketSink>,
    peer: EndpointAddr,
) {
    let cancel = inner.cancel.clone();
    let mut reconnect_delay = Duration::from_secs(1);
    'attachment: loop {
        let failure = loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    session.cancel();
                    break 'attachment;
                }
                packet = session.recv() => {
                    let Some(packet) = packet else {
                        break session.last_error().unwrap_or_else(|| "CONNECT-IP gateway closed the session".to_owned());
                    };
                    inner.received.fetch_add(1, Ordering::Relaxed);
                    sink.on_packet(packet.to_vec());
                }
                packet = incoming.recv() => {
                    let Some(packet) = packet else {
                        session.cancel();
                        break 'attachment;
                    };
                    match session.send(packet).await {
                        Ok(()) => { inner.sent.fetch_add(1, Ordering::Relaxed); }
                        Err(error @ (ip::Error::InvalidPacket | ip::Error::PacketTooLarge | ip::Error::AddressPolicy)) => {
                            tracing::debug!(network = %inner.valid.network, %error, stage = "connect_ip_packet", "packet_rejected");
                        }
                        Err(error) => break session.last_error().unwrap_or_else(|| error.to_string()),
                    }
                }
            }
        };
        session.cancel();
        if cancel.is_cancelled() {
            break;
        }
        let attempt = inner.reconnects.fetch_add(1, Ordering::Relaxed) + 1;
        tracing::warn!(network = %inner.valid.network, gateway = %inner.valid.gateway, attempt,
            error = %failure, reconnect_delay_ms = reconnect_delay.as_millis() as u64,
            stage = "connect_ip_reconnect", "CONNECT-IP session ended; retrying with the approved binding");
        inner.set(
            SessionState::Reconnecting,
            Some(("session_closed", failure)),
        );

        loop {
            tokio::select! {
                _ = cancel.cancelled() => break 'attachment,
                _ = tokio::time::sleep(reconnect_delay) => {}
            }
            let attempt = tokio::time::timeout(
                HANDSHAKE_TIMEOUT,
                ip::connect(
                    inner.transport.endpoint(),
                    peer.clone(),
                    &inner.valid.network,
                    cancel.clone(),
                ),
            )
            .await;
            match attempt {
                Ok(Ok(replacement)) => {
                    if !config::grant_matches(
                        &inner.valid,
                        replacement.config.address,
                        replacement.config.mtu,
                        &replacement.config.routes,
                    ) {
                        replacement.cancel();
                        tracing::error!(network = %inner.valid.network, stage = "connect_ip_reconnect_rejected",
                            "CONNECT-IP reconnect does not match the approved binding");
                        inner.set(
                            SessionState::Failed,
                            Some((
                                "local_ip_grant_mismatch",
                                "The gateway's assignment or routes changed. Disconnect and connect again to approve the new settings.".into(),
                            )),
                        );
                        break 'attachment;
                    }
                    let replacement = Arc::new(replacement);
                    inner.replace_session(replacement.clone());
                    session = replacement;
                    reconnect_delay = Duration::from_secs(1);
                    tracing::info!(network = %inner.valid.network, session_id = %session.session_id,
                        stage = "connect_ip_reconnected", "CONNECT-IP attachment recovered");
                    inner.set(SessionState::Connected, None);
                    break;
                }
                Ok(Err(error)) if retryable(&error) => {
                    let message = error.to_string();
                    tracing::warn!(network = %inner.valid.network, error = %message,
                        stage = "connect_ip_reconnect_attempt_failed", "CONNECT-IP reconnect attempt failed");
                    inner.set(SessionState::Reconnecting, Some(("reconnecting", message)));
                    reconnect_delay = std::cmp::min(reconnect_delay * 2, MAX_RECONNECT_DELAY);
                }
                Ok(Err(error)) => {
                    let connector = inner.transport.endpoint_id().to_string();
                    let error = handshake_error(&inner.valid.network, &connector, error);
                    tracing::error!(network = %inner.valid.network, %error,
                        stage = "connect_ip_reconnect_rejected", "CONNECT-IP reconnect requires a binding, gateway, or protocol change");
                    inner.set(
                        SessionState::Failed,
                        Some((error.code(), error.to_string())),
                    );
                    break 'attachment;
                }
                Err(_) => {
                    inner.set(
                        SessionState::Reconnecting,
                        Some(("timeout", "CONNECT-IP reconnect handshake timed out".into())),
                    );
                    reconnect_delay = std::cmp::min(reconnect_delay * 2, MAX_RECONNECT_DELAY);
                }
            }
        }
    }
    session.cancel();
    if inner.state() != SessionState::Failed && !cancel.is_cancelled() {
        inner.set(SessionState::Stopped, None);
    }
}
