//! Validation of the managed-VPC session configuration.
//!
//! Mirrors the checks `datum-connectd` applies before it opens CONNECT-IP for a
//! `ConnectNetworkBinding` (connect v1.0.0-preview.28):
//!
//! - `daemon/src/runtime.rs` `join_network`: client and gateway addresses must be
//!   IPv6 `/128`;
//! - `daemon/src/local_ip.rs` `Binding::parsed_routes`: 1..=32 unique, canonical,
//!   same-family routes, no default route;
//! - `daemon/src/relays.rs` `parse`: HTTPS relay origins only, deduplicated;
//! - `ip-adapter/src/helper.rs` `ManagedPolicy::managed_vpc_default().approve`:
//!   ULA (`fc00::/7`) host addresses and routes, routes `/16` or narrower,
//!   MTU 1280..=1500, at most 32 routes.
//!
//! On iOS the system VPN consent plus the user's tap stand in for the macOS
//! helper's administrator approval, so the managed policy is enforced here
//! instead of in a root helper.

use std::{collections::HashSet, net::IpAddr};

use connect_transport::ip::IpPrefix;
use ipnet::{IpNet, Ipv6Net};
use iroh::{EndpointId, RelayUrl, SecretKey};

use crate::ConnectError;

/// The managed VPC policy's host-address and route range.
const ULA: &str = "fc00::/7";
const MINIMUM_ROUTE_PREFIX: u8 = 16;
const MAX_ROUTES: usize = 32;

/// A validated configuration, ready for the transport.
#[derive(Debug, Clone)]
pub(crate) struct Validated {
    pub secret_key: SecretKey,
    pub network: String,
    pub gateway: EndpointId,
    pub relay_urls: Vec<RelayUrl>,
    pub home_relay_urls: Vec<RelayUrl>,
    pub client_address: Ipv6Net,
    pub gateway_address: Ipv6Net,
    pub routes: Vec<IpPrefix>,
    pub mtu: u16,
}

fn invalid(message: impl Into<String>) -> ConnectError {
    ConnectError::InvalidConfig {
        message: message.into(),
    }
}

pub(crate) fn validate(config: &crate::SessionConfig) -> Result<Validated, ConnectError> {
    let key: [u8; 32] = config
        .secret_key
        .as_slice()
        .try_into()
        .map_err(|_| invalid("the Connector secret key must be exactly 32 bytes"))?;
    let secret_key = SecretKey::from_bytes(&key);

    if !valid_network(&config.network) {
        return Err(invalid("the network name is not a valid resource name"));
    }
    let gateway: EndpointId = config
        .gateway_endpoint_id
        .trim()
        .parse()
        .map_err(|_| invalid("the gateway endpoint ID is not a valid public key"))?;

    // Binding status may legitimately carry no relays when the gateway has a
    // public underlay; the daemon then relies on discovery. Keep that behaviour.
    let relay_urls = parse_relays(&config.relay_urls)?;
    let home_relay_urls = parse_relays(&config.home_relay_urls)?;

    let client_address = host_address(&config.client_address, "client")?;
    let gateway_address = host_address(&config.gateway_address, "gateway")?;
    if client_address == gateway_address {
        return Err(invalid(
            "the client and gateway addresses must be different",
        ));
    }

    if config.routes.is_empty() || config.routes.len() > MAX_ROUTES {
        return Err(invalid("a VPC attachment needs 1 to 32 approved routes"));
    }
    let ula: Ipv6Net = ULA.parse().expect("valid ULA range");
    let mut seen = HashSet::new();
    let mut routes = Vec::with_capacity(config.routes.len());
    for raw in &config.routes {
        let net: IpNet = raw
            .trim()
            .parse()
            .map_err(|_| invalid(format!("route {raw:?} is not a CIDR prefix")))?;
        let IpNet::V6(net) = net else {
            return Err(invalid(
                "every route must be IPv6, the same family as the assigned address",
            ));
        };
        if net.prefix_len() == 0
            || net.addr() != net.network()
            || net.network().is_unspecified()
            || net.network().is_loopback()
            || net.network().is_multicast()
            || !seen.insert(net)
        {
            return Err(invalid(
                "routes must be unique canonical unicast prefixes; default routes are forbidden",
            ));
        }
        if net.prefix_len() < MINIMUM_ROUTE_PREFIX
            || !(net.prefix_len() >= ula.prefix_len() && ula.contains(&net.network()))
        {
            return Err(invalid(
                "VPC routes must be IPv6 ULA prefixes of /16 or narrower",
            ));
        }
        // The transport's own canonical form; the grant is compared in it.
        let prefix: IpPrefix = net.to_string().parse().map_err(|_| {
            invalid(format!(
                "route {raw:?} is outside the CONNECT-IP route policy"
            ))
        })?;
        routes.push(prefix);
    }

    if !(1280..=1500).contains(&config.mtu) {
        return Err(invalid("the approved MTU must be between 1280 and 1500"));
    }

    Ok(Validated {
        secret_key,
        network: config.network.clone(),
        gateway,
        relay_urls,
        home_relay_urls,
        client_address,
        gateway_address,
        routes,
        mtu: config.mtu,
    })
}

