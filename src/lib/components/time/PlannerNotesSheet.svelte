<script lang="ts">
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import type { Note } from '#lib/notes';

	/** Lista agregada das notas dos blocos visíveis no planejador. */
	let {
		items,
		onopen,
		onclose
	}: {
		items: { note: Note; label: string; color: string }[];
		onopen: (note: Note) => void;
		onclose: () => void;
	} = $props();

	function excerpt(body: string): string {
		return body.replace(/\s+/g, ' ').trim().slice(0, 90);
	}
</script>

<Sheet title="Notas do planejador" closeLabel="Fechar" {onclose}>
	<div class="pn-list">
		{#each items as item, index (item.note.id + index)}
			<button type="button" class="pn-row" style={`--cc:${item.color}`} onclick={() => onopen(item.note)}>
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
