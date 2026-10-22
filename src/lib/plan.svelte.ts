/**
 * Estado do plano no app.
 *
 * `pro: true` por padrão para o web preview e o desktop não piscarem bloqueados
 * antes do primeiro `plan_status`. No mobile a resposta chega no boot e, sem
 * rede, o Rust mantém o Pro cacheado por até 7 dias.
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauriApp } from './backup-io';
import { isGated, wouldExceed, type PlanKey, type PlanStatus } from './plan';

export const plan = $state<{ status: PlanStatus }>({
	status: { pro: true, source: 'desktop', checked_at: null, limits: null }
});

export const paywall = $state<{ open: boolean; reason: PlanKey | null }>({
	open: false,
	reason: null
});

export function planGated(): boolean {
	return isGated(plan.status);
}

export function planPro(): boolean {
	return plan.status.pro;
}

/** Guard otimista: chame antes de abrir o formulário de criação. */
export function allowCreate(key: PlanKey, current: number): boolean {
	if (!wouldExceed(plan.status, key, current)) return true;
	requestUpgrade(key);
	return false;
}

export function requestUpgrade(reason: PlanKey | null = null): void {
	paywall.reason = reason;
	paywall.open = true;
}

export function closePaywall(): void {
	paywall.open = false;
}

export async function loadPlan(): Promise<void> {
	if (!isTauriApp()) return;
	try {
		plan.status = await invoke<PlanStatus>('plan_status');
	} catch {
		// sem IPC (preview/web): segue como desktop, sem gating
	}
}

/** Chamado pelo billing depois de comprar/restaurar (fatia 5). */
export async function setPlanPro(pro: boolean, source = 'play'): Promise<void> {
	if (!isTauriApp()) return;
	plan.status = await invoke<PlanStatus>('plan_set_pro', { pro, source });
}
