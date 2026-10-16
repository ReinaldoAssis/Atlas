<script lang="ts">
	/**
	 * Kit Atlas — seletor segmentado com pílula deslizante
	 * (`docs/DESIGN.md` §4). Usa `radiogroup` para manter teclado e leitor
	 * de tela coerentes com o que o olho vê.
	 */
	type Option = { value: string; label: string };

	let {
		options,
		value = $bindable(),
		label,
		onchange
	}: {
		options: Option[];
		value?: string;
		label: string;
		onchange?: (value: string) => void;
	} = $props();

	const index = $derived(Math.max(0, options.findIndex((option) => option.value === value)));

	function select(next: string) {
		if (next === value) return;
		value = next;
		onchange?.(next);
	}
</script>

<div
	class="segmented"
	role="radiogroup"
	aria-label={label}
	style={`--i:${index};--n:${options.length || 1}`}
>
	<i class="pill" aria-hidden="true"></i>
	{#each options as option (option.value)}
		<button
			type="button"
			role="radio"
			aria-checked={option.value === value}
			class="seg"
			class:on={option.value === value}
			onclick={() => select(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--n, 2), 1fr);
		padding: 3px;
		border-radius: 20px;
		background: var(--s2);
	}
	.pill {
		position: absolute;
		z-index: 0;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / var(--n, 2));
		border-radius: 20px;
		background: var(--acc);
		transform: translateX(calc(var(--i, 0) * 100%));
		transition: transform 0.3s var(--ease-spring);
	}
	.seg {
		position: relative;
		z-index: 1;
		min-height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: 20px;
		background: transparent;
		color: var(--mu);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: color 0.2s var(--ease-smooth);
	}
	.seg.on {
		color: var(--on-acc);
	}
	@media (prefers-reduced-motion: reduce) {
		.pill,
		.seg {
			transition: none;
		}
	}
</style>
