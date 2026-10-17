//! Endpoint iroh e handshake.
//!
//! Alcance só LAN: `presets::Minimal` não configura relay nem DNS/Pkarr da n0,
//! então nenhum pacote sai da rede local. O handshake troca `hello`
//! (proto + schema + cursores) e devolve a sessão já aberta para o protocolo
//! de delta (`session.rs`).

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use iroh::endpoint::{Connection, RecvStream, SendStream, presets};
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use tokio::time::timeout;

use super::protocol::{self, Cursor, Hello, Message};

/// Teto do handshake. Rede local: se passou disso, o par não está lá.
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(5);

/// Espera do acceptor pelo fechamento do dialer (flush do último frame).
const CLOSE_GRACE: Duration = Duration::from_secs(5);

/// O que este aparelho apresenta no hello.
#[derive(Debug, Clone)]
pub struct LocalNode {
  /// `PRAGMA user_version` do banco ativo.
  pub schema: u32,
  pub device_id: String,
  /// Cursores que este lado tem **para o par** (preenchido por quem disca).
  pub cursors: Vec<Cursor>,
}

impl LocalNode {
  pub fn new(schema: u32, device_id: impl Into<String>) -> Self {
    Self {
      schema,
      device_id: device_id.into(),
      cursors: Vec::new(),
    }
  }

  pub fn hello(&self) -> Hello {
    Hello {
      proto: protocol::PROTO_VERSION,
      schema: self.schema,
      device_id: self.device_id.clone(),
      cursors: self.cursors.clone(),
    }
  }
}

/// Sessão aberta: a conexão e o stream bidi já com o hello trocado.
pub struct Session {
  pub(crate) conn: Connection,
  pub(crate) send: SendStream,
  pub(crate) recv: RecvStream,
  pub remote: EndpointId,
  pub hello: Hello,
  role: Role,
}

impl Session {
  /// Fecha a sessão.
  ///
  /// Quem disca fecha na hora; o acceptor espera o outro lado fechar. Sem isso,
  /// `finish()` + `close()` descarta o frame que ainda está em voo.
  pub async fn close(mut self) {
    let _ = self.send.finish();
    if self.role == Role::Acceptor {
      let _ = timeout(CLOSE_GRACE, self.conn.closed()).await;
    }
    self.conn.close(0u32.into(), b"atlas/sync");
  }

  /// Device id que o par declarou (vai no cursor por origem).
  pub fn peer_device_id(&self) -> &str {
    &self.hello.device_id
  }

  /// Quem discou define a ordem do delta (manda primeiro).
  pub fn is_dialer(&self) -> bool {
    self.role == Role::Dialer
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
  Dialer,
  Acceptor,
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

/// Diala o par, valida o hello dele e devolve a sessão aberta.
pub async fn dial(endpoint: &Endpoint, peer: EndpointAddr, local: &LocalNode) -> Result<Session, String> {
  timeout(HELLO_TIMEOUT, async {
    let conn = endpoint
      .connect(peer, protocol::ALPN)
      .await
      .map_err(|error| format!("conexão: {error}"))?;
    let (send, recv, remote, hello) = exchange(&conn, local.hello(), Role::Dialer, None).await?;
    Ok(Session {
      conn,
      send,
      recv,
      remote,
      hello,
      role: Role::Dialer,
    })
  })
  .await
  .map_err(|_| "timeout no hello".to_string())?
}

/// Aceita uma conexão e troca hello. `None` quando o endpoint foi fechado.
///
/// `cursors_by_peer` indexa os cursores por EndpointID: o acceptor só sabe com
/// quem está falando depois de aceitar, e o hello já precisa ir com eles.
pub async fn accept(
  endpoint: &Endpoint,
  local: &LocalNode,
  cursors_by_peer: &BTreeMap<String, Vec<Cursor>>,
  // `None` = aceitar qualquer par (só o PoC manual usa; o app sempre passa a
  // allowlist de `sync_peers`).
  allowlist: Option<&BTreeSet<String>>,
) -> Result<Option<Session>, String> {
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
    let mut hello = local.hello();
    hello.cursors = cursors_by_peer.get(&remote.to_string()).cloned().unwrap_or_default();
    let (send, recv, _, hello) = exchange(&conn, hello, Role::Acceptor, allowlist).await?;
    Ok(Some(Session {
      conn,
      send,
      recv,
      remote,
      hello,
      role: Role::Acceptor,
    }))
  })
  .await
  .map_err(|_| "timeout no hello".to_string())?
}

