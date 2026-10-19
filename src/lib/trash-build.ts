/**
 * Snapshots para a lixeira global.
 *
 * Cada exclusão vira um `TrashTableSnapshot` com as colunas reais da tabela
 * (sem `updated_at`/`device_id`/`deleted_at`, que o restore preenche). Manter a
 * montagem aqui deixa a página e os componentes sem SQL.
 */
import type {
	Category,
	Habit,
	HabitLog,
	TimeBlock,
	Tracker,
	TrackerEntry,
	Transaction
} from './atlas';
import type { GraphEdge, GraphNode } from './graph';
import type { TrashTableSnapshot } from './trash';

function table<T>(
	name: string,
	columns: string[],
	items: T[],
	row: (item: T) => string[]
): TrashTableSnapshot {
	return { table: name, columns, rows: items.map((item) => row(item).map((value) => String(value))) };
}

export function transactionTables(items: Transaction[]): TrashTableSnapshot[] {
	return [
		table('transactions', ['id', 'occurred_on', 'payload'], items, (item) => [
			item.id,
			item.date,
			JSON.stringify(item)
		])
	];
}

export function financeCategoryTables(category: Category, transactions: Transaction[] = []): TrashTableSnapshot[] {
	const tables = [
		table('categories', ['id', 'module', 'payload'], [category], (item) => [
			item.id,
			item.module,
			JSON.stringify(item)
		])
	];
	if (transactions.length) tables.push(...transactionTables(transactions));
	return tables;
}

export function habitTables(habits: Habit[], logs: HabitLog[] = []): TrashTableSnapshot[] {
	const tables = [
		table('habits', ['id', 'payload'], habits, (item) => [item.id, JSON.stringify(item)])
	];
	if (logs.length) {
		tables.push(
			table('habit_logs', ['id', 'habit_id', 'occurred_on', 'payload'], logs, (item) => [
				item.id,
				item.habitId,
				item.date,
				JSON.stringify(item)
			])
		);
	}
	return tables;
}

export function habitLogTables(logs: HabitLog[]): TrashTableSnapshot[] {
	if (!logs.length) return [];
	return [
		table('habit_logs', ['id', 'habit_id', 'occurred_on', 'payload'], logs, (item) => [
			item.id,
			item.habitId,
			item.date,
			JSON.stringify(item)
		])
	];
}

export function trackerTables(trackers: Tracker[], entries: TrackerEntry[] = []): TrashTableSnapshot[] {
	const tables = [
		table('trackers', ['id', 'payload'], trackers, (item) => [item.id, JSON.stringify(item)])
	];
	if (entries.length) {
		tables.push(
			table('tracker_entries', ['id', 'tracker_id', 'occurred_on', 'payload'], entries, (item) => [
				item.id,
				item.trackerId,
				item.date,
				JSON.stringify(item)
			])
		);
	}
	return tables;
}

export function trackerEntryTables(entries: TrackerEntry[]): TrashTableSnapshot[] {
	return [
		table('tracker_entries', ['id', 'tracker_id', 'occurred_on', 'payload'], entries, (item) => [
			item.id,
			item.trackerId,
			item.date,
			JSON.stringify(item)
		])
	];
}

export function timeCategoryTables(category: Category, blocks: TimeBlock[] = []): TrashTableSnapshot[] {
	const tables = [
		table('categories', ['id', 'module', 'payload'], [category], (item) => [
			item.id,
			item.module,
			JSON.stringify(item)
		])
	];
	if (blocks.length) {
		tables.push(
			table('time_blocks', ['id', 'starts_at', 'payload'], blocks, (item) => [
				item.id,
				item.startAt,
				JSON.stringify(item)
			])
		);
	}
	return tables;
}

export function graphNodeTables(node: GraphNode, edges: GraphEdge[] = []): TrashTableSnapshot[] {
	const tables = [
		table('graph_nodes', ['id', 'payload'], [node], (item) => [item.id, JSON.stringify(item)])
	];
	if (edges.length) {
		tables.push(
			table('graph_edges', ['id', 'payload'], edges, (item) => [item.id, JSON.stringify(item)])
		);
	}
	return tables;
}

export function graphEdgeTables(edges: GraphEdge[]): TrashTableSnapshot[] {
	return [table('graph_edges', ['id', 'payload'], edges, (item) => [item.id, JSON.stringify(item)])];
}
