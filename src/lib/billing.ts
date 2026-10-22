/**
 * Billing do mobile (Play Billing 9 no Android; StoreKit 2 no iOS depois).
 *
 * O entitlement gravado pelo Rust é a fonte da verdade da UI; aqui só
 * perguntamos à loja, compramos/restauramos e sincronizamos o `plan.json`.
 * Nada disso roda no desktop (o PC é grátis).
 */
import {
	acknowledgePurchase,
	getProductStatus,
	getProducts,
	onPurchaseUpdated,
	purchase,
	restorePurchases,
	PurchaseState,
	type Purchase
} from '@choochmeque/tauri-plugin-iap-api';
import { planGated, setPlanPro } from './plan.svelte';

export const PRODUCT_MONTHLY = 'atlas_pro_monthly';
export const PRODUCT_ANNUAL = 'atlas_pro_annual';
export const PRO_PRODUCTS = [PRODUCT_MONTHLY, PRODUCT_ANNUAL] as const;

export interface BillingPrices {
	monthly: string | null;
	annual: string | null;
}

export type PurchaseOutcome = 'ok' | 'pending' | 'cancelled' | 'error';

function isActive(purchase: Purchase): boolean {
	return purchase.purchaseState === PurchaseState.PURCHASED;
}

async function acknowledge(purchase: Purchase): Promise<void> {
	if (!purchase.isAcknowledged) await acknowledgePurchase(purchase.purchaseToken);
}

/** Preços localizados da loja; `null` cai no texto fixo do paywall. */
export async function loadPrices(): Promise<BillingPrices> {
	if (!planGated()) return { monthly: null, annual: null };
	try {
		const { products } = await getProducts([...PRO_PRODUCTS], 'subs');
		const price = (id: string) =>
			products.find((product) => product.productId === id)?.formattedPrice ?? null;
		return { monthly: price(PRODUCT_MONTHLY), annual: price(PRODUCT_ANNUAL) };
	} catch {
		return { monthly: null, annual: null };
	}
}

/**
 * Reconsulta a loja. Se alguma assinatura está ativa, marca Pro e renova o
 * carimbo da checagem (o grace de 7 dias). Falha de rede não rebaixa ninguém.
 */
export async function refreshEntitlement(): Promise<boolean> {
	if (!planGated()) return true;
	try {
		for (const productId of PRO_PRODUCTS) {
			const status = await getProductStatus(productId, 'subs');
			if (status.isOwned && status.purchaseState === PurchaseState.PURCHASED) {
				await setPlanPro(true, 'play');
				return true;
			}
		}
		await setPlanPro(false, 'play');
		return false;
	} catch {
		return false;
	}
}

export async function subscribe(productId: string): Promise<PurchaseOutcome> {
	try {
		const result = await purchase(productId, 'subs');
		if (!isActive(result)) {
			return result.purchaseState === PurchaseState.PENDING ? 'pending' : 'cancelled';
		}
		await acknowledge(result).catch(() => undefined);
		await setPlanPro(true, 'play');
		return 'ok';
	} catch (error) {
		console.error('billing: purchase', error);
		return 'error';
	}
}

export async function restore(): Promise<boolean> {
	try {
		const { purchases } = await restorePurchases('subs');
		const active = purchases.find(isActive);
		if (!active) return false;
		await acknowledge(active).catch(() => undefined);
		await setPlanPro(true, 'play');
		return true;
	} catch (error) {
		console.error('billing: restore', error);
		return false;
	}
}

/** Escuta renovações/restaurações enquanto o app está aberto. */
export async function watchPurchases(onChange: () => void): Promise<() => void> {
	if (!planGated()) return () => undefined;
	try {
		const listener = await onPurchaseUpdated(async (updated) => {
			if (!isActive(updated)) return;
			await acknowledge(updated).catch(() => undefined);
			await setPlanPro(true, 'play');
			onChange();
		});
		return () => void listener.unregister();
	} catch {
		return () => undefined;
	}
}
