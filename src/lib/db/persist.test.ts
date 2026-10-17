import { describe, expect, it } from 'vitest';
import { planRows, settingStatements, tombstoneIds, tombstoneStatements, upsertSql, type RowStamp } from './persist';

describe('upsertSql', () => {
	it('monta INSERT ... ON CONFLICT com placeholders posicionais', () => {
		expect(upsertSql('categories', ['id', 'module', 'payload', 'updated_at', 'device_id'])).toBe(
			'INSERT INTO categories (id, module, payload, updated_at, device_id) ' +
				'VALUES ($1, $2, $3, $4, $5) ' +
				'ON CONFLICT(id) DO UPDATE SET module = excluded.module, payload = excluded.payload, ' +
				'updated_at = excluded.updated_at, device_id = excluded.device_id, deleted_at = NULL'
		);
	});

	it('aceita chave composta (counters usa key + owner)', () => {
		const sql = upsertSql('counters', ['key', 'owner', 'value', 'updated_at', 'device_id'], ['key', 'owner']);
		expect(sql).toContain('ON CONFLICT(key, owner) DO UPDATE SET value = excluded.value');
	});
});

describe('tombstoneIds', () => {
	it('devolve o que existia e sumiu', () => {
		expect(tombstoneIds(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['a']);
	});

	it('devolve vazio quando nada some', () => {
		expect(tombstoneIds(['a', 'b'], ['a', 'b'])).toEqual([]);
	});
});

describe('tombstoneStatements', () => {
	it('marca deleted_at e updated_at com o mesmo carimbo', () => {
		const statements = tombstoneStatements('habits', ['demo-meditar'], 1_700_000_000_000, 'dev-1');
		expect(statements).toEqual([
			{
				sql: 'UPDATE habits SET deleted_at = $1, updated_at = $1, device_id = $2 WHERE id = $3 AND deleted_at IS NULL',
				params: ['1700000000000', 'dev-1', 'demo-meditar']
			}
		]);
	});
});

describe('settingStatements', () => {
	it('usa INSERT OR REPLACE só das chaves locais', () => {
		const statements = settingStatements({ preferences: { currency: 'BRL' }, desconhecido: 1 });
		expect(statements).toHaveLength(1);
		expect(statements[0].sql).toBe('INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)');
		expect(statements[0].params).toEqual(['preferences', '{"currency":"BRL"}']);
	});

	it('não grava mais lifeForce/experience/finance em app_settings', () => {
		expect(settingStatements({ lifeForce: { value: 50 }, experience: { totalXp: 10 }, finance: {} })).toEqual([]);
	});
});

describe('planRows', () => {
	const row = (key: string, json: string, values = [key, json]) => ({ key, values, json });

	it('grava a linha nova com o carimbo do lote', () => {
		const plan = planRows({
			table: 'habits',
			columns: ['id', 'payload'],
			rows: [row('h1', '{"id":"h1"}')],
			deviceId: 'dev-a',
			at: 100
		});
		expect(plan.statements).toHaveLength(1);
		expect(plan.statements[0].params).toEqual(['h1', '{"id":"h1"}', '100', 'dev-a']);
		expect(plan.stamps.h1).toEqual({ json: '{"id":"h1"}', updatedAt: 100, deviceId: 'dev-a' });
	});

	it('preserva carimbo e origem da linha inalterada', () => {
		const previous: Record<string, RowStamp> = {
			h1: { json: '{"id":"h1"}', updatedAt: 100, deviceId: 'dev-b' }
		};
		const plan = planRows({
			table: 'habits',
			columns: ['id', 'payload'],
			rows: [row('h1', '{"id":"h1"}')],
			previous,
			deviceId: 'dev-a',
			at: 200
		});
		expect(plan.statements).toEqual([]);
		expect(plan.skipped).toBe(1);
		// Sem isso, um save no aparelho A reivindicaria uma edição de B e
		// engoliria a edição seguinte dele (carimbo maior).
		expect(plan.stamps.h1).toEqual({ json: '{"id":"h1"}', updatedAt: 100, deviceId: 'dev-b' });
	});

	it('reestampa quando o conteúdo muda', () => {
		const previous: Record<string, RowStamp> = {
			h1: { json: '{"id":"h1","n":1}', updatedAt: 100, deviceId: 'dev-b' }
		};
		const plan = planRows({
			table: 'habits',
			columns: ['id', 'payload'],
			rows: [row('h1', '{"id":"h1","n":2}')],
			previous,
			deviceId: 'dev-a',
			at: 200
		});
		expect(plan.statements).toHaveLength(1);
		expect(plan.stamps.h1).toEqual({ json: '{"id":"h1","n":2}', updatedAt: 200, deviceId: 'dev-a' });
	});

	it('suporta chave composta e só as linhas passadas entram em stamps', () => {
		const plan = planRows({
			table: 'counters',
			columns: ['key', 'owner', 'value'],
			conflict: ['key', 'owner'],
			rows: [{ key: 'xp:dev-a', values: ['xp', 'dev-a', '10'], json: '10' }],
			deviceId: 'dev-a',
			at: 300
		});
		expect(plan.statements[0].sql).toContain('ON CONFLICT(key, owner)');
		expect(Object.keys(plan.stamps)).toEqual(['xp:dev-a']);
	});
});
