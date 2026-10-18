<script lang="ts">
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { getCarta } from '#lib/carta';
	import type { Note } from '#lib/notes';

	/** Leitura da nota aberta a partir do dialog do planejador, sem sair do Tempo. */
	let {
		note,
		onopenfull,
		onclose
	}: { note: Note; onopenfull: (note: Note) => void; onclose: () => void } = $props();

	const carta = getCarta();
	let bodyEl = $state<HTMLElement | null>(null);

	$effect(() => {
		const element = bodyEl;
		if (!element) return;
		let cancelled = false;
		element.innerHTML = '';
		void carta
			.render(note.body)
			.then((html) => {
				if (!cancelled) element.innerHTML = html;
			})
			.catch(() => {
				if (!cancelled) element.textContent = note.body;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<Sheet title={note.title || 'Sem título'} closeLabel="Fechar" {onclose} onpullup={() => onopenfull(note)}>
	{#if note.tags.length}
		<div class="pn-tags">
			{#each note.tags as tag (tag)}<span>#{tag}</span>{/each}
		</div>
	{/if}
	{#if note.body.trim()}
		<div class="pn-body markdown-body" bind:this={bodyEl}></div>
	{:else}
		<p class="pn-empty">Nota vazia.</p>
	{/if}
</Sheet>

<style>
	.pn-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-bottom: 10px;
	}
	.pn-tags span {
		padding: 2px 7px;
		border-radius: 10px;
		background: var(--accd);
		color: var(--acc);
		font-size: 11px;
		font-weight: 600;
	}
	.pn-body {
		padding-bottom: 8px;
		color: var(--tx);
		font-size: 15px;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.pn-empty {
		margin: 0;
		color: var(--mu);
		font-size: 14px;
	}
</style>
