//! Pareamento por SAS de 6 dígitos (`atlas/pair/1`).
//!
//! Os dois lados geram um nonce e o código sai de
//! `SHA-256("atlas/sas/1" + ids ordenados + nonce de quem discou + nonce de
//! quem aceitou)`. Ninguém confia no outro: um intermediário (MITM) teria
//! nonces diferentes e os códigos exibidos não bateriam — o humano compara.
//!
//! O ALPN é separado do sync de propósito: pareamento é o único caminho que
//! aceita um par fora da allowlist, e só até alguém confirmar dos dois lados.

use std::time::Duration;

use iroh::endpoint::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::time::timeout;

use super::protocol;

/// ALPN do pareamento.
pub const ALPN: &[u8] = b"atlas/pair/1";
pub const PROTO_VERSION: u32 = 1;

/// Teto de cada passo do handshake (a decisão humana tem o TTL do comando).
pub const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairRequest {
  pub proto: u32,
  pub device_id: String,
  /// Nome que este lado anuncia (vira `sync_peers.name` no outro).
  pub name: String,
  pub nonce: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairResponse {
  pub device_id: String,
  pub name: String,
  pub nonce: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairDecision {
  pub accept: bool,
}

/// Identidade que este lado apresenta no pareamento.
#[derive(Debug, Clone)]
pub struct PairLocal {
  /// EndpointID (chave pública) deste lado, em texto.
  pub endpoint_id: String,
  pub device_id: String,
  pub name: String,
}

/// O que o humano precisa ver antes de confirmar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairOffer {
  pub sas: String,
  pub peer_device_id: String,
  pub peer_name: String,
}

/// Resultado de um pareamento confirmado dos dois lados.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairOutcome {
  pub sas: String,
  pub peer_device_id: String,
  pub peer_name: String,
}

fn new_nonce() -> String {
  let bytes: [u8; 16] = rand::random();
  bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Código de 6 dígitos, igual nos dois lados.
///
/// Os IDs entram ordenados (o papel não muda o resultado); os nonces entram na
/// ordem dos papéis (quem discou primeiro), que cada lado conhece.
pub fn derive_sas(dialer_id: &str, acceptor_id: &str, dialer_nonce: &str, acceptor_nonce: &str) -> String {
  let (first, second) = if dialer_id <= acceptor_id {
    (dialer_id, acceptor_id)
  } else {
    (acceptor_id, dialer_id)
  };
  let mut hasher = Sha256::new();
  hasher.update(b"atlas/sas/1");
  // Prefixo de tamanho evita ambiguidade na concatenação.
  for part in [first, second, dialer_nonce, acceptor_nonce] {
    hasher.update((part.len() as u32).to_be_bytes());
    hasher.update(part.as_bytes());
  }
  let digest = hasher.finalize();
  let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
  format!("{value:06}")
}

fn check_request(request: &PairRequest) -> Result<(), String> {
  if request.proto != PROTO_VERSION {
    return Err(format!(
      "protocolo de pareamento incompatível: local {PROTO_VERSION}, par {}",
      request.proto
    ));
  }
  if request.device_id.trim().is_empty() {
    return Err("pedido de pareamento sem device_id".to_string());
  }
  Ok(())
}

/// Quem discou: manda o pedido, recebe o nonce do outro, exibe o SAS, decide.
pub async fn dial<F, D>(conn: Connection, local: PairLocal, on_offer: F) -> Result<PairOutcome, String>
where
  F: FnOnce(PairOffer) -> D,
  D: std::future::Future<Output = bool>,
{
  let peer_id = conn.remote_id().to_string();
  let (mut send, mut recv, request) = timeout(TIMEOUT, async {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|error| format!("stream: {error}"))?;
    let nonce = new_nonce();
    let request = PairRequest {
      proto: PROTO_VERSION,
      device_id: local.device_id.clone(),
      name: local.name.clone(),
      nonce,
    };
    protocol::write_json(&mut send, &request).await?;
    let response: PairResponse = protocol::read_json(&mut recv).await?;
    Ok::<_, String>((send, recv, (request, response)))
  })
  .await
  .map_err(|_| "timeout no pedido de pareamento".to_string())??;

  let (request, response) = request;
  let sas = derive_sas(&local.endpoint_id, &peer_id, &request.nonce, &response.nonce);
  let accept = on_offer(PairOffer {
    sas: sas.clone(),
    peer_device_id: response.device_id.clone(),
    peer_name: response.name.clone(),
  })
  .await;

  // Quem discou fala primeiro e fecha depois de ler; o acceptor espera esse
  // fechamento antes de fechar também (senão o último frame se perde).
  let both = timeout(TIMEOUT, async {
    protocol::write_json(&mut send, &PairDecision { accept }).await?;
    send.finish().map_err(|error| format!("fim do pareamento: {error}"))?;
    let decision: PairDecision = protocol::read_json(&mut recv).await?;
    Ok::<bool, String>(decision.accept)
  })
  .await
  .map_err(|_| "timeout na confirmação do pareamento".to_string())??;

  conn.close(0u32.into(), b"atlas/pair");
  if accept && both {
    Ok(PairOutcome {
      sas,
      peer_device_id: response.device_id,
      peer_name: response.name,
    })
  } else {
    Err("pareamento cancelado".to_string())
  }
}

