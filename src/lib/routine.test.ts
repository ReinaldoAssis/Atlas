import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, normalizeRoutine, type AtlasSnapshot, type RoutineBlock, type TimeBlock } from './atlas';
import { applyRoutine, routineBlockId, syncRoutine } from './routine';

const NOW = new Date('2026-10-21T10:00:00');

function routineBlock(overrides: Partial<RoutineBlock> = {}): RoutineBlock {
	return {
		id: 'deep-work',
		title: 'Foco profundo',
		categoryId: 'deep-work',
		weekday: 1,
		startMinutes: 9 * 60,
		durationMinutes: 60,
		...overrides
	};
}

function snapshotWith(blocks: RoutineBlock[], timeBlocks: TimeBlock[] = []): AtlasSnapshot {
	const snapshot = createEmptySnapshot();
	snapshot.routine = { revision: 'rev-1', blocks };
	snapshot.timeBlocks = timeBlocks;
	return snapshot;
}

function generated(snapshot: AtlasSnapshot): TimeBlock[] {
	return snapshot.timeBlocks.filter((block) => block.routineId);
}

describe('syncRoutine', () => {
	it('materializa o horizonte de 8 semanas sem tocar no passado', () => {
		const result = syncRoutine(snapshotWith([routineBlock()]), NOW);
		const blocks = generated(result.snapshot);

		expect(result.changed).toBe(true);
		expect(blocks).toHaveLength(8);
		expect(blocks[0].startAt).toBe('2026-10-26T09:00:00');
		expect(blocks.at(-1)?.startAt).toBe('2026-12-14T09:00:00');
		expect(blocks.every((block) => block.routineRevision === 'rev-1')).toBe(true);
	});

	it('pula o horário de hoje que já começou', () => {
		const result = syncRoutine(
			snapshotWith([routineBlock({ weekday: 3, startMinutes: 8 * 60 })]),
			NOW
		);

		// Quarta 21/10 às 8h já passou; o primeiro bloco cai na próxima quarta.
		expect(generated(result.snapshot)[0].startAt).toBe('2026-10-28T08:00:00');
	});

	it('manual vence: pula a data inteira quando há conflito', () => {
		const manual: TimeBlock = {
			id: 'manual',
			title: 'Reunião',
			categoryId: 'personal',
			startAt: '2026-10-26T09:30:00',
			endAt: '2026-10-26T10:30:00',
			plannedMinutes: 60,
			actualMinutes: null,
			status: 'planned'
		};
		const result = syncRoutine(snapshotWith([routineBlock()], [manual]), NOW);
		const blocks = generated(result.snapshot);

		expect(blocks).toHaveLength(7);
		expect(blocks.some((block) => block.startAt.startsWith('2026-10-26'))).toBe(false);
	});

	it('não recria um bloco gerado que o usuário apagou', () => {
		const first = syncRoutine(snapshotWith([routineBlock()]), NOW).snapshot;
		const deleted = first.timeBlocks.map((block) =>
			block.startAt.startsWith('2026-10-26') ? { ...block, status: 'cancelled' as const } : block
		);
		const second = syncRoutine({ ...first, timeBlocks: deleted }, NOW);

		expect(second.changed).toBe(false);
		expect(second.snapshot.timeBlocks.filter((block) => block.startAt.startsWith('2026-10-26'))).toHaveLength(1);
	});

	it('não mexe em bloco gerado editado para outra categoria', () => {
		const first = syncRoutine(snapshotWith([routineBlock()]), NOW).snapshot;
		const edited = first.timeBlocks.map((block) =>
			block.startAt.startsWith('2026-10-26') ? { ...block, categoryId: 'reading' } : block
		);
		const second = syncRoutine({ ...first, timeBlocks: edited }, NOW);

		expect(second.changed).toBe(false);
		expect(second.snapshot.timeBlocks.find((block) => block.id === routineBlockId('deep-work', '2026-10-26'))?.categoryId).toBe('reading');
	});
});

describe('applyRoutine', () => {
	it('descarta o futuro gerado, preserva passado/manual e recria', () => {
		const past: TimeBlock = {
			id: 'routine-deep-work-2026-10-12',
			title: 'Foco profundo',
			categoryId: 'deep-work',
			startAt: '2026-10-12T09:00:00',
			endAt: '2026-10-12T10:00:00',
			plannedMinutes: 60,
			actualMinutes: null,
			status: 'completed',
			routineId: 'deep-work',
			routineRevision: 'rev-1'
		};
		const manual: TimeBlock = {
			id: 'manual',
			title: 'Reunião',
			categoryId: 'personal',
			startAt: '2026-10-26T09:00:00',
			endAt: '2026-10-26T10:00:00',
			plannedMinutes: 60,
			actualMinutes: null,
			status: 'planned'
		};
		const base = snapshotWith([routineBlock()], [past, manual]);
		const next = applyRoutine(base, { revision: 'rev-2', blocks: [routineBlock({ durationMinutes: 30 })] }, NOW);

		expect(next.timeBlocks.find((block) => block.id === past.id)?.status).toBe('completed');
		expect(next.timeBlocks.find((block) => block.id === manual.id)).toBeTruthy();
		expect(next.timeBlocks.find((block) => block.id === routineBlockId('deep-work', '2026-10-26'))).toBeUndefined();
		expect(next.timeBlocks.find((block) => block.id === routineBlockId('deep-work', '2026-11-02'))?.plannedMinutes).toBe(30);
	});
});

describe('normalizeRoutine', () => {
	it('descarta blocos inválidos e arredonda para 30 min', () => {
		const routine = normalizeRoutine({
			revision: 'r1',
			blocks: [
				{ id: 'a', categoryId: 'deep-work', weekday: 1, startMinutes: 545, durationMinutes: 47 },
				{ id: 'b', categoryId: 'deep-work', weekday: 9, startMinutes: 0, durationMinutes: 30 },
				{ id: 'c', categoryId: 'deep-work', weekday: 2, startMinutes: 23 * 60 + 30, durationMinutes: 60 }
			]
		});

		expect(routine.revision).toBe('r1');
		expect(routine.blocks).toHaveLength(1);
		expect(routine.blocks[0]).toMatchObject({ startMinutes: 540, durationMinutes: 60 });
	});

	it('vazio por padrão', () => {
		expect(normalizeRoutine(undefined)).toEqual({ revision: '', blocks: [] });
	});
});
