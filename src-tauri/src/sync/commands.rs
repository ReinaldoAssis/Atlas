//! Commands do sync (P2c): ciclo de vida, allowlist e evento pro front.
//!
//! A UI de Sincronização é P5; aqui ficam só as operações que ela vai chamar.
//! O opt-in mora em `app_settings.sync_enabled` (ausente = desligado) e o banco
//! de teste nunca liga: juntar fixture com o banco real seria corrupção.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use iroh::{Endpoint, EndpointAddr, EndpointId};
use serde::Serialize;
use sqlx::{Row as SqlRow, SqlitePool};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use super::protocol::Cursor;
use super::{discovery, engine, identity, session, store};

/// Banco do modo de teste: sync desligado por decisão (`docs/SYNC.md` §3).
pub const TEST_DB: &str = "sqlite:atlas.test.db";

/// Evento emitido ao fim de uma sessão que aplicou algo.
pub const EVENT_APPLIED: &str = "atlas://sync-applied";

/// Opt-in do sync (local, nunca sincroniza).
const ENABLED_KEY: &str = "sync_enabled";

/// Não martelar um par que acabou de falhar (mDNS reanuncia o tempo todo).
const DIAL_COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct SyncState {
  inner: Mutex<Option<Running>>,
}

struct Running {
  endpoint: Endpoint,
  endpoint_id: EndpointId,
  local: engine::LocalNode,
  advertisement: Option<discovery::Advertisement>,
  discovered: Arc<Mutex<HashMap<EndpointId, EndpointAddr>>>,
  in_flight: Arc<Mutex<BTreeSet<EndpointId>>>,
  last_attempt: Arc<Mutex<HashMap<EndpointId, Instant>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplied {
  pub peer: String,
  pub applied: usize,
  pub skipped: usize,
  pub at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPeerStatus {
  pub endpoint_id: String,
  pub name: String,
  pub last_sync_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
  pub enabled: bool,
  pub running: bool,
  pub endpoint_id: Option<String>,
  pub peers: Vec<SyncPeerStatus>,
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|elapsed| elapsed.as_millis() as i64)
    .unwrap_or(0)
}

/// Banco ativo; recusa o modo de teste.
fn ensure_prod(db: &str) -> Result<(), String> {
  if db == TEST_DB {
    return Err("sync desligado no modo de teste".to_string());
  }
  Ok(())
}

async fn pool(app: &AppHandle, db: &str) -> Result<SqlitePool, String> {
  let instances = app.state::<tauri_plugin_sql::DbInstances>();
  let guard = instances.0.read().await;
  match guard.get(db) {
    Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Ok(pool.clone()),
    None => Err(format!("banco {db} não carregado")),
  }
}

async fn read_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
  let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("app_settings.{key}: {error}"))?;
  Ok(row.and_then(|row| row.try_get::<String, _>("value").ok()))
}

async fn is_enabled(pool: &SqlitePool) -> Result<bool, String> {
  Ok(read_setting(pool, ENABLED_KEY)
    .await?
    .and_then(|value| serde_json::from_str::<bool>(&value).ok())
    .unwrap_or(false))
}

async fn set_enabled(pool: &SqlitePool, value: bool) -> Result<(), String> {
  sqlx::query("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")
    .bind(ENABLED_KEY)
    .bind(serde_json::to_string(&value).map_err(|error| error.to_string())?)
    .execute(pool)
    .await
    .map_err(|error| format!("app_settings.{ENABLED_KEY}: {error}"))?;
  Ok(())
}

async fn device_id(pool: &SqlitePool) -> Result<String, String> {
  read_setting(pool, "device_id")
    .await?
    .and_then(|value| serde_json::from_str::<String>(&value).ok())
    .filter(|value| !value.is_empty())
    .ok_or_else(|| "device_id ausente: abra o app antes de ligar o sync".to_string())
}

fn emit_report(app: &AppHandle, report: &session::SessionReport) {
  if report.applied == 0 && report.skipped == 0 {
    return;
  }
  let payload = SyncApplied {
    peer: report.peer.clone(),
    applied: report.applied,
    skipped: report.skipped,
    at: now_ms(),
  };
  if let Err(error) = app.emit(EVENT_APPLIED, payload) {
    log::warn!("sync: falha ao emitir {EVENT_APPLIED}: {error}");
  }
}

fn spawn_accept(app: AppHandle, endpoint: Endpoint, local: engine::LocalNode, pool: SqlitePool) {
  tauri::async_runtime::spawn(async move {
    loop {
      match session::accept(&endpoint, &local, &pool).await {
        Ok(Some(report)) => {
          log::info!(
            "sync: sessão com {} — aplicadas {}, ignoradas {}",
            report.peer,
            report.applied,
            report.skipped
          );
          emit_report(&app, &report);
        }
        Ok(None) => break,
        Err(error) if error.contains("timeout no hello") => continue,
        Err(error) => log::warn!("sync: accept falhou: {error}"),
      }
    }
  });
}

