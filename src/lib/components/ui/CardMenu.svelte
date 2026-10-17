<script lang="ts">
	import type { Component } from 'svelte';

	/**
	 * Kit Atlas — menu de contexto de card (segurar no toque / botão direito /
	 * botão `⋯` no desktop). O chamador posiciona e fecha.
	 */
	let {
		x,
		y,
		items,
		onclose
	}: {
		x: number;
		y: number;
		items: { label: string; danger?: boolean; icon?: Component<{ size?: number }>; action: () => void }[];
		onclose: () => void;
	} = $props();
</script>

<div class="cm" role="menu" style={`left:${x}px;top:${y}px`}>
	{#each items as item, index (index)}
		<button
			type="button"
			role="menuitem"
			class:danger={item.danger}
			onclick={() => {
				onclose();
				item.action();
			}}
		>
			{#if item.icon}
				{@const Icon = item.icon}
				<Icon size={16} />
			{/if}
			{item.label}
		</button>
	{/each}
</div>

<style>
	.cm {
		position: fixed;
		z-index: 70;
		min-width: 184px;
		padding: 6px;
		border: 1px solid var(--ln, #2e332e);
		border-radius: 12px;
		background: var(--s2, #272b27);
		box-shadow: 0 14px 34px #000a;
		animation: cm-in 0.14s ease-out;
	}
	.cm button {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--tx, #ecefe6);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.cm button:hover {
		background: #ffffff14;
	}
	.cm button.danger {
		color: #e58f83;
	}
	@keyframes cm-in {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
	}
</style>
