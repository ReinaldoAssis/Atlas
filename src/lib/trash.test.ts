import { describe, expect, it } from 'vitest';
import {
	TRASH_RETENTION_DAYS,
	buildRestoreStatements,
	buildTrashEvent,
	isTrashExpired,
	normalizeTrashEvent,
	trashCutoff
} from './trash';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function categoryEvent() {
	return buildTrashEvent(
		{
			module: 'finance',
			kind: 'category',
			entityId: 'ali',
			label: 'Alimentação',
			tables: [
				{
					table: 'categories',
					columns: ['id', 'module', 'payload'],
					rows: [['ali', 'finance', '{"id":"ali","module":"finance"}']]
				},
				{
					table: 'transactions',
					columns: ['id', 'occurred_on', 'payload'],
					rows: [['t1', '2026-10-17', '{"id":"t1","categoryId":"ali"}']]
				}
			]
		},
		NOW,
		'dev-1'
	);
}

describe('trash retention', () => {
	it('expira em 7 dias', () => {
		expect(TRASH_RETENTION_DAYS).toBe(7);
		expect(trashCutoff(NOW)).toBe(NOW - 7 * DAY);
		expect(isTrashExpired({ deletedAt: NOW - 8 * DAY }, NOW)).toBe(true);
		expect(isTrashExpired({ deletedAt: NOW - 6 * DAY }, NOW)).toBe(false);
	});
});

describe('buildTrashEvent', () => {
	it('guarda módulo, rótulo e o snapshot das tabelas', () => {
		const event = categoryEvent();
		expect(event.module).toBe('finance');
		expect(event.kind).toBe('category');
		expect(event.label).toBe('Alimentação');
		expect(event.payload.tables).toHaveLength(2);
		expect(event.payload.tables[0].rows[0][0]).toBe('ali');
		expect(event.deletedAt).toBe(NOW);
	});

	it('usa o id quando o rótulo vem vazio', () => {
		const event = buildTrashEvent(
			{ module: 'habits', kind: 'habit', entityId: 'h1', label: '   ', tables: [] },
			NOW,
			'dev-1'
		);
		expect(event.label).toBe('h1');
	});
});

describe('normalizeTrashEvent', () => {
	it('aceita payload JSON e descarta tabelas fora da allowlist', () => {
		const raw = {
			id: 'e1',
			module: 'finance',
			kind: 'category',
			entityId: 'ali',
			label: 'Alimentação',
			deletedAt: NOW,
			payload: JSON.stringify({
				tables: [
					{ table: 'categories', columns: ['id'], rows: [['ali']] },
					{ table: 'users; DROP TABLE x', columns: ['id'], rows: [['x']] }
				]
			})
		};
		const event = normalizeTrashEvent(raw);
		expect(event?.payload.tables).toHaveLength(1);
		expect(event?.payload.tables[0].table).toBe('categories');
	});

	it('devolve null sem id/módulo/tipo', () => {
		expect(normalizeTrashEvent({ id: 'e1' })).toBeNull();
	});
});

describe('buildRestoreStatements', () => {
	it('reativa as linhas com upsert e remove o evento', () => {
		const event = categoryEvent();
		const statements = buildRestoreStatements(event, 'dev-2', NOW + 1000);
		expect(statements).toHaveLength(3);

		const category = statements[0];
		expect(category.sql).toContain('INSERT INTO categories');
		expect(category.sql).toContain('ON CONFLICT(id) DO UPDATE');
		expect(category.sql).toContain('deleted_at = NULL');
		expect(category.params).toEqual([
			'ali',
			'finance',
			'{"id":"ali","module":"finance"}',
			String(NOW + 1000),
			'dev-2'
		]);

		const transaction = statements[1];
		expect(transaction.sql).toContain('INSERT INTO transactions');

		const remove = statements[2];
		expect(remove.sql).toBe('DELETE FROM trash_events WHERE id = $1');
		expect(remove.params).toEqual([event.id]);
	});

	it('não gera SQL para tabela fora da allowlist', () => {
		const statements = buildRestoreStatements(
			{
				id: 'e1',
				payload: { tables: [{ table: 'nope', columns: ['id'], rows: [['x']] }] }
			},
			'dev-1',
			NOW
		);
		expect(statements).toHaveLength(1);
		expect(statements[0].sql).toContain('DELETE FROM trash_events');
	});
});
