//! Host-side end-to-end probe for `datum-connect-core`.
//!
//! Uses the same API as the iOS Network Extension (`start_session`,
//! `write_packet`, `PacketSink::on_packet`, `status`, `stop`) and sends ICMPv6
//! echo requests from the binding's client `/128` to a VPC address.
//!
//! Reads one JSON object on stdin (never a file, because it carries the
//! Connector secret key):
//!
//! ```json
//! {"secretKeyHex":"…","network":"default","gatewayEndpointId":"…",
//!  "relayUrls":["https://…"],"homeRelayUrls":["https://…"],
//!  "clientAddress":"fd…/128","gatewayAddress":"fd…/128",
//!  "routes":["fd20:0:10::/48"],"mtu":1280,
//!  "targets":["fd20:0:10:1:0:1::"],"count":3,"timeoutSeconds":5}
//! ```
//!
//! Exit status 0 means at least one echo reply arrived from a target.

use std::{
    io::Read,
    net::Ipv6Addr,
    process::ExitCode,
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};

use datum_connect_core::{
    LogLevel, LogSink, PacketSink, SessionConfig, SessionStatus, StatusObserver, set_log_sink,
    start_session,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    secret_key_hex: String,
    network: String,
    gateway_endpoint_id: String,
    relay_urls: Vec<String>,
    #[serde(default)]
    home_relay_urls: Vec<String>,
    client_address: String,
    gateway_address: String,
    routes: Vec<String>,
    mtu: u16,
    targets: Vec<String>,
    #[serde(default = "default_count")]
    count: u16,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
    /// Optional TCP ports to probe with a SYN on each target (diagnostic:
    /// distinguishes "no ICMP responder" from "no path").
    #[serde(default)]
    tcp_ports: Vec<u16>,
}
fn default_count() -> u16 {
    3
}
fn default_timeout() -> u64 {
    5
}

struct Sink(mpsc::Sender<Vec<u8>>);
impl PacketSink for Sink {
    fn on_packet(&self, packet: Vec<u8>) {
        let _ = self.0.send(packet);
    }
}

struct Observer;
impl StatusObserver for Observer {
    fn on_status(&self, status: SessionStatus) {
        println!(
            "status: state={:?} session_id={} address={} routes={:?} mtu={} capacity={} error={}",
            status.state,
            status.session_id.as_deref().unwrap_or("-"),
            status.client_address,
            status.routes,
            status.mtu,
            status.datagram_capacity,
            status.last_error.as_deref().unwrap_or("-")
        );
    }
}

struct Stderr;
impl LogSink for Stderr {
    fn log(&self, level: LogLevel, message: String) {
        eprintln!("[{level:?}] {message}");
    }
}

