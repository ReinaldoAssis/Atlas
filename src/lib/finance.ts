/**
 * Regras financeiras puras — sem estado da página e sem I/O.
 *
 * O mês é sempre o calendário local (`YYYY-MM`). As funções recebem os
 * lançamentos já carregados para continuarem testáveis e reutilizáveis pelo
 * grafo, pela dashboard e pela aba de Finanças.
 */
import {
	normalizeCategoryLimitMode,
	type Category,
	type CategoryLimitMode,
	type Transaction
} from './atlas';

/** Prefixo `YYYY-MM` do mês local. */
export function monthKey(date: Date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function transactionsInMonth(transactions: Transaction[], date: Date = new Date()): Transaction[] {
	const prefix = monthKey(date);
	return transactions.filter((item) => item.date.startsWith(prefix));
}

/** Total lançado numa categoria (os lançamentos já vêm filtrados por período). */
export function amountForCategory(transactions: Transaction[], categoryId: string): number {
	return transactions
		.filter((item) => item.categoryId === categoryId)
		.reduce((sum, item) => sum + item.amountMinor, 0);
}

export interface BudgetOverview {
	/** Soma dos limites das categorias de saída com limite/meta > 0. */
	allocatedMinor: number;
	/** Gasto do mês (todas as despesas). */
	spentMinor: number;
	/** Positivo = ainda cabe; negativo = passou do orçamento. */
	remainingMinor: number;
	/** 0–1, saturado (a barra não passa de 100%). */
	ratio: number;
	over: boolean;
}

export function budgetOverview(categories: Category[], monthTransactions: Transaction[]): BudgetOverview {
	const allocatedMinor = categories
		.filter((item) => item.module === 'finance' && item.kind !== 'in' && (item.limitMinor ?? 0) > 0)
		.reduce((sum, item) => sum + (item.limitMinor ?? 0), 0);
	// Metas de categoria também são alocação (investimento, por exemplo).
	const spentMinor = monthTransactions
		.filter((item) => item.type === 'expense')
		.reduce((sum, item) => sum + item.amountMinor, 0);
	return {
		allocatedMinor,
		spentMinor,
		remainingMinor: allocatedMinor - spentMinor,
		ratio: allocatedMinor > 0 ? Math.min(1, spentMinor / allocatedMinor) : 0,
		over: allocatedMinor > 0 && spentMinor > allocatedMinor
	};
}

export interface CategoryLimitStatus {
	limitMinor: number;
	mode: CategoryLimitMode;
	/** Gasto ÷ limite, sem saturar (pode passar de 1). */
	ratio: number;
	/** O que a barra/tile pinta: nunca passa de 1. */
	displayRatio: number;
	reached: boolean;
	/** Passou do valor. Em `goal` não é ruim — só deixa de ser novidade. */
	over: boolean;
	/** Excedente em pontos percentuais inteiros (0 quando não passou). */
	percentBeyond: number;
	/** Positivo = falta; negativo = excedeu. */
	remainingMinor: number;
}

export function categoryLimitStatus(category: Category, spentMinor: number): CategoryLimitStatus {
	const limitMinor = Math.max(0, category.limitMinor ?? 0);
	const mode = normalizeCategoryLimitMode(category.limitMode);
	if (category.kind === 'in' || limitMinor <= 0) {
		return {
			limitMinor,
			mode,
			ratio: 0,
			displayRatio: 0,
			reached: false,
			over: false,
			percentBeyond: 0,
			remainingMinor: 0
		};
	}
	const spent = Math.max(0, spentMinor);
	const ratio = spent / limitMinor;
	return {
		limitMinor,
		mode,
		ratio,
		displayRatio: Math.min(1, ratio),
		reached: ratio >= 1,
		over: ratio > 1,
		percentBeyond: ratio > 1 ? Math.round((ratio - 1) * 100) : 0,
		remainingMinor: limitMinor - spent
	};
}
