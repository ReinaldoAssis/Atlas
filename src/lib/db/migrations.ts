/**
 * Migrações de schema versionadas por `PRAGMA user_version`.
 *
 * Cada migração roda uma única vez, em ordem, e o runner é idempotente:
 * uma instalação já na versão atual não executa nada.
 *
 * Regras:
 * - Nunca editar uma migração já publicada; criar uma nova.
 * - SQLite não tem `ADD COLUMN IF NOT EXISTS`: use `addColumn`.
 */

import { habitLogId } from '../atlas';
import { SHARED_SETTING_KEYS, XP_COUNTER_KEY } from './persist';

export interface SqlContext {
	execute(sql: string, params?: unknown[]): Promise<void>;
	select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Migration {
	version: number;
	name: string;
	run(ctx: SqlContext): Promise<void>;
}

async function hasColumn(ctx: SqlContext, table: string, column: string): Promise<boolean> {
	const rows = await ctx.select<{ name: string }>(`PRAGMA table_info(${table})`);
	return rows.some((row) => row.name === column);
}

/** Adiciona a coluna se ainda não existir (SQLite não tem `ADD COLUMN IF NOT EXISTS`). */
export async function ensureColumn(ctx: SqlContext, table: string, column: string, ddl: string): Promise<void> {
	if (await hasColumn(ctx, table, column)) return;
	await ctx.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

async function addColumn(ctx: SqlContext, table: string, column: string, ddl: string): Promise<void> {
	return ensureColumn(ctx, table, column, ddl);
}

/** Interpreta o JSON guardado numa coluna; devolve `undefined` se não der. */
function safeJson<T>(value: unknown): T | undefined {
	try {
		return JSON.parse(String(value)) as T;
	} catch {
		return undefined;
	}
}

/**
 * Normaliza um carimbo legado para epoch ms.
 *
 * `notes.updated_at` guardava ISO (`2026-10-16T12:00:00.000Z`) enquanto as
 * outras tabelas já usavam epoch ms — carimbos de tipos diferentes não se
 * comparam no LWW. Aqui aceitamos os dois formatos.
 */
export function toEpochMs(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
	const text = String(value ?? '').trim();
	if (!text) return 0;
	if (/^-?\d+$/.test(text)) return Number(text);
	const parsed = Date.parse(text);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** Tabelas de linha que já existem antes da v6 (todas com `updated_at`). */
const PRE_V6_TABLES = [
	'categories',
	'transactions',
	'habits',
	'habit_logs',
	'trackers',
	'tracker_entries',
	'time_blocks',
	'graph_domains',
	'graph_nodes',
	'graph_edges'
] as const;

export const migrations: Migration[] = [
	{
		version: 1,
		name: 'baseline',
		run: async (ctx) => {
			await ctx.execute(`CREATE TABLE IF NOT EXISTS categories (
				id TEXT PRIMARY KEY, module TEXT NOT NULL, payload TEXT NOT NULL
			)`);
			await ctx.execute(`CREATE TABLE IF NOT EXISTS transactions (
				id TEXT PRIMARY KEY, occurred_on TEXT NOT NULL, payload TEXT NOT NULL
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS transactions_by_date ON transactions(occurred_on)');
			await ctx.execute(`CREATE TABLE IF NOT EXISTS habits (
				id TEXT PRIMARY KEY, payload TEXT NOT NULL
			)`);
			await ctx.execute(`CREATE TABLE IF NOT EXISTS habit_logs (
				id TEXT PRIMARY KEY, habit_id TEXT NOT NULL, occurred_on TEXT NOT NULL, payload TEXT NOT NULL,
				UNIQUE(habit_id, occurred_on)
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS habit_logs_by_date ON habit_logs(occurred_on)');
			await ctx.execute(`CREATE TABLE IF NOT EXISTS time_blocks (
				id TEXT PRIMARY KEY, starts_at TEXT NOT NULL, payload TEXT NOT NULL
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS time_blocks_by_start ON time_blocks(starts_at)');
			await ctx.execute(`CREATE TABLE IF NOT EXISTS app_settings (
				key TEXT PRIMARY KEY, value TEXT NOT NULL
			)`);
		}
	},
	{
		version: 2,
		name: 'sync-metadata',
		// Colunas para replicação incremental (base do sync P2P futuro).
		// `deleted_at` é lápide (tombstone): a linha some da leitura, mas fica
		// até a purga (ver `purgeTombstones`).
		run: async (ctx) => {
			for (const table of ['categories', 'transactions', 'habits', 'habit_logs', 'time_blocks']) {
				await addColumn(ctx, table, 'updated_at', 'updated_at INTEGER NOT NULL DEFAULT 0');
				await addColumn(ctx, table, 'deleted_at', 'deleted_at INTEGER');
				await addColumn(ctx, table, 'device_id', 'device_id TEXT');
			}
			await ctx.execute('CREATE INDEX IF NOT EXISTS categories_by_updated ON categories(updated_at)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS transactions_by_updated ON transactions(updated_at)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS habits_by_updated ON habits(updated_at)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS habit_logs_by_updated ON habit_logs(updated_at)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS time_blocks_by_updated ON time_blocks(updated_at)');
		}
	},
	{
		version: 3,
		name: 'drop-demo-data',
		// A instalação inicial só continha dados de exemplo. O primeiro boot
		// passa a ser vazio; aqui limpamos o que foi semeado automaticamente.
		run: async (ctx) => {
			await ctx.execute("DELETE FROM transactions WHERE id LIKE 'demo-%'");
			await ctx.execute("DELETE FROM habits WHERE id LIKE 'demo-%'");
			await ctx.execute("DELETE FROM time_blocks WHERE id LIKE 'demo-%'");
			await ctx.execute("DELETE FROM habit_logs WHERE habit_id LIKE 'demo-%'");
			await ctx.execute("DELETE FROM app_settings WHERE key IN ('finance', 'lifeForce', 'experience', 'seeded')");
		}
	},
	{
		version: 4,
		name: 'notes-and-graph-tables',
		// Notas/pastas ganham metadados de sync; o grafo sai do blob JSON em
		// `app_settings` e vira tabelas por entidade.
		run: async (ctx) => {
			await ctx.execute(`CREATE TABLE IF NOT EXISTS folders (
				id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
				position INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
			)`);
			await ctx.execute(`CREATE TABLE IF NOT EXISTS notes (
				id TEXT PRIMARY KEY, folder_id TEXT, title TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
				pinned INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
			)`);
			for (const table of ['notes', 'folders']) {
				await addColumn(ctx, table, 'deleted_at', 'deleted_at INTEGER');
				await addColumn(ctx, table, 'device_id', 'device_id TEXT');
			}
			for (const table of ['graph_domains', 'graph_nodes', 'graph_edges']) {
				await ctx.execute(`CREATE TABLE IF NOT EXISTS ${table} (
					id TEXT PRIMARY KEY, payload TEXT NOT NULL,
					updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT
				)`);
			}
			// Migra o blob do grafo uma única vez.
			const existing = await ctx.select<{ id: string }>('SELECT id FROM graph_nodes LIMIT 1');
			if (existing.length === 0) {
				const rows = await ctx.select<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', ['graph']);
				if (rows.length > 0 && rows[0].value) {
					try {
						const graph = JSON.parse(rows[0].value) as {
							domains?: Array<{ id: string }>;
							nodes?: Array<{ id: string }>;
							edges?: Array<{ id: string }>;
						};
						for (const domain of graph.domains ?? []) {
							await ctx.execute('INSERT OR IGNORE INTO graph_domains (id, payload) VALUES ($1, $2)', [domain.id, JSON.stringify(domain)]);
						}
						for (const node of graph.nodes ?? []) {
							await ctx.execute('INSERT OR IGNORE INTO graph_nodes (id, payload) VALUES ($1, $2)', [node.id, JSON.stringify(node)]);
						}
						for (const edge of graph.edges ?? []) {
							await ctx.execute('INSERT OR IGNORE INTO graph_edges (id, payload) VALUES ($1, $2)', [edge.id, JSON.stringify(edge)]);
						}
					} catch {
						/* blob inválido: ignora (o grafo cai no default) */
					}
				}
			}
			await ctx.execute("DELETE FROM app_settings WHERE key = 'graph'");
		}
	},
	{
		version: 5,
		name: 'tracker-tables',
		// Trackers (acompanhamento sem recorrência) e seus registros. Vários
		// registros por dia, então `tracker_entries` não tem UNIQUE por data.
		run: async (ctx) => {
			await ctx.execute(`CREATE TABLE IF NOT EXISTS trackers (
				id TEXT PRIMARY KEY, payload TEXT NOT NULL,
				updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT
			)`);
			await ctx.execute(`CREATE TABLE IF NOT EXISTS tracker_entries (
				id TEXT PRIMARY KEY, tracker_id TEXT NOT NULL, occurred_on TEXT NOT NULL,
				payload TEXT NOT NULL,
				updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS tracker_entries_by_tracker ON tracker_entries(tracker_id)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS tracker_entries_by_date ON tracker_entries(occurred_on)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS trackers_by_updated ON trackers(updated_at)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS tracker_entries_by_updated ON tracker_entries(updated_at)');
		}
	},
	{
		version: 6,
		name: 'sync-metadata-v2',
		// Metadados que faltavam para o sync P2P (S10/P1). Quatro buracos:
		// 1. `notes.updated_at` era TEXT ISO enquanto o resto usava epoch ms —
		//    carimbos de tipos diferentes não ordenam. SQLite não muda o tipo de
		//    uma coluna, então a tabela é reconstruída.
		// 2. `folders` não tinha carimbo nenhum (não dava nem para calcular delta).
		// 3. `lifeForce`/`finance`/`experience` viviam em `app_settings` (sem
		//    carimbo e sem lápide) → viraram `shared_settings` (LWW por linha) e
		//    `counters` (uma contribuição por aparelho; a soma é o XP).
		// 4. `habit_logs` tinha id aleatório com `UNIQUE(habit_id, occurred_on)`:
		//    dois aparelhos criando o mesmo dia colidiam no merge. O id passa a
		//    ser derivado de (hábito, data).
		run: async (ctx) => {
			const at = Date.now();
			const deviceRows = await ctx.select<{ value: string }>(
				'SELECT value FROM app_settings WHERE key = $1',
				['device_id']
			);
			// Instalação nova ainda não tem `device_id` (ele nasce depois das
			// migrações): o que veio de antes fica sob a origem `legacy`.
			const deviceId = safeJson<string>(deviceRows[0]?.value) ?? 'legacy';
			const stamp = String(at);

			// 1. `notes`: reconstrói com `updated_at` em epoch ms.
			await ctx.execute(`CREATE TABLE IF NOT EXISTS notes_sync (
				id TEXT PRIMARY KEY, folder_id TEXT, title TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
				pinned INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
				deleted_at INTEGER, device_id TEXT
			)`);
			const notes = await ctx.select<{
				id: string;
				folder_id: string | null;
				title: string;
				created_at: string;
				updated_at: unknown;
				pinned: unknown;
				payload: string;
				deleted_at: unknown;
				device_id: string | null;
			}>('SELECT id, folder_id, title, created_at, updated_at, pinned, payload, deleted_at, device_id FROM notes');
			for (const note of notes) {
				await ctx.execute(
					'INSERT OR REPLACE INTO notes_sync (id, folder_id, title, created_at, updated_at, pinned, payload, deleted_at, device_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
					[
						note.id,
						note.folder_id ?? null,
						note.title ?? '',
						note.created_at ?? '',
						String(toEpochMs(note.updated_at)),
						String(Number(note.pinned) ? 1 : 0),
						note.payload,
						note.deleted_at == null ? null : toEpochMs(note.deleted_at),
						note.device_id ?? null
					]
				);
			}
			await ctx.execute('DROP TABLE notes');
			await ctx.execute('ALTER TABLE notes_sync RENAME TO notes');
			await ctx.execute('CREATE INDEX IF NOT EXISTS notes_by_folder ON notes(folder_id)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS notes_by_updated ON notes(updated_at)');

			// 2. `folders` ganha carimbo (as existentes entram como deste instante).
			await addColumn(ctx, 'folders', 'updated_at', 'updated_at INTEGER NOT NULL DEFAULT 0');
			await ctx.execute('UPDATE folders SET updated_at = $1 WHERE updated_at = 0', [stamp]);
			await ctx.execute('CREATE INDEX IF NOT EXISTS folders_by_updated ON folders(updated_at)');

			// 3a. Singletons sincronizáveis saem de `app_settings`.
			await ctx.execute(`CREATE TABLE IF NOT EXISTS shared_settings (
				key TEXT PRIMARY KEY, value TEXT NOT NULL,
				updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS shared_settings_by_updated ON shared_settings(updated_at)');
			const shared = await ctx.select<{ key: string; value: string }>(
				`SELECT key, value FROM app_settings WHERE key IN (${SHARED_SETTING_KEYS.map((key) => `'${key}'`).join(', ')})`
			);
			for (const row of shared) {
				await ctx.execute(
					'INSERT OR REPLACE INTO shared_settings (key, value, updated_at, device_id) VALUES ($1,$2,$3,$4)',
					[row.key, row.value, stamp, deviceId]
				);
			}
			await ctx.execute(
				`DELETE FROM app_settings WHERE key IN (${SHARED_SETTING_KEYS.map((key) => `'${key}'`).join(', ')})`
			);

			// 3b. XP vira contador por aparelho (somar incrementos é o que
			// sobrevive ao LWW: dois aparelhos ganhando XP não se sobrescrevem).
			await ctx.execute(`CREATE TABLE IF NOT EXISTS counters (
				key TEXT NOT NULL, owner TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
				updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, device_id TEXT,
				PRIMARY KEY (key, owner)
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS counters_by_updated ON counters(updated_at)');
			const experience = await ctx.select<{ value: string }>(
				"SELECT value FROM app_settings WHERE key = 'experience'"
			);
			if (experience.length > 0) {
				const parsed = safeJson<{ totalXp?: number }>(experience[0].value);
				const totalXp = Math.max(0, Math.trunc(Number(parsed?.totalXp ?? 0)));
				await ctx.execute(
					'INSERT OR REPLACE INTO counters (key, owner, value, updated_at, device_id) VALUES ($1,$2,$3,$4,$5)',
					[XP_COUNTER_KEY, deviceId, String(totalXp), stamp, deviceId]
				);
				await ctx.execute("DELETE FROM app_settings WHERE key = 'experience'");
			}

			// 4. Bookkeeping de sync: pares confiáveis (P3) e cursor por
			//    (par × aparelho de origem). A purga de lápides usa `last_sync_at`.
			await ctx.execute(`CREATE TABLE IF NOT EXISTS sync_peers (
				endpoint_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
				paired_at INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER NOT NULL DEFAULT 0
			)`);
			await ctx.execute(`CREATE TABLE IF NOT EXISTS sync_cursors (
				peer_id TEXT NOT NULL, owner TEXT NOT NULL,
				updated_at INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (peer_id, owner)
			)`);

			// 5. Log de hábito com id determinístico.
			const logs = await ctx.select<{ id: string; payload: string }>('SELECT id, payload FROM habit_logs');
			for (const log of logs) {
				const parsed = safeJson<{ habitId?: string; date?: string }>(log.payload);
				if (!parsed?.habitId || !parsed?.date) continue;
				const nextId = habitLogId(parsed.habitId, parsed.date);
				if (nextId === log.id) continue;
				await ctx.execute('UPDATE habit_logs SET id = $1, payload = $2 WHERE id = $3', [
					nextId,
					JSON.stringify({ ...parsed, id: nextId }),
					log.id
				]);
			}

			// 6. Linhas sem carimbo (a seed de categorias inseria com default 0)
			//    nunca seriam enviadas a um par: o cursor começa em 0.
			for (const table of PRE_V6_TABLES) {
				await ctx.execute(`UPDATE ${table} SET updated_at = $1 WHERE updated_at = 0`, [stamp]);
			}
		}
	},
	{
		version: 7,
		name: 'trash-events',
		// Lixeira global (S15): índice local de exclusões agrupadas. Não entra no
		// sync; os tombstones das tabelas continuam sendo a fonte de verdade.
		run: async (ctx) => {
			await ctx.execute(`CREATE TABLE IF NOT EXISTS trash_events (
				id TEXT PRIMARY KEY,
				module TEXT NOT NULL,
				kind TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				label TEXT NOT NULL DEFAULT '',
				payload TEXT NOT NULL,
				deleted_at INTEGER NOT NULL,
				device_id TEXT
			)`);
			await ctx.execute('CREATE INDEX IF NOT EXISTS trash_events_by_deleted ON trash_events(deleted_at)');
			await ctx.execute('CREATE INDEX IF NOT EXISTS trash_events_by_module ON trash_events(module)');
		}
	}
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version;

export async function getSchemaVersion(ctx: SqlContext): Promise<number> {
	const rows = await ctx.select<{ user_version: number }>('PRAGMA user_version');
	return rows[0]?.user_version ?? 0;
}

/** Aplica as migrações pendentes e devolve a versão final do schema. */
export async function runMigrations(ctx: SqlContext): Promise<number> {
	const current = await getSchemaVersion(ctx);
	for (const migration of migrations) {
		if (migration.version <= current) continue;
		await migration.run(ctx);
		// `PRAGMA` não aceita placeholder; `version` é um literal controlado.
		await ctx.execute(`PRAGMA user_version = ${migration.version}`);
	}
	return getSchemaVersion(ctx);
}