fn main() -> ExitCode {
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() {
        eprintln!("probe: could not read stdin");
        return ExitCode::from(2);
    }
    let input: Input = match serde_json::from_str(&raw) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("probe: invalid input JSON: {error}");
            return ExitCode::from(2);
        }
    };
    drop(raw);
    set_log_sink(
        Arc::new(Stderr),
        std::env::var("PROBE_LOG").unwrap_or_else(|_| "info".into()),
    );

    let secret_key = match hex_decode(&input.secret_key_hex) {
        Some(key) => key,
        None => {
            eprintln!("probe: secretKeyHex must be 64 hex characters");
            return ExitCode::from(2);
        }
    };
    let source: Ipv6Addr = match input
        .client_address
        .split('/')
        .next()
        .and_then(|a| a.parse().ok())
    {
        Some(address) => address,
        None => {
            eprintln!("probe: invalid clientAddress");
            return ExitCode::from(2);
        }
    };
    let config = SessionConfig {
        secret_key,
        network: input.network.clone(),
        gateway_endpoint_id: input.gateway_endpoint_id.clone(),
        relay_urls: input.relay_urls.clone(),
        home_relay_urls: input.home_relay_urls.clone(),
        client_address: input.client_address.clone(),
        gateway_address: input.gateway_address.clone(),
        routes: input.routes.clone(),
        mtu: input.mtu,
    };

    let (tx, rx) = mpsc::channel();
    println!(
        "probe: starting session network={} gateway={} client={} routes={:?}",
        input.network, input.gateway_endpoint_id, input.client_address, input.routes
    );
    let started = Instant::now();
    let session = match start_session(config, Arc::new(Sink(tx)), Arc::new(Observer)) {
        Ok(session) => session,
        Err(error) => {
            println!("probe: start_session failed ({}): {error}", error.code());
            return ExitCode::from(1);
        }
    };
    println!(
        "probe: session connected in {} ms",
        started.elapsed().as_millis()
    );

    let identifier: u16 = std::process::id() as u16;
    let mut replies = 0;
    for target in &input.targets {
        let Ok(destination) = target.parse::<Ipv6Addr>() else {
            println!("probe: skipping invalid target {target}");
            continue;
        };
        for sequence in 1..=input.count {
            let payload = format!("datum-connect-core probe {sequence}");
            let packet = echo_request(
                source,
                destination,
                identifier,
                sequence,
                payload.as_bytes(),
            );
            let sent_at = Instant::now();
            session.write_packet(packet);
            let deadline = sent_at + Duration::from_secs(input.timeout_seconds);
            let mut matched = false;
            while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                let Ok(reply) = rx.recv_timeout(remaining) else {
                    break;
                };
                if let Some((from, id, seq, hop_limit)) = parse_echo_reply(&reply)
                    && from == destination
                    && id == identifier
                    && seq == sequence
                {
                    println!(
                        "{} bytes from {from}: icmp_seq={seq} hlim={hop_limit} time={:.1} ms",
                        reply.len() - 40,
                        sent_at.elapsed().as_secs_f64() * 1000.0
                    );
                    matched = true;
                    replies += 1;
                    break;
                }
                println!(
                    "probe: ignoring packet ({} bytes, next header {})",
                    reply.len(),
                    reply.get(6).copied().unwrap_or(0)
                );
            }
            if !matched {
                println!("Request timeout for {destination} icmp_seq={sequence}");
            }
        }
    }
    for target in &input.targets {
        let Ok(destination) = target.parse::<Ipv6Addr>() else {
            continue;
        };
        for &port in &input.tcp_ports {
            let source_port = 40000 + (identifier % 20000);
            let packet = tcp_syn(source, destination, source_port, port, 0x5eed_0001);
            let sent_at = Instant::now();
            session.write_packet(packet);
            let deadline = sent_at + Duration::from_secs(input.timeout_seconds);
            let mut outcome = "no answer".to_owned();
            while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                let Ok(reply) = rx.recv_timeout(remaining) else {
                    break;
                };
                if let Some((from, sport, dport, flags)) = parse_tcp(&reply)
                    && from == destination
                    && sport == port
                    && dport == source_port
                {
                    outcome = match flags & 0x16 {
                        0x12 => "SYN-ACK (port open)".into(),
                        f if f & 0x04 != 0 => "RST (host reachable, port closed)".into(),
                        f => format!("flags {f:#x}"),
                    };
                    break;
                }
            }
            println!(
                "tcp {destination} port {port}: {outcome} after {:.1} ms",
                sent_at.elapsed().as_secs_f64() * 1000.0
            );
        }
    }
    let status = session.status();
    println!(
        "probe: totals sent={} received={} dropped={} reconnects={} session_id={}",
        status.packets_sent,
        status.packets_received,
        status.packets_dropped,
        status.reconnects,
        status.session_id.as_deref().unwrap_or("-")
    );
    session.stop();
    if replies > 0 {
        println!("probe: PASS ({replies} echo replies)");
        ExitCode::SUCCESS
    } else {
        println!("probe: FAIL (no echo reply)");
        ExitCode::from(1)
    }
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    let value = value.trim();
    if value.len() != 64 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).ok())
        .collect()
}

/// IPv6 + ICMPv6 Echo Request (type 128) with a correct checksum.
fn echo_request(
    source: Ipv6Addr,
    destination: Ipv6Addr,
    identifier: u16,
    sequence: u16,
    payload: &[u8],
) -> Vec<u8> {
    let icmp_len = 8 + payload.len();
    let mut packet = Vec::with_capacity(40 + icmp_len);
    packet.extend_from_slice(&[0x60, 0, 0, 0]);
    packet.extend_from_slice(&(icmp_len as u16).to_be_bytes());
    packet.push(58); // next header: ICMPv6
    packet.push(64); // hop limit
    packet.extend_from_slice(&source.octets());
    packet.extend_from_slice(&destination.octets());
    packet.extend_from_slice(&[128, 0, 0, 0]);
    packet.extend_from_slice(&identifier.to_be_bytes());
    packet.extend_from_slice(&sequence.to_be_bytes());
    packet.extend_from_slice(payload);
    let checksum = icmpv6_checksum(source, destination, &packet[40..]);
    packet[42..44].copy_from_slice(&checksum.to_be_bytes());
    packet
}

