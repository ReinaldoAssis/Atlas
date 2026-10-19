/**
 * Lixeira global — modelo puro.
 *
 * A fonte de verdade continua sendo os tombstones (`deleted_at`) espalhados
 * pelas tabelas; `trash_events` é o índice local que agrupa uma exclusão (ex.:
 * categoria + lançamentos) e guarda o snapshot necessário para restaurar.
 *
 * Sem I/O: os statements de restauração são montados aqui e executados por
 * `trash-store.ts`.
 */
import { id as newId } from './atlas';
import { upsertSql, type BatchStatement } from './db/persist';

/** Dias que um evento fica visível/restaurável na lixeira. */
export const TRASH_RETENTION_DAYS = 7;

export type TrashModule = 'finance' | 'habits' | 'time' | 'graph' | 'notes';
export type TrashKind =
	| 'transaction'
	| 'category'
	| 'habit'
	| 'habitLog'
	| 'tracker'
	| 'trackerEntry'
	| 'timeBlock'
	| 'graphDomain'
	| 'graphNode'
	| 'graphEdge'
	| 'note'
	| 'folder';

export interface TrashTableSnapshot {
	table: string;
	/** Colunas da linha, sem `updated_at`/`device_id`/`deleted_at`. */
	columns: string[];
	/** Chave do upsert; default `['id']`. */
	conflict?: string[];
	/** Cada linha na mesma ordem de `columns`. */
	rows: string[][];
}

export interface TrashPayload {
	tables: TrashTableSnapshot[];
}

export interface TrashEvent {
	id: string;
	module: TrashModule;
	kind: TrashKind;
	entityId: string;
	label: string;
	payload: TrashPayload;
	/** Epoch ms. */
	deletedAt: number;
	deviceId?: string;
}

export interface TrashEventInput {
	module: TrashModule;
	kind: TrashKind;
	entityId: string;
	label: string;
	tables: TrashTableSnapshot[];
}

/**
 * Tabelas que a lixeira pode restaurar. É allowlist de propósito: o payload vem
 * do banco e não pode virar SQL arbitrário.
 */
export const TRASH_TABLES = new Set([
	'categories',
	'transactions',
	'habits',
	'habit_logs',
	'trackers',
	'tracker_entries',
	'time_blocks',
	'graph_domains',
	'graph_nodes',
	'graph_edges',
	'notes',
	'folders',
	'shared_settings',
	'counters'
]);

const COLUMN_NAME = /^[a-z_]+$/;

/** Colunas de carimbo: não entram no payload; o restore as preenche. */
const RESERVED_COLUMNS = new Set(['updated_at', 'device_id', 'deleted_at']);

export function trashCutoff(now = Date.now(), days = TRASH_RETENTION_DAYS): number {
	return now - days * 86_400_000;
}

export function isTrashExpired(event: Pick<TrashEvent, 'deletedAt'>, now = Date.now(), days = TRASH_RETENTION_DAYS): boolean {
	return event.deletedAt < trashCutoff(now, days);
}

export function buildTrashEvent(input: TrashEventInput, at: number, deviceId: string): TrashEvent {
	return {
		id: newId(),
		module: input.module,
		kind: input.kind,
		entityId: input.entityId,
		label: input.label.trim() || input.entityId,
		payload: normalizePayload({ tables: input.tables }),
		deletedAt: at,
		deviceId
	};
}

/** Normaliza um evento vindo do banco (payload inválido não restaura nada). */
export function normalizeTrashEvent(raw: unknown): TrashEvent | null {
	const source = (raw ?? {}) as Partial<TrashEvent> & { payload?: unknown };
	if (!source.id || !source.module || !source.kind) return null;
	const payload = typeof source.payload === 'string' ? safeJson<TrashPayload>(source.payload) : source.payload;
	return {
		id: String(source.id),
		module: source.module,
		kind: source.kind,
		entityId: String(source.entityId ?? ''),
		label: String(source.label ?? source.entityId ?? ''),
		payload: normalizePayload(payload),
		deletedAt: Number(source.deletedAt) || 0,
		deviceId: source.deviceId ? String(source.deviceId) : undefined
	};
}

function safeJson<T>(value: string): T | undefined {
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

function normalizePayload(raw: unknown): TrashPayload {
	const source = (raw ?? {}) as Partial<TrashPayload>;
	if (!Array.isArray(source.tables)) return { tables: [] };
	const tables: TrashTableSnapshot[] = [];
	for (const item of source.tables) {
		if (!item || typeof item !== 'object') continue;
		const table = (item as TrashTableSnapshot).table;
		const columns = (item as TrashTableSnapshot).columns;
		const rows = (item as TrashTableSnapshot).rows;
		if (typeof table !== 'string' || !TRASH_TABLES.has(table)) continue;
		if (!Array.isArray(columns) || !columns.every((column) => typeof column === 'string' && COLUMN_NAME.test(column))) continue;
		if (columns.some((column) => RESERVED_COLUMNS.has(column))) continue;
		if (!Array.isArray(rows)) continue;
		const rawConflict = (item as TrashTableSnapshot).conflict;
		const conflict = Array.isArray(rawConflict)
			? rawConflict.filter((column) => typeof column === 'string' && columns.includes(column))
			: undefined;
		const validRows = rows
			.filter((row): row is string[] => Array.isArray(row) && row.length === columns.length)
			.map((row) => row.map((value) => String(value)));
		tables.push({ table, columns, conflict, rows: validRows });
	}
	return { tables };
}

/**
 * Statements que devolvem as linhas do evento ao banco.
 *
 * O upsert reativa a linha (`deleted_at = NULL`) e usa o carimbo atual, então o
 * sync enxerga o restore como uma edição normal.
 */
export function buildRestoreStatements(event: Pick<TrashEvent, 'id' | 'payload'>, deviceId: string, at: number): BatchStatement[] {
	const statements: BatchStatement[] = [];
	for (const table of event.payload.tables) {
		if (!TRASH_TABLES.has(table.table)) continue;
		const conflict = table.conflict?.length ? table.conflict : ['id'];
		const sql = upsertSql(table.table, [...table.columns, 'updated_at', 'device_id'], conflict);
		for (const row of table.rows) {
			statements.push({ sql, params: [...row, String(at), deviceId] });
		}
	}
	statements.push({ sql: 'DELETE FROM trash_events WHERE id = $1', params: [event.id] });
	return statements;
}
