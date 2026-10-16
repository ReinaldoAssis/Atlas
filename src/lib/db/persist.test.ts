import { describe, expect, it } from 'vitest';
import { settingStatements, tombstoneIds, tombstoneStatements, upsertSql } from './persist';

describe('upsertSql', () => {
	it('monta INSERT ... ON CONFLICT com placeholders posicionais', () => {
		expect(upsertSql('categories', ['id', 'module', 'payload', 'updated_at', 'device_id'])).toBe(
			'INSERT INTO categories (id, module, payload, updated_at, device_id) ' +
				'VALUES ($1, $2, $3, $4, $5) ' +
				'ON CONFLICT(id) DO UPDATE SET module = excluded.module, payload = excluded.payload, ' +
				'updated_at = excluded.updated_at, device_id = excluded.device_id, deleted_at = NULL'
		);
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
	it('usa INSERT OR REPLACE só das chaves conhecidas', () => {
		const statements = settingStatements({ lifeForce: { value: 50 }, desconhecido: 1 });
		expect(statements).toHaveLength(1);
		expect(statements[0].sql).toBe('INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)');
		expect(statements[0].params).toEqual(['lifeForce', '{"value":50}']);
	});
});