fn icmpv6_checksum(source: Ipv6Addr, destination: Ipv6Addr, message: &[u8]) -> u16 {
    transport_checksum(source, destination, 58, message)
}

/// RFC 8200 upper-layer checksum over the IPv6 pseudo-header.
fn transport_checksum(
    source: Ipv6Addr,
    destination: Ipv6Addr,
    next_header: u8,
    message: &[u8],
) -> u16 {
    let mut sum: u32 = 0;
    let mut add = |bytes: &[u8]| {
        for chunk in bytes.chunks(2) {
            let word = if chunk.len() == 2 {
                u16::from_be_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], 0])
            };
            sum += u32::from(word);
        }
    };
    add(&source.octets());
    add(&destination.octets());
    add(&(message.len() as u32).to_be_bytes());
    add(&[0, 0, 0, next_header]);
    add(message);
    while sum > 0xffff {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

/// IPv6 + TCP SYN (no options) with a correct checksum.
fn tcp_syn(source: Ipv6Addr, destination: Ipv6Addr, sport: u16, dport: u16, seq: u32) -> Vec<u8> {
    let mut packet = Vec::with_capacity(60);
    packet.extend_from_slice(&[0x60, 0, 0, 0]);
    packet.extend_from_slice(&20u16.to_be_bytes());
    packet.push(6); // next header: TCP
    packet.push(64);
    packet.extend_from_slice(&source.octets());
    packet.extend_from_slice(&destination.octets());
    packet.extend_from_slice(&sport.to_be_bytes());
    packet.extend_from_slice(&dport.to_be_bytes());
    packet.extend_from_slice(&seq.to_be_bytes());
    packet.extend_from_slice(&0u32.to_be_bytes());
    packet.extend_from_slice(&[0x50, 0x02]); // data offset 5, SYN
    packet.extend_from_slice(&64240u16.to_be_bytes());
    packet.extend_from_slice(&[0, 0, 0, 0]); // checksum, urgent
    let checksum = transport_checksum(source, destination, 6, &packet[40..]);
    packet[56..58].copy_from_slice(&checksum.to_be_bytes());
    packet
}

/// (source, source port, destination port, flags) of a TCP segment.
fn parse_tcp(packet: &[u8]) -> Option<(Ipv6Addr, u16, u16, u8)> {
    if packet.len() < 60 || packet[0] >> 4 != 6 || packet[6] != 6 {
        return None;
    }
    let source = Ipv6Addr::from(<[u8; 16]>::try_from(&packet[8..24]).ok()?);
    Some((
        source,
        u16::from_be_bytes([packet[40], packet[41]]),
        u16::from_be_bytes([packet[42], packet[43]]),
        packet[53],
    ))
}

/// (source, identifier, sequence, hop limit) of an ICMPv6 Echo Reply (type 129).
fn parse_echo_reply(packet: &[u8]) -> Option<(Ipv6Addr, u16, u16, u8)> {
    if packet.len() < 48 || packet[0] >> 4 != 6 || packet[6] != 58 || packet[40] != 129 {
        return None;
    }
    let source = Ipv6Addr::from(<[u8; 16]>::try_from(&packet[8..24]).ok()?);
    let identifier = u16::from_be_bytes([packet[44], packet[45]]);
    let sequence = u16::from_be_bytes([packet[46], packet[47]]);
    Some((source, identifier, sequence, packet[7]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_request_checksum_verifies() {
        let source: Ipv6Addr = "fd2c::1".parse().unwrap();
        let destination: Ipv6Addr = "fd20:0:10::1".parse().unwrap();
        let packet = echo_request(source, destination, 7, 1, b"hello");
        // Summing the message with its checksum in place yields zero.
        assert_eq!(icmpv6_checksum(source, destination, &packet[40..]), 0);
        assert_eq!(packet.len(), 40 + 8 + 5);
    }

    #[test]
    fn parses_echo_reply() {
        let source: Ipv6Addr = "fd20:0:10::1".parse().unwrap();
        let mut reply = echo_request(source, "fd2c::1".parse().unwrap(), 9, 4, b"x");
        reply[40] = 129;
        assert_eq!(parse_echo_reply(&reply), Some((source, 9, 4, 64)));
    }
}
