//! Commands do sync (P2c/P3): ciclo de vida, pareamento, allowlist e eventos.
//!
//! A UI de Sincronização é P5; aqui ficam só as operações que ela vai chamar.
//! O opt-in mora em `app_settings.sync_enabled` (ausente = desligado) e o banco
//! de teste nunca liga: juntar fixture com o banco real seria corrupção.
//!
//! Pareamento (`atlas/pair/1`) é o único caminho que aceita um par fora da
//! allowlist, e só até os dois lados confirmarem o SAS de 6 dígitos.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use iroh::{Endpoint, EndpointAddr, EndpointId};
use serde::Serialize;
use sqlx::{Row as SqlRow, SqlitePool};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{oneshot, Mutex};

use super::protocol::{self, Cursor};
use super::{engine, identity, pair, session, store};
#[cfg(not(target_os = "ios"))]
use super::discovery;
#[cfg(target_os = "ios")]
use super::discovery_ios;

/// Banco do modo de teste: sync desligado por decisão (`docs/SYNC.md` §3).
pub const TEST_DB: &str = "sqlite:atlas.test.db";

/// Evento emitido ao fim de uma sessão que aplicou algo.
pub const EVENT_APPLIED: &str = "atlas://sync-applied";
/// Alguém pediu pareamento (a UI mostra o SAS e pede confirmação).
pub const EVENT_PAIR_REQUEST: &str = "atlas://sync-pair-request";
/// Pareamento confirmado dos dois lados.
pub const EVENT_PAIRED: &str = "atlas://sync-paired";

/// Opt-in do sync (local, nunca sincroniza).
const ENABLED_KEY: &str = "sync_enabled";

/// Não martelar um par que acabou de falhar (mDNS reanuncia o tempo todo).
const DIAL_COOLDOWN: Duration = Duration::from_secs(30);

/// Quanto tempo o SAS fica válido para confirmação.
pub const PAIR_TTL: Duration = Duration::from_secs(120);
/// Tentativas de pareamento por par antes de um descanso.
const PAIR_MAX_ATTEMPTS: u32 = 3;

#[derive(Default)]
pub struct SyncState {
  inner: Mutex<Option<Running>>,
}

struct Running {
  endpoint: Endpoint,
  endpoint_id: EndpointId,
  local: engine::LocalNode,
  pair_local: pair::PairLocal,
  #[cfg(not(target_os = "ios"))]
  advertisement: Option<discovery::Advertisement>,
  #[cfg(target_os = "ios")]
  discovery: Option<discovery_ios::Discovery>,
  alive: Arc<AtomicBool>,
  discovered: Arc<Mutex<BTreeMap<EndpointId, Discovered>>>,
  in_flight: Arc<Mutex<BTreeSet<EndpointId>>>,
  last_attempt: Arc<Mutex<HashMap<EndpointId, Instant>>>,
  pending: Arc<Mutex<BTreeMap<EndpointId, PendingPair>>>,
  attempts: Arc<Mutex<HashMap<EndpointId, PairAttempt>>>,
}

#[derive(Debug, Clone)]
struct Discovered {
  name: String,
  addr: EndpointAddr,
}

struct PendingPair {
  name: String,
  sas: String,
  expires_at: Instant,
  decision: Option<oneshot::Sender<bool>>,
}

