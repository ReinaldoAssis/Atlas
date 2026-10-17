use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

// Sync P2P (S10). No iOS a descoberta é um plugin Swift (P4); o resto é comum.
#[cfg(not(target_os = "android"))]
pub mod sync;

#[derive(Deserialize)]
pub struct BatchStatement {
  pub sql: String,
  #[serde(default)]
  pub params: Vec<String>,
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
  tx.commit().await.map_err(|error| error.to_string())?;
  Ok(())
}

/// Torna panic visível no iOS (stderr não aparece no console do device).
fn install_panic_hook() {
  std::panic::set_hook(Box::new(|info| {
    let message = format!("Atlas panic: {info}");
    #[cfg(target_os = "ios")]
    {
      unsafe extern "C" {
        fn NSLog(format: *const std::ffi::c_char, ...);
      }
      if let Ok(text) = std::ffi::CString::new(message.clone()) {
        unsafe { NSLog(c"%s".as_ptr(), text.as_ptr()) };
      }
    }
    eprintln!("{message}");
  }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  install_panic_hook();
  let builder = tauri::Builder::default();

  // Updater (S8) e relaunch só no desktop: as crates estão sob o mesmo cfg no
  // Cargo.toml, e no iOS/macOS elas nem são compiladas.
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());

  #[cfg(not(target_os = "android"))]
  let builder = builder
    .manage(sync::commands::SyncState::default())
    .invoke_handler(tauri::generate_handler![
      db_batch,
      sync::commands::sync_start,
      sync::commands::sync_stop,
      sync::commands::sync_now,
      sync::commands::sync_status,
      sync::commands::sync_cursors,
      sync::commands::sync_discovered,
      sync::commands::sync_pair_begin,
      sync::commands::sync_pair_confirm,
      sync::commands::sync_unpair
    ]);

  #[cfg(target_os = "android")]
  let builder = builder.invoke_handler(tauri::generate_handler![db_batch]);

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
