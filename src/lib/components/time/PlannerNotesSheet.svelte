<script lang="ts">
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import type { Note } from '#lib/notes';

	/** Lista agregada das notas dos blocos visíveis no planejador. */
	let {
		items,
		onopen,
		onopenfull,
		onclose
	}: {
		items: { note: Note; label: string; color: string }[];
		onopen: (note: Note) => void;
		onopenfull: (note: Note) => void;
		onclose: () => void;
	} = $props();

	function excerpt(body: string): string {
		return body.replace(/\s+/g, ' ').trim().slice(0, 90);
	}

	/**
	 * Swipe para cima na linha abre a nota inteira na aba Notas. O `touchmove`
	 * só cancela o scroll depois que o gesto é claramente vertical para cima,
	 * senão a lista continuaria rolando por baixo do dedo.
	 */
	const SWIPE_START = 12;
	const SWIPE_OPEN = 48;
	let swipe: { x: number; y: number; note: Note; armed: boolean } | null = null;
	let suppressClick = false;
	let suppressTimer: ReturnType<typeof setTimeout> | undefined;

	function touchStart(event: TouchEvent, note: Note) {
		if (event.touches.length !== 1) {
			swipe = null;
			return;
		}
		const touch = event.touches[0];
		swipe = { x: touch.clientX, y: touch.clientY, note, armed: false };
		suppressClick = false;
	}

	function touchMove(event: TouchEvent) {
		if (!swipe || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const dx = touch.clientX - swipe.x;
		const dy = touch.clientY - swipe.y;
		if (!swipe.armed && dy < -SWIPE_START && Math.abs(dy) > Math.abs(dx) * 1.2) {
			swipe.armed = true;
		}
		if (swipe.armed && event.cancelable) event.preventDefault();
	}

	function touchEnd(event: TouchEvent) {
		const current = swipe;
		swipe = null;
		if (!current?.armed) return;
		const touch = event.changedTouches[0];
		if (!touch || touch.clientY - current.y > -SWIPE_OPEN) return;
		// O touchend também gera click na linha; o preview não pode abrir.
		suppressClick = true;
		clearTimeout(suppressTimer);
		suppressTimer = setTimeout(() => (suppressClick = false), 600);
		onopenfull(current.note);
	}
</script>

<Sheet title="Notas do planejador" closeLabel="Fechar" {onclose}>
	<div class="pn-list">
		{#each items as item, index (item.note.id + index)}
			<button
				type="button"
				class="pn-row"
				style={`--cc:${item.color}`}
				onclick={() => {
					if (!suppressClick) onopen(item.note);
				}}
				ontouchstart={(event) => touchStart(event, item.note)}
				ontouchmove={touchMove}
				ontouchend={touchEnd}
				ontouchcancel={() => (swipe = null)}
			>
				<i aria-hidden="true"></i>
				<span class="pn-main">
					<b>{item.note.title || 'Sem título'}</b>
					<small>{item.label}</small>
				</span>
				<span class="pn-ex">{excerpt(item.note.body) || 'Nota vazia'}</span>
			</button>
		{/each}
	</div>
</Sheet>

<style>
	.pn-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: 4px;
	}
	.pn-row {
		display: grid;
		grid-template-columns: 9px minmax(0, 1fr);
		gap: 4px 10px;
		padding: 12px;
		border: 1px solid var(--ln);
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.pn-row:active {
		background: color-mix(in srgb, var(--cc) 14%, var(--s2));
	}
	.pn-row i {
		width: 9px;
		height: 9px;
		margin-top: 5px;
		border-radius: 50%;
		background: var(--cc);
	}
	.pn-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.pn-main b {
		font-size: 15px;
		font-weight: 600;
	}
	.pn-main small,
	.pn-ex {
		color: var(--mu);
		font-size: 12px;
	}
	.pn-ex {
		grid-column: 2;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	@media (hover: hover) {
		.pn-row:hover {
			border-color: color-mix(in srgb, var(--cc) 45%, var(--ln));
		}
	}
</style>