fn host_address(raw: &str, which: &str) -> Result<Ipv6Net, ConnectError> {
    let net: IpNet = raw
        .trim()
        .parse()
        .map_err(|_| invalid(format!("the {which} address must be an IPv6 /128 CIDR")))?;
    let IpNet::V6(net) = net else {
        return Err(invalid(format!("the {which} address must be IPv6 /128")));
    };
    if net.prefix_len() != 128 {
        return Err(invalid(format!("the {which} address must be IPv6 /128")));
    }
    let ula: Ipv6Net = ULA.parse().expect("valid ULA range");
    if !ula.contains(&net.addr()) {
        return Err(invalid(format!(
            "the {which} address is outside the managed VPC range (IPv6 ULA)"
        )));
    }
    Ok(net)
}

/// `daemon/src/relays.rs` `parse`, without the empty-list rejection (an empty
/// list means "no explicit relays" here).
pub(crate) fn parse_relays(raw: &[String]) -> Result<Vec<RelayUrl>, ConnectError> {
    let mut relays = Vec::new();
    for value in raw.iter().map(|value| value.trim()) {
        let relay = value
            .parse::<RelayUrl>()
            .map_err(|_| invalid("relay URLs must be HTTPS origins"))?;
        if relay.scheme() != "https"
            || relay.host_str().is_none()
            || !relay.username().is_empty()
            || relay.password().is_some()
            || relay.query().is_some()
            || relay.fragment().is_some()
            || relay.path() != "/"
        {
            return Err(invalid(
                "relay URLs must be HTTPS origins without credentials, paths, queries, or fragments",
            ));
        }
        if !relays.contains(&relay) {
            relays.push(relay);
        }
    }
    if relays.len() > 8 {
        return Err(invalid("at most 8 relay URLs are allowed"));
    }
    Ok(relays)
}

/// Kubernetes-style DNS label, the shape `connect_transport::ip` accepts.
fn valid_network(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 63
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
}

