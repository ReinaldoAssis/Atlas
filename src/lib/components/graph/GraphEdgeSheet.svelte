<script lang="ts">
	import { money, type AtlasSnapshot } from '#lib/atlas';
	import { edgeRatio, GRAPH_SOURCES, GRAPH_WINDOWS, sourceLabel, windowLabel, type GraphEdge, type GraphSourceKind } from '#lib/graph';
	import { isMoneySource, sourceDefaultTarget, sourceNeedsRef, sourceProgress, sourceRefOptions, sourceUnit, sourceWindowable } from '#lib/graph-sources';
	import { m } from '#lib/paraglide/messages.js';

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
		return unit ? `${Math.round(value)} ${unit}` : `${Math.round(value)}`;
	}

	function pickRef(id: string) {
		const target = sourceDefaultTarget(edge.source, id, snapshot);
		onpatch(target === undefined ? { refId: id } : { refId: id, target });
	}
</script>

<div class="gv-from">{fromName} → {toName}</div>
<input class="gv-inp" maxlength="40" aria-label={m.graph_edge_action()} value={edge.label} oninput={(event) => onpatch({ label: event.currentTarget.value })} />
<div class="gv-lb">{m.graph_edge_powered_by()}</div>
<div class="gv-chips">
	{#each GRAPH_SOURCES as source (source.id)}
		<button class="gv-chip" class:on={edge.source === source.id} onclick={() => onsource(source.id)}>{sourceLabel(source.id)}</button>
	{/each}
</div>
{#if edge.source === 'manual'}
	<div class="gv-pct" class:ok={edgeRatio(edge) >= 1}>{Math.round(edgeRatio(edge) * 100)}%</div>
	<div class="gv-lb">{m.graph_edge_progress()}</div>
	<input
		type="range"
		aria-label={m.graph_edge_progress()}
		min="0"
		max="100"
		step="5"
		value={edge.manualProgress}
		style={`--f:${edge.manualProgress}%`}
		oninput={(event) => onprogress(Number(event.currentTarget.value))}
	/>
{:else}
	{#if sourceNeedsRef(edge.source)}
		<div class="gv-lb">{m.graph_edge_reference()}</div>
		{#if options.length}
			<div class="gv-chips">
				{#each options as option (option.id)}
					<button class="gv-chip" class:on={edge.refId === option.id} onclick={() => pickRef(option.id)}>{option.name}</button>
				{/each}
			</div>
		{:else}
			<div class="gv-hint">{m.graph_edge_no_refs()}</div>
		{/if}
	{/if}
	{#if sourceWindowable(edge.source)}
		<div class="gv-lb">{m.graph_edge_window()}</div>
		<div class="gv-chips">
			{#each GRAPH_WINDOWS as window (window.id)}
				<button class="gv-chip" class:on={edge.window === window.id} onclick={() => onpatch({ window: window.id })}>{windowLabel(window.id)}</button>
			{/each}
		</div>
		{#if edge.window === 'fixed'}
			<input class="gv-inp" type="date" aria-label={m.graph_edge_window_start()} value={edge.windowFrom ?? ''} oninput={(event) => onpatch({ windowFrom: event.currentTarget.value })} />
		{/if}
	{/if}
	<div class="gv-lb">{m.graph_edge_target_with_unit({ unit })}</div>
	<input
		class="gv-inp"
		type="number"
		min="0"
		step={isMoneySource(edge.source) ? '0.01' : '1'}
		aria-label={m.graph_edge_target()}
		value={targetDisplay()}
		oninput={(event) => onTargetInput(event.currentTarget.value)}
	/>
	<div class="gv-readout">
		{#if progress}
			<b>{formatMetric(progress.value)}</b> {edge.source === 'financeLimit'
				? m.graph_edge_readout_available({ target: formatMetric(progress.target), percent: Math.round(Math.min(1, progress.ratio) * 100) })
				: m.graph_edge_readout({ target: formatMetric(progress.target), percent: Math.round(Math.min(1, progress.ratio) * 100) })}
		{:else}
			{m.graph_edge_source_unavailable()}
		{/if}
	</div>
{/if}
<button class="gv-btn" onclick={onclose}>{m.graph_done()}</button>
<button class="gv-btn danger" onclick={ondelete}>{m.graph_edge_delete()}</button>