#[derive(Debug, Clone, Copy)]
struct PairAttempt {
  count: u32,
  started: Instant,
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
pub struct SyncPendingPair {
  pub endpoint_id: String,
  pub name: String,
  pub sas: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
  pub enabled: bool,
  pub running: bool,
  pub endpoint_id: Option<String>,
  pub peers: Vec<SyncPeerStatus>,
  pub pending_pairs: Vec<SyncPendingPair>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDiscovered {
  pub endpoint_id: String,
  pub name: String,
  /// `ip:porta` do primeiro endereço (para pareamento manual).
  pub address: Option<String>,
  pub paired: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStarted {
  pub peer: String,
  pub sas: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairRequestEvent {
  peer: String,
  name: String,
  sas: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairedEvent {
  peer: String,
  name: String,
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

struct DialContext {
  app: AppHandle,
  endpoint: Endpoint,
  local: engine::LocalNode,
  pool: SqlitePool,
  in_flight: Arc<Mutex<BTreeSet<EndpointId>>>,
  last_attempt: Arc<Mutex<HashMap<EndpointId, Instant>>>,
  alive: Arc<AtomicBool>,
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

fn spawn_accept(
  app: AppHandle,
  endpoint: Endpoint,
  local: engine::LocalNode,
  pair_local: pair::PairLocal,
  pool: SqlitePool,
  pending: Arc<Mutex<BTreeMap<EndpointId, PendingPair>>>,
  attempts: Arc<Mutex<HashMap<EndpointId, PairAttempt>>>,
) {
  tauri::async_runtime::spawn(async move {
    loop {
      let (conn, alpn) = match engine::accept_raw(&endpoint).await {
        Ok(Some(incoming)) => incoming,
        Ok(None) => break,
        Err(error) if error.contains("timeout") => continue,
        Err(error) => {
          log::warn!("sync: accept falhou: {error}");
          continue;
        }
      };
      match alpn.as_slice() {
        protocol::ALPN => {
          let remote = conn.remote_id().to_string();
          let cursors = store::cursors_for(&pool, &remote).await.unwrap_or_default();
          // Em erro de banco a allowlist vazia recusa todo mundo (lado seguro).
          let allowlist = store::allowlist(&pool).await.unwrap_or_default();
          match engine::accept_handshake(conn, &local, cursors, Some(&allowlist)).await {
            Ok(session) => {
              let app = app.clone();
              let pool = pool.clone();
              tauri::async_runtime::spawn(async move {
                match session::run(session, &pool).await {
                  Ok(report) => {
                    log::info!(
                      "sync: sessão com {} — aplicadas {}, ignoradas {}",
                      report.peer,
                      report.applied,
                      report.skipped
                    );
                    emit_report(&app, &report);
                  }
                  Err(error) => log::warn!("sync: sessão falhou: {error}"),
                }
              });
            }
            Err(error) => log::warn!("sync: handshake recusado: {error}"),
          }
        }
        pair::ALPN => {
          let app = app.clone();
          let pool = pool.clone();
          let pending = pending.clone();
          let attempts = attempts.clone();
          let pair_local = pair_local.clone();
          tauri::async_runtime::spawn(async move {
            let peer = conn.remote_id();
            let (decision_tx, decision_rx) = oneshot::channel();
            let pending_for_offer = pending.clone();
            let app_for_offer = app.clone();
            let result = pair::accept(conn, pair_local, move |offer| {
              let pending = pending_for_offer.clone();
              let app = app_for_offer.clone();
              let sas = offer.sas.clone();
              let name = offer.peer_name.clone();
              async move {
                pending.lock().await.insert(
                  peer,
                  PendingPair {
                    name: name.clone(),
                    sas: sas.clone(),
                    expires_at: Instant::now() + PAIR_TTL,
                    decision: Some(decision_tx),
                  },
                );
                if let Err(error) = app.emit(
                  EVENT_PAIR_REQUEST,
                  PairRequestEvent {
                    peer: peer.to_string(),
                    name,
                    sas,
                  },
                ) {
                  log::warn!("sync: falha ao emitir {EVENT_PAIR_REQUEST}: {error}");
                }
                tokio::time::timeout(PAIR_TTL, decision_rx)
                  .await
                  .ok()
                  .and_then(|decision| decision.ok())
                  .unwrap_or(false)
              }
            })
            .await;
            pending.lock().await.remove(&peer);
            match result {
              Ok(outcome) => {
                if let Err(error) = store::add_peer(&pool, &peer.to_string(), &outcome.peer_name, now_ms()).await {
                  log::warn!("sync: parear: {error}");
                  return;
                }
                attempts.lock().await.remove(&peer);
                let _ = app.emit(
                  EVENT_PAIRED,
                  PairedEvent {
                    peer: peer.to_string(),
                    name: outcome.peer_name,
                  },
                );
                log::info!("sync: pareado com {} ({})", peer, outcome.sas);
              }
              Err(error) => log::warn!("sync: pareamento recusado/falhou: {error}"),
            }
          });
        }
        other => {
          log::warn!("sync: ALPN inesperado: {}", String::from_utf8_lossy(other));
          conn.close(0u32.into(), b"alpn");
        }
      }
    }
  });
}

#[cfg(not(target_os = "ios"))]
fn spawn_discovery(
  context: Arc<DialContext>,
  receiver: mdns_sd::Receiver<mdns_sd::ServiceEvent>,
  discovered: Arc<Mutex<BTreeMap<EndpointId, Discovered>>>,
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
    while context.alive.load(Ordering::Relaxed) {
      let Some(event) = events_rx.recv().await else {
        break;
      };
      let mdns_sd::ServiceEvent::ServiceResolved(info) = event else {
        continue;
      };
      let Some(peer) = discovery::parse_resolved(&info) else {
        continue;
      };
      if peer.addr.id == me {
        continue;
      }
      discovered.lock().await.insert(
        peer.addr.id,
        Discovered {
          name: peer.name.clone(),
          addr: peer.addr.clone(),
        },
      );
      // EndpointID menor disca; o outro só aceita.
      if me > peer.addr.id {
        continue;
      }
      let allowlist = store::allowlist(&context.pool).await.unwrap_or_else(|error| {
        log::warn!("sync: allowlist: {error}");
        BTreeSet::new()
      });
      if !allowlist.contains(&peer.addr.id.to_string()) {
        continue;
      }
      start_dial(&context, peer.addr).await;
    }
  });
}

/// Loop de descoberta no iOS: lê o snapshot do plugin e disca os pareados.
#[cfg(target_os = "ios")]
fn spawn_discovery_ios(
  context: Arc<DialContext>,
  discovery: discovery_ios::Handle,
  discovered: Arc<Mutex<BTreeMap<EndpointId, Discovered>>>,
) {
  tauri::async_runtime::spawn(async move {
    let me = context.endpoint.id();
    while context.alive.load(Ordering::Relaxed) {
      {
        let peers = discovery.snapshot();
        {
          for peer in peers {
            let Ok(id) = peer.id.parse::<EndpointId>() else {
              continue;
            };
            if id == me || peer.addresses.is_empty() {
              continue;
            }
            let mut addr = EndpointAddr::new(id);
            for ip in &peer.addresses {
              if let Ok(socket) = format!("{ip}:{}", peer.port).parse::<std::net::SocketAddr>() {
                addr = addr.with_ip_addr(socket);
              }
            }
            discovered.lock().await.insert(
              id,
              Discovered {
                name: peer.name.clone(),
                addr: addr.clone(),
              },
            );
            if me > id {
              continue;
            }
            let allowlist = store::allowlist(&context.pool).await.unwrap_or_default();
            if !allowlist.contains(&id.to_string()) {
              continue;
            }
            start_dial(&context, addr).await;
          }
        }
      }
      tokio::time::sleep(discovery_ios::POLL).await;
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
  let (endpoint_id, pending_pairs) = match guard.as_ref() {
    Some(running) => {
      let pending = running
        .pending
        .lock()
        .await
        .iter()
        .filter(|(_, pending)| pending.expires_at > Instant::now())
        .map(|(peer, pending)| SyncPendingPair {
          endpoint_id: peer.to_string(),
          name: pending.name.clone(),
          sas: pending.sas.clone(),
        })
        .collect();
      (Some(running.endpoint_id.to_string()), pending)
    }
    None => (None, Vec::new()),
  };
  Ok(SyncStatus {
    enabled,
    running: guard.is_some(),
    endpoint_id,
    peers,
    pending_pairs,
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
  let key = identity::load_or_create(&identity::identity_path(&app_dir))
    .map_err(|error| format!("identidade do sync: {error}"))?;
  let endpoint = engine::bind(key).await?;
  let endpoint_id = endpoint.id();
  let name = format!("Atlas {}", endpoint_id.fmt_short());

  #[cfg(not(target_os = "ios"))]
  let (advertisement, receiver) = discovery::Advertisement::start(&endpoint)?;
  #[cfg(target_os = "ios")]
  let ios_discovery = {
    let port = endpoint
      .bound_sockets()
      .first()
      .map(std::net::SocketAddr::port)
      .ok_or_else(|| "endpoint sem socket UDP ligado".to_string())?;
    discovery_ios::Discovery::start(&endpoint_id.to_string(), &name, port)?
  };

  let pair_local = pair::PairLocal {
    endpoint_id: endpoint_id.to_string(),
    device_id: device_id.clone(),
    name: name.clone(),
  };
  let local = engine::LocalNode::new(schema, device_id);
  let discovered = Arc::new(Mutex::new(BTreeMap::new()));
  let in_flight = Arc::new(Mutex::new(BTreeSet::new()));
  let last_attempt = Arc::new(Mutex::new(HashMap::new()));
  let pending = Arc::new(Mutex::new(BTreeMap::new()));
  let attempts = Arc::new(Mutex::new(HashMap::new()));
  let alive = Arc::new(AtomicBool::new(true));

  spawn_accept(
    app.clone(),
    endpoint.clone(),
    local.clone(),
    pair_local.clone(),
    pool.clone(),
    pending.clone(),
    attempts.clone(),
  );
  let context = Arc::new(DialContext {
    app: app.clone(),
    endpoint: endpoint.clone(),
    local: local.clone(),
    pool: pool.clone(),
    in_flight: in_flight.clone(),
    last_attempt: last_attempt.clone(),
    alive: alive.clone(),
  });
  #[cfg(not(target_os = "ios"))]
  spawn_discovery(context, receiver, discovered.clone());
  #[cfg(target_os = "ios")]
  spawn_discovery_ios(context, ios_discovery.handle(), discovered.clone());

  set_enabled(&pool, true).await?;

  let mut guard = state.inner.lock().await;
  if guard.is_some() {
    #[cfg(not(target_os = "ios"))]
    advertisement.stop();
    #[cfg(target_os = "ios")]
    ios_discovery.stop();
    endpoint.close().await;
    return Err("sync já estava rodando".to_string());
  }
  *guard = Some(Running {
    endpoint,
    endpoint_id,
    local,
    pair_local,
    #[cfg(not(target_os = "ios"))]
    advertisement: Some(advertisement),
    #[cfg(target_os = "ios")]
    discovery: Some(ios_discovery),
    alive,
    discovered,
    in_flight,
    last_attempt,
    pending,
    attempts,
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
    running.alive.store(false, Ordering::Relaxed);
    #[cfg(not(target_os = "ios"))]
    if let Some(advertisement) = running.advertisement.take() {
      advertisement.stop();
    }
    #[cfg(target_os = "ios")]
    if let Some(discovery) = running.discovery.take() {
      discovery.stop();
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
  let (endpoint, local, discovered, in_flight, last_attempt, alive) = {
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
      running.alive.clone(),
    )
  };
  let allowlist = store::allowlist(&pool).await?;
  let peers: Vec<EndpointAddr> = discovered
    .lock()
    .await
    .values()
    .map(|entry| entry.addr.clone())
    .collect();
  let context = DialContext {
    app: app.clone(),
    endpoint,
    local,
    pool,
    in_flight,
    last_attempt,
    alive,
  };
  for peer in peers {
    if peer.id > context.endpoint.id() && allowlist.contains(&peer.id.to_string()) {
      start_dial(&context, peer).await;
    }
  }
  status(&app, &db, &state).await
}

/// Pares vistos na LAN agora (para a lista de pareamento do P5).
#[tauri::command]
pub async fn sync_discovered(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
) -> Result<Vec<SyncDiscovered>, String> {
  let pool = pool(&app, &db).await?;
  let allowlist = store::allowlist(&pool).await?;
  let guard = state.inner.lock().await;
  let Some(running) = guard.as_ref() else {
    return Ok(Vec::new());
  };
  let discovered = running.discovered.lock().await;
  Ok(discovered
    .iter()
    .map(|(id, entry)| SyncDiscovered {
      endpoint_id: id.to_string(),
      name: entry.name.clone(),
      address: entry
        .addr
        .ip_addrs()
        .next()
        .map(|socket| socket.to_string()),
      paired: allowlist.contains(&id.to_string()),
    })
    .collect())
}

/// Pede pareamento com um par descoberto (ou informe `ip:porta`).
#[tauri::command]
pub async fn sync_pair_begin(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
  peer: String,
  address: Option<String>,
) -> Result<PairStarted, String> {
  ensure_prod(&db)?;
  let peer_id: EndpointId = peer
    .parse()
    .map_err(|_| format!("EndpointID inválido: {peer}"))?;
  let pool = pool(&app, &db).await?;
  let (endpoint, pair_local, pending, attempts_for_check, discovered) = {
    let guard = state.inner.lock().await;
    let Some(running) = guard.as_ref() else {
      return Err("sync não está rodando".to_string());
    };
    (
      running.endpoint.clone(),
      running.pair_local.clone(),
      running.pending.clone(),
      running.attempts.clone(),
      running.discovered.clone(),
    )
  };

  // Limite de tentativas: 3 por par em uma janela de TTL.
  {
    let mut attempts = attempts_for_check.lock().await;
    let entry = attempts.entry(peer_id).or_insert(PairAttempt {
      count: 0,
      started: Instant::now(),
    });
    if entry.started.elapsed() > PAIR_TTL {
      *entry = PairAttempt {
        count: 0,
        started: Instant::now(),
      };
    }
    if entry.count >= PAIR_MAX_ATTEMPTS {
      return Err("muitas tentativas de pareamento; espere 2 min".to_string());
    }
    entry.count += 1;
  }

  let target = match address {
    Some(text) => {
      let socket: std::net::SocketAddr = text
        .parse()
        .map_err(|_| format!("endereço inválido (use ip:porta): {text}"))?;
      EndpointAddr::new(peer_id).with_ip_addr(socket)
    }
    None => discovered
      .lock()
      .await
      .get(&peer_id)
      .map(|entry| entry.addr.clone())
      .ok_or_else(|| "par não descoberto: informe ip:porta".to_string())?,
  };

  let conn = tokio::time::timeout(pair::TIMEOUT, endpoint.connect(target, pair::ALPN))
    .await
    .map_err(|_| "timeout ao conectar para parear".to_string())?
    .map_err(|error| format!("conexão de pareamento: {error}"))?;

  let (sas_tx, sas_rx) = oneshot::channel::<String>();
  let (decision_tx, decision_rx) = oneshot::channel::<bool>();
  let pending_for_session = pending.clone();
  let attempts = attempts_for_check.clone();
  let app_for_session = app.clone();
  let pool_for_session = pool.clone();
  tauri::async_runtime::spawn(async move {
    let pending_for_offer = pending_for_session.clone();
    let result = pair::dial(conn, pair_local, move |offer| {
      let pending = pending_for_offer.clone();
      let sas = offer.sas.clone();
      let name = offer.peer_name.clone();
      async move {
        pending.lock().await.insert(
          peer_id,
          PendingPair {
            name,
            sas: sas.clone(),
            expires_at: Instant::now() + PAIR_TTL,
            decision: Some(decision_tx),
          },
        );
        let _ = sas_tx.send(sas);
        tokio::time::timeout(PAIR_TTL, decision_rx)
          .await
          .ok()
          .and_then(|decision| decision.ok())
          .unwrap_or(false)
      }
    })
    .await;
    pending_for_session.lock().await.remove(&peer_id);
    match result {
      Ok(outcome) => {
        match store::add_peer(&pool_for_session, &peer_id.to_string(), &outcome.peer_name, now_ms()).await {
          Ok(()) => {
            attempts.lock().await.remove(&peer_id);
            let _ = app_for_session.emit(
              EVENT_PAIRED,
              PairedEvent {
                peer: peer_id.to_string(),
                name: outcome.peer_name,
              },
            );
            log::info!("sync: pareado com {} ({})", peer_id, outcome.sas);
          }
          Err(error) => log::warn!("sync: parear: {error}"),
        }
      }
      Err(error) => log::warn!("sync: pareamento cancelado/falhou: {error}"),
    }
  });

  let sas = tokio::time::timeout(PAIR_TTL, sas_rx)
    .await
    .map_err(|_| "timeout no pareamento".to_string())?
    .map_err(|_| "pareamento encerrou antes do SAS".to_string())?;
  Ok(PairStarted {
    peer: peer_id.to_string(),
    sas,
  })
}

/// Confirma (ou recusa) o SAS do pedido pendente com `peer`.
#[tauri::command]
pub async fn sync_pair_confirm(
  state: State<'_, SyncState>,
  peer: String,
  accept: bool,
) -> Result<(), String> {
  let peer_id: EndpointId = peer
    .parse()
    .map_err(|_| format!("EndpointID inválido: {peer}"))?;
  let pending = {
    let guard = state.inner.lock().await;
    let Some(running) = guard.as_ref() else {
      return Err("sync não está rodando".to_string());
    };
    running.pending.clone()
  };
  let mut map = pending.lock().await;
  let Some(entry) = map.remove(&peer_id) else {
    return Err("nenhum pedido de pareamento pendente".to_string());
  };
  if entry.expires_at <= Instant::now() {
    return Err("pedido de pareamento expirado".to_string());
  }
  entry
    .decision
    .ok_or_else(|| "pareamento já encerrado".to_string())?
    .send(accept)
    .map_err(|_| "pareamento já encerrado".to_string())
}

/// Desemparelha: remove o par e os cursores dele.
#[tauri::command]
pub async fn sync_unpair(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
  peer: String,
) -> Result<SyncStatus, String> {
  ensure_prod(&db)?;
  let pool = pool(&app, &db).await?;
  store::remove_peer(&pool, &peer).await?;
  if let Ok(peer_id) = peer.parse::<EndpointId>() {
    if let Some(running) = state.inner.lock().await.as_ref() {
      running.pending.lock().await.remove(&peer_id);
      running.attempts.lock().await.remove(&peer_id);
    }
  }
  status(&app, &db, &state).await
}

/// Cursors de um par (para inspeção/console). Não usado pela UI ainda.
#[tauri::command]
pub async fn sync_cursors(app: AppHandle, db: String, peer: String) -> Result<Vec<Cursor>, String> {
  let pool = pool(&app, &db).await?;
  store::cursors_for(&pool, &peer).await
}

#[tauri::command]
pub async fn sync_status(
  app: AppHandle,
  state: State<'_, SyncState>,
  db: String,
) -> Result<SyncStatus, String> {
  status(&app, &db, &state).await
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
