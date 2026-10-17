//! Endpoint iroh e o handshake (P2a).
//!
//! Alcance só LAN: `presets::Minimal` não configura relay nem DNS/Pkarr da n0,
//! então nenhum pacote sai da rede local. A sessão em si (delta por cursor +
//! merge) chega em P2b; aqui só o `hello`, que já prova descoberta, conexão,
//! ALPN, framing e recusa por incompatibilidade.

use std::time::Duration;

use iroh::endpoint::{Connection, presets};
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use tokio::time::timeout;

use super::protocol::{self, Hello, Message};

/// Teto do handshake. Rede local: se passou disso, o par não está lá.
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(5);

/// O que este aparelho apresenta no hello.
#[derive(Debug, Clone)]
pub struct LocalNode {
  /// `PRAGMA user_version` do banco ativo.
  pub schema: u32,
  pub device_id: String,
}

impl LocalNode {
  pub fn hello(&self) -> Hello {
    Hello {
      proto: protocol::PROTO_VERSION,
      schema: self.schema,
      device_id: self.device_id.clone(),
      cursors: Vec::new(),
    }
  }
}

/// Liga o endpoint com a identidade local, sem relay e sem descoberta externa.
pub async fn bind(secret_key: SecretKey) -> Result<Endpoint, String> {
  Endpoint::builder(presets::Minimal)
    .secret_key(secret_key)
    .alpns(vec![protocol::ALPN.to_vec()])
    .bind()
    .await
    .map_err(|error| format!("endpoint: {error}"))
}

/// Diala o par, valida o hello dele e devolve o que ele disse ser.
pub async fn dial(endpoint: &Endpoint, peer: EndpointAddr, local: &LocalNode) -> Result<Hello, String> {
  timeout(HELLO_TIMEOUT, async {
    let conn = endpoint
      .connect(peer, protocol::ALPN)
      .await
      .map_err(|error| format!("conexão: {error}"))?;
    let result = exchange(&conn, local, Role::Dialer).await;
    conn.close(0u32.into(), b"atlas/hello");
    result
  })
  .await
  .map_err(|_| "timeout no hello".to_string())?
}

/// Aceita uma conexão e troca hello. `None` quando o endpoint foi fechado.
pub async fn accept(endpoint: &Endpoint, local: &LocalNode) -> Result<Option<(EndpointId, Hello)>, String> {
  timeout(HELLO_TIMEOUT, async {
    let Some(incoming) = endpoint.accept().await else {
      return Ok(None);
    };
    let mut accepting = incoming
      .accept()
      .map_err(|error| format!("conexão entrante: {error}"))?;
    let alpn = accepting
      .alpn()
      .await
      .map_err(|error| format!("alpn: {error}"))?;
    if alpn.as_slice() != protocol::ALPN {
      return Err(format!("alpn inesperado: {}", String::from_utf8_lossy(&alpn)));
    }
    let conn = accepting
      .await
      .map_err(|error| format!("conexão entrante: {error}"))?;
    let remote = conn.remote_id();
    let result = exchange(&conn, local, Role::Acceptor).await;
    // Sem flush explícito: fechar a conexão logo depois de `finish()` descarta
    // o frame ainda em voo (o dialer lê "connection lost" — inclusive no
    // `Refuse`). Espera o outro lado fechar; ele fecha depois de ler.
    let _ = timeout(Duration::from_secs(5), conn.closed()).await;
    conn.close(0u32.into(), b"atlas/hello");
    result.map(|hello| Some((remote, hello)))
  })
  .await
  .map_err(|_| "timeout no hello".to_string())?
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
  Dialer,
  Acceptor,
}

