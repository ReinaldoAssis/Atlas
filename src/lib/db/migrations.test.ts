import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, migrations, runMigrations, toEpochMs, type SqlContext } from './migrations';

/** Fake mínimo de SQLite: guarda `user_version` e o SQL executado. */
function fakeContext(initialVersion = 0, columns: string[] = []) {
	const executed: string[] = [];
	let version = initialVersion;
	const ctx: SqlContext = {
		async execute(sql) {
			executed.push(sql);
			const match = /PRAGMA user_version = (\d+)/.exec(sql);
			if (match) version = Number(match[1]);
		},
		async select<T>(sql: string): Promise<T[]> {
			if (sql.startsWith('PRAGMA user_version')) return [{ user_version: version }] as T[];
			if (sql.startsWith('PRAGMA table_info')) return columns.map((name) => ({ name })) as T[];
			return [];
		}
	};
	return { ctx, executed, get version() { return version; } };
}

describe('migrations', () => {
	it('tem versões crescentes e únicas', () => {
		const versions = migrations.map((migration) => migration.version);
		expect(versions).toEqual([...versions].sort((a, b) => a - b));
		expect(new Set(versions).size).toBe(versions.length);
		expect(LATEST_SCHEMA_VERSION).toBe(versions[versions.length - 1]);
	});

	it('aplica todas as migrações numa instalação nova', async () => {
		const db = fakeContext(0);
		const version = await runMigrations(db.ctx);
		expect(version).toBe(LATEST_SCHEMA_VERSION);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS categories'))).toBe(true);
		expect(db.executed.some((sql) => sql.includes('ADD COLUMN updated_at'))).toBe(true);
		expect(db.executed.some((sql) => sql.includes('DELETE FROM habits WHERE id LIKE'))).toBe(true);
	});

	it('não repete migrações já aplicadas', async () => {
		const db = fakeContext(LATEST_SCHEMA_VERSION);
		await runMigrations(db.ctx);
		expect(db.executed).toHaveLength(0);
	});

	it('aplica só as migrações pendentes', async () => {
		const db = fakeContext(2);
		await runMigrations(db.ctx);
		expect(db.executed.some((sql) => sql.includes('DELETE FROM transactions WHERE id LIKE'))).toBe(true);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS categories'))).toBe(false);
		expect(db.version).toBe(LATEST_SCHEMA_VERSION);
	});

	it('não re-adiciona colunas existentes', async () => {
		// Colunas já presentes (instalação migrada uma vez) → nenhum ALTER.
		const db = fakeContext(1, ['id', 'updated_at', 'deleted_at', 'device_id']);
		await runMigrations(db.ctx);
		expect(db.executed.some((sql) => sql.includes('ADD COLUMN'))).toBe(false);
	});

	it('cria as tabelas do grafo', async () => {
		const db = fakeContext(0);
		await runMigrations(db.ctx);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS graph_nodes'))).toBe(true);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS graph_domains'))).toBe(true);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS graph_edges'))).toBe(true);
	});

	it('cria as tabelas de tracker', async () => {
		const db = fakeContext(0);
		await runMigrations(db.ctx);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS trackers'))).toBe(true);
		expect(db.executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS tracker_entries'))).toBe(true);
	});

	it('migra o blob do grafo para as tabelas', async () => {
		const graph = {
			domains: [{ id: 'car' }],
			nodes: [{ id: 'origem' }],
			edges: [{ id: 'e1' }]
		};
		const executed: Array<{ sql: string; params?: unknown[] }> = [];
		let version = 3;
		const ctx: SqlContext = {
			async execute(sql, params) {
				executed.push({ sql, params });
				const match = /PRAGMA user_version = (\d+)/.exec(sql);
				if (match) version = Number(match[1]);
			},
			async select<T>(sql: string): Promise<T[]> {
				if (sql.startsWith('PRAGMA user_version')) return [{ user_version: version }] as T[];
				if (sql.startsWith('PRAGMA table_info')) return [] as T[];
				if (sql.includes('graph_nodes')) return [] as T[];
				if (sql.includes('app_settings')) return [{ value: JSON.stringify(graph) }] as T[];
				return [] as T[];
			}
		};
		await runMigrations(ctx);
		expect(executed.some((entry) => entry.sql.includes('INSERT OR IGNORE INTO graph_domains'))).toBe(true);
		expect(executed.some((entry) => entry.sql.includes('INSERT OR IGNORE INTO graph_nodes'))).toBe(true);
		expect(executed.some((entry) => entry.sql.includes('INSERT OR IGNORE INTO graph_edges'))).toBe(true);
		expect(executed.some((entry) => entry.sql.includes("DELETE FROM app_settings WHERE key = 'graph'"))).toBe(true);
	});

	it('v6 move os singletons e carimba as notas em epoch ms', async () => {
		const executed: Array<{ sql: string; params?: unknown[] }> = [];
		let version = 5;
		const noteRow = {
			id: 'n1',
			folder_id: null,
			title: 'Nota',
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-05-02T10:00:00.000Z',
			pinned: 1,
			payload: '{"id":"n1"}',
			deleted_at: null,
			device_id: 'dev-1'
		};
		const logRow = {
			id: 'random-1',
			payload: JSON.stringify({ id: 'random-1', habitId: 'h1', date: '2026-05-01', value: 1 })
		};
		const ctx: SqlContext = {
			async execute(sql, params) {
				executed.push({ sql, params });
				const match = /PRAGMA user_version = (\d+)/.exec(sql);
				if (match) version = Number(match[1]);
			},
			async select<T>(sql: string): Promise<T[]> {
				if (sql.startsWith('PRAGMA user_version')) return [{ user_version: version }] as T[];
				// Só `id`: força os ALTER TABLE das colunas de sync.
				if (sql.startsWith('PRAGMA table_info')) return [{ name: 'id' }] as T[];
				if (sql.includes('FROM notes')) return [noteRow] as T[];
				if (sql.includes('FROM habit_logs')) return [logRow] as T[];
				if (sql.includes("key = 'experience'")) return [{ value: JSON.stringify({ totalXp: 42 }) }] as T[];
				if (sql.includes('key = $1')) return [{ value: JSON.stringify('dev-1') }] as T[];
				if (sql.includes('app_settings')) {
					return [
						{ key: 'lifeForce', value: '{"value":50}' },
						{ key: 'finance', value: '{"savingsGoalMinor":0}' }
					] as T[];
				}
				return [] as T[];
			}
		};
		await runMigrations(ctx);

		// 1. `notes` reconstruída com o carimbo em epoch ms e o resto preservado.
		const noteInsert = executed.find((entry) => entry.sql.startsWith('INSERT OR REPLACE INTO notes_sync'));
		expect(noteInsert?.params?.[4]).toBe(String(Date.parse('2026-05-02T10:00:00.000Z')));
		expect(noteInsert?.params?.[5]).toBe('1');
		expect(executed.some((entry) => entry.sql === 'DROP TABLE notes')).toBe(true);
		expect(executed.some((entry) => entry.sql.includes('RENAME TO notes'))).toBe(true);

		// 2. `folders` ganha carimbo.
		expect(executed.some((entry) => entry.sql.includes('ALTER TABLE folders ADD COLUMN updated_at'))).toBe(true);

		// 3. lifeForce/finance saem de `app_settings` para `shared_settings`.
		expect(executed.filter((entry) => entry.sql.startsWith('INSERT OR REPLACE INTO shared_settings'))).toHaveLength(2);
		expect(executed.some((entry) => entry.sql.includes('DELETE FROM app_settings') && entry.sql.includes("'finance'"))).toBe(true);

		// 4. XP vira contador da origem local (a soma é o total exibido).
		expect(
			executed.some(
				(entry) =>
					entry.sql.startsWith('INSERT OR REPLACE INTO counters') &&
					entry.params?.[0] === 'experience.totalXp' &&
					entry.params?.[1] === 'dev-1' &&
					entry.params?.[2] === '42'
			)
		).toBe(true);
		expect(executed.some((entry) => entry.sql === "DELETE FROM app_settings WHERE key = 'experience'")).toBe(true);

		// 5. Log de hábito com id determinístico (hábito + data).
		const logUpdate = executed.find((entry) => entry.sql.startsWith('UPDATE habit_logs SET id'));
		expect(logUpdate?.params?.[0]).toBe('hlog:h1:2026-05-01');
		expect(JSON.parse(String(logUpdate?.params?.[1]))).toMatchObject({ id: 'hlog:h1:2026-05-01', habitId: 'h1' });

		// 6. Nenhuma linha fica com carimbo 0 (nunca seria enviada a um par).
		expect(executed.some((entry) => entry.sql === 'UPDATE categories SET updated_at = $1 WHERE updated_at = 0')).toBe(true);
	});

	it('v6 usa `legacy` quando a instalação ainda não tem device_id', async () => {
		const executed: Array<{ sql: string; params?: unknown[] }> = [];
		let version = 5;
		const ctx: SqlContext = {
			async execute(sql, params) {
				executed.push({ sql, params });
				const match = /PRAGMA user_version = (\d+)/.exec(sql);
				if (match) version = Number(match[1]);
			},
			async select<T>(sql: string): Promise<T[]> {
				if (sql.startsWith('PRAGMA user_version')) return [{ user_version: version }] as T[];
				if (sql.startsWith('PRAGMA table_info')) return [{ name: 'id' }] as T[];
				if (sql.includes("key = 'experience'")) return [{ value: JSON.stringify({ totalXp: 7 }) }] as T[];
				return [] as T[];
			}
		};
		await runMigrations(ctx);
		const counter = executed.find((entry) => entry.sql.startsWith('INSERT OR REPLACE INTO counters'));
		expect(counter?.params?.[1]).toBe('legacy');
		expect(counter?.params?.[2]).toBe('7');
	});
});

describe('toEpochMs', () => {
	it('aceita ISO, epoch ms em texto e número', () => {
		expect(toEpochMs('2026-05-02T10:00:00.000Z')).toBe(Date.parse('2026-05-02T10:00:00.000Z'));
		expect(toEpochMs('1746180000000')).toBe(1746180000000);
		expect(toEpochMs(1746180000000)).toBe(1746180000000);
	});

	it('devolve 0 para lixo', () => {
		expect(toEpochMs('')).toBe(0);
		expect(toEpochMs(null)).toBe(0);
		expect(toEpochMs('ontem')).toBe(0);
	});
});
