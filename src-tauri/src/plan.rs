//! Plano do mobile: free com limites, Pro sem limites.
//!
//! O PC é sempre Pro. No mobile o estado fica em `plan.json` no app data, com
//! carimbo da última checagem: sem rede por mais de 7 dias o app volta a
//! tratar o usuário como free até a Play responder de novo.
//!
//! A checagem de verdade roda no Rust, dentro da transação do `db_batch`
//! (`check_limits`): a UI só antecipa o paywall para não deixar o usuário
//! escrever e perder o trabalho no erro.

#[cfg(any(target_os = "android", target_os = "ios"))]
use serde::Deserialize;
use serde::Serialize;
#[cfg(any(target_os = "android", target_os = "ios"))]
use std::path::PathBuf;
#[cfg(any(target_os = "android", target_os = "ios"))]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::Manager;

/// Dias de histórico liberados no free.
pub const HISTORY_DAYS: u32 = 7;
/// Sem falar com a Play por este tempo, o Pro cacheado deixa de valer.
pub const GRACE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanLimits {
  pub notes: u32,
  pub attachments: u32,
  pub habits: u32,
  pub trackers: u32,
  pub finance_categories: u32,
  pub time_categories: u32,
  pub graph_nodes: u32,
  pub history_days: u32,
}

pub fn limits() -> PlanLimits {
  PlanLimits {
    notes: 7,
    attachments: 5,
    habits: 3,
    trackers: 2,
    finance_categories: 4,
    time_categories: 5,
    graph_nodes: 5,
    history_days: HISTORY_DAYS,
  }
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanStatus {
  pub pro: bool,
  /// `play`, `beta` ou `free`.
  pub source: String,
  pub checked_at: Option<i64>,
  pub limits: Option<PlanLimits>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredPlan {
  pro: bool,
  source: String,
  checked_at: i64,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as i64)
    .unwrap_or(0)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn plan_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("app data: {error}"))?;
  Ok(dir.join("plan.json"))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn read_stored(app: &AppHandle) -> StoredPlan {
  let Ok(path) = plan_path(app) else {
    return StoredPlan {
      pro: false,
      source: "free".to_string(),
      checked_at: 0,
    };
  };
  let Ok(raw) = std::fs::read_to_string(path) else {
    return StoredPlan {
      pro: false,
      source: "free".to_string(),
      checked_at: 0,
    };
  };
  serde_json::from_str(&raw).unwrap_or(StoredPlan {
    pro: false,
    source: "free".to_string(),
    checked_at: 0,
  })
}

/// Pro só vale enquanto a última checagem estiver dentro da janela de graça.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn is_pro(stored: &StoredPlan) -> bool {
  stored.pro && now_ms().saturating_sub(stored.checked_at) <= GRACE_MS
}

#[tauri::command]
pub fn plan_status(app: AppHandle) -> Result<PlanStatus, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let stored = read_stored(&app);
    return Ok(PlanStatus {
      pro: is_pro(&stored),
      source: if is_pro(&stored) {
        stored.source
      } else {
        "free".to_string()
      },
      checked_at: Some(stored.checked_at),
      limits: Some(limits()),
    });
  }

  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    let _ = &app;
    Ok(PlanStatus {
      pro: true,
      source: "desktop".to_string(),
      checked_at: None,
      limits: None,
    })
  }
}

/// Grava o resultado de uma compra/restauração vinda do billing.
#[tauri::command]
pub fn plan_set_pro(app: AppHandle, pro: bool, source: String) -> Result<PlanStatus, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let stored = StoredPlan {
      pro,
      source,
      checked_at: now_ms(),
    };
    let path = plan_path(&app)?;
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
      &path,
      serde_json::to_string_pretty(&stored).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
  }

  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    let _ = (&app, pro, source);
  }

  plan_status(app)
}

