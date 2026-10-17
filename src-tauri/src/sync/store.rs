//! Lado banco do sync: schema, cursores, delta e merge LWW.
//!
//! O merge é payload-agnóstico: as colunas de cada tabela saem de
//! `PRAGMA table_info` (fonte única = schema real), e a chave sai do `pk` do
//! PRAGMA. Não existe lista de colunas no Rust para sair de sincronia.
//!
//! Só entram linhas de tabelas da allowlist (`SYNC_TABLES`). Tabela fora dela
//! ou coluna desconhecida aborta a sessão: o par não decide o que escrever.

use std::collections::{BTreeMap, BTreeSet};

use sqlx::{Row as SqlRow, SqlitePool};

use super::protocol::{Cursor, Row, origin};

/// Tabelas replicadas (decisão em `docs/SYNC.md` §3 — escopo v1).
pub const SYNC_TABLES: [&str; 14] = [
  "categories",
  "transactions",
  "habits",
  "habit_logs",
  "trackers",
  "tracker_entries",
  "time_blocks",
  "graph_domains",
  "graph_nodes",
  "graph_edges",
  "notes",
  "folders",
  "shared_settings",
  "counters",
];

/// Colunas de uma tabela, na ordem do schema, com a chave primária.
#[derive(Debug, Clone)]
pub struct TableSchema {
  pub name: String,
  pub columns: Vec<String>,
  pub pk: Vec<String>,
}

impl TableSchema {
  fn key_of<'a>(&self, row: &'a Row) -> Result<Vec<Option<&'a str>>, String> {
    self
      .pk
      .iter()
      .map(|column| {
        row
          .cols
          .get(column)
          .map(|value| value.as_deref())
          .ok_or_else(|| format!("{}: linha sem chave {column}", self.name))
      })
      .collect()
  }
}