/// Troca de hello no mesmo stream bidi: quem disca escreve primeiro.
///
/// Devolve os streams já prontos para a sessão (o `finish` fica para o fim do
/// delta, não aqui).
///
/// `allowlist` só é usada pelo acceptor: ele confere o par **antes** de
/// responder o hello (nada de metadado para desconhecido).
async fn exchange(
  conn: &Connection,
  local: Hello,
  role: Role,
  allowlist: Option<&BTreeSet<String>>,
) -> Result<(SendStream, RecvStream, EndpointId, Hello), String> {
  let (mut send, mut recv) = match role {
    Role::Acceptor => conn.accept_bi().await.map_err(|error| format!("stream: {error}"))?,
    Role::Dialer => conn.open_bi().await.map_err(|error| format!("stream: {error}"))?,
  };

  let remote = match role {
    Role::Dialer => {
      protocol::write_message(&mut send, &Message::Hello(local.clone())).await?;
      match protocol::read_message(&mut recv).await? {
        Message::Hello(hello) => hello,
        Message::Refuse { reason } => return Err(format!("par recusou: {reason}")),
        other => return Err(format!("mensagem inesperada no hello: {other:?}")),
      }
    }
    Role::Acceptor => {
      let hello = match protocol::read_message(&mut recv).await? {
        Message::Hello(hello) => hello,
        Message::Refuse { reason } => return Err(format!("par recusou: {reason}")),
        other => return Err(format!("mensagem inesperada no hello: {other:?}")),
      };
      let trusted = allowlist
        .map(|set| set.contains(&conn.remote_id().to_string()))
        .unwrap_or(true);
      let refusal = match protocol::check_hello(&hello, local.schema) {
        Ok(()) if trusted => None,
        Ok(()) => Some(format!("par fora da allowlist: {}", conn.remote_id())),
        Err(reason) => Some(reason.to_string()),
      };
      match refusal {
        None => protocol::write_message(&mut send, &Message::Hello(local.clone())).await?,
        Some(reason) => {
          protocol::write_message(&mut send, &Message::Refuse { reason: reason.clone() }).await?;
          let _ = send.finish();
          let _ = timeout(CLOSE_GRACE, conn.closed()).await;
          return Err(reason);
        }
      }
      hello
    }
  };

  if role == Role::Dialer {
    protocol::check_hello(&remote, local.schema).map_err(|reason| reason.to_string())?;
  }
  let remote_id = conn.remote_id();
  Ok((send, recv, remote_id, remote))
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
    LocalNode::new(schema, device_id)
  }

  fn allow(id: EndpointId) -> BTreeSet<String> {
    BTreeSet::from([id.to_string()])
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
      let trusted = allow(a.id());
      tokio::spawn(async move { accept(&b, &node("dev-b", 6), &BTreeMap::new(), Some(&trusted)).await })
    };
    let local = node("dev-a", 6);
    let peer_addr = loopback(&b);
    let (session, accepted) = tokio::join!(dial(&a, peer_addr, &local), server);
    let session = session.unwrap();
    assert_eq!(session.hello.device_id, "dev-b");
    assert_eq!(session.hello.proto, protocol::PROTO_VERSION);
    assert_eq!(session.hello.schema, 6);

    let accepted = accepted.unwrap().unwrap().unwrap();
    assert_eq!(accepted.remote, a.id());
    assert_eq!(accepted.hello.device_id, "dev-a");

    session.close().await;
    accepted.close().await;
    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn acceptor_sends_the_cursors_it_holds_for_the_peer() {
    let (a, b) = bind_pair().await;
    let cursors = BTreeMap::from([(
      a.id().to_string(),
      vec![Cursor {
        owner: "dev-c".into(),
        updated_at: 99,
      }],
    )]);

    let server = {
      let b = b.clone();
      let trusted = allow(a.id());
      tokio::spawn(async move { accept(&b, &node("dev-b", 6), &cursors, Some(&trusted)).await })
    };
    let local = node("dev-a", 6);
    let peer_addr = loopback(&b);
    let (session, accepted) = tokio::join!(dial(&a, peer_addr, &local), server);
    let session = session.unwrap();
    assert_eq!(
      session.hello.cursors,
      vec![Cursor {
        owner: "dev-c".into(),
        updated_at: 99,
      }]
    );
    let accepted = accepted.unwrap().unwrap().unwrap();
    accepted.close().await;
    session.close().await;
    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn schema_mismatch_is_refused_by_both_sides() {
    let (a, b) = bind_pair().await;

    let server = {
      let b = b.clone();
      let trusted = allow(a.id());
      tokio::spawn(async move { accept(&b, &node("dev-b", 6), &BTreeMap::new(), Some(&trusted)).await })
    };
    let local = node("dev-a", 7);
    let peer_addr = loopback(&b);
    let (dialed, accepted) = tokio::join!(dial(&a, peer_addr, &local), server);
    let error = match dialed {
      Ok(_) => panic!("dial deveria falhar com schema 7"),
      Err(error) => error,
    };
    assert!(error.contains("schema"), "erro inesperado: {error}");
    // O acceptor também recusa: ele compara antes de responder.
    assert!(accepted.unwrap().is_err(), "acceptor deveria recusar schema 7");

    a.close().await;
    b.close().await;
  }

  #[tokio::test]
  async fn unpaired_peer_is_refused_before_the_hello() {
    let (a, b) = bind_pair().await;
    let trusted = BTreeSet::new();
    let server = {
      let b = b.clone();
      tokio::spawn(async move { accept(&b, &node("dev-b", 6), &BTreeMap::new(), Some(&trusted)).await })
    };
    let local = node("dev-a", 6);
    let peer_addr = loopback(&b);
    let (dialed, accepted) = tokio::join!(dial(&a, peer_addr, &local), server);
    let error = match dialed {
      Ok(_) => panic!("dial deveria ser recusado sem pareamento"),
      Err(error) => error,
    };
    assert!(error.contains("allowlist"), "erro inesperado: {error}");
    assert!(accepted.unwrap().is_err());

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
    a.close().await;
  }
}
