//! Sessão de sync: delta nos dois sentidos + merge.
//!
//! Ordem (decisão em `docs/SYNC.md` §3): hello A↔B (com cursores) → A manda o
//! delta dele + `Done` → B aplica e manda o dele → A aplica. Quem disca é o
//! EndpointID menor; o outro só aceita.
//!
//! Cursores só são gravados no fim, e o merge é idempotente: sessão cortada no
//! meio reenvia do mesmo ponto na próxima vez, sem duplicar nem perder linha.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use iroh::endpoint::SendStream;
use iroh::{Endpoint, EndpointAddr};
use sqlx::SqlitePool;

use super::engine::{self, LocalNode, Session};
use super::protocol::{self, Message, Row};
use super::store::{self, ApplyStats};

/// Resumo de uma sessão (vai pro log e, em P2c, pro evento do front).
#[derive(Debug, Clone, Default)]
pub struct SessionReport {
  /// EndpointID do par (vai no evento/status).
  pub peer: String,
  pub applied: usize,
  pub skipped: usize,
  pub sent: usize,
  pub received: usize,
  pub max_stamp: i64,
}

impl SessionReport {
  pub fn is_empty(&self) -> bool {
    self.applied == 0 && self.sent == 0
  }
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|elapsed| elapsed.as_millis() as i64)
    .unwrap_or(0)
}

/// Diala um par e roda a sessão completa.
pub async fn dial(
  endpoint: &Endpoint,
  peer: EndpointAddr,
  local: &LocalNode,
  pool: &SqlitePool,
) -> Result<SessionReport, String> {
  let peer_id = peer.id.to_string();
  let allowlist = store::allowlist(pool).await?;
  if !allowlist.contains(&peer_id) {
    return Err(format!("par fora da allowlist: {peer_id}"));
  }
  let mut local = local.clone();
  local.cursors = store::cursors_for(pool, &peer_id).await?;
  let session = engine::dial(endpoint, peer, &local).await?;
  run(session, pool).await
}

/// Aceita uma conexão e roda a sessão completa.
pub async fn accept(
  endpoint: &Endpoint,
  local: &LocalNode,
  pool: &SqlitePool,
) -> Result<Option<SessionReport>, String> {
  let cursors = store::cursors_by_peer(pool).await?;
  let allowlist = store::allowlist(pool).await?;
  let Some(session) = engine::accept(endpoint, local, &cursors, Some(&allowlist)).await? else {
    return Ok(None);
  };
  run(session, pool).await.map(Some)
}

/// Roda a sessão já com o hello trocado (o roteador de ALPN usa esta entrada).
pub async fn run(mut session: Session, pool: &SqlitePool) -> Result<SessionReport, String> {
  let peer_id = session.remote.to_string();
  let peer_device = session.peer_device_id().to_string();
  let delta = store::collect_delta(pool, &session.hello.cursors, &peer_device).await?;
  let sent = delta.len();

  let stats = if session.is_dialer() {
    send_delta(&mut session.send, &delta).await?;
    receive_delta(&mut session.recv, pool).await?
  } else {
    let stats = receive_delta(&mut session.recv, pool).await?;
    send_delta(&mut session.send, &delta).await?;
    stats
  };

  // O corte da purga precisa cobrir o maior carimbo recebido (HLC pode estar
  // à frente do relógio de parede).
  let session_stamp = now_ms().max(stats.max_stamp);
  store::save_cursors(pool, &peer_id, &stats.cursors, session_stamp).await?;
  store::observe_stamp(pool, stats.max_stamp).await?;
  session.close().await;

  Ok(SessionReport {
    peer: peer_id,
    applied: stats.applied,
    skipped: stats.skipped,
    sent,
    received: stats.applied + stats.skipped,
    max_stamp: stats.max_stamp,
  })
}