/// The daemon's grant check (`local_ip::join`): the authenticated server grant
/// must carry exactly the expected address, MTU and route set.
pub(crate) fn grant_matches(
    expected: &Validated,
    address: IpAddr,
    mtu: u16,
    routes: &[IpPrefix],
) -> bool {
    let actual: HashSet<_> = routes.iter().copied().collect();
    let wanted: HashSet<_> = expected.routes.iter().copied().collect();
    address == IpAddr::V6(expected.client_address.addr()) && mtu == expected.mtu && actual == wanted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SessionConfig;

    fn config() -> SessionConfig {
        SessionConfig {
            secret_key: vec![7; 32],
            network: "default".into(),
            gateway_endpoint_id: "1cb8b6b096c8f2d73655daa468234e138a5eb19084fbf324e7dcc7f1b1461c47"
                .into(),
            relay_urls: vec![
                "https://iroh-relay.us-central-1.datum-staging.net".into(),
                "https://iroh-relay.us-east-1.datum-staging.net".into(),
            ],
            home_relay_urls: vec![],
            client_address: "fd2c:45a:1e7c:b93f:1f44:bdde:5e68:4b53/128".into(),
            gateway_address: "fd9b:faa:407d:f339:afee:bcea:d03f:b9d9/128".into(),
            routes: vec!["fd20:0:2b::/48".into()],
            mtu: 1280,
        }
    }

    #[test]
    fn accepts_a_real_binding_status() {
        let valid = validate(&config()).unwrap();
        assert_eq!(valid.relay_urls.len(), 2);
        assert_eq!(valid.routes[0].to_string(), "fd20:0:2b::/48");
        assert!(grant_matches(
            &valid,
            "fd2c:45a:1e7c:b93f:1f44:bdde:5e68:4b53".parse().unwrap(),
            1280,
            &["fd20:0:2b::/48".parse().unwrap()]
        ));
    }

    #[test]
    fn grant_must_match_exactly() {
        let valid = validate(&config()).unwrap();
        let address = "fd2c:45a:1e7c:b93f:1f44:bdde:5e68:4b53".parse().unwrap();
        let route = ["fd20:0:2b::/48".parse().unwrap()];
        assert!(!grant_matches(
            &valid,
            "fd2c::1".parse().unwrap(),
            1280,
            &route
        ));
        assert!(!grant_matches(&valid, address, 1400, &route));
        assert!(!grant_matches(
            &valid,
            address,
            1280,
            &["fd20:0:2c::/48".parse().unwrap()]
        ));
        assert!(!grant_matches(
            &valid,
            address,
            1280,
            &[route[0], "fd20:0:2c::/48".parse().unwrap()]
        ));
    }

    #[test]
    fn rejects_outside_the_managed_policy() {
        type Mutation = Box<dyn Fn(&mut SessionConfig)>;
        let cases: Vec<Mutation> = vec![
            Box::new(|c| c.secret_key = vec![1; 31]),
            Box::new(|c| c.gateway_endpoint_id = "not-a-key".into()),
            Box::new(|c| c.client_address = "fd2c::1/64".into()),
            Box::new(|c| c.client_address = "10.0.0.1/32".into()),
            Box::new(|c| c.client_address = "2001:db8::1/128".into()),
            Box::new(|c| c.gateway_address = c.client_address.clone()),
            Box::new(|c| c.routes = vec![]),
            Box::new(|c| c.routes = vec!["::/0".into()]),
            Box::new(|c| c.routes = vec!["2001:db8::/32".into()]),
            Box::new(|c| c.routes = vec!["fc00::/7".into()]),
            Box::new(|c| c.routes = vec!["fd20:0:2b::1/48".into()]),
            Box::new(|c| c.routes = vec!["fd20::/48".into(), "fd20::/48".into()]),
            Box::new(|c| c.routes = vec!["10.0.0.0/8".into()]),
            Box::new(|c| c.mtu = 1200),
            Box::new(|c| c.mtu = 9000),
            Box::new(|c| c.relay_urls = vec!["http://relay.example.com".into()]),
            Box::new(|c| c.relay_urls = vec!["https://relay.example.com/path".into()]),
            Box::new(|c| c.network = "Bad_Name".into()),
        ];
        for (index, mutate) in cases.iter().enumerate() {
            let mut c = config();
            mutate(&mut c);
            assert!(validate(&c).is_err(), "case {index} should be rejected");
        }
    }

    #[test]
    fn relays_are_deduplicated() {
        let relays = parse_relays(&[
            "https://relay.example.com".into(),
            "https://relay.example.com/".into(),
        ])
        .unwrap();
        assert_eq!(relays.len(), 1);
    }
}
