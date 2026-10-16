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

async function addColumn(ctx: SqlContext, table: string, column: string, ddl: string): Promise<void> {
	if (await hasColumn(ctx, table, column)) return;
	await ctx.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
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
			await ctx.execute("DELETE FROM app_settings WHERE key IN ('finance', 'lifeForce', 'experience', 'graph', 'seeded')");
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
