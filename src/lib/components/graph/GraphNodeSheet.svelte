<script lang="ts">
	import { onMount } from 'svelte';
	import { horizonLabel, HORIZONS, isMilestone, nodeRoleLabel, type GraphDomain, type GraphNode } from '#lib/graph';
	import { m } from '#lib/paraglide/messages.js';

	let {
		node,
		domains,
		hasIncoming,
		isNew = false,
		onpatch,
		ontoggle,
		ondelete,
		onclose
	}: {
		node: GraphNode;
		domains: GraphDomain[];
		hasIncoming: boolean;
		isNew?: boolean;
		onpatch: (patch: Partial<GraphNode>) => void;
		ontoggle: () => void;
		ondelete: () => void;
		onclose: () => void;
	} = $props();

	let nameInput = $state<HTMLInputElement | null>(null);

	onMount(() => {
		if (!isNew) return;
		setTimeout(() => {
			try {
				nameInput?.focus();
				nameInput?.select();
			} catch {
				/* Ignora foco em WebViews restritas. */
			}
		}, 60);
	});
</script>

<div class="gv-from">{node.origin ? m.graph_node_sheet_origin() : `${nodeRoleLabel(node)} · ${horizonLabel(node.horizon)}`}</div>
<input
	class="gv-inp"
	bind:this={nameInput}
	maxlength="40"
	aria-label={m.graph_node_name()}
	value={node.name}
	oninput={(event) => onpatch({ name: event.currentTarget.value })}
/>
<div class="gv-lb">{m.graph_node_horizon()}</div>
<div class="gv-chips">
	{#each HORIZONS as horizon (horizon.id)}
		<button class="gv-chip" class:on={node.horizon === horizon.id} onclick={() => onpatch({ horizon: horizon.id })}>{horizonLabel(horizon.id)}</button>
	{/each}
</div>
{#if !node.origin}
	<div class="gv-hint">
		<span class={isMilestone(node) ? 'gv-hint-tri' : 'gv-hint-dot'}></span>
		{nodeRoleLabel(node)} · {isMilestone(node) ? m.graph_node_long_term() : m.graph_node_short_term()}
	</div>
{/if}
<div class="gv-lb">{m.graph_node_domain()}</div>
<div class="gv-chips">
	{#each domains as domain (domain.id)}
		<button class="gv-chip" class:on={node.domainId === domain.id} style={`--cc:${domain.color}`} onclick={() => onpatch({ domainId: domain.id })}><i></i>{domain.name}</button>
	{/each}
</div>
{#if !node.origin && !hasIncoming}
	<button class="gv-btn ghost" aria-pressed={Boolean(node.reachedManual)} onclick={ontoggle}>{node.reachedManual ? m.graph_node_reached_on() : m.graph_node_reached_off()}</button>
{/if}
<button class="gv-btn" onclick={onclose}>{m.graph_done()}</button>
{#if !node.origin}
	<button class="gv-btn danger" onclick={ondelete}>{m.graph_node_delete()}</button>
{/if}
