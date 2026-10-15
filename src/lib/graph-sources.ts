// Fase 2 — fontes de módulo para as arestas do grafo.
// Progresso é sempre derivado e somente leitura: reconciliar nunca escreve nos módulos.
import { currentStreak, dateOffset, localDate, weekStartDate, type AtlasSnapshot } from './atlas';
import type { GraphEdge, GraphSourceKind, GraphState } from './graph';

interface Range {
	start: string | null;
	end: string;
}

export interface SourceProgress {
	value: number;
	target: number;
	ratio: number;
	done: boolean;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function monthStart(today: string): string {
	const date = new Date(`${today}T12:00:00`);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function windowRange(edge: GraphEdge): Range {
	const today = localDate();
	if (edge.window === 'week') return { start: weekStartDate(today), end: today };
	if (edge.window === 'month') return { start: monthStart(today), end: today };
	if (edge.window === 'fixed') return { start: edge.windowFrom ?? null, end: today };
	return { start: null, end: today };
}

function inRange(date: string, range: Range): boolean {
	return (!range.start || date >= range.start) && date <= range.end;
}

function pausePeriods(snapshot: AtlasSnapshot): { start: string; end: string }[] {
	const periods = [...snapshot.lifeForce.pausePeriods];
	const today = localDate();
	if (snapshot.lifeForce.pausedFrom && snapshot.lifeForce.pausedUntil) {
		const end = dateOffset(snapshot.lifeForce.pausedUntil, -1);
		periods.push({ start: snapshot.lifeForce.pausedFrom, end: end < today ? end : today });
	}
	return periods;
}

/** Constrói o resultado. `done` explícito quando a fonte tem semântica própria (ex.: limite). */
function resultOf(value: number, target: number, done?: boolean): SourceProgress {
	if (!target || target <= 0) return { value, target: target || 0, ratio: 0, done: Boolean(done) };
	const ratio = Math.max(0, value / target);
	return { value, target, ratio, done: done ?? ratio >= 1 };
}

/** Valor/target/ratio atual de uma aresta alimentada por módulo. `null` = fonte inválida. */
export function sourceProgress(edge: GraphEdge, snapshot: AtlasSnapshot): SourceProgress | null {
	switch (edge.source) {
		case 'habitValue': {
			const habit = snapshot.habits.find((item) => item.id === edge.refId);
			if (!habit) return null;
			const range = windowRange(edge);
			const value = snapshot.habitLogs
				.filter((log) => log.habitId === habit.id && inRange(log.date, range))
				.reduce((sum, log) => sum + log.value, 0);
			return resultOf(value, edge.target);
		}
		case 'habitStreak': {
			const habit = snapshot.habits.find((item) => item.id === edge.refId);
			if (!habit) return null;
			const value = currentStreak(habit, snapshot.habitLogs, localDate(), pausePeriods(snapshot));
			return resultOf(value, edge.target);
		}
		case 'timeHours': {
			const category = snapshot.categories.find((item) => item.id === edge.refId && item.module === 'time');
			if (!category) return null;
			const today = localDate();
			const week = weekStartDate(today);
			const minutes = snapshot.timeBlocks
				.filter((block) => block.categoryId === category.id && block.status !== 'cancelled' && block.startAt.slice(0, 10) >= week && block.startAt.slice(0, 10) <= today)
				.reduce((sum, block) => sum + block.plannedMinutes, 0);
			return resultOf(minutes / 60, edge.target);
		}
		case 'financeSavings': {
			const range = windowRange(edge);
			const value = snapshot.transactions
				.filter((item) => inRange(item.date, range))
				.reduce((sum, item) => sum + (item.type === 'income' ? item.amountMinor : -item.amountMinor), 0);
			return resultOf(value, edge.target);
		}
		case 'financeLimit': {
			const category = snapshot.categories.find((item) => item.id === edge.refId && item.module === 'finance');
			if (!category) return null;
			const range = { start: monthStart(localDate()), end: localDate() };
			const spent = snapshot.transactions
				.filter((item) => item.categoryId === category.id && item.type === 'expense' && inRange(item.date, range))
				.reduce((sum, item) => sum + item.amountMinor, 0);
			const target = edge.target > 0 ? edge.target : category.limitMinor ?? 0;
			if (target <= 0) return null;
			// Restrição: sucesso = gastar dentro do limite. A razão mostra o orçamento disponível.
			const ratio = Math.max(0, Math.min(1, (target - spent) / target));
			return { value: spent, target, ratio, done: spent <= target };
		}
		default:
			return null;
	}
}

/**
 * Atualiza o cache de progresso das arestas alimentadas por módulo.
 * Fonte inválida (hábito/categoria removidos) → vira manual, congelada no último valor.
 */
export function reconcileGraph(graph: GraphState, snapshot: AtlasSnapshot): GraphState {
	let changed = false;
	const edges = graph.edges.map((edge) => {
		if (edge.source === 'manual') return edge;
		const result = sourceProgress(edge, snapshot);
		if (!result) {
			changed = true;
			return { ...edge, source: 'manual' as GraphSourceKind, done: (edge.manualProgress ?? 0) >= 100 };
		}
		const manualProgress = Math.round(clamp01(result.ratio) * 100);
		const done = result.done;
		if (manualProgress === edge.manualProgress && done === edge.done) return edge;
		changed = true;
		return { ...edge, manualProgress, done };
	});
	return changed ? { ...graph, edges } : graph;
}

export function isMoneySource(source: GraphSourceKind): boolean {
	return source === 'financeSavings' || source === 'financeLimit';
}

export function sourceWindowable(source: GraphSourceKind): boolean {
	return source === 'habitValue' || source === 'financeSavings';
}

export function sourceNeedsRef(source: GraphSourceKind): boolean {
	return source === 'habitValue' || source === 'habitStreak' || source === 'timeHours' || source === 'financeLimit';
}

export function sourceRefOptions(source: GraphSourceKind, snapshot: AtlasSnapshot): { id: string; name: string }[] {
	if (source === 'habitValue' || source === 'habitStreak') return snapshot.habits.map((habit) => ({ id: habit.id, name: habit.name }));
	if (source === 'timeHours') return snapshot.categories.filter((item) => item.module === 'time').map((item) => ({ id: item.id, name: item.name }));
	if (source === 'financeLimit') return snapshot.categories.filter((item) => item.module === 'finance' && item.kind !== 'in').map((item) => ({ id: item.id, name: item.name }));
	return [];
}

export function sourceUnit(edge: GraphEdge, snapshot: AtlasSnapshot): string {
	switch (edge.source) {
		case 'habitValue':
			return snapshot.habits.find((item) => item.id === edge.refId)?.unit || 'x';
		case 'habitStreak':
			return 'dias';
		case 'timeHours':
			return 'h';
		case 'financeSavings':
		case 'financeLimit':
			return snapshot.preferences.currency;
		default:
			return '';
	}
}
