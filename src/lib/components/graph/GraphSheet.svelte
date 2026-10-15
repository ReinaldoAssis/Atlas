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
</script>

<div
	class="gv-overlay"
	style={`--bx:${bx};--by:${by}`}
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onclose();
	}}
>
	<div class="gv-caret" class:flip={side === 'left'}></div>
	<div class="gv-sheet" role="dialog" aria-modal="true" aria-label={label}>
		<div class="gv-grip"></div>
		{@render children()}
	</div>
</div>
