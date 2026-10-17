/**
 * Construtores puros da persistência incremental.
 *
 * Sem I/O: recebem o estado atual e devolvem statements. Isso mantém a lógica
 * de upsert/tombstone/carimbo testável sem Tauri nem SQLite.
 */

export interface BatchStatement {
	sql: string;
	params: string[];
}

/**
 * `INSERT ... ON CONFLICT(...) DO UPDATE`, reativando a linha
 * (limpa `deleted_at`) a cada escrita.
 *
 * `conflict` são as colunas da chave: `['id']` para as tabelas de linha,
 * `['key']` para `shared_settings` e `['key','owner']` para `counters`.
 */
export function upsertSql(table: string, columns: string[], conflict: string[] = ['id']): string {
	const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
	const updates = columns
		.filter((column) => !conflict.includes(column))
		.map((column) => `${column} = excluded.${column}`)
		.join(', ');
	return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflict.join(', ')}) DO UPDATE SET ${updates}, deleted_at = NULL`;
}

/** Ids que existiam e sumiram → viram lápide (deleção). */
export function tombstoneIds(previous: Iterable<string>, current: Iterable<string>): string[] {
	const present = new Set(current);
	return [...previous].filter((id) => !present.has(id));
}

/** Marca as lápides de um lote de deleções. */
export function tombstoneStatements(table: string, ids: string[], at: number, deviceId: string): BatchStatement[] {
	return ids.map((id) => ({
		sql: `UPDATE ${table} SET deleted_at = $1, updated_at = $1, device_id = $2 WHERE id = $3 AND deleted_at IS NULL`,
		params: [String(at), deviceId, id]
	}));
}

/** Chaves de `app_settings` que só valem nesta instalação (não sincronizam). */
export const LOCAL_SETTING_KEYS = ['preferences'] as const;

/**
 * Singletons que sincronizam como linha comum (LWW por `updated_at`).
 * Saíram de `app_settings` (sem carimbo) para `shared_settings` (com carimbo).
 */
export const SHARED_SETTING_KEYS = ['lifeForce', 'finance'] as const;

/** Chave do contador de XP em `counters` (uma linha por `device_id`). */
export const XP_COUNTER_KEY = 'experience.totalXp';

export function settingStatements(values: Record<string, unknown>): BatchStatement[] {
	return LOCAL_SETTING_KEYS.filter((key) => key in values).map((key) => ({
		sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)',
		params: [key, JSON.stringify(values[key])]
	}));
}

/** Carimbo de uma linha já gravada: conteúdo + `updated_at`/`device_id` usados. */
export interface RowStamp {
	json: string;
	updatedAt: number;
	deviceId: string;
}

/** Linha a gravar: chave lógica, valores (na ordem de `columns`) e o JSON de comparação. */
export interface PlannedRow {
	key: string;
	values: string[];
	json: string;
}

export interface PlanRowsOptions {
	table: string;
	columns: string[];
	conflict?: string[];
	rows: PlannedRow[];
	previous?: Record<string, RowStamp>;
	deviceId: string;
	at: number;
}

export interface PlanRowsResult {
	statements: BatchStatement[];
	stamps: Record<string, RowStamp>;
	/** Linhas idênticas à última gravação — não vão para o banco. */
	skipped: number;
}

/**
 * Planeja as escritas de uma tabela preservando o carimbo das linhas inalteradas.
 *
 * O `saveSnapshot` recebe o snapshot inteiro a cada mudança e antes carimbava
 * **todas** as linhas com o mesmo `at`/`device_id`. Duas consequências ruins:
 * a linha herdada de outro aparelho ganhava carimbo novo e vencia uma edição
 * real feita depois no outro aparelho; e qualquer edição virava delta "novo"
 * para o cursor do sync (full-state + churn do grafo).
 *
 * Aqui a linha só é reescrita quando o conteúdo muda; a inalterada mantém
 * `updated_at`/`device_id` de origem. Isso também evita IPC por gravação.
 */
export function planRows(options: PlanRowsOptions): PlanRowsResult {
	const { table, columns, conflict = ['id'], rows, previous, deviceId, at } = options;
	const sql = upsertSql(table, [...columns, 'updated_at', 'device_id'], conflict);
	const statements: BatchStatement[] = [];
	const stamps: Record<string, RowStamp> = {};
	let skipped = 0;
	for (const row of rows) {
		const before = previous?.[row.key];
		if (before && before.json === row.json) {
			stamps[row.key] = before;
			skipped += 1;
			continue;
		}
		statements.push({ sql, params: [...row.values, String(at), deviceId] });
		stamps[row.key] = { json: row.json, updatedAt: at, deviceId };
	}
	return { statements, stamps, skipped };
}
