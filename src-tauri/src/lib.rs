use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![db_batch])
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
