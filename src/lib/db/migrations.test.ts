import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, migrations, runMigrations, type SqlContext } from './migrations';

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
});