/// Quem aceitou: lê o pedido, responde o nonce, exibe o SAS, decide.
pub async fn accept<F, D>(conn: Connection, local: PairLocal, on_offer: F) -> Result<PairOutcome, String>
where
  F: FnOnce(PairOffer) -> D,
  D: std::future::Future<Output = bool>,
{
  let peer_id = conn.remote_id().to_string();
  let (mut send, mut recv, request) = timeout(TIMEOUT, async {
    let (mut send, mut recv) = conn.accept_bi().await.map_err(|error| format!("stream: {error}"))?;
    let request: PairRequest = protocol::read_json(&mut recv).await?;
    check_request(&request)?;
    let response = PairResponse {
      device_id: local.device_id.clone(),
      name: local.name.clone(),
      nonce: new_nonce(),
    };
    protocol::write_json(&mut send, &response).await?;
    Ok::<_, String>((send, recv, (request, response)))
  })
  .await
  .map_err(|_| "timeout no pedido de pareamento".to_string())??;

  let (request, response) = request;
  let sas = derive_sas(&peer_id, &local.endpoint_id, &request.nonce, &response.nonce);
  let accept = on_offer(PairOffer {
    sas: sas.clone(),
    peer_device_id: request.device_id.clone(),
    peer_name: request.name.clone(),
  })
  .await;

  // Lê a decisão de quem discou antes de responder: assim o dialer fecha
  // depois de ler tudo, e este lado espera o fechamento antes de fechar.
  let both = timeout(TIMEOUT, async {
    let decision: PairDecision = protocol::read_json(&mut recv).await?;
    protocol::write_json(&mut send, &PairDecision { accept }).await?;
    send.finish().map_err(|error| format!("fim do pareamento: {error}"))?;
    Ok::<bool, String>(decision.accept)
  })
  .await
  .map_err(|_| "timeout na confirmação do pareamento".to_string())??;

  let _ = timeout(TIMEOUT, conn.closed()).await;
  conn.close(0u32.into(), b"atlas/pair");
  if accept && both {
    Ok(PairOutcome {
      sas,
      peer_device_id: request.device_id,
      peer_name: request.name,
    })
  } else {
    Err("pareamento cancelado".to_string())
  }
}

#[cfg(test)]
mod tests {
  use iroh::{Endpoint, EndpointAddr, SecretKey, endpoint::presets};
  use tokio::time::timeout as tokio_timeout;

  use super::*;

  #[test]
  fn sas_is_six_digits_and_depends_on_both_nonces() {
    let sas = derive_sas("a", "b", "n1", "n2");
    assert_eq!(sas.len(), 6, "SAS precisa ter 6 dígitos: {sas}");
    assert!(sas.chars().all(|c| c.is_ascii_digit()), "SAS não numérico: {sas}");
    assert_eq!(
      sas,
      derive_sas("b", "a", "n1", "n2"),
      "ordem dos ids não muda o SAS"
    );
    assert_ne!(sas, derive_sas("a", "b", "n2", "n1"), "trocar nonces muda o SAS");
    assert_ne!(sas, derive_sas("a", "b", "n1", "n3"), "nonce diferente muda o SAS");
  }

