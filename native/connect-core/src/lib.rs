//! Datum Connect CONNECT-IP client core for the iOS Network Extension.
//!
//! A thin UniFFI surface over `connect-transport` (the same crate
//! `datum-connectd` uses). The control plane (Connector, ConnectGateway,
//! ConnectNetworkBinding, Lease) is handled by the app; this crate only opens
//! the CONNECT-IP session the binding approved, verifies the gateway's grant
//! the way the daemon does, and moves IP packets.
//!
//! ```text
//! start_session(config, sink, observer) -> Session
//! session.write_packet(bytes) / write_packets([bytes])   packets in (from packetFlow)
//! sink.on_packet(bytes)                                  packets out (to packetFlow)
//! session.status() / session.stop()
//! observer.on_status(status)                             state changes and errors
//! ```

mod config;
mod logging;
mod session;

pub use logging::{LogLevel, LogSink, set_log_sink};
pub use session::Session;

uniffi::setup_scaffolding!();

/// Everything the gateway's `ConnectNetworkBinding` status approved, plus the
/// device's Connector key.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SessionConfig {
    /// The Connector's iroh (ed25519) secret key: 32 raw bytes.
    pub secret_key: Vec<u8>,
    /// The Network name; sent as the CONNECT-IP network selector.
    pub network: String,
    /// `status.endpointID` of the binding (the gateway's public key, hex).
    pub gateway_endpoint_id: String,
    /// `status.relayURLs` of the binding: how to reach the gateway.
    pub relay_urls: Vec<String>,
    /// Relays for this device's own endpoint. Empty uses iroh's default relay
    /// map; staging passes the Datum staging relays, as the daemon does.
    pub home_relay_urls: Vec<String>,
    /// `status.assignedAddress`: this device's IPv6 `/128`.
    pub client_address: String,
    /// `status.peerAddress`: the gateway's IPv6 `/128`.
    pub gateway_address: String,
    /// `status.routes`: the approved VPC prefixes.
    pub routes: Vec<String>,
    /// The approved IP MTU (the daemon uses 1280 for managed gateways).
    pub mtu: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SessionState {
    Connecting,
    Connected,
    Reconnecting,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SessionStatus {
    pub state: SessionState,
    /// Shared with the gateway's logs (`session_id`).
    pub session_id: Option<String>,
    pub client_address: String,
    pub gateway_address: String,
    pub routes: Vec<String>,
    pub mtu: u16,
    /// Packets handed to the transport (device to VPC).
    pub packets_sent: u64,
    /// Packets delivered to the sink (VPC to device).
    pub packets_received: u64,
    /// Packets refused locally: invalid, too large, outside the grant, or a
    /// full send queue.
    pub packets_dropped: u64,
    pub datagram_capacity: u64,
    pub reconnects: u64,
    pub last_error: Option<String>,
    /// Stable machine code for `last_error` (the daemon's error codes).
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, thiserror::Error, uniffi::Error)]
pub enum ConnectError {
    #[error("{detail}")]
    InvalidConfig { detail: String },
    #[error("{detail}")]
    RelayUnavailable { detail: String },
    #[error("{detail}")]
    DatagramsUnsupported { detail: String },
    #[error("{detail}")]
    DatagramMtuInsufficient { detail: String },
    #[error("{detail}")]
    GatewayApprovalRequired { detail: String },
    #[error("{detail}")]
    GatewaySetupFailed { detail: String },
    #[error("{detail}")]
    GrantMismatch { detail: String },
    #[error("{detail}")]
    Handshake { detail: String },
    #[error("{detail}")]
    Timeout { detail: String },
    #[error("the session is stopped")]
    Stopped,
}

impl ConnectError {
    /// The daemon's `ApiError` code for the same failure.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfig { .. } => "invalid_config",
            Self::RelayUnavailable { .. } => "relay_unavailable",
            Self::DatagramsUnsupported { .. } => "local_ip_datagrams_unsupported",
            Self::DatagramMtuInsufficient { .. } => "local_ip_datagram_mtu_insufficient",
            Self::GatewayApprovalRequired { .. } => "local_ip_gateway_approval_required",
            Self::GatewaySetupFailed { .. } => "local_ip_gateway_setup_failed",
            Self::GrantMismatch { .. } => "local_ip_grant_mismatch",
            Self::Handshake { .. } => "local_ip_handshake_failed",
            Self::Timeout { .. } => "timeout",
            Self::Stopped => "stopped",
        }
    }
}

/// Packets from the gateway, ready for `NEPacketTunnelFlow.writePackets`.
/// Called on a transport thread; implementations must be thread-safe.
#[uniffi::export(with_foreign)]
pub trait PacketSink: Send + Sync {
    fn on_packet(&self, packet: Vec<u8>);
}

/// Session state changes, including terminal errors.
#[uniffi::export(with_foreign)]
pub trait StatusObserver: Send + Sync {
    fn on_status(&self, status: SessionStatus);
}

/// Validate a configuration without connecting (for the app's pre-flight).
#[uniffi::export]
pub fn validate_config(config: SessionConfig) -> Result<(), ConnectError> {
    config::validate(&config).map(|_| ())
}

/// The iroh public key (hex, the Connector `spec.publicKey`) for a secret key.
#[uniffi::export]
pub fn public_key_for(secret_key: Vec<u8>) -> Result<String, ConnectError> {
    let key: [u8; 32] =
        secret_key
            .as_slice()
            .try_into()
            .map_err(|_| ConnectError::InvalidConfig {
                detail: "the Connector secret key must be exactly 32 bytes".into(),
            })?;
    Ok(iroh::SecretKey::from_bytes(&key).public().to_string())
}

/// Connect to the gateway, verify its grant and start moving packets.
///
/// Blocks until the CONNECT-IP session is negotiated (at most ~30 s: relay
/// readiness then the handshake). Call it off the main thread.
#[uniffi::export]
pub fn start_session(
    config: SessionConfig,
    sink: std::sync::Arc<dyn PacketSink>,
    observer: std::sync::Arc<dyn StatusObserver>,
) -> Result<std::sync::Arc<Session>, ConnectError> {
    session::start(config, sink, observer)
}
