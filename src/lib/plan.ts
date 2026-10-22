/** Plano do mobile (o PC é sempre Pro) — tipos e regras puras. */

export type PlanKey =
	| 'notes'
	| 'attachments'
	| 'habits'
	| 'trackers'
	| 'finance_categories'
	| 'time_categories'
	| 'graph_nodes';

export interface PlanLimits {
	notes: number;
	attachments: number;
	habits: number;
	trackers: number;
	finance_categories: number;
	time_categories: number;
	graph_nodes: number;
	history_days: number;
}

export interface PlanStatus {
	pro: boolean;
	source: string;
	checked_at: number | null;
	limits: PlanLimits | null;
}

export const FREE_LIMITS: PlanLimits = {
	notes: 7,
	attachments: 5,
	habits: 3,
	trackers: 2,
	finance_categories: 4,
	time_categories: 5,
	graph_nodes: 5,
	history_days: 7
};

/** O mobile responde com limites; o desktop devolve `limits: null`. */
export function isGated(plan: PlanStatus): boolean {
	return plan.limits !== null;
}

export function limitFor(plan: PlanStatus, key: PlanKey): number | null {
	if (plan.pro || !plan.limits) return null;
	return plan.limits[key];
}

/** `true` quando criar mais um item passaria do limite do free. */
export function wouldExceed(plan: PlanStatus, key: PlanKey, current: number): boolean {
	const limit = limitFor(plan, key);
	return limit !== null && current >= limit;
}

/**
 * O Rust reverte o lote com `plan-limit:<chave>:<limite>`. A UI usa isso como
 * fallback quando algum caminho de escrita escapou do guard otimista.
 */
export function parsePlanLimitError(message: string): { key: PlanKey; limit: number } | null {
	const match = /plan-limit:([a-z_]+):(\d+)/.exec(message);
	if (!match) return null;
	const key = match[1] as PlanKey;
	if (!(key in FREE_LIMITS)) return null;
	return { key, limit: Number(match[2]) };
}

/** Data mínima visível no free (`YYYY-MM-DD`), contada a partir de hoje. */
export function historyFloor(today: string, plan: PlanStatus): string | null {
	if (plan.pro || !plan.limits) return null;
	const date = new Date(`${today}T12:00:00`);
	date.setDate(date.getDate() - (plan.limits.history_days - 1));
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