/// Quantos anexos existem no app data (`attachments/<note>/<file>`).
#[cfg(any(target_os = "android", target_os = "ios"))]
fn attachment_count(app: &AppHandle) -> u64 {
  let Ok(dir) = app.path().app_data_dir() else {
    return 0;
  };
  let root = dir.join("attachments");
  let Ok(notes) = std::fs::read_dir(root) else {
    return 0;
  };
  notes
    .filter_map(Result::ok)
    .filter(|entry| entry.path().is_dir())
    .filter_map(|entry| std::fs::read_dir(entry.path()).ok())
    .map(|files| files.filter_map(Result::ok).count() as u64)
    .sum()
}

/// Chamado dentro da transação: rollback se o free passou de algum limite.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn check_limits(
  app: &AppHandle,
  tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<(), String> {
  let stored = read_stored(app);
  if is_pro(&stored) {
    return Ok(());
  }
  let limit = limits();

  let notes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
  if notes > i64::from(limit.notes) {
    return Err(format!("plan-limit:notes:{}", limit.notes));
  }

  let habits: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM habits WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.active'), 1) = 1",
  )
  .fetch_one(&mut **tx)
  .await
  .map_err(|error| error.to_string())?;
  if habits > i64::from(limit.habits) {
    return Err(format!("plan-limit:habits:{}", limit.habits));
  }

  let trackers: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM trackers WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.active'), 1) = 1",
  )
  .fetch_one(&mut **tx)
  .await
  .map_err(|error| error.to_string())?;
  if trackers > i64::from(limit.trackers) {
    return Err(format!("plan-limit:trackers:{}", limit.trackers));
  }

  let finance: i64 = sqlx::query_scalar::<_, i64>(
    "SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL AND module = 'finance'",
  )
  .fetch_one(&mut **tx)
  .await
  .map_err(|error| error.to_string())?;
  if finance > i64::from(limit.finance_categories) {
    return Err(format!("plan-limit:finance_categories:{}", limit.finance_categories));
  }

  let time: i64 = sqlx::query_scalar::<_, i64>(
    "SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL AND module = 'time'",
  )
  .fetch_one(&mut **tx)
  .await
  .map_err(|error| error.to_string())?;
  if time > i64::from(limit.time_categories) {
    return Err(format!("plan-limit:time_categories:{}", limit.time_categories));
  }

  let nodes: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM graph_nodes WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.origin'), 0) = 0",
  )
  .fetch_one(&mut **tx)
  .await
  .map_err(|error| error.to_string())?;
  if nodes > i64::from(limit.graph_nodes) {
    return Err(format!("plan-limit:graph_nodes:{}", limit.graph_nodes));
  }

  let attachments = attachment_count(app);
  if attachments > u64::from(limit.attachments) {
    return Err(format!("plan-limit:attachments:{}", limit.attachments));
  }

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn free_limits_match_the_product_decision() {
    let limits = limits();
    assert_eq!(limits.notes, 7);
    assert_eq!(limits.attachments, 5);
    assert_eq!(limits.habits, 3);
    assert_eq!(limits.trackers, 2);
    assert_eq!(limits.finance_categories, 4);
    assert_eq!(limits.time_categories, 5);
    assert_eq!(limits.graph_nodes, 5);
    assert_eq!(limits.history_days, 7);
  }

  #[test]
  fn grace_window_is_one_week() {
    assert_eq!(GRACE_MS, 604_800_000);
  }

  /// O guard depende de `json_extract` (JSON1) no SQLite empacotado.
  #[tokio::test]
  async fn json_extract_reads_payload_flags() {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:")
      .await
      .expect("sqlite em memória");
    sqlx::query("CREATE TABLE habits (id TEXT PRIMARY KEY, deleted_at INTEGER, payload TEXT)")
      .execute(&pool)
      .await
      .expect("tabela");
    sqlx::query(
      "INSERT INTO habits (id, payload) VALUES ('a', '{\"active\":true}'), ('b', '{\"active\":false}')",
    )
    .execute(&pool)
    .await
    .expect("linhas");
    let active: i64 = sqlx::query_scalar(
      "SELECT COUNT(*) FROM habits WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.active'), 1) = 1",
    )
    .fetch_one(&pool)
    .await
    .expect("json_extract");
    assert_eq!(active, 1);
  }
}