async fn send_delta(send: &mut SendStream, rows: &[Row]) -> Result<(), String> {
  for chunk in rows.chunks(protocol::MAX_ROWS_PER_FRAME) {
    protocol::write_message(send, &Message::Rows { rows: chunk.to_vec() }).await?;
  }
  protocol::write_message(send, &Message::Done).await?;
  send.finish().map_err(|error| format!("fim do delta: {error}"))?;
  Ok(())
}

async fn receive_delta(
  recv: &mut iroh::endpoint::RecvStream,
  pool: &SqlitePool,
) -> Result<ApplyStats, String> {
  let mut total = ApplyStats::default();
  loop {
    match protocol::read_message(recv).await? {
      Message::Rows { rows } => {
        let stats = store::apply_rows(pool, &rows).await?;
        total.applied += stats.applied;
        total.skipped += stats.skipped;
        total.max_stamp = total.max_stamp.max(stats.max_stamp);
        for (owner, updated_at) in stats.cursors {
          let entry = total.cursors.entry(owner).or_insert(updated_at);
          if updated_at > *entry {
            *entry = updated_at;
          }
        }
      }
      Message::Done => return Ok(total),
      Message::Hello(_) | Message::Refuse { .. } => {
        return Err("mensagem fora de ordem no delta".to_string());
      }
    }
  }
}

/// Cursores após uma sessão, para testes e para o `sync_status` (P2c).
pub async fn cursors(pool: &SqlitePool, peer_id: &str) -> Result<Vec<protocol::Cursor>, String> {
  store::cursors_for(pool, peer_id).await
}

/// Agrupa cursores por origem (usado no log/status).
pub fn cursor_map(cursors: &[protocol::Cursor]) -> BTreeMap<String, i64> {
  cursors
    .iter()
    .map(|cursor| (cursor.owner.clone(), cursor.updated_at))
    .collect()
}

#[cfg(test)]
mod tests {
  use std::time::Duration;

  use iroh::SecretKey;
  use sqlx::sqlite::SqlitePoolOptions;
  use tokio::time::timeout;

  use super::*;
  use crate::sync::{engine, store};

