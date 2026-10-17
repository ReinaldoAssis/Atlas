//! Descoberta DNS-SD (Windows/macOS).
//!
//! iOS não usa este caminho: lá é Bonjour nativo (P4), porque o mDNS cru exige
//! o entitlement restrito `com.apple.developer.networking.multicast`, que a
//! Apple nega para mDNS direto (`docs/SYNC.md` §2).
//!
//! Serviço `_atlas-sync._udp.local.`, instância `Atlas <6 chars do id>` e TXT
//! com `id=<EndpointID>` + `v=1`. A porta é a do socket UDP do endpoint.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;

use iroh::{Endpoint, EndpointAddr, EndpointId};
use mdns_sd::{Receiver, ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};

pub const SERVICE_TYPE: &str = "_atlas-sync._udp.local.";
pub const TXT_ID: &str = "id";
pub const TXT_VERSION: &str = "v";
pub const ANNOUNCE_VERSION: &str = "1";

/// Anúncio ativo do endpoint local.
pub struct Advertisement {
  daemon: ServiceDaemon,
  fullname: String,
  instance: String,
}

/// Um par descoberto na LAN.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredPeer {
  pub addr: EndpointAddr,
  /// Nome da instância no anúncio (`Atlas <6 chars>`).
  pub name: String,
}

impl Advertisement {
  /// Anuncia o endpoint e devolve também o canal de descoberta.
  ///
  /// O `ServiceDaemon` é um só: anunciar e navegar no mesmo daemon evita duas
  /// cópias do socket multicast.
  pub fn start(endpoint: &Endpoint) -> Result<(Self, Receiver<ServiceEvent>), String> {
    let id = endpoint.id();
    let port = endpoint
      .bound_sockets()
      .first()
      .map(SocketAddr::port)
      .ok_or_else(|| "endpoint sem socket UDP ligado".to_string())?;
    let daemon = ServiceDaemon::new().map_err(|error| format!("mdns: {error}"))?;
    let short = id.fmt_short().to_string();
    let instance = format!("Atlas {short}");
    // Endereços vêm do host (`addr_auto`): o endpoint liga em 0.0.0.0 e o IP
    // real de cada interface só o mdns-sd conhece.
    let info = ServiceInfo::new(
      SERVICE_TYPE,
      &instance,
      &format!("atlas-{short}.local."),
      (),
      port,
      HashMap::from([
        (TXT_ID.to_string(), id.to_string()),
        (TXT_VERSION.to_string(), ANNOUNCE_VERSION.to_string()),
      ]),
    )
    .map_err(|error| format!("mdns: {error}"))?
    .enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    daemon
      .register(info)
      .map_err(|error| format!("mdns register: {error}"))?;
    let receiver = daemon
      .browse(SERVICE_TYPE)
      .map_err(|error| format!("mdns browse: {error}"))?;
    Ok((
      Self {
        daemon,
        fullname,
        instance,
      },
      receiver,
    ))
  }

  /// Nome que este endpoint anuncia (vai no pedido de pareamento).
  pub fn instance_name(&self) -> &str {
    &self.instance
  }

  /// Para de anunciar e fecha o daemon (sai do multicast).
  pub fn stop(self) {
    let _ = self.daemon.unregister(&self.fullname);
    let _ = self.daemon.shutdown();
  }
}

/// Converte um serviço resolvido em endereço dialável; `None` se não for nosso
/// (TXT sem `id` ou id inválido) — nada de confiar no nome da instância.
pub fn parse_resolved(info: &ResolvedService) -> Option<DiscoveredPeer> {
  let id: EndpointId = info.txt_properties.get_property_val_str(TXT_ID)?.parse().ok()?;
  let mut addr = EndpointAddr::new(id);
  let mut seen = HashSet::new();
  for scoped in &info.addresses {
    let ip = scoped.to_ip_addr();
    if !seen.insert(ip) {
      continue;
    }
    addr = addr.with_ip_addr(SocketAddr::new(ip, info.port));
  }
  // O label da instância vem antes do tipo; nomes com ponto são escapados.
  let name = info
    .fullname
    .split('.')
    .next()
    .filter(|name| !name.is_empty())
    .unwrap_or("Atlas")
    .to_string();
  Some(DiscoveredPeer { addr, name })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn service_type_is_dns_sd_shaped() {
    assert!(SERVICE_TYPE.starts_with('_'));
    assert!(SERVICE_TYPE.ends_with("._udp.local."));
  }
}
