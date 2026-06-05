use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum IpKind {
    Public,
    Private,
    Loopback,
    BlockedMetadata,
}

fn ip_kind(ip: IpAddr) -> IpKind {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            if v.is_link_local() {
                return IpKind::BlockedMetadata;
            }
            if v.is_loopback() || v.is_unspecified() || v.is_broadcast() || v.is_multicast() {
                return IpKind::Loopback;
            }
            if o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
            {
                return IpKind::Private;
            }
            IpKind::Public
        }
        IpAddr::V6(v) => {
            if v.is_loopback() || v.is_unspecified() || v.is_multicast() {
                return IpKind::Loopback;
            }
            let segs = v.segments();
            if segs[0] == 0xfd00 && segs[1] == 0xec2 {
                return IpKind::BlockedMetadata;
            }
            if segs[0] & 0xffc0 == 0xfe80 {
                return IpKind::BlockedMetadata;
            }
            if segs[0] & 0xfe00 == 0xfc00 {
                return IpKind::Private;
            }
            IpKind::Public
        }
    }
}

fn is_blocked_host_name(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "metadata.google.internal" | "metadata" | "metadata.azure.com"
    )
}

fn parse_and_check_static(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("scheme not allowed: {s}")),
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("userinfo in url is not allowed".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?;
    if is_blocked_host_name(host) {
        return Err(format!("host not allowed: {host}"));
    }
    Ok(parsed)
}

fn worst_kind(ips: &[IpAddr]) -> IpKind {
    let mut worst = IpKind::Public;
    for ip in ips {
        let k = ip_kind(*ip);
        worst = match (worst, k) {
            (_, IpKind::BlockedMetadata) | (IpKind::BlockedMetadata, _) => IpKind::BlockedMetadata,
            (IpKind::Public, x) => x,
            (x, IpKind::Public) => x,
            (a, _) => a,
        };
    }
    worst
}

fn check_kind(host: &str, ips: &[IpAddr], allow_private: bool) -> Result<(), String> {
    match worst_kind(ips) {
        IpKind::BlockedMetadata => Err(format!("host not allowed: {host}")),
        IpKind::Loopback | IpKind::Private if !allow_private => Err(format!(
            "host {host} resolves to a private/loopback address; not allowed for this provider"
        )),
        _ => Ok(()),
    }
}

fn is_safe(ip: IpAddr, allow_private: bool) -> bool {
    match ip_kind(ip) {
        IpKind::BlockedMetadata => false,
        IpKind::Loopback | IpKind::Private => allow_private,
        IpKind::Public => true,
    }
}

async fn resolve_ips(host: &str) -> Result<Vec<IpAddr>, String> {
    let host_owned = host.to_string();
    let ips = tokio::task::spawn_blocking(move || {
        (host_owned.as_str(), 0u16)
            .to_socket_addrs()
            .map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("dns: {e}"))?;
    if ips.is_empty() {
        return Err("dns: no addresses".into());
    }
    Ok(ips)
}

async fn validate_and_resolve(
    url: &str,
    allow_private: bool,
) -> Result<(String, Vec<IpAddr>, bool), String> {
    let parsed = parse_and_check_static(url)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?
        .to_string();
    let (ips, is_literal) = match host.parse::<IpAddr>() {
        Ok(ip) => (vec![ip], true),
        Err(_) => (resolve_ips(&host).await?, false),
    };
    check_kind(&host, &ips, allow_private)?;
    Ok((host, ips, is_literal))
}

pub async fn guarded_client(url: &str, allow_private: bool) -> Result<reqwest::Client, String> {
    let (host, ips, is_literal) = validate_and_resolve(url, allow_private).await?;

    let origin_host = host.clone();
    let mut builder = reqwest::Client::builder()
        .pool_idle_timeout(Some(Duration::from_secs(90)))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(Some(Duration::from_secs(30)))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error("too many redirects");
            }
            let next = attempt.url();
            match next.scheme() {
                "http" | "https" => {}
                _ => return attempt.stop(),
            }
            match next.host_str() {
                Some(h) if h == origin_host => attempt.follow(),
                _ => attempt.stop(),
            }
        }));

    if !is_literal {
        let safe: Vec<SocketAddr> = ips
            .into_iter()
            .filter(|ip| is_safe(*ip, allow_private))
            .map(|ip| SocketAddr::new(ip, 0))
            .collect();
        if safe.is_empty() {
            return Err(format!("host {host}: no safe IPs"));
        }
        builder = builder.resolve_to_addrs(&host, &safe);
    }

    builder.build().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    fn v4(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    #[test]
    fn classifies_v4_ranges() {
        assert_eq!(ip_kind(v4(169, 254, 169, 254)), IpKind::BlockedMetadata);
        assert_eq!(ip_kind(v4(127, 0, 0, 1)), IpKind::Loopback);
        assert_eq!(ip_kind(v4(10, 0, 0, 5)), IpKind::Private);
        assert_eq!(ip_kind(v4(192, 168, 1, 2)), IpKind::Private);
        assert_eq!(ip_kind(v4(172, 16, 0, 1)), IpKind::Private);
        assert_eq!(ip_kind(v4(1, 1, 1, 1)), IpKind::Public);
    }

    #[test]
    fn classifies_v6() {
        assert_eq!(ip_kind(IpAddr::V6(Ipv6Addr::LOCALHOST)), IpKind::Loopback);
        assert_eq!(
            ip_kind(IpAddr::V6(Ipv6Addr::new(
                0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254
            ))),
            IpKind::BlockedMetadata
        );
        assert_eq!(
            ip_kind(IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1))),
            IpKind::BlockedMetadata
        );
    }

    #[test]
    fn rejects_bad_scheme_and_userinfo() {
        assert!(parse_and_check_static("ftp://example.com").is_err());
        assert!(parse_and_check_static("http://user:pw@example.com").is_err());
        assert!(parse_and_check_static("https://api.openai.com/v1").is_ok());
    }

    #[test]
    fn rejects_blocked_hostnames() {
        assert!(parse_and_check_static("http://metadata.google.internal/").is_err());
    }

    #[tokio::test]
    async fn metadata_ip_blocked_even_when_private_allowed() {
        assert!(
            guarded_client("http://169.254.169.254/latest/meta-data", true)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn loopback_allowed_only_when_private_allowed() {
        assert!(
            guarded_client("http://127.0.0.1:11434/v1/chat/completions", true)
                .await
                .is_ok()
        );
        assert!(
            guarded_client("http://127.0.0.1:11434/v1/chat/completions", false)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn private_lan_blocked_for_remote() {
        assert!(guarded_client("http://10.0.0.5:8080", false).await.is_err());
        assert!(guarded_client("http://10.0.0.5:8080", true).await.is_ok());
    }

    #[tokio::test]
    async fn public_literal_allowed() {
        assert!(guarded_client("https://1.1.1.1/v1", false).await.is_ok());
    }
}
