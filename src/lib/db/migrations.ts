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
