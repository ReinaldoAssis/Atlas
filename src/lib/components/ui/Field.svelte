<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Kit Atlas — campo com rótulo (DESIGN §4). Estiliza o controle recebido. */
	let {
		label,
		hint,
		children
	}: { label?: string; hint?: string; children: Snippet } = $props();
</script>

<label class="field">
	{#if label}<span class="label">{label}{#if hint}<small>{hint}</small>{/if}</span>{/if}
	{@render children()}
</label>

<style>
	.field {
		display: grid;
		gap: 7px;
	}
	.label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: var(--mu);
		font-size: 13px;
		font-weight: 600;
	}
	.label small {
		font-size: 11px;
		font-weight: 400;
	}
	.field :global(input),
	.field :global(select) {
		width: 100%;
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--ln);
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-size: 15px;
		outline: none;
	}
	.field :global(select) {
		color-scheme: dark;
	}
	.field :global(input:focus),
	.field :global(select:focus) {
		border-color: var(--acc);
	}
	.field :global(input::placeholder) {
		color: var(--mu);
	}
	.field :global(.static) {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding: 0 12px;
		border-radius: 10px;
		background: var(--s2);
		color: var(--mu);
		font-size: 15px;
	}
</style>