struct DialContext {
  app: AppHandle,
  endpoint: Endpoint,
  local: engine::LocalNode,
  pool: SqlitePool,
  in_flight: Arc<Mutex<BTreeSet<EndpointId>>>,
  last_attempt: Arc<Mutex<HashMap<EndpointId, Instant>>>,
}

/// Dispara uma sessão contra `peer`, respeitando cooldown e sessão em andamento.
async fn start_dial(context: &DialContext, peer: EndpointAddr) {
  {
    let mut attempts = context.last_attempt.lock().await;
    if let Some(last) = attempts.get(&peer.id) {
      if last.elapsed() < DIAL_COOLDOWN {
        return;
      }
    }
    attempts.insert(peer.id, Instant::now());
  }
  if !context.in_flight.lock().await.insert(peer.id) {
    return;
  }
  let app = context.app.clone();
  let endpoint = context.endpoint.clone();
  let local = context.local.clone();
  let pool = context.pool.clone();
  let in_flight = context.in_flight.clone();
  tauri::async_runtime::spawn(async move {
    match session::dial(&endpoint, peer.clone(), &local, &pool).await {
      Ok(report) => {
        log::info!(
          "sync: sessão com {} — enviadas {}, aplicadas {}, ignoradas {}",
          report.peer,
          report.sent,
          report.applied,
          report.skipped
        );
        emit_report(&app, &report);
      }
      Err(error) => log::warn!("sync: dial para {} falhou: {error}", peer.id),
    }
    in_flight.lock().await.remove(&peer.id);
  });
}

fn spawn_discovery(
  context: Arc<DialContext>,
  receiver: mdns_sd::Receiver<mdns_sd::ServiceEvent>,
  discovered: Arc<Mutex<HashMap<EndpointId, EndpointAddr>>>,
) {
  tauri::async_runtime::spawn(async move {
    // `Receiver::recv` é bloqueante: bombeia para o runtime async.
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
      while let Ok(event) = receiver.recv() {
        if events_tx.send(event).is_err() {
          break;
        }
      }
    });

    let me = context.endpoint.id();
    while let Some(event) = events_rx.recv().await {
      let mdns_sd::ServiceEvent::ServiceResolved(info) = event else {
        continue;
      };
      let Some(peer) = discovery::parse_resolved(&info) else {
        continue;
      };
      if peer.id == me {
        continue;
      }
      discovered.lock().await.insert(peer.id, peer.clone());
      // EndpointID menor disca; o outro só aceita.
      if me > peer.id {
        continue;
      }
      let allowlist = store::allowlist(&context.pool).await.unwrap_or_else(|error| {
        log::warn!("sync: allowlist: {error}");
        BTreeSet::new()
      });
      if !allowlist.contains(&peer.id.to_string()) {
        continue;
      }
      start_dial(&context, peer).await;
    }
  });
}

async fn status(app: &AppHandle, db: &str, state: &SyncState) -> Result<SyncStatus, String> {
  let pool = pool(app, db).await?;
  let enabled = is_enabled(&pool).await?;
  let peers = store::peers(&pool)
    .await?
    .into_iter()
    .map(|peer| SyncPeerStatus {
      endpoint_id: peer.endpoint_id,
      name: peer.name,
      last_sync_at: peer.last_sync_at,
    })
    .collect();
  let guard = state.inner.lock().await;
  Ok(SyncStatus {
    enabled,
    running: guard.is_some(),
    endpoint_id: guard.as_ref().map(|running| running.endpoint_id.to_string()),
    peers,
  })
}

/// Liga o endpoint, anuncia e passa a sincronizar com os pares pareados.
#[tauri::command]
pub async fn sync_start(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
) -> Result<SyncStatus, String> {
  ensure_prod(&db)?;
  if state.inner.lock().await.is_some() {
    return status(&app, &db, &state).await;
  }
  let pool = pool(&app, &db).await?;
  let schema = store::schema_version(&pool).await?;
  let device_id = device_id(&pool).await?;
  let app_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  let key = identity::load_or_create(&identity::identity_path(&app_dir)).map_err(|error| {
    format!("identidade do sync: {error}")
  })?;
  let endpoint = engine::bind(key).await?;
  let endpoint_id = endpoint.id();
  let (advertisement, receiver) = discovery::Advertisement::start(&endpoint)?;

  let local = engine::LocalNode::new(schema, device_id);
  let discovered = Arc::new(Mutex::new(HashMap::new()));
  let in_flight = Arc::new(Mutex::new(BTreeSet::new()));
  let last_attempt = Arc::new(Mutex::new(HashMap::new()));

  // O accept roda solto: `sync_stop` fecha o endpoint e o loop termina com
  // `Ok(None)`.
  spawn_accept(app.clone(), endpoint.clone(), local.clone(), pool.clone());

  let context = Arc::new(DialContext {
    app: app.clone(),
    endpoint: endpoint.clone(),
    local: local.clone(),
    pool: pool.clone(),
    in_flight: in_flight.clone(),
    last_attempt: last_attempt.clone(),
  });
  spawn_discovery(context, receiver, discovered.clone());

  set_enabled(&pool, true).await?;

  let mut guard = state.inner.lock().await;
  if guard.is_some() {
    advertisement.stop();
    endpoint.close().await;
    return Err("sync já estava rodando".to_string());
  }
  *guard = Some(Running {
    endpoint,
    endpoint_id,
    local,
    advertisement: Some(advertisement),
    discovered,
    in_flight,
    last_attempt,
  });
  drop(guard);
  status(&app, &db, &state).await
}

