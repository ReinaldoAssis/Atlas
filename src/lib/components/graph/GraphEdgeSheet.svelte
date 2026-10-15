<script lang="ts">
	import { money, type AtlasSnapshot } from '#lib/atlas';
	import { edgeRatio, GRAPH_SOURCES, GRAPH_WINDOWS, type GraphEdge, type GraphSourceKind } from '#lib/graph';
	import { isMoneySource, sourceNeedsRef, sourceProgress, sourceRefOptions, sourceUnit, sourceWindowable } from '#lib/graph-sources';

	let {
		edge,
		snapshot,
		fromName,
		toName,
		onpatch,
		onsource,
		onprogress,
		ondelete,
		onclose
	}: {
		edge: GraphEdge;
		snapshot: AtlasSnapshot;
		fromName: string;
		toName: string;
		onpatch: (patch: Partial<GraphEdge>) => void;
		onsource: (source: GraphSourceKind) => void;
		onprogress: (value: number) => void;
		ondelete: () => void;
		onclose: () => void;
	} = $props();

	const options = $derived(sourceRefOptions(edge.source, snapshot));
	const progress = $derived(sourceProgress(edge, snapshot));
	const unit = $derived(sourceUnit(edge, snapshot));

	function targetDisplay(): number {
		return isMoneySource(edge.source) ? (edge.target || 0) / 100 : edge.target || 0;
	}

	function onTargetInput(raw: string) {
		const value = Number(raw);
		if (!Number.isFinite(value) || value < 0) return;
		onpatch({ target: isMoneySource(edge.source) ? Math.round(value * 100) : value });
	}

	function formatMetric(value: number): string {
		if (isMoneySource(edge.source)) return money(value, snapshot.preferences.currency);
		if (edge.source === 'timeHours') return `${value.toFixed(1).replace('.', ',')}h`;
		if (edge.source === 'habitStreak') return `${Math.round(value)} dias`;
		return unit ? `${Math.round(value)} ${unit}` : `${Math.round(value)}`;
	}
</script>

<div class="gv-from">{fromName} → {toName}</div>
<input class="gv-inp" maxlength="40" aria-label="Ação" value={edge.label} oninput={(event) => onpatch({ label: event.currentTarget.value })} />
<div class="gv-lb">Alimentado por</div>
<div class="gv-chips">
	{#each GRAPH_SOURCES as source (source.id)}
		<button class="gv-chip" class:on={edge.source === source.id} onclick={() => onsource(source.id)}>{source.label}</button>
	{/each}
</div>
{#if edge.source === 'manual'}
	<div class="gv-pct" class:ok={edgeRatio(edge) >= 1}>{Math.round(edgeRatio(edge) * 100)}%</div>
	<div class="gv-lb">Progresso</div>
	<input
		type="range"
		aria-label="Progresso"
		min="0"
		max="100"
		step="5"
		value={edge.manualProgress}
		style={`--f:${edge.manualProgress}%`}
		oninput={(event) => onprogress(Number(event.currentTarget.value))}
	/>
{:else}
	{#if sourceNeedsRef(edge.source)}
		<div class="gv-lb">Referência</div>
		{#if options.length}
			<div class="gv-chips">
				{#each options as option (option.id)}
					<button class="gv-chip" class:on={edge.refId === option.id} onclick={() => onpatch({ refId: option.id })}>{option.name}</button>
				{/each}
			</div>
		{:else}
			<div class="gv-hint">Nada para referenciar neste módulo ainda.</div>
		{/if}
	{/if}
	{#if sourceWindowable(edge.source)}
		<div class="gv-lb">Janela</div>
		<div class="gv-chips">
			{#each GRAPH_WINDOWS as window (window.id)}
				<button class="gv-chip" class:on={edge.window === window.id} onclick={() => onpatch({ window: window.id })}>{window.label}</button>
			{/each}
		</div>
		{#if edge.window === 'fixed'}
			<input class="gv-inp" type="date" aria-label="Início da janela" value={edge.windowFrom ?? ''} oninput={(event) => onpatch({ windowFrom: event.currentTarget.value })} />
		{/if}
	{/if}
	<div class="gv-lb">Meta ({unit})</div>
	<input
		class="gv-inp"
		type="number"
		min="0"
		step={isMoneySource(edge.source) ? '0.01' : '1'}
		aria-label="Meta"
		value={targetDisplay()}
		oninput={(event) => onTargetInput(event.currentTarget.value)}
	/>
	<div class="gv-readout">
		{#if progress}
			<b>{formatMetric(progress.value)}</b> de {formatMetric(progress.target)} · {Math.round(Math.min(1, progress.ratio) * 100)}%{edge.source === 'financeLimit' ? ' disponível' : ''}
		{:else}
			Fonte indisponível no momento.
		{/if}
	</div>
{/if}
<button class="gv-btn" onclick={onclose}>Pronto</button>
<button class="gv-btn danger" onclick={ondelete}>Excluir transição</button>
