//! Protocolo `atlas/sync/1`: framing + mensagens.
//!
//! Cada frame é `u32` big-endian (tamanho) + JSON. JSON é chato mas é
//! inspecionável com `tcpdump`/log e o custo some perto do I/O do SQLite.
//! A validação de tabela/coluna vem no merge (P2b): o fio é só transporte.

use iroh::endpoint::{RecvStream, SendStream};
use serde::{Deserialize, Serialize};
/// ALPN do protocolo. Trocar a versão invalida conexão antiga de propósito.
pub const ALPN: &[u8] = b"atlas/sync/1";

/// Versão do protocolo (independente de `PRAGMA user_version`).
pub const PROTO_VERSION: u32 = 1;

/// Teto de um frame. Um lote de 500 linhas cabe folgado; acima disso é bug.
pub const MAX_FRAME: usize = 4 * 1024 * 1024;

/// Linhas por frame do delta. Payload de nota é o maior item; 200 linhas ficam
/// bem abaixo de `MAX_FRAME` e mantêm o progresso visível.
pub const MAX_ROWS_PER_FRAME: usize = 200;

/// O que este lado já recebeu deste par, por aparelho de origem.
///
/// O cursor é por (par × origem): um cursor global quebraria com relógio
/// adiantado e um reenvio de outro aparelho.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cursor {
  /// `device_id` de quem escreveu a linha.
  pub owner: String,
  /// Maior `updated_at` já recebido dessa origem nesta sessão de par.
  pub updated_at: i64,
}

/// Primeira mensagem da sessão.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
  pub proto: u32,
  /// `PRAGMA user_version` do schema local.
  pub schema: u32,
  pub device_id: String,
  /// Matriz de cursores deste lado **para este par** (vazia em P2a).
  #[serde(default)]
  pub cursors: Vec<Cursor>,
}

/// Linha replicada: tabela + valores por coluna.
///
/// Colunas numéricas viajam como texto: o SQLite converte pela afinidade da
/// coluna, igual ao `db_batch`, e `NULL` continua `NULL` (não vira a string
/// "null"). `updated_at`/`device_id` também estão em `cols` — não há cópia de
/// metadado fora da linha.
pub type Cols = std::collections::BTreeMap<String, Option<String>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Row {
  pub table: String,
  pub cols: Cols,
}

impl Row {
  /// Carimbo LWW da linha. Ausente/ inválido é erro de protocolo.
  pub fn updated_at(&self) -> Result<i64, String> {
    let raw = self
      .cols
      .get("updated_at")
      .and_then(|value| value.as_deref())
      .ok_or_else(|| format!("{}: linha sem updated_at", self.table))?;
    raw.parse::<i64>()
      .map_err(|_| format!("{}: updated_at inválido: {raw}", self.table))
  }

  /// Origem da linha (`device_id`); vazio/ausente vira `legacy`.
  pub fn owner(&self) -> &str {
    origin(self.cols.get("device_id").and_then(|value| value.as_deref()))
  }
}

/// Normaliza a origem: linhas antigas (antes do `device_id`) contam como `legacy`.
pub fn origin(device_id: Option<&str>) -> &str {
  match device_id {
    Some(value) if !value.is_empty() => value,
    _ => "legacy",
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
  Hello(Hello),
  /// Lote de linhas (delta por cursor). Pode vir mais de um.
  Rows { rows: Vec<Row> },
  /// Fim do delta deste lado; o receptor pode fechar o turno.
  Done,
  /// Recusa explícita: o outro lado sabe *por que* a sessão não andou.
  Refuse { reason: String },
}

/// Motivo legível de incompatibilidade (vai no `Refuse` e no log).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Incompatibility {
  Protocol { local: u32, remote: u32 },
  Schema { local: u32, remote: u32 },
  EmptyDeviceId,
}

impl std::fmt::Display for Incompatibility {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Incompatibility::Protocol { local, remote } => {
        write!(f, "protocolo incompatível: local {local}, par {remote}")
      }
      Incompatibility::Schema { local, remote } => {
        write!(f, "schema incompatível: local {local}, par {remote}")
      }
      Incompatibility::EmptyDeviceId => write!(f, "hello sem device_id"),
    }
  }
}