/// Para o anúncio e encerra o endpoint; pares e cursores ficam.
#[tauri::command]
pub async fn sync_stop(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
) -> Result<SyncStatus, String> {
  let pool = pool(&app, &db).await?;
  let running = { state.inner.lock().await.take() };
  if let Some(mut running) = running {
    if let Some(advertisement) = running.advertisement.take() {
      advertisement.stop();
    }
    running.endpoint.close().await;
  }
  set_enabled(&pool, false).await?;
  status(&app, &db, &state).await
}

/// Força uma sessão com cada par já descoberto (o outro lado só aceita).
#[tauri::command]
pub async fn sync_now(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
) -> Result<SyncStatus, String> {
  ensure_prod(&db)?;
  let pool = pool(&app, &db).await?;
  let (endpoint, local, discovered, in_flight, last_attempt) = {
    let guard = state.inner.lock().await;
    let Some(running) = guard.as_ref() else {
      return Err("sync não está rodando".to_string());
    };
    (
      running.endpoint.clone(),
      running.local.clone(),
      running.discovered.clone(),
      running.in_flight.clone(),
      running.last_attempt.clone(),
    )
  };
  let allowlist = store::allowlist(&pool).await?;
  let peers: Vec<EndpointAddr> = discovered.lock().await.values().cloned().collect();
  let context = DialContext {
    app: app.clone(),
    endpoint,
    local,
    pool,
    in_flight,
    last_attempt,
  };
  for peer in peers {
    if peer.id > context.endpoint.id() && allowlist.contains(&peer.id.to_string()) {
      start_dial(&context, peer).await;
    }
  }
  status(&app, &db, &state).await
}

#[tauri::command]
pub async fn sync_status(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
) -> Result<SyncStatus, String> {
  status(&app, &db, &state).await
}

/// Cursors de um par (para inspeção/console). Não usado pela UI ainda.
#[tauri::command]
pub async fn sync_cursors(
  app: AppHandle,
  db: String,
  peer: String,
) -> Result<Vec<Cursor>, String> {
  let pool = pool(&app, &db).await?;
  store::cursors_for(&pool, &peer).await
}

#[cfg(test)]
mod tests {
  use sqlx::sqlite::SqlitePoolOptions;

  use super::*;

  async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
      .max_connections(1)
      .connect("sqlite::memory:")
      .await
      .expect("sqlite em memória");
    sqlx::query("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
      .execute(&pool)
      .await
      .expect("DDL");
    pool
  }

  #[test]
  fn test_mode_never_starts_sync() {
    assert!(ensure_prod(TEST_DB).is_err());
    assert!(ensure_prod("sqlite:atlas.db").is_ok());
  }

  #[tokio::test]
  async fn enabled_flag_defaults_to_off_and_roundtrips() {
    let pool = pool().await;
    assert!(!is_enabled(&pool).await.unwrap(), "ausente = desligado");
    set_enabled(&pool, true).await.unwrap();
    assert!(is_enabled(&pool).await.unwrap());
    set_enabled(&pool, false).await.unwrap();
    assert!(!is_enabled(&pool).await.unwrap());
  }

  #[tokio::test]
  async fn device_id_is_required() {
    let pool = pool().await;
    assert!(device_id(&pool).await.is_err());
    sqlx::query("INSERT INTO app_settings (key, value) VALUES ('device_id', ?)")
      .bind(serde_json::to_string("dev-a").unwrap())
      .execute(&pool)
      .await
      .unwrap();
    assert_eq!(device_id(&pool).await.unwrap(), "dev-a");
  }

  #[tokio::test]
  async fn status_peers_come_from_sync_peers() {
    let pool = pool().await;
    sqlx::query(
      "CREATE TABLE sync_peers (endpoint_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
       paired_at INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER NOT NULL DEFAULT 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO sync_peers (endpoint_id, name, last_sync_at) VALUES ('abc', 'iPhone', 42)")
      .execute(&pool)
      .await
      .unwrap();
    let peers = store::peers(&pool).await.unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].name, "iPhone");
    assert_eq!(peers[0].last_sync_at, 42);
  }
}
