/**
 * Persistência da lixeira global.
 *
 * `loadTrashEvents` só lê o índice local; `recordTrashEvent` grava o evento na
 * mesma fila serializada do resto do banco. Restaurar reusa os upserts de
 * `db/persist` para reativar as linhas (e limpar o tombstone).
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { activeDbName } from './test-mode';
import { getReadyDatabase, getDeviceId, nextWriteStamp, runSerialized, writeStampStatement } from './storage';
import {
	buildRestoreStatements,
	buildTrashEvent,
	normalizeTrashEvent,
	trashCutoff,
	type TrashEvent,
	type TrashEventInput
} from './trash';

interface TrashRow {
	id: string;
	module: string;
	kind: string;
	entity_id: string;
	label: string;
	payload: string;
	deleted_at: unknown;
	device_id: string | null;
}

/** Eventos ainda dentro da retenção, mais recentes primeiro. */
export async function loadTrashEvents(now = Date.now()): Promise<TrashEvent[]> {
	if (!isTauri()) return [];
	const db = await getReadyDatabase();
	const rows = await db.select<TrashRow[]>(
		'SELECT id, module, kind, entity_id, label, payload, deleted_at, device_id FROM trash_events WHERE deleted_at >= $1 ORDER BY deleted_at DESC',
		[String(trashCutoff(now))]
	);
	return rows
		.map((row) =>
			normalizeTrashEvent({
				id: row.id,
				module: row.module,
				kind: row.kind,
				entityId: row.entity_id,
				label: row.label,
				payload: row.payload,
				deletedAt: Number(row.deleted_at) || 0,
				deviceId: row.device_id ?? undefined
			})
		)
		.filter((event): event is TrashEvent => event !== null);
}

/**
 * Registra uma exclusão. Deve ser chamado **fora** de `runSerialized`; a
 * exclusão em si (tombstones) pode ir no mesmo lote quando a frente de cada
 * módulo for implementada.
 */
export function recordTrashEvent(input: TrashEventInput): Promise<TrashEvent> {
	return runSerialized(async () => {
		const db = await getReadyDatabase();
		const deviceId = await getDeviceId();
		const at = await nextWriteStamp(db);
		const event = buildTrashEvent(input, at, deviceId);
		await invoke('db_batch', {
			db: activeDbName(),
			statements: [
				{
					sql: 'INSERT INTO trash_events (id, module, kind, entity_id, label, payload, deleted_at, device_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
					params: [
						event.id,
						event.module,
						event.kind,
						event.entityId,
						event.label,
						JSON.stringify(event.payload),
						String(event.deletedAt),
						deviceId
					]
				},
				writeStampStatement(at)
			]
		});
		return event;
	});
}

/** Restaura as linhas e remove o evento. `false` quando o evento não existe. */
export function restoreTrashEvent(eventId: string): Promise<boolean> {
	return runSerialized(async () => {
		const db = await getReadyDatabase();
		const rows = await db.select<TrashRow[]>(
			'SELECT id, module, kind, entity_id, label, payload, deleted_at, device_id FROM trash_events WHERE id = $1',
			[eventId]
		);
		if (rows.length === 0) return false;
		const event = normalizeTrashEvent({
			id: rows[0].id,
			module: rows[0].module,
			kind: rows[0].kind,
			entityId: rows[0].entity_id,
			label: rows[0].label,
			payload: rows[0].payload,
			deletedAt: Number(rows[0].deleted_at) || 0,
			deviceId: rows[0].device_id ?? undefined
		});
		if (!event) return false;
		const at = await nextWriteStamp(db);
		const deviceId = await getDeviceId();
		const statements = buildRestoreStatements(event, deviceId, at);
		statements.push(writeStampStatement(at));
		await invoke('db_batch', { db: activeDbName(), statements });
		return true;
	});
}

/** "Excluir de vez": some da lixeira; os tombstones seguem a purga do sync. */
export function forgetTrashEvent(eventId: string): Promise<void> {
	return runSerialized(async () => {
		const db = await getReadyDatabase();
		await db.execute('DELETE FROM trash_events WHERE id = $1', [eventId]);
	});
}

/** Limpeza semanal (boot): apaga eventos fora da retenção. */
export function purgeTrashEvents(now = Date.now()): Promise<number> {
	return runSerialized(async () => {
		const db = await getReadyDatabase();
		const rows = await db.select<Array<{ count: unknown }>>(
			'SELECT COUNT(*) AS count FROM trash_events WHERE deleted_at < $1',
			[String(trashCutoff(now))]
		);
		const count = Number(rows[0]?.count ?? 0);
		if (count > 0) await db.execute('DELETE FROM trash_events WHERE deleted_at < $1', [String(trashCutoff(now))]);
		return count;
	});
}
