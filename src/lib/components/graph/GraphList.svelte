<script lang="ts">
	import { edgeRatio, horizonLabel, nodeReached, nodeRoleLabel, type GraphNode, type GraphState } from '#lib/graph';

	let {
		graph,
		onopennode,
		onopenedge,
		onreset
	}: {
		graph: GraphState;
		onopennode: (id: string) => void;
		onopenedge: (id: string) => void;
		onreset: () => void;
	} = $props();

	const findNode = (id: string) => graph.nodes.find((node) => node.id === id);
	const domainOf = (id: string) => graph.domains.find((domain) => domain.id === id);
	const nodeColor = (node: GraphNode) => domainOf(node.domainId)?.color ?? '#8d968a';
	const domainName = (id: string) => domainOf(id)?.name ?? 'Sem domínio';
	const incoming = (id: string) => graph.edges.filter((edge) => edge.to === id);
	const outgoing = (id: string) => graph.edges.filter((edge) => edge.from === id);
	const reached = (node: GraphNode) => nodeReached(node, graph.edges);
	const nameOf = (id: string) => findNode(id)?.name ?? '—';
</script>

<div class="gv-list" role="region" aria-label="Grafo em lista">
	{#each graph.nodes as node (node.id)}
		<div class="gv-list-node">
			<div class="gv-list-head">
				<span class="gv-dot" style={`background:${nodeColor(node)}`}></span>
				<b>{node.name}</b>
				<span class="gv-list-meta">{node.origin ? 'Origem' : nodeRoleLabel(node)} · {horizonLabel(node.horizon)} · {domainName(node.domainId)}{reached(node) ? ' · alcançado' : ''}</span>
			</div>
			{#each incoming(node.id) as edge (edge.id)}
				<div class="gv-list-edge">
					↳ de <button class="gv-link-btn" onclick={() => onopennode(edge.from)}>{nameOf(edge.from)}</button>: {edge.label} · {Math.round(edgeRatio(edge) * 100)}%
					<button class="gv-link-btn" onclick={() => onopenedge(edge.id)}>editar</button>
				</div>
			{/each}
			{#each outgoing(node.id) as edge (edge.id)}
				<div class="gv-list-edge muted">
					↳ para <button class="gv-link-btn" onclick={() => onopennode(edge.to)}>{nameOf(edge.to)}</button>: {edge.label} · {Math.round(edgeRatio(edge) * 100)}%
				</div>
			{/each}
		</div>
	{/each}
	<button class="gv-dev" onclick={onreset}>Restaurar grafo de exemplo</button>
</div>
