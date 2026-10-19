import { describe, expect, it } from 'vitest';
import type { Category, Habit, HabitLog, TimeBlock, Tracker, TrackerEntry, Transaction } from './atlas';
import type { GraphEdge, GraphNode } from './graph';
import {
	financeCategoryTables,
	graphEdgeTables,
	graphNodeTables,
	habitLogTables,
	habitTables,
	timeCategoryTables,
	trackerEntryTables,
	trackerTables,
	transactionTables
} from './trash-build';

const transaction: Transaction = {
	id: 't1',
	type: 'expense',
	amountMinor: 4200,
	categoryId: 'ali',
	date: '2026-10-17',
	description: 'Mercado'
};

const category: Category = { id: 'ali', module: 'finance', name: 'Alimentação', color: '#ffb347', kind: 'out' };

const habit: Habit = {
	id: 'h1',
	name: 'Ler',
	metric: 'duration',
	unit: 'min',
	target: 30,
	scheduledDays: [1],
	active: true,
	bestStreak: 2
};

const log: HabitLog = { id: 'l1', habitId: 'h1', date: '2026-10-17', value: 30, completed: true };

const tracker: Tracker = {
	id: 'tr1',
	name: 'Peso',
	metric: 'count',
	unit: 'kg',
	target: 72,
	targetDirection: 'down',
	askTime: false,
	active: true,
	createdAt: '2026-10-01'
};

const trackerEntry: TrackerEntry = { id: 'te1', trackerId: 'tr1', date: '2026-10-17', value: 73 };

const block: TimeBlock = {
	id: 'tb1',
	title: 'Foco',
	categoryId: 'deep-work',
	startAt: '2026-10-17T09:00:00',
	endAt: '2026-10-17T09:30:00',
	plannedMinutes: 30,
	actualMinutes: null,
	status: 'planned'
};

const node: GraphNode = { id: 'n1', name: 'Meta', horizon: 'month', domainId: 'car', x: 10, y: 20 };
const edge: GraphEdge = {
	id: 'e1',
	from: 'origem',
	to: 'n1',
	label: 'Ação',
	source: 'manual',
	target: 0,
	window: 'month',
	manualProgress: 0
};

describe('trash-build', () => {
	it('monta a linha do lançamento com a coluna occurred_on', () => {
		const [table] = transactionTables([transaction]);
		expect(table.table).toBe('transactions');
		expect(table.columns).toEqual(['id', 'occurred_on', 'payload']);
		expect(table.rows[0][0]).toBe('t1');
		expect(table.rows[0][1]).toBe('2026-10-17');
		expect(JSON.parse(table.rows[0][2])).toMatchObject({ id: 't1', description: 'Mercado' });
	});

	it('agrupa categoria financeira e lançamentos vinculados', () => {
		const tables = financeCategoryTables(category, [transaction]);
		expect(tables.map((table) => table.table)).toEqual(['categories', 'transactions']);
		expect(tables[0].rows[0]).toEqual(['ali', 'finance', JSON.stringify(category)]);
		expect(tables[1].rows[0]).toEqual(['t1', '2026-10-17', JSON.stringify(transaction)]);
	});

	it('omite lançamentos quando a categoria está vazia', () => {
		expect(financeCategoryTables(category).map((table) => table.table)).toEqual(['categories']);
	});

	it('agrupa hábito e registros', () => {
		const tables = habitTables([habit], [log]);
		expect(tables.map((table) => table.table)).toEqual(['habits', 'habit_logs']);
		expect(tables[1].rows[0]).toEqual(['l1', 'h1', '2026-10-17', JSON.stringify(log)]);
	});

	it('omite a tabela de registros quando não há log', () => {
		expect(habitTables([habit]).map((table) => table.table)).toEqual(['habits']);
		expect(habitLogTables([])).toEqual([]);
	});

	it('agrupa tracker e registros', () => {
		const tables = trackerTables([tracker], [trackerEntry]);
		expect(tables.map((table) => table.table)).toEqual(['trackers', 'tracker_entries']);
		expect(trackerEntryTables([trackerEntry])[0].rows[0][1]).toBe('tr1');
	});

	it('agrupa categoria de tempo e blocos', () => {
		const timeCategory: Category = { id: 'deep-work', module: 'time', name: 'Foco', color: '#d4f25a' };
		const tables = timeCategoryTables(timeCategory, [block]);
		expect(tables.map((table) => table.table)).toEqual(['categories', 'time_blocks']);
		expect(tables[1].rows[0][1]).toBe(block.startAt);
	});

	it('agrupa nó e arestas conectadas', () => {
		const tables = graphNodeTables(node, [edge]);
		expect(tables.map((table) => table.table)).toEqual(['graph_nodes', 'graph_edges']);
		expect(graphEdgeTables([edge])[0].rows[0][0]).toBe('e1');
	});
});