/// Identificador citado para SQL (nomes vêm do PRAGMA ou da allowlist).
fn quote(identifier: &str) -> String {
  format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// Versão do schema (`PRAGMA user_version`) — vai no hello.
pub async fn schema_version(pool: &SqlitePool) -> Result<u32, String> {
  let row = sqlx::query("PRAGMA user_version")
    .fetch_one(pool)
    .await
    .map_err(|error| format!("user_version: {error}"))?;
  let version: i64 = row
    .try_get("user_version")
    .map_err(|error| format!("user_version: {error}"))?;
  Ok(version.max(0) as u32)
}

/// Lê o schema real das tabelas replicadas.
pub async fn load_schema(pool: &SqlitePool) -> Result<Vec<TableSchema>, String> {
  let mut schemas = Vec::with_capacity(SYNC_TABLES.len());
  for table in SYNC_TABLES {
    let info = sqlx::query(&format!("PRAGMA table_info({})", quote(table)))
      .fetch_all(pool)
      .await
      .map_err(|error| format!("schema de {table}: {error}"))?;
    if info.is_empty() {
      return Err(format!("tabela ausente: {table}"));
    }
    let mut columns = Vec::with_capacity(info.len());
    let mut pk: Vec<(i64, String)> = Vec::new();
    for column in info {
      let name: String = column
        .try_get("name")
        .map_err(|error| format!("schema de {table}: {error}"))?;
      let order: i64 = column
        .try_get("pk")
        .map_err(|error| format!("schema de {table}: {error}"))?;
      if order > 0 {
        pk.push((order, name.clone()));
      }
      columns.push(name);
    }
    pk.sort_by_key(|(order, _)| *order);
    let pk: Vec<String> = pk.into_iter().map(|(_, name)| name).collect();
    if pk.is_empty() {
      return Err(format!("{table} sem chave primária"));
    }
    for required in ["updated_at", "device_id"] {
      if !columns.iter().any(|column| column == required) {
        return Err(format!("{table} sem {required}"));
      }
    }
    schemas.push(TableSchema {
      name: table.to_string(),
      columns,
      pk,
    });
  }
  Ok(schemas)
}

/// EndpointIDs pareados (allowlist). Nada mescla sem estar aqui.
pub async fn allowlist(pool: &SqlitePool) -> Result<std::collections::BTreeSet<String>, String> {
  let rows = sqlx::query("SELECT endpoint_id FROM sync_peers")
    .fetch_all(pool)
    .await
    .map_err(|error| format!("allowlist: {error}"))?;
  rows
    .into_iter()
    .map(|row| {
      row
        .try_get::<String, _>("endpoint_id")
        .map_err(|error| format!("allowlist: {error}"))
    })
    .collect()
}

/// Cursores que este lado tem para um par (peer → origens).
pub async fn cursors_for(pool: &SqlitePool, peer_id: &str) -> Result<Vec<Cursor>, String> {
  let rows = sqlx::query(
    "SELECT owner, updated_at FROM sync_cursors WHERE peer_id = ? ORDER BY owner",
  )
  .bind(peer_id)
  .fetch_all(pool)
  .await
  .map_err(|error| format!("cursores: {error}"))?;
  rows
    .into_iter()
    .map(|row| {
      Ok(Cursor {
        owner: row.try_get("owner").map_err(|error| error.to_string())?,
        updated_at: row.try_get("updated_at").map_err(|error| error.to_string())?,
      })
    })
    .collect()
}

/// Par confiável, como a UI/status vê.
#[derive(Debug, Clone)]
pub struct PeerRecord {
  pub endpoint_id: String,
  pub name: String,
  pub last_sync_at: i64,
}

/// Pares pareados (a allowlist) com o último sync.
pub async fn peers(pool: &SqlitePool) -> Result<Vec<PeerRecord>, String> {
  let rows = sqlx::query("SELECT endpoint_id, name, last_sync_at FROM sync_peers ORDER BY name, endpoint_id")
    .fetch_all(pool)
    .await
    .map_err(|error| format!("pares: {error}"))?;
  rows
    .into_iter()
    .map(|row| {
      Ok(PeerRecord {
        endpoint_id: row.try_get("endpoint_id").map_err(|error| error.to_string())?,
        name: row.try_get("name").map_err(|error| error.to_string())?,
        last_sync_at: row.try_get("last_sync_at").map_err(|error| error.to_string())?,
      })
    })
    .collect()
}

/// Todos os cursores conhecidos, por EndpointID (o acceptor precisa antes de
/// saber com quem está falando).
pub async fn cursors_by_peer(pool: &SqlitePool) -> Result<BTreeMap<String, Vec<Cursor>>, String> {
  let rows = sqlx::query("SELECT peer_id, owner, updated_at FROM sync_cursors ORDER BY peer_id, owner")
    .fetch_all(pool)
    .await
    .map_err(|error| format!("cursores: {error}"))?;
  let mut result: BTreeMap<String, Vec<Cursor>> = BTreeMap::new();
  for row in rows {
    result
      .entry(row.try_get("peer_id").map_err(|error| error.to_string())?)
      .or_default()
      .push(Cursor {
        owner: row.try_get("owner").map_err(|error| error.to_string())?,
        updated_at: row.try_get("updated_at").map_err(|error| error.to_string())?,
      });
  }
  Ok(result)
}

/// Origens presentes no banco (inclui linhas antigas sem `device_id`).
async fn owners(pool: &SqlitePool, schemas: &[TableSchema]) -> Result<BTreeSet<String>, String> {
  let mut owners = BTreeSet::new();
  for schema in schemas {
    let sql = format!(
      "SELECT DISTINCT COALESCE(NULLIF(device_id, ''), 'legacy') AS owner FROM {}",
      quote(&schema.name)
    );
    for row in sqlx::query(&sql)
      .fetch_all(pool)
      .await
      .map_err(|error| format!("origens de {}: {error}", schema.name))?
    {
      owners.insert(row.try_get::<String, _>("owner").map_err(|error| error.to_string())?);
    }
  }
  Ok(owners)
}

/// Delta a enviar para um par, a partir dos cursores que **ele** declarou.
///
/// `updated_at >= cursor` (não `>`): um mesmo salvamento carimba várias linhas
/// com o mesmo `updated_at`; cortar em `>` pularia as que sobraram do lote.
/// Reenviar as linhas do carimbo do cursor é barato e o merge é idempotente.
pub async fn collect_delta(
  pool: &SqlitePool,
  peer_cursors: &[Cursor],
  peer_device: &str,
) -> Result<Vec<Row>, String> {
  let schemas = load_schema(pool).await?;
  let cursors: BTreeMap<&str, i64> = peer_cursors
    .iter()
    .map(|cursor| (cursor.owner.as_str(), cursor.updated_at))
    .collect();
  let mut rows = Vec::new();
  for owner in owners(pool, &schemas).await? {
    // As linhas do próprio par voltariam iguais e seriam descartadas no LWW.
    if owner == peer_device {
      continue;
    }
    let after = cursors.get(owner.as_str()).copied().unwrap_or(0);
    for schema in &schemas {
      let columns = schema
        .columns
        .iter()
        .map(|column| format!("CAST({} AS TEXT) AS {}", quote(column), quote(column)))
        .collect::<Vec<_>>()
        .join(", ");
      let sql = format!(
        "SELECT {columns} FROM {} WHERE COALESCE(NULLIF(device_id, ''), 'legacy') = ? AND updated_at >= ? ORDER BY updated_at, rowid",
        quote(&schema.name)
      );
      let fetched = sqlx::query(&sql)
        .bind(&owner)
        .bind(after)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("delta de {}: {error}", schema.name))?;
      for row in fetched {
        let mut cols = BTreeMap::new();
        for column in &schema.columns {
          let value: Option<String> = row
            .try_get(column.as_str())
            .map_err(|error| format!("delta de {}: {error}", schema.name))?;
          cols.insert(column.clone(), value);
        }
        rows.push(Row {
          table: schema.name.clone(),
          cols,
        });
      }
    }
  }
  Ok(rows)
}