  async fn bind() -> Endpoint {
    Endpoint::builder(presets::Minimal)
      .secret_key(SecretKey::generate())
      .alpns(vec![ALPN.to_vec()])
      .bind()
      .await
      .unwrap()
  }

  fn loopback(endpoint: &Endpoint) -> EndpointAddr {
    let socket = endpoint
      .bound_sockets()
      .into_iter()
      .find(|socket| socket.is_ipv4())
      .expect("socket ipv4");
    EndpointAddr::new(endpoint.id()).with_ip_addr(std::net::SocketAddr::new(
      std::net::Ipv4Addr::LOCALHOST.into(),
      socket.port(),
    ))
  }

  fn local(endpoint: &Endpoint, name: &str) -> PairLocal {
    PairLocal {
      endpoint_id: endpoint.id().to_string(),
      device_id: format!("dev-{name}"),
      name: name.to_string(),
    }
  }

  #[tokio::test]
  async fn both_sides_derive_the_same_sas_and_pair() {
    let a = bind().await;
    let b = bind().await;
    let server = {
      let b = b.clone();
      tokio::spawn(async move {
        let conn = b.accept().await.unwrap().accept().unwrap().await.unwrap();
        accept(conn, local(&b, "iPhone"), |offer| async move {
          assert_eq!(offer.sas.len(), 6);
          assert_eq!(offer.peer_name, "Windows");
          true
        })
        .await
      })
    };
    let conn = a.connect(loopback(&b), ALPN).await.unwrap();
    let (dialed, accepted) = tokio::join!(
      dial(conn, local(&a, "Windows"), |offer| async move {
        assert_eq!(offer.sas.len(), 6);
        assert_eq!(offer.peer_name, "iPhone");
        true
      }),
      server
    );
    let dialed = dialed.unwrap();
    let accepted = accepted.unwrap().unwrap();
    assert_eq!(dialed.sas, accepted.sas, "os dois lados veem o mesmo código");
    assert_eq!(dialed.peer_name, "iPhone");
    assert_eq!(accepted.peer_name, "Windows");
    assert_eq!(dialed.peer_device_id, "dev-iPhone");

    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn rejection_on_either_side_aborts_the_pairing() {
    let a = bind().await;
    let b = bind().await;
    let server = {
      let b = b.clone();
      tokio::spawn(async move {
        let conn = b.accept().await.unwrap().accept().unwrap().await.unwrap();
        accept(conn, local(&b, "iPhone"), |_offer| async move { true }).await
      })
    };
    let conn = a.connect(loopback(&b), ALPN).await.unwrap();
    let (dialed, accepted) = tokio::join!(
      dial(conn, local(&a, "Windows"), |_offer| async move { false }),
      server
    );
    assert!(dialed.is_err(), "quem recusou não pode concluir");
    assert!(
      accepted.unwrap().is_err(),
      "a recusa do outro lado aborta também"
    );

    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn protocol_mismatch_is_refused() {
    let a = bind().await;
    let b = bind().await;
    let server = {
      let b = b.clone();
      tokio::spawn(async move {
        let conn = b.accept().await.unwrap().accept().unwrap().await.unwrap();
        let (mut send, mut recv) = conn.accept_bi().await.unwrap();
        let mut request: PairRequest = protocol::read_json(&mut recv).await.unwrap();
        request.proto = 9;
        let _ = &mut send;
        // O acceptor real recusaria no `check_request`; aqui simulamos o erro
        // chamando a validação direto.
        check_request(&request)
      })
    };
    let conn = a.connect(loopback(&b), ALPN).await.unwrap();
    let dialed = tokio_timeout(
      Duration::from_secs(5),
      dial(conn, local(&a, "Windows"), |_offer| async move { true }),
    )
    .await;
    let refused = server.await.unwrap();
    assert!(refused.is_err());
    assert!(
      dialed.map(|inner| inner.is_err()).unwrap_or(true),
      "sem resposta válida o dialer falha"
    );

    a.close().await;
    b.close().await;
  }
}