/// Compara o hello do par com o estado local.
///
/// Schema diferente é recusa dura: são versões diferentes de tabela, e adivinhar
/// o que fazer com linha desconhecida corrompe o banco.
pub fn check_hello(remote: &Hello, local_schema: u32) -> Result<(), Incompatibility> {
  if remote.proto != PROTO_VERSION {
    return Err(Incompatibility::Protocol {
      local: PROTO_VERSION,
      remote: remote.proto,
    });
  }
  if remote.schema != local_schema {
    return Err(Incompatibility::Schema {
      local: local_schema,
      remote: remote.schema,
    });
  }
  if remote.device_id.trim().is_empty() {
    return Err(Incompatibility::EmptyDeviceId);
  }
  Ok(())
}

/// Escreve um frame JSON. `finish` fica com quem chamou.
///
/// Genérico porque o protocolo de pareamento (`atlas/pair/1`) usa o mesmo
/// framing em outro ALPN.
pub async fn write_json<T: Serialize>(send: &mut SendStream, value: &T) -> Result<(), String> {
  let body = serde_json::to_vec(value).map_err(|error| format!("serialização: {error}"))?;
  if body.len() > MAX_FRAME {
    return Err(format!("frame grande demais: {} bytes", body.len()));
  }
  send
    .write_all(&(body.len() as u32).to_be_bytes())
    .await
    .map_err(|error| format!("escrita do tamanho: {error}"))?;
  send
    .write_all(&body)
    .await
    .map_err(|error| format!("escrita do frame: {error}"))?;
  Ok(())
}

/// Escreve uma mensagem do protocolo de sync.
pub async fn write_message(send: &mut SendStream, message: &Message) -> Result<(), String> {
  write_json(send, message).await
}

/// Lê um frame JSON; erro claro em tamanho fora do limite.
pub async fn read_json<T: serde::de::DeserializeOwned>(recv: &mut RecvStream) -> Result<T, String> {
  let mut header = [0u8; 4];
  recv
    .read_exact(&mut header)
    .await
    .map_err(|error| format!("leitura do tamanho: {error}"))?;
  let len = u32::from_be_bytes(header) as usize;
  if len == 0 || len > MAX_FRAME {
    return Err(format!("frame inválido: {len} bytes"));
  }
  let mut body = vec![0u8; len];
  recv
    .read_exact(&mut body)
    .await
    .map_err(|error| format!("leitura do frame: {error}"))?;
  serde_json::from_slice(&body).map_err(|error| format!("frame inválido: {error}"))
}

/// Lê uma mensagem do protocolo de sync.
pub async fn read_message(recv: &mut RecvStream) -> Result<Message, String> {
  read_json(recv).await
}

#[cfg(test)]
mod tests {
  use super::*;

  fn hello(schema: u32, device_id: &str) -> Hello {
    Hello {
      proto: PROTO_VERSION,
      schema,
      device_id: device_id.to_string(),
      cursors: vec![Cursor {
        owner: "dev-a".into(),
        updated_at: 42,
      }],
    }
  }

  #[test]
  fn matching_hello_is_accepted() {
    assert_eq!(check_hello(&hello(6, "dev-b"), 6), Ok(()));
  }

  #[test]
  fn protocol_mismatch_is_rejected() {
    let mut remote = hello(6, "dev-b");
    remote.proto = 2;
    assert_eq!(
      check_hello(&remote, 6),
      Err(Incompatibility::Protocol { local: 1, remote: 2 })
    );
  }

  #[test]
  fn schema_mismatch_is_rejected() {
    assert_eq!(
      check_hello(&hello(7, "dev-b"), 6),
      Err(Incompatibility::Schema { local: 6, remote: 7 })
    );
  }

  #[test]
  fn empty_device_id_is_rejected() {
    assert_eq!(
      check_hello(&hello(6, "  "), 6),
      Err(Incompatibility::EmptyDeviceId)
    );
  }

  #[test]
  fn message_roundtrips_through_json() {
    let message = Message::Hello(hello(6, "dev-b"));
    let json = serde_json::to_vec(&message).unwrap();
    let parsed: Message = serde_json::from_slice(&json).unwrap();
    assert_eq!(parsed, message);

    let refusal = Message::Refuse {
      reason: "schema incompatível".into(),
    };
    let json = serde_json::to_vec(&refusal).unwrap();
    assert_eq!(serde_json::from_slice::<Message>(&json).unwrap(), refusal);
  }

  #[test]
  fn hello_cursors_default_to_empty_for_older_payloads() {
    let hello: Hello = serde_json::from_str(r#"{"proto":1,"schema":6,"device_id":"x"}"#).unwrap();
    assert!(hello.cursors.is_empty());
  }
}
