import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from './atlas';
import {
	amountForCategory,
	budgetOverview,
	categoryLimitStatus,
	monthKey,
	transactionsInMonth
} from './finance';

const now = new Date(2026, 9, 18, 12, 0, 0); // outubro/2026

const categories: Category[] = [
	{ id: 'sal', module: 'finance', name: 'Salário', color: '#d4f25a', kind: 'in' },
	{ id: 'moa', module: 'finance', name: 'Moradia', color: '#9cc8ff', kind: 'out', limitMinor: 120000, limitMode: 'limit' },
	{ id: 'inv', module: 'finance', name: 'Investimento', color: '#ffd45a', kind: 'out', limitMinor: 50000, limitMode: 'goal' },
	{ id: 'laz', module: 'finance', name: 'Lazer', color: '#f1a5c5', kind: 'out', limitMinor: 0, limitMode: 'limit' }
];

const transactions: Transaction[] = [
	{ id: 't1', type: 'income', amountMinor: 500000, categoryId: 'sal', date: '2026-10-01', description: 'Salário' },
	{ id: 't2', type: 'expense', amountMinor: 90000, categoryId: 'moa', date: '2026-10-05', description: 'Aluguel' },
	{ id: 't3', type: 'expense', amountMinor: 20000, categoryId: 'inv', date: '2026-10-06', description: 'Aporte' },
	{ id: 't4', type: 'expense', amountMinor: 10000, categoryId: 'laz', date: '2026-09-30', description: 'Cinema' }
];

describe('finance period helpers', () => {
	it('usa o mês local no prefixo', () => {
		expect(monthKey(now)).toBe('2026-10');
	});

	it('filtra só os lançamentos do mês', () => {
		expect(transactionsInMonth(transactions, now).map((item) => item.id)).toEqual(['t1', 't2', 't3']);
	});

	it('soma a categoria', () => {
		expect(amountForCategory(transactionsInMonth(transactions, now), 'moa')).toBe(90000);
	});
});

describe('budgetOverview', () => {
	it('aloca só categorias de saída com limite > 0, incluindo metas', () => {
		const budget = budgetOverview(categories, transactionsInMonth(transactions, now));
		// 120000 (moradia) + 50000 (meta de investimento); Lazer tem limite 0.
		expect(budget.allocatedMinor).toBe(170000);
		expect(budget.spentMinor).toBe(110000);
		expect(budget.remainingMinor).toBe(60000);
		expect(budget.ratio).toBeCloseTo(110000 / 170000);
		expect(budget.over).toBe(false);
	});

	it('satura a barra e marca estouro', () => {
		const budget = budgetOverview(
			categories,
			[{ id: 't9', type: 'expense', amountMinor: 200000, categoryId: 'moa', date: '2026-10-10', description: 'Reforma' }]
		);
		expect(budget.ratio).toBe(1);
		expect(budget.over).toBe(true);
		expect(budget.remainingMinor).toBe(-30000);
	});

	it('sem orçamento definido não divide por zero', () => {
		const budget = budgetOverview([], []);
		expect(budget).toEqual({
			allocatedMinor: 0,
			spentMinor: 0,
			remainingMinor: 0,
			ratio: 0,
			over: false
		});
	});
});

describe('categoryLimitStatus', () => {
	it('limite abaixo de 100% fica no verde', () => {
		const status = categoryLimitStatus(categories[1], 90000);
		expect(status.mode).toBe('limit');
		expect(status.displayRatio).toBeCloseTo(0.75);
		expect(status.reached).toBe(false);
		expect(status.over).toBe(false);
		expect(status.remainingMinor).toBe(30000);
	});

	it('limite passado satura o preenchimento e calcula o excedente', () => {
		const status = categoryLimitStatus(categories[1], 126000);
		expect(status.displayRatio).toBe(1);
		expect(status.reached).toBe(true);
		expect(status.over).toBe(true);
		expect(status.percentBeyond).toBe(5);
		expect(status.remainingMinor).toBe(-6000);
	});

	it('meta é positiva ao atingir e ao passar (sem punição)', () => {
		const atGoal = categoryLimitStatus(categories[2], 50000);
		expect(atGoal.mode).toBe('goal');
		expect(atGoal.reached).toBe(true);
		expect(atGoal.over).toBe(false);
		expect(atGoal.percentBeyond).toBe(0);

		const beyond = categoryLimitStatus(categories[2], 62500);
		expect(beyond.reached).toBe(true);
		expect(beyond.over).toBe(true);
		expect(beyond.percentBeyond).toBe(25);
		expect(beyond.displayRatio).toBe(1);
	});

	it('categoria de entrada ou sem limite não tem status', () => {
		expect(categoryLimitStatus(categories[0], 500000).displayRatio).toBe(0);
		expect(categoryLimitStatus(categories[3], 5000).reached).toBe(false);
	});
});