  const DDL: &str = r#"
    CREATE TABLE categories (id TEXT PRIMARY KEY, module TEXT NOT NULL, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, occurred_on TEXT NOT NULL, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE habits (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE habit_logs (id TEXT PRIMARY KEY, habit_id TEXT NOT NULL, occurred_on TEXT NOT NULL,
      payload TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT,
      UNIQUE(habit_id, occurred_on));
    CREATE TABLE time_blocks (id TEXT PRIMARY KEY, starts_at TEXT NOT NULL, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE trackers (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE tracker_entries (id TEXT PRIMARY KEY, tracker_id TEXT NOT NULL, occurred_on TEXT NOT NULL,
      payload TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE graph_domains (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE graph_nodes (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE graph_edges (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, folder_id TEXT, title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
      deleted_at INTEGER, device_id TEXT, pinned INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, deleted_at INTEGER,
      device_id TEXT, updated_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE shared_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT);
    CREATE TABLE counters (key TEXT NOT NULL, owner TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT,
      PRIMARY KEY (key, owner));
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sync_peers (endpoint_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
      paired_at INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sync_cursors (peer_id TEXT NOT NULL, owner TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (peer_id, owner));
    PRAGMA user_version = 6;
  "#;

  async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
      .max_connections(1)
      .connect("sqlite::memory:")
      .await
      .expect("sqlite em memória");
    for statement in DDL.split(';') {
      let statement = statement.trim();
      if statement.is_empty() {
        continue;
      }
      sqlx::query(statement).execute(&pool).await.expect("DDL");
    }
    pool
  }

  async fn seed(pool: &SqlitePool, table: &str, cols: &[(&str, &str)]) {
    let names = cols.iter().map(|(name, _)| *name).collect::<Vec<_>>().join(", ");
    let placeholders = (0..cols.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("INSERT OR REPLACE INTO {table} ({names}) VALUES ({placeholders})");
    let mut query = sqlx::query(&sql);
    for (_, value) in cols {
      query = query.bind(*value);
    }
    query.execute(pool).await.expect("seed");
  }

  async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
      .fetch_one(pool)
      .await
      .expect("count")
  }

  async fn column(pool: &SqlitePool, table: &str, column: &str, id: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(&format!(
      "SELECT CAST({column} AS TEXT) FROM {table} WHERE id = ?"
    ))
      .bind(id)
      .fetch_one(pool)
      .await
      .expect("column")
  }

  struct Peers {
    a: Endpoint,
    b: Endpoint,
    a_pool: SqlitePool,
    b_pool: SqlitePool,
    local_a: LocalNode,
    local_b: LocalNode,
  }

  async fn peers() -> Peers {
    let a = engine::bind(SecretKey::generate()).await.unwrap();
    let b = engine::bind(SecretKey::generate()).await.unwrap();
    let a_pool = pool().await;
    let b_pool = pool().await;
    // Allowlist: cada lado conhece o outro (o pareamento real é P3).
    seed(
      &a_pool,
      "sync_peers",
      &[("endpoint_id", &b.id().to_string()), ("name", "b")],
    )
    .await;
    seed(
      &b_pool,
      "sync_peers",
      &[("endpoint_id", &a.id().to_string()), ("name", "a")],
    )
    .await;
    Peers {
      a,
      b,
      a_pool,
      b_pool,
      local_a: LocalNode::new(6, "dev-a"),
      local_b: LocalNode::new(6, "dev-b"),
    }
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

  /// Roda uma sessão e devolve (initiator, acceptor).
  async fn sync(peers: &Peers) -> (SessionReport, SessionReport) {
    let server = {
      let endpoint = peers.b.clone();
      let pool = peers.b_pool.clone();
      let local = peers.local_b.clone();
      tokio::spawn(async move { accept(&endpoint, &local, &pool).await })
    };
    let (dialed, accepted) = tokio::join!(
      dial(&peers.a, loopback(&peers.b), &peers.local_a, &peers.a_pool),
      server
    );
    (
      dialed.expect("dial"),
      accepted.expect("join").expect("accept").expect("sessão"),
    )
  }

  #[tokio::test]
  async fn rows_converge_in_both_directions() {
    let peers = peers().await;
    seed(
      &peers.a_pool,
      "categories",
      &[
        ("id", "cat-1"),
        ("module", "fin"),
        ("payload", r#"{"name":"Mercado"}"#),
        ("updated_at", "100"),
        ("device_id", "dev-a"),
      ],
    )
    .await;
    seed(
      &peers.b_pool,
      "habits",
      &[
        ("id", "habit-1"),
        ("payload", r#"{"name":"Ler"}"#),
        ("updated_at", "200"),
        ("device_id", "dev-b"),
      ],
    )
    .await;

    let (from_a, from_b) = sync(&peers).await;
    assert_eq!(from_a.applied, 1, "A aplica o hábito de B");
    assert_eq!(from_b.applied, 1, "B aplica a categoria de A");

    assert_eq!(count(&peers.b_pool, "categories").await, 1);
    assert_eq!(count(&peers.a_pool, "habits").await, 1);

    // Cursores por (par × origem).
    let b_cursors = cursors(&peers.b_pool, &peers.a.id().to_string()).await.unwrap();
    assert_eq!(
      cursor_map(&b_cursors).get("dev-a").copied(),
      Some(100),
      "B registra o que recebeu de dev-a"
    );

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn resync_is_idempotent() {
    let peers = peers().await;
    seed(
      &peers.a_pool,
      "habits",
      &[
        ("id", "habit-1"),
        ("payload", r#"{"name":"Ler"}"#),
        ("updated_at", "100"),
        ("device_id", "dev-a"),
      ],
    )
    .await;
    sync(&peers).await;

    let (from_a, _) = sync(&peers).await;
    // O cursor reenvia as linhas do carimbo exato; o LWW descarta todas.
    assert_eq!(from_a.applied, 0);
    assert_eq!(count(&peers.b_pool, "habits").await, 1);

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn newest_stamp_wins_on_both_sides() {
    let peers = peers().await;
    for (pool, payload, at) in [
      (&peers.a_pool, r#"{"name":"velho"}"#, "100"),
      (&peers.b_pool, r#"{"name":"novo"}"#, "200"),
    ] {
      seed(
        pool,
        "habits",
        &[
          ("id", "habit-1"),
          ("payload", payload),
          ("updated_at", at),
          ("device_id", "dev-x"),
        ],
      )
      .await;
    }

    sync(&peers).await;

    assert_eq!(
      column(&peers.a_pool, "habits", "payload", "habit-1").await.as_deref(),
      Some(r#"{"name":"novo"}"#)
    );
    assert_eq!(
      column(&peers.b_pool, "habits", "payload", "habit-1").await.as_deref(),
      Some(r#"{"name":"novo"}"#)
    );

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn tie_goes_to_the_smallest_device_id() {
    let peers = peers().await;
    for (pool, payload, device) in [
      (&peers.a_pool, r#"{"name":"a"}"#, "dev-a"),
      (&peers.b_pool, r#"{"name":"z"}"#, "dev-z"),
    ] {
      seed(
        pool,
        "habits",
        &[
          ("id", "habit-1"),
          ("payload", payload),
          ("updated_at", "100"),
          ("device_id", device),
        ],
      )
      .await;
    }

    sync(&peers).await;

    assert_eq!(
      column(&peers.a_pool, "habits", "payload", "habit-1").await.as_deref(),
      Some(r#"{"name":"a"}"#)
    );
    assert_eq!(
      column(&peers.b_pool, "habits", "payload", "habit-1").await.as_deref(),
      Some(r#"{"name":"a"}"#)
    );

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn tombstones_propagate() {
    let peers = peers().await;
    seed(
      &peers.a_pool,
      "notes",
      &[
        ("id", "note-1"),
        ("title", "Rascunho"),
        ("created_at", "2026-10-17T10:00:00.000Z"),
        ("updated_at", "100"),
        ("payload", r#"{"id":"note-1","title":"Rascunho"}"#),
        ("device_id", "dev-a"),
      ],
    )
    .await;
    seed(
      &peers.b_pool,
      "notes",
      &[
        ("id", "note-1"),
        ("title", "Rascunho"),
        ("created_at", "2026-10-17T10:00:00.000Z"),
        ("updated_at", "300"),
        ("deleted_at", "300"),
        ("payload", r#"{"id":"note-1","title":"Rascunho"}"#),
        ("device_id", "dev-b"),
      ],
    )
    .await;

    sync(&peers).await;

    assert_eq!(
      column(&peers.a_pool, "notes", "deleted_at", "note-1").await.as_deref(),
      Some("300"),
      "a lápide mais nova vence e chega no outro lado"
    );

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn cursor_skips_origin_already_synced() {
    let peers = peers().await;
    seed(
      &peers.a_pool,
      "shared_settings",
      &[
        ("key", "lifeForce"),
        ("value", "42"),
        ("updated_at", "100"),
        ("device_id", "dev-a"),
      ],
    )
    .await;
    sync(&peers).await;

    // A não tem nada novo de dev-a depois do cursor 100.
    let cursors = cursors(&peers.b_pool, &peers.a.id().to_string()).await.unwrap();
    let delta = store::collect_delta(&peers.a_pool, &cursors, "dev-b").await.unwrap();
    assert!(
      delta.iter().all(|row| row.table != "shared_settings" || row.updated_at().unwrap() >= 100),
      "delta não deveria reenviar nada abaixo do cursor"
    );

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn schema_mismatch_does_not_merge() {
    let peers = peers().await;
    seed(
      &peers.a_pool,
      "habits",
      &[
        ("id", "habit-1"),
        ("payload", "{}"),
        ("updated_at", "100"),
        ("device_id", "dev-a"),
      ],
    )
    .await;
    let mut local_b = peers.local_b.clone();
    local_b.schema = 7;

    let server = {
      let endpoint = peers.b.clone();
      let pool = peers.b_pool.clone();
      tokio::spawn(async move { accept(&endpoint, &local_b, &pool).await })
    };
    let dialed = dial(&peers.a, loopback(&peers.b), &peers.local_a, &peers.a_pool).await;
    assert!(dialed.is_err());
    let accepted = server.await.unwrap();
    assert!(accepted.is_err());
    assert_eq!(count(&peers.b_pool, "habits").await, 0);

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn legacy_rows_without_device_id_still_travel() {
    let peers = peers().await;
    // Linha de antes do `device_id`: origem `legacy`, mas continua replicando.
    sqlx::query(
      "INSERT INTO habits (id, payload, updated_at, device_id) VALUES ('habit-legacy', '{}', 50, NULL)",
    )
    .execute(&peers.a_pool)
    .await
    .unwrap();

    let (_, from_b) = sync(&peers).await;
    assert_eq!(from_b.applied, 1);
    assert_eq!(count(&peers.b_pool, "habits").await, 1);

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn session_reports_stats_and_bumps_hlc() {
    let peers = peers().await;
    seed(
      &peers.a_pool,
      "habits",
      &[
        ("id", "habit-1"),
        ("payload", "{}"),
        ("updated_at", "5000"),
        ("device_id", "dev-a"),
      ],
    )
    .await;

    let (from_a, from_b) = sync(&peers).await;
    assert_eq!(from_a.sent, 1);
    assert_eq!(from_b.received, 1);
    assert_eq!(from_b.max_stamp, 5000);

    let hlc: String = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'hlc_last'")
      .fetch_one(&peers.b_pool)
      .await
      .unwrap();
    assert_eq!(hlc, "5000", "HLC local sobe acima do que chegou");

    let last_sync: i64 = sqlx::query_scalar("SELECT last_sync_at FROM sync_peers LIMIT 1")
      .fetch_one(&peers.b_pool)
      .await
      .unwrap();
    assert!(last_sync >= 5000, "corte da purga cobre o carimbo recebido");

    peers.a.close().await;
    peers.b.close().await;
  }

  #[tokio::test]
  async fn unknown_table_aborts_the_batch() {
    let pool = pool().await;
    let row = Row {
      table: "app_settings".into(),
      cols: [
        ("key".to_string(), Some("x".to_string())),
        ("value".to_string(), Some("1".to_string())),
        ("updated_at".to_string(), Some("1".to_string())),
        ("device_id".to_string(), Some("dev-a".to_string())),
      ]
      .into_iter()
      .collect(),
    };
    assert!(store::apply_rows(&pool, &[row]).await.is_err());
  }

  #[tokio::test]
  async fn session_times_out_cleanly_when_peer_vanishes() {
    // Guarda-chuva: dial para endpoint fechado não pode pendurar o teste.
    let peers = peers().await;
    let addr = loopback(&peers.b);
    peers.b.close().await;
    let result = timeout(
      Duration::from_secs(20),
      dial(&peers.a, addr, &peers.local_a, &peers.a_pool),
    )
    .await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_err());
    peers.a.close().await;
  }

  // Garante que o DDL de teste cobre todas as tabelas da allowlist.
  #[tokio::test]
  async fn test_schema_matches_allowlist() {
    let pool = pool().await;
    let schemas = store::load_schema(&pool).await.unwrap();
    assert_eq!(schemas.len(), store::SYNC_TABLES.len());
  }
}
