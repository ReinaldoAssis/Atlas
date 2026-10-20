<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		bx = '0px',
		by = '0px',
		side = 'right',
		label,
		onclose,
		children
	}: {
		bx?: string;
		by?: string;
		side?: 'left' | 'right';
		label: string;
		onclose: () => void;
		children: Snippet;
	} = $props();

	let closing = $state(false);
	function requestClose() {
		if (closing) return;
		const reduced = typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced) {
			onclose();
			return;
		}
		closing = true;
		setTimeout(onclose, 190);
	}
</script>

<div
	class="gv-overlay"
	class:closing
	style={`--bx:${bx};--by:${by}`}
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) requestClose();
	}}
>
	<div class="gv-caret" class:flip={side === 'left'}></div>
	<div class="gv-sheet" role="dialog" aria-modal="true" aria-label={label}>
		<div class="gv-grip"></div>
		{@render children()}
	</div>
</div>

<style>
	.gv-overlay {
		animation: gv-fade-in 0.18s ease-out;
	}
	.gv-sheet {
		animation: gv-sheet-in 0.28s cubic-bezier(0.2, 0.9, 0.2, 1);
	}
	.gv-overlay.closing {
		animation: gv-fade-out 0.18s ease-in forwards;
	}
	.gv-overlay.closing .gv-sheet {
		animation: gv-sheet-out 0.19s cubic-bezier(0.4, 0, 1, 1) forwards;
	}
	@keyframes gv-fade-in {
		from {
			opacity: 0;
		}
	}
	@keyframes gv-sheet-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.98);
		}
	}
	@keyframes gv-fade-out {
		to {
			opacity: 0;
		}
	}
	@keyframes gv-sheet-out {
		to {
			opacity: 0;
			transform: translateY(10px) scale(0.98);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.gv-overlay,
		.gv-sheet,
		.gv-overlay.closing,
		.gv-overlay.closing .gv-sheet {
			animation: none;
		}
	}
</style>
