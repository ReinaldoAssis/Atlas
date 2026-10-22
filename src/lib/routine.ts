/**
 * Rotina semanal → blocos concretos.
 *
 * A rotina é uma **semana padrão** (sem datas). `syncRoutine` cria os blocos das
 * próximas `ROUTINE_HORIZON_WEEKS` semanas e `applyRoutine` regenera o futuro
 * quando a rotina muda.
 *
 * Regras:
 * - blocos gerados carregam `routineId` + `routineRevision`;
 * - editar um bloco gerado vale só para aquela data (a revisão não muda);
 * - apagar (status `cancelled`) também é exceção: o id fixo impede recriar;
 * - bloco manual no mesmo horário vence (a rotina pula o slot);
 * - passado e blocos já iniciados nunca são tocados.
 */
import {
	dateOffset,
	localDate,
	ROUTINE_HORIZON_WEEKS,
	type AtlasSnapshot,
	type RoutineBlock,
	type RoutineState,
	type TimeBlock
} from './atlas';

const SLOT_MINUTES = 30;
const DAY_MINUTES = 24 * 60;
const HORIZON_DAYS = ROUTINE_HORIZON_WEEKS * 7;

/** Id determinístico: o mesmo slot da rotina gera sempre a mesma linha. */
export function routineBlockId(routineId: string, date: string): string {
	return `routine-${routineId}-${date}`;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** `YYYY-MM-DDTHH:MM:00`, aceitando minutos além de 24h (vira o dia seguinte). */
function atMinutes(date: string, minutes: number): string {
	const day = minutes >= DAY_MINUTES ? dateOffset(date, 1) : date;
	const rest = minutes % DAY_MINUTES;
	return `${day}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}:00`;
}

function idKey(block: TimeBlock): string {
	return block.startAt.slice(0, 16);
}

/** Carimbo local comparável com `startAt` (`YYYY-MM-DDTHH:MM:SS`). */
function localStamp(now: Date): string {
	return `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function overlaps(block: TimeBlock, startAt: string, endAt: string): boolean {
	return block.status !== 'cancelled' && idKey(block) < endAt && block.endAt.slice(0, 16) > startAt;
}

function isFuture(block: TimeBlock, now: string): boolean {
	return block.startAt > now;
}

/** Cria os blocos que faltam no horizonte, sem mexer no que já existe. */
function materialize(
	routine: RoutineState,
	blocks: TimeBlock[],
	now: Date
): { blocks: TimeBlock[]; created: number } {
	if (!routine.blocks.length) return { blocks, created: 0 };
	const nowIso = localStamp(now);
	const today = localDate(now);
	const existing = new Set(blocks.map((block) => block.id));
	const next = [...blocks];
	let created = 0;
	const ordered = [...routine.blocks].sort(
		(a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes
	);

	for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
		const date = dateOffset(today, offset);
		const weekday = new Date(`${date}T12:00:00`).getDay();
		for (const entry of ordered) {
			if (entry.weekday !== weekday) continue;
			const id = routineBlockId(entry.id, date);
			if (existing.has(id)) continue;
			const startAt = atMinutes(date, entry.startMinutes);
			if (startAt <= nowIso) continue;
			const endAt = atMinutes(date, entry.startMinutes + entry.durationMinutes);
			// Manual vence: qualquer bloco ativo no caminho faz a rotina pular.
			if (next.some((block) => overlaps(block, startAt, endAt))) continue;
			next.push({
				id,
				title: entry.title,
				categoryId: entry.categoryId,
				startAt,
				endAt,
				plannedMinutes: entry.durationMinutes,
				actualMinutes: null,
				status: 'planned',
				routineId: entry.id,
				routineRevision: routine.revision
			});
			existing.add(id);
			created += 1;
		}
	}
	return { blocks: next, created };
}

/**
 * Sincroniza a rotina com os blocos: rematerializa quando a revisão mudou e
 * completa o horizonte. Devolve o mesmo snapshot quando nada mudou.
 */
export function syncRoutine(
	snapshot: AtlasSnapshot,
	now: Date = new Date()
): { snapshot: AtlasSnapshot; changed: boolean } {
	const nowIso = localStamp(now);
	const stale = snapshot.timeBlocks.some(
		(block) =>
			block.routineId &&
			block.status !== 'cancelled' &&
			block.routineRevision !== snapshot.routine.revision &&
			isFuture(block, nowIso)
	);
	const base = stale
		? snapshot.timeBlocks.filter(
				(block) => !(block.routineId && block.status !== 'cancelled' && isFuture(block, nowIso))
			)
		: snapshot.timeBlocks;
	const result = materialize(snapshot.routine, base, now);
	if (!stale && result.created === 0) return { snapshot, changed: false };
	return {
		snapshot: { ...snapshot, timeBlocks: result.blocks },
		changed: true
	};
}

/**
 * Aplica uma rotina editada: descarta os blocos futuros gerados pela revisão
 * antiga (exceções apagadas ficam como lápide) e recria o horizonte.
 */
export function applyRoutine(
	snapshot: AtlasSnapshot,
	routine: RoutineState,
	now: Date = new Date()
): AtlasSnapshot {
	const nowIso = localStamp(now);
	const kept = snapshot.timeBlocks.filter(
		(block) => !(block.routineId && block.status !== 'cancelled' && isFuture(block, nowIso))
	);
	const result = materialize(routine, kept, now);
	return { ...snapshot, routine, timeBlocks: result.blocks };
}