/// Resultado de aplicar um lote.
#[derive(Debug, Default, Clone)]
pub struct ApplyStats {
  pub applied: usize,
  pub skipped: usize,
  /// Maior carimbo recebido (avança o HLC local).
  pub max_stamp: i64,
  /// Maior carimbo recebido por origem (avança os cursores do par).
  pub cursors: BTreeMap<String, i64>,
}

/// Decide o vencedor do LWW para uma linha.
///
/// Maior `updated_at` vence; empate desempata pelo **menor** `device_id`
/// (decisão em `docs/SYNC.md` §3). `None` = linha ainda não existe.
pub fn should_apply(local: Option<(i64, Option<&str>)>, incoming: (i64, Option<&str>)) -> bool {
  match local {
    None => true,
    Some((local_at, local_device)) => {
      if incoming.0 != local_at {
        incoming.0 > local_at
      } else {
        origin(incoming.1) < origin(local_device)
      }
    }
  }
}

/// Aplica um lote numa transação (lotes parciais já ficam; cursores só no fim).
pub async fn apply_rows(pool: &SqlitePool, rows: &[Row]) -> Result<ApplyStats, String> {
  let mut stats = ApplyStats::default();
  if rows.is_empty() {
    return Ok(stats);
  }
  let schemas = load_schema(pool).await?;
  let by_name: BTreeMap<&str, &TableSchema> =
    schemas.iter().map(|schema| (schema.name.as_str(), schema)).collect();
  let mut tx = pool.begin().await.map_err(|error| format!("transação: {error}"))?;
  for row in rows {
    let schema = by_name
      .get(row.table.as_str())
      .ok_or_else(|| format!("tabela fora da allowlist: {}", row.table))?;
    for column in row.cols.keys() {
      if !schema.columns.iter().any(|known| known == column) {
        return Err(format!("{}: coluna desconhecida {column}", row.table));
      }
    }
    let updated_at = row.updated_at()?;
    if updated_at > stats.max_stamp {
      stats.max_stamp = updated_at;
    }
    let owner = row.owner().to_string();
    let cursor = stats.cursors.entry(owner).or_insert(updated_at);
    if updated_at > *cursor {
      *cursor = updated_at;
    }

    let key = schema.key_of(row)?;
    let mut where_sql = String::new();
    for (index, _) in key.iter().enumerate() {
      if index > 0 {
        where_sql.push_str(" AND ");
      }
      where_sql.push_str(&format!("{} = ?", quote(&schema.pk[index])));
    }
    let select_sql = format!(
      "SELECT updated_at, device_id FROM {} WHERE {where_sql}",
      quote(&schema.name)
    );
    let mut select = sqlx::query(&select_sql);
    for value in &key {
      select = select.bind(*value);
    }
    let existing = select
      .fetch_optional(&mut *tx)
      .await
      .map_err(|error| format!("leitura de {}: {error}", schema.name))?;

    let local = match existing {
      None => None,
      Some(existing) => Some((
        existing
          .try_get::<i64, _>("updated_at")
          .map_err(|error| error.to_string())?,
        existing
          .try_get::<Option<String>, _>("device_id")
          .map_err(|error| error.to_string())?,
      )),
    };
    let incoming_device = row.cols.get("device_id").and_then(|value| value.as_deref());
    let local_pair = local
      .as_ref()
      .map(|(at, device)| (*at, device.as_deref()));
    if !should_apply(local_pair, (updated_at, incoming_device)) {
      stats.skipped += 1;
      continue;
    }

    let columns = schema
      .columns
      .iter()
      .map(|column| quote(column))
      .collect::<Vec<_>>()
      .join(", ");
    let placeholders = schema
      .columns
      .iter()
      .map(|_| "?")
      .collect::<Vec<_>>()
      .join(", ");
    let updates = schema
      .columns
      .iter()
      .filter(|column| !schema.pk.iter().any(|pk| pk == *column))
      .map(|column| format!("{0} = excluded.{0}", quote(column)))
      .collect::<Vec<_>>()
      .join(", ");
    let upsert_sql = if updates.is_empty() {
      format!(
        "INSERT INTO {} ({columns}) VALUES ({placeholders}) ON CONFLICT({}) DO NOTHING",
        quote(&schema.name),
        schema.pk.iter().map(|column| quote(column)).collect::<Vec<_>>().join(", ")
      )
    } else {
      format!(
        "INSERT INTO {} ({columns}) VALUES ({placeholders}) ON CONFLICT({}) DO UPDATE SET {updates}",
        quote(&schema.name),
        schema.pk.iter().map(|column| quote(column)).collect::<Vec<_>>().join(", ")
      )
    };
    let mut upsert = sqlx::query(&upsert_sql);
    for column in &schema.columns {
      upsert = upsert.bind(row.cols.get(column).cloned().flatten());
    }
    upsert
      .execute(&mut *tx)
      .await
      .map_err(|error| format!("merge de {}: {error}", schema.name))?;
    stats.applied += 1;
  }
  tx.commit().await.map_err(|error| format!("transação: {error}"))?;
  Ok(stats)
}

