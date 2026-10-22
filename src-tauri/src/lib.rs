use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

// Sync P2P (S10). No iOS a descoberta é um plugin Swift (P4); no Android é o
// mesmo `mdns-sd` do desktop, com `MulticastLock` (plugin Kotlin).
pub mod multicast;
pub mod plan;
pub mod sync;

#[derive(Deserialize)]
pub struct BatchStatement {
  pub sql: String,
  #[serde(default)]
  pub params: Vec<String>,
}

/// Notificação nativa no macOS.
///
/// O caminho do `tauri-plugin-notification` no macOS usa
/// `NSUserNotificationCenter` (API removida nas versões recentes) e o banner é
/// descartado em builds ad-hoc. O `osascript` é o fallback que funciona em
/// qualquer assinatura; no Windows/iOS o plugin continua sendo usado.
#[tauri::command]
fn native_notification(title: String, body: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let escape = |value: &str| value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ");
    let script = format!(
      "display notification \"{}\" with title \"{}\"",
      escape(&body),
      escape(&title)
    );
    let output = std::process::Command::new("osascript")
      .arg("-e")
      .arg(script)
      .output()
      .map_err(|error| format!("osascript: {error}"))?;
    if output.status.success() {
      Ok(())
    } else {
      Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (title, body);
    Err("notificação nativa só no macOS".to_string())
  }
}

/// Executa uma lista de statements numa única transação sobre UMA conexão.
///
/// O plugin SQL usa um pool do sqlx. Enviar `BEGIN`/`COMMIT` como comandos
/// separados não garante a mesma conexão (o pool abre várias, por exemplo por
/// causa dos SELECTs em paralelo no load), o que gera
/// "cannot rollback - no transaction is active". Aqui a transação é aberta e
/// fechada na mesma conexão.
#[tauri::command]
async fn db_batch(
  app: tauri::AppHandle,
  db: String,
  statements: Vec<BatchStatement>,
) -> Result<(), String> {
  let instances = app.state::<DbInstances>();
  let guard = instances.0.read().await;
  let pool = guard
    .get(&db)
    .ok_or_else(|| format!("database {db} not loaded"))?;
  let pool = match pool {
    DbPool::Sqlite(pool) => pool,
  };
  let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
  for statement in statements {
    let mut query = sqlx::query(&statement.sql);
    for param in &statement.params {
      query = query.bind(param);
    }
    query
      .execute(&mut *tx)
      .await
      .map_err(|error| error.to_string())?;
  }

  // Backstop do freemium: sem Pro, um lote que estoura qualquer limite
  // inteiro é revertido (a UI já bloqueia antes, mas o IPC não é confiável).
  #[cfg(any(target_os = "android", target_os = "ios"))]
  plan::check_limits(&app, &mut tx).await?;

  tx.commit().await.map_err(|error| error.to_string())?;
  Ok(())
}

/// Torna panic visível no iOS (stderr não aparece no console do device).
///
/// Escreve em `tmp/atlas-panic.log` dentro do sandbox, além do stderr. Não usar
/// `NSLog` daqui: ele espera `NSString` e uma C string derruba o processo.
fn install_panic_hook() {
  std::panic::set_hook(Box::new(|info| {
    let message = format!("Atlas panic: {info}");
    eprintln!("{message}");
    if let Ok(mut file) = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(std::env::temp_dir().join("atlas-panic.log"))
    {
      use std::io::Write;
      let _ = writeln!(file, "{message}");
    }
  }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  install_panic_hook();
  // O `tauri://` do iOS serve os assets com reqwest, que exige um provider
  // rustls instalado (senão panic em `default_rustls_crypto_provider`). O iroh
  // já compila o ring; instalar aqui resolve para os dois.
  let _ = rustls::crypto::ring::default_provider().install_default();
  let builder = tauri::Builder::default();

  // Updater (S8) e relaunch só no desktop: as crates estão sob o mesmo cfg no
  // Cargo.toml, e no iOS/macOS elas nem são compiladas.
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());

  // O mDNS do sync só recebe multicast com `MulticastLock` no Android.
  #[cfg(target_os = "android")]
  let builder = builder.plugin(multicast::init());

  // Billing só existe no mobile; o PC não tem paywall.
  #[cfg(any(target_os = "android", target_os = "ios"))]
  let builder = builder.plugin(tauri_plugin_iap::init());

  let builder = builder
    .manage(sync::commands::SyncState::default())
    .invoke_handler(tauri::generate_handler![
      db_batch,
      plan::plan_status,
      plan::plan_set_pro,
      native_notification,
      sync::commands::sync_start,
      sync::commands::sync_stop,
      sync::commands::sync_now,
      sync::commands::sync_status,
      sync::commands::sync_set_auto,
      sync::commands::sync_discovery_restart,
      sync::commands::sync_cursors,
      sync::commands::sync_discovered,
      sync::commands::sync_pair_begin,
      sync::commands::sync_pair_confirm,
      sync::commands::sync_unpair
    ]);

  builder
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_haptics::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
  use super::BatchStatement;

  #[test]
  fn batch_statement_defaults_params_to_empty() {
    let statement: BatchStatement = serde_json::from_str(r#"{"sql":"SELECT 1"}"#).unwrap();
    assert_eq!(statement.sql, "SELECT 1");
    assert!(statement.params.is_empty());
  }

  #[test]
  fn batch_statement_reads_string_params() {
    let statement: BatchStatement =
      serde_json::from_str(r#"{"sql":"INSERT INTO t VALUES ($1, $2)","params":["a","b"]}"#).unwrap();
    assert_eq!(statement.params, vec!["a", "b"]);
  }
}
