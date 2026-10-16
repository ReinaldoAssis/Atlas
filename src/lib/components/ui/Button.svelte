<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Kit Atlas — botão de ação (DESIGN §4). */
	let {
		variant = 'primary',
		type = 'button',
		disabled = false,
		onclick,
		children
	}: {
		variant?: 'primary' | 'secondary' | 'danger';
		type?: 'button' | 'submit';
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	} = $props();

	function handle(event: MouseEvent) {
		if (disabled) return;
		onclick?.(event);
	}
</script>

<button {type} class="btn {variant}" {disabled} onclick={handle}>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 46px;
		padding: 0 16px;
		border: 0;
		border-radius: 12px;
		font: inherit;
		font-size: 15px;
		font-weight: 700;
		cursor: pointer;
	}
	.primary {
		background: var(--acc);
		color: var(--on-acc);
	}
	.secondary {
		background: var(--s2);
		color: var(--tx);
	}
	.danger {
		background: var(--s2);
		color: var(--danger);
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