/// Troca de hello no mesmo stream bidi: quem disca escreve primeiro.
async fn exchange(conn: &Connection, local: &LocalNode, role: Role) -> Result<Hello, String> {
  let (mut send, mut recv) = match role {
    Role::Acceptor => conn.accept_bi().await.map_err(|error| format!("stream: {error}"))?,
    Role::Dialer => conn.open_bi().await.map_err(|error| format!("stream: {error}"))?,
  };

  let remote = match role {
    Role::Dialer => {
      protocol::write_message(&mut send, &Message::Hello(local.hello())).await?;
      match protocol::read_message(&mut recv).await? {
        Message::Hello(hello) => hello,
        Message::Refuse { reason } => return Err(format!("par recusou: {reason}")),
      }
    }
    Role::Acceptor => {
      let hello = match protocol::read_message(&mut recv).await? {
        Message::Hello(hello) => hello,
        Message::Refuse { reason } => return Err(format!("par recusou: {reason}")),
      };
      match protocol::check_hello(&hello, local.schema) {
        Ok(()) => protocol::write_message(&mut send, &Message::Hello(local.hello())).await?,
        Err(reason) => {
          protocol::write_message(&mut send, &Message::Refuse { reason: reason.to_string() }).await?;
          let _ = send.finish();
          return Err(reason.to_string());
        }
      }
      hello
    }
  };

  // O dialer só confia no hello depois de validar; o acceptor já validou antes
  // de responder.
  if role == Role::Dialer {
    protocol::check_hello(&remote, local.schema).map_err(|reason| reason.to_string())?;
  }
  let _ = send.finish();
  Ok(remote)
}

/// Endereço de loopback para testes (o endpoint liga em 0.0.0.0).
#[cfg(test)]
fn loopback(endpoint: &Endpoint) -> EndpointAddr {
  let socket = endpoint
    .bound_sockets()
    .into_iter()
    .find(|socket| socket.is_ipv4())
    .expect("endpoint sem socket ipv4");
  EndpointAddr::new(endpoint.id()).with_ip_addr(std::net::SocketAddr::new(
    std::net::Ipv4Addr::LOCALHOST.into(),
    socket.port(),
  ))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn node(device_id: &str, schema: u32) -> LocalNode {
    LocalNode {
      schema,
      device_id: device_id.to_string(),
    }
  }

  async fn bind_pair() -> (Endpoint, Endpoint) {
    let a = bind(SecretKey::generate()).await.unwrap();
    let b = bind(SecretKey::generate()).await.unwrap();
    (a, b)
  }

  #[tokio::test]
  async fn endpoints_exchange_hello() {
    let (a, b) = bind_pair().await;

    let server = {
      let b = b.clone();
      tokio::spawn(async move { accept(&b, &node("dev-b", 6)).await })
    };
    let local = node("dev-a", 6);
    let peer_addr = loopback(&b);
    let (hello, server) = tokio::join!(dial(&a, peer_addr, &local), server);
    let hello = hello.unwrap();
    let dbg = server.unwrap();
    assert_eq!(hello.device_id, "dev-b");
    assert_eq!(hello.proto, protocol::PROTO_VERSION);
    assert_eq!(hello.schema, 6);

    let (remote, peer) = dbg.unwrap().unwrap();
    assert_eq!(remote, a.id());
    assert_eq!(peer.device_id, "dev-a");

    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn schema_mismatch_is_refused_by_both_sides() {
    let (a, b) = bind_pair().await;

    let server = {
      let b = b.clone();
      tokio::spawn(async move { accept(&b, &node("dev-b", 6)).await })
    };
    let error = dial(&a, loopback(&b), &node("dev-a", 7)).await.unwrap_err();
    assert!(error.contains("schema"), "erro inesperado: {error}");

    // O acceptor também recusa: ele compara antes de responder.
    let accepted = server.await.unwrap();
    assert!(accepted.is_err(), "acceptor deveria recusar schema 7");

    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn dial_to_unknown_peer_fails_without_hanging() {
    let a = bind(SecretKey::generate()).await.unwrap();
    let ghost = bind(SecretKey::generate()).await.unwrap();
    let addr = loopback(&ghost);
    ghost.close().await;

    let result = timeout(Duration::from_secs(15), dial(&a, addr, &node("dev-a", 6))).await;
    assert!(result.is_ok(), "dial não deveria pendurar além do HELLO_TIMEOUT");
    assert!(result.unwrap().is_err(), "dial a endpoint fechado deve falhar");
    a.close().await;
  }
}