/// Grava os cursores do par e o `last_sync_at` da sessão.
///
/// `last_sync_at` é o corte da purga de lápides: precisa ficar **acima** de
/// qualquer carimbo recebido (HLC pode estar à frente do relógio), senão a
/// purga apaga lápide que o par ainda não viu.
pub async fn save_cursors(
  pool: &SqlitePool,
  peer_id: &str,
  cursors: &BTreeMap<String, i64>,
  session_stamp: i64,
) -> Result<(), String> {
  let mut tx = pool.begin().await.map_err(|error| format!("transação: {error}"))?;
  for (owner, updated_at) in cursors {
    sqlx::query(
      "INSERT INTO sync_cursors (peer_id, owner, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(peer_id, owner) DO UPDATE SET updated_at = MAX(updated_at, excluded.updated_at)",
    )
    .bind(peer_id)
    .bind(owner)
    .bind(updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("cursor: {error}"))?;
  }
  sqlx::query("UPDATE sync_peers SET last_sync_at = MAX(last_sync_at, ?) WHERE endpoint_id = ?")
    .bind(session_stamp)
    .bind(peer_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("last_sync_at: {error}"))?;
  tx.commit().await.map_err(|error| format!("transação: {error}"))?;
  Ok(())
}

/// Sobe o `hlc_last` local para pelo menos `stamp`.
///
/// Sem isso o próximo carimbo local poderia ser menor que o que acabou de
/// chegar, e a edição feita depois perderia no LWW.
pub async fn observe_stamp(pool: &SqlitePool, stamp: i64) -> Result<(), String> {
  let row = sqlx::query("SELECT value FROM app_settings WHERE key = 'hlc_last'")
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("hlc_last: {error}"))?;
  let current = row
    .and_then(|row| row.try_get::<String, _>("value").ok())
    .and_then(|value| serde_json::from_str::<i64>(&value).ok())
    .unwrap_or(0);
  if stamp <= current {
    return Ok(());
  }
  sqlx::query("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('hlc_last', ?)")
    .bind(serde_json::to_string(&stamp).map_err(|error| error.to_string())?)
    .execute(pool)
    .await
    .map_err(|error| format!("hlc_last: {error}"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn newest_stamp_wins() {
    assert!(should_apply(Some((10, Some("aaa"))), (11, Some("zzz"))));
    assert!(!should_apply(Some((11, Some("aaa"))), (10, Some("zzz"))));
  }

  #[test]
  fn tie_breaks_by_smallest_device_id() {
    assert!(should_apply(Some((10, Some("bbb"))), (10, Some("aaa"))));
    assert!(!should_apply(Some((10, Some("aaa"))), (10, Some("bbb"))));
    assert!(!should_apply(Some((10, Some("aaa"))), (10, Some("aaa"))));
  }

  #[test]
  fn missing_local_row_always_applies() {
    assert!(should_apply(None, (1, None)));
  }

  #[test]
  fn legacy_loses_ties() {
    // Sem device_id = legado: perde empate para qualquer aparelho.
    assert!(should_apply(Some((10, None)), (10, Some("aaa"))));
    assert!(!should_apply(Some((10, Some("aaa"))), (10, None)));
  }
}
