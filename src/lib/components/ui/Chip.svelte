<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Kit Atlas — chip selecionável (DESIGN §4). */
	let {
		selected = false,
		color,
		ariaLabel,
		onselect,
		children
	}: {
		selected?: boolean;
		color?: string;
		ariaLabel?: string;
		onselect?: () => void;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	class="chip"
	class:on={selected}
	aria-pressed={selected}
	aria-label={ariaLabel}
	style={color ? `--cc:${color}` : undefined}
	onclick={() => onselect?.()}
>
	{@render children()}
</button>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 36px;
		padding: 0 14px;
		border: 0;
		border-radius: 20px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s var(--ease-smooth), transform 0.15s var(--ease-spring);
	}
	.chip.on {
		background: var(--cc, var(--acc));
		color: var(--on-acc);
	}
	.chip:active {
		transform: scale(0.94);
	}
	@media (prefers-reduced-motion: reduce) {
		.chip {
			transition: none;
		}
	}
</style>
