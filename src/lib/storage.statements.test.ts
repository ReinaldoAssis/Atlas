import { describe, expect, it } from 'vitest';
import { createEmptySnapshot } from './atlas';
import { buildSnapshotStatements } from './storage';

/** Conta `$1..$n` (o upsert usa numeração) ou `?`. */
function placeholders(sql: string): number {
	return (sql.match(/\$\d+|\?/g) ?? []).length;
}

describe('buildSnapshotStatements', () => {
	it('cada statement liga exatamente um parâmetro por placeholder', () => {
		const statements = buildSnapshotStatements(createEmptySnapshot(), 'dev-1', 1);
		expect(statements.length).toBeGreaterThan(0);
		for (const statement of statements) {
			expect(statement.params.length, statement.sql).toBe(placeholders(statement.sql));
			for (const [index, param] of statement.params.entries()) {
				expect(typeof param, `${statement.sql} / param ${index}`).toBe('string');
			}
		}
	});

	it('grava o payload JSON de linhas de conteúdo', () => {
		const base = createEmptySnapshot();
		const snapshot = {
			...base,
			habits: [
				{
					id: 'h1',
					name: 'Ler',
					metric: 'boolean' as const,
					unit: '',
					target: 1,
					scheduledDays: [0, 1, 2, 3, 4, 5, 6],
					active: true,
					bestStreak: 0
				}
			]
		};
		const statements = buildSnapshotStatements(snapshot, 'dev-1', 1);
		const insert = statements.find((statement) => statement.sql.includes('INTO habits '));
		expect(insert).toBeTruthy();
		const payload = insert!.params.find((param) => param.startsWith('{'));
		expect(payload).toBeTruthy();
		expect(JSON.parse(payload!).id).toBe('h1');
	});

	it('o grafo carrega payload com id (domínio, nó e aresta)', () => {
		const statements = buildSnapshotStatements(createEmptySnapshot(), 'dev-1', 1);
		for (const table of ['graph_domains', 'graph_nodes', 'graph_edges']) {
			const insert = statements.find((statement) => statement.sql.includes(`INTO ${table} `));
			if (!insert) continue;
			const payload = insert.params.find((param) => param.startsWith('{'));
			expect(payload, table).toBeTruthy();
			expect(typeof JSON.parse(payload!).id, table).toBe('string');
		}
	});
});
