<script lang="ts">
	import { Check, RotateCcw } from '@lucide/svelte';
	import { m } from '#lib/paraglide/messages.js';
	import type { PlanKey } from '#lib/plan';
	import Sheet from '../ui/Sheet.svelte';
	import Button from '../ui/Button.svelte';

	/**
	 * Paywall do mobile. Aparece quando o free bate num limite, pela linha
	 * "Atlas Pro" em Configurações e (ocasionalmente) para lembrar os
	 * benefícios. A compra em si entra na fatia de billing; aqui o CTA só
	 * avisa que ela chega na próxima atualização.
	 */
	let {
		reason = null,
		pro = false,
		onsubscribe,
		onrestore,
		onclose
	}: {
		reason?: PlanKey | null;
		pro?: boolean;
		onsubscribe?: () => void;
		onrestore?: () => void;
		onclose: () => void;
	} = $props();
</script>

<Sheet title={m.paywall_title()} closeLabel={m.common_close()} {onclose}>
	<div class="pw">
		<p class="lead">{m.paywall_subtitle()}</p>
		{#if reason}<p class="limit">{m.paywall_limit_body()}</p>{/if}

		<ul class="benefits">
			<li><Check size={16} />{m.paywall_benefit_limits()}</li>
			<li><Check size={16} />{m.paywall_benefit_sync()}</li>
			<li><Check size={16} />{m.paywall_benefit_history()}</li>
		</ul>

		<div class="prices">
			<div class="price">
				<strong>{m.paywall_price_monthly()}</strong>
			</div>
			<div class="price annual">
				<strong>{m.paywall_price_annual()}</strong>
				<small>{m.paywall_trial()}</small>
			</div>
		</div>

		<Button onclick={onsubscribe} disabled={pro || !onsubscribe}>{m.paywall_subscribe()}</Button>
		<button type="button" class="restore" onclick={onrestore} disabled={!onrestore}>
			<RotateCcw size={14} />{m.paywall_restore()}
		</button>
		<p class="soon">{m.paywall_soon()}</p>
	</div>
</Sheet>

<style>
	.pw {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.lead {
		margin: 0;
		color: var(--ink-soft, #c9cfc2);
		font-size: 14px;
	}
	.limit {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid var(--ln);
		border-radius: 12px;
		background: var(--s2);
		font-size: 13px;
	}
	.benefits {
		display: flex;
		flex-direction: column;
		gap: 9px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.benefits li {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		color: var(--ink, #ecefe6);
		font-size: 13px;
		line-height: 1.35;
	}
	.benefits :global(svg) {
		flex: none;
		margin-top: 1px;
		color: var(--lime);
	}
	.prices {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.price {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px;
		border: 1px solid var(--ln);
		border-radius: 14px;
		background: var(--s2);
	}
	.price.annual {
		border-color: color-mix(in srgb, var(--lime) 45%, var(--ln));
	}
	.price strong {
		font-size: 14px;
	}
	.price small {
		color: var(--lime);
		font-size: 11px;
	}
	.restore {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 0;
		background: none;
		color: var(--muted);
		font-size: 12px;
	}
	.soon {
		margin: 0;
		color: var(--muted);
		font-size: 11px;
		text-align: center;
	}
</style>
