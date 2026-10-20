import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, type AtlasSnapshot, type Tracker, type TrackerEntry } from './atlas';
import type { GraphEdge } from './graph';
import { sourceDefaultTarget, sourceNeedsRef, sourceProgress, sourceRefOptions, sourceUnit } from './graph-sources';

function tracker(overrides: Partial<Tracker> = {}): Tracker {
	return {
		id: 't1',
		name: 'Peso',
		metric: 'count',
		unit: 'kg',
		target: 70,
		targetDirection: 'down',
		askTime: false,
		active: true,
		createdAt: '2026-01-01T10:00:00.000Z',
		...overrides
	};
}

function entry(value: number, date = '2026-10-15'): TrackerEntry {
	return { id: `e-${date}-${value}`, trackerId: 't1', date, value };
}

function snapshotWith(trackers: Tracker[], entries: TrackerEntry[] = []): AtlasSnapshot {
	return { ...createEmptySnapshot(), trackers, trackerEntries: entries };
}

function edge(overrides: Partial<GraphEdge> = {}): GraphEdge {
	return {
		id: 'edge-1',
		from: 'a',
		to: 'b',
		label: 'Pesar',
		source: 'trackerLast',
		refId: 't1',
		target: 70,
		window: 'total',
		manualProgress: 0,
		...overrides
	};
}

describe('sourceProgress · trackers', () => {
	it('usa o último registro da janela', () => {
		const snapshot = snapshotWith([tracker()], [entry(72, '2026-10-13'), entry(69, '2026-10-15')]);
		const result = sourceProgress(edge(), snapshot);
		expect(result).toMatchObject({ value: 69, target: 70, done: true });
	});

	it('calcula a média dos registros da janela', () => {
		const snapshot = snapshotWith([tracker()], [entry(72, '2026-10-13'), entry(68, '2026-10-14')]);
		const result = sourceProgress(edge({ source: 'trackerAverage' }), snapshot);
		expect(result?.value).toBe(70);
	});

	it('trackerGoal herda a meta do tracker quando a aresta não tem meta', () => {
		const snapshot = snapshotWith([tracker({ target: 65 })], [entry(67)]);
		const result = sourceProgress(edge({ source: 'trackerGoal', target: 0 }), snapshot);
		expect(result).toMatchObject({ value: 67, target: 65, done: false });
		expect(sourceDefaultTarget('trackerGoal', 't1', snapshot)).toBe(65);
	});

	it('respeita “menos é melhor” na meta do tracker', () => {
		const snapshot = snapshotWith([tracker()], [entry(72)]);
		expect(sourceProgress(edge({ source: 'trackerGoal' }), snapshot)?.done).toBe(false);
		const better = snapshotWith([tracker()], [entry(68)]);
		expect(sourceProgress(edge({ source: 'trackerGoal' }), better)?.done).toBe(true);
	});

	it('devolve null quando o tracker não existe', () => {
		expect(sourceProgress(edge({ refId: 'nope' }), snapshotWith([]))).toBeNull();
	});

	it('lista só trackers ativos como referência', () => {
		const snapshot = snapshotWith([tracker(), tracker({ id: 't2', name: 'Sono', active: false })]);
		expect(sourceRefOptions('trackerAverage', snapshot)).toEqual([{ id: 't1', name: 'Peso' }]);
		expect(sourceNeedsRef('trackerGoal')).toBe(true);
	});

	it('herda a unidade do tracker', () => {
		const snapshot = snapshotWith([tracker()]);
		expect(sourceUnit(edge(), snapshot)).toBe('kg');
	});

	it('streak de hábito semanal usa semanas', () => {
		const snapshot = createEmptySnapshot();
		snapshot.habits = [
			{
				id: 'h1',
				name: 'Treinar',
				metric: 'weekly',
				unit: '',
				target: 3,
				scheduledDays: [],
				active: true,
				bestStreak: 0
			}
		];
		expect(sourceUnit(edge({ source: 'habitStreak', refId: 'h1' }), snapshot)).toBe('semanas');
	});
});
