/**
 * Construtores puros da persistência incremental.
 *
 * Sem I/O: recebem o estado atual e devolvem statements. Isso mantém a lógica
 * de upsert/tombstone testável sem Tauri nem SQLite.
 */

export interface BatchStatement {
	sql: string;
	params: string[];
}

/**
 * `INSERT ... ON CONFLICT(id) DO UPDATE`, reativando a linha
 * (limpa `deleted_at`) a cada escrita.
 */
export function upsertSql(table: string, columns: string[]): string {
	const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
	const updates = columns
		.filter((column) => column !== 'id')
		.map((column) => `${column} = excluded.${column}`)
		.join(', ');
	return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}, deleted_at = NULL`;
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

/** Chaves de `app_settings` que nunca são apagadas (não entram no DELETE geral). */
export const SETTING_KEYS = ['lifeForce', 'preferences', 'experience', 'finance', 'graph'] as const;

export function settingStatements(values: Record<string, unknown>): BatchStatement[] {
	return SETTING_KEYS.filter((key) => key in values).map((key) => ({
		sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)',
		params: [key, JSON.stringify(values[key])]
	}));
}
