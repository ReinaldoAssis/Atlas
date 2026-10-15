<script lang="ts">
	import { onMount } from 'svelte';
	import type { AtlasSnapshot } from '#lib/atlas';
	import {
		createGraphFromDemo,
		edgeRatio,
		graphId,
		wouldCreateCycle,
		type GraphEdge,
		type GraphNode,
		type GraphSourceKind,
		type GraphState
	} from '#lib/graph';
	import { sourceRefOptions } from '#lib/graph-sources';
	import { burstAt, playFeedback, playTone, pulseHaptic } from '#lib/feedback';
	import GraphCanvas from './GraphCanvas.svelte';
	import GraphSheet from './GraphSheet.svelte';
	import GraphNodeSheet from './GraphNodeSheet.svelte';
	import GraphEdgeSheet from './GraphEdgeSheet.svelte';
	import GraphList from './GraphList.svelte';

	let {
		snapshot,
		oncommit,
		ontoast
	}: {
		snapshot: AtlasSnapshot;
		oncommit: (next: GraphState) => void;
		ontoast: (message: string, undo?: () => void) => void;
	} = $props();

	const graph = $derived(snapshot.graph);
	const sound = $derived(snapshot.preferences.soundEnabled);
	const haptics = $derived(snapshot.preferences.hapticsEnabled);

	let stageEl = $state<HTMLElement | null>(null);
	let canvas = $state<{ fit: () => void } | null>(null);
	let view = $state({ k: 1, x: 0, y: 0 });
	let editNode = $state<GraphNode | null>(null);
	let editEdge = $state<GraphEdge | null>(null);
	let isNewNode = $state(false);
	let showList = $state(false);
	let layoutTick = $state(0);

	const findNode = (id: string) => graph.nodes.find((node) => node.id === id);
	const incoming = (id: string) => graph.edges.filter((edge) => edge.to === id);

	/* ---------- persistência ---------- */
	function commit(next: GraphState) {
		oncommit(next);
	}

	function closeEditor() {
		editNode = null;
		editEdge = null;
		isNewNode = false;
	}

	function updateNode(patch: Partial<GraphNode>) {
		if (!editNode) return;
		const id = editNode.id;
		editNode = { ...editNode, ...patch };
		commit({ ...graph, nodes: graph.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) });
	}

	function updateEdge(patch: Partial<GraphEdge>) {
		if (!editEdge) return;
		const id = editEdge.id;
		editEdge = { ...editEdge, ...patch };
		commit({ ...graph, edges: graph.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)) });
	}

	function moveNodeTo(id: string, x: number, y: number) {
		commit({ ...graph, nodes: graph.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) });
	}

	function toggleReached(node: GraphNode) {
		updateNode({ reachedManual: !node.reachedManual });
	}

	/* ---------- feedback com posição de tela ---------- */
	function screenOf(point: { x: number; y: number }): [number, number] {
		if (!stageEl) return [window.innerWidth / 2, window.innerHeight / 2];
		const rect = stageEl.getBoundingClientRect();
		return [rect.left + view.x + point.x * view.k, rect.top + view.y + point.y * view.k];
	}

	function setEdgeProgress(value: number) {
		if (!editEdge) return;
		const before = edgeRatio(editEdge);
		const clamped = Math.max(0, Math.min(100, value));
		const ratio = clamped / 100;
		updateEdge({ manualProgress: clamped, done: ratio >= 1 });
		playTone(240 + ratio * 520, 0.05, 'sine', 0.035, sound);
		pulseHaptic(haptics, 3);
		if (before < 1 && ratio >= 1) {
			const target = findNode(editEdge.to);
			if (target) {
				const [sx, sy] = screenOf(target);
				burstAt(sx, sy, 20);
			}
			[523, 659, 784, 1047].forEach((frequency, index) => setTimeout(() => playTone(frequency, 0.24, 'triangle', 0.06, sound), index * 90));
			pulseHaptic(haptics, [20, 40, 20, 40, 70]);
			ontoast(`Transição concluída: ${editEdge.label}`);
		}
	}

	function setEdgeSource(source: GraphSourceKind) {
		if (!editEdge) return;
		const refs = sourceRefOptions(source, snapshot);
		const patch: Partial<GraphEdge> = { source };
		if (refs.length) {
			if (!refs.some((option) => option.id === editEdge?.refId)) patch.refId = refs[0].id;
		} else {
			patch.refId = undefined;
		}
		if (source === 'habitStreak') patch.window = 'total';
		else if (source === 'timeHours') patch.window = 'week';
		else if (source === 'financeLimit') patch.window = 'month';
		else if (source === 'financeSavings' && editEdge.window === 'week') patch.window = 'month';
		updateEdge(patch);
		playTone(560, 0.06, 'sine', 0.05, sound);
		pulseHaptic(haptics, 5);
	}

	/* ---------- edição ---------- */
	function openNode(id: string) {
		const node = findNode(id);
		if (!node) return;
		editEdge = null;
		isNewNode = false;
		editNode = { ...node };
		playTone(380, 0.1, 'sine', 0.05, sound);
	}

	function openEdge(id: string) {
		const edge = graph.edges.find((item) => item.id === id);
		if (!edge) return;
		editNode = null;
		isNewNode = false;
		editEdge = { ...edge };
		playTone(380, 0.1, 'sine', 0.05, sound);
	}

	function openNewNode(x: number, y: number, from?: string) {
		const origin = graph.nodes.find((node) => node.origin);
		const node: GraphNode = {
			id: graphId(),
			name: 'Novo nó',
			horizon: 'quarter',
			domainId: origin?.domainId ?? graph.domains[0]?.id ?? '',
			x,
			y
		};
		const edges = from
			? [...graph.edges, { id: graphId(), from, to: node.id, label: 'Nova ação', source: 'manual' as const, target: 0, window: 'month' as const, manualProgress: 0 }]
			: graph.edges;
		commit({ ...graph, nodes: [...graph.nodes, node], edges });
		editNode = node;
		editEdge = null;
		isNewNode = true;
		const [sx, sy] = screenOf(node);
		burstAt(sx, sy, 14, { up: true });
		playTone(440, 0.1, 'triangle', 0.06, sound);
		setTimeout(() => playTone(660, 0.14, 'triangle', 0.06, sound), 70);
		pulseHaptic(haptics, [10, 30, 10]);
	}

	function newAtCenter() {
		if (!stageEl) {
			openNewNode(0, 0);
			return;
		}
		const rect = stageEl.getBoundingClientRect();
		const wx = (rect.width / 2 - view.x) / view.k;
		const wy = (rect.height / 2 - view.y) / view.k;
		openNewNode(wx + (Math.random() - 0.5) * 90, wy + (Math.random() - 0.5) * 90);
	}

	function connect(from: string, to: string) {
		const origin = graph.nodes.find((node) => node.origin);
		if (from === to) return ontoast('Um nó não pode se ligar a si mesmo');
		if (origin && to === origin.id) return ontoast('O nó de origem não recebe conexões');
		if (graph.edges.some((edge) => edge.from === from && edge.to === to)) return ontoast('Essa transição já existe');
		if (wouldCreateCycle(graph.edges, from, to)) return ontoast('Isso criaria um ciclo');
		const edge: GraphEdge = { id: graphId(), from, to, label: 'Nova ação', source: 'manual', target: 0, window: 'month', manualProgress: 0 };
		commit({ ...graph, edges: [...graph.edges, edge] });
		const target = findNode(to);
		if (target) {
			const [sx, sy] = screenOf(target);
			burstAt(sx, sy, 16);
		}
		playTone(523, 0.12, 'triangle', 0.06, sound);
		setTimeout(() => playTone(784, 0.16, 'triangle', 0.06, sound), 80);
		pulseHaptic(haptics, [10, 30, 10]);
		setTimeout(() => openEdge(edge.id), 320);
	}

	function deleteNode(node: GraphNode) {
		if (node.origin) return;
		const before = JSON.stringify(graph);
		const id = node.id;
		if (editNode?.id === id) closeEditor();
		commit({ ...graph, nodes: graph.nodes.filter((item) => item.id !== id), edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id) });
		playFeedback('erase', sound);
		pulseHaptic(haptics, 12);
		ontoast('Nó removido', () => commit(JSON.parse(before) as GraphState));
	}

	function deleteSelectedNode() {
		if (editNode) deleteNode(editNode);
	}

	function deleteSelectedEdge() {
		if (!editEdge) return;
		const before = JSON.stringify(graph);
		const id = editEdge.id;
		closeEditor();
		commit({ ...graph, edges: graph.edges.filter((edge) => edge.id !== id) });
		playFeedback('erase', sound);
		pulseHaptic(haptics, 12);
		ontoast('Transição removida', () => commit(JSON.parse(before) as GraphState));
	}

	function resetDemo() {
		commit(createGraphFromDemo());
		ontoast('Grafo de exemplo restaurado.');
	}

	onMount(() => {
		const onScroll = () => {
			layoutTick += 1;
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closeEditor();
		};
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('keydown', onKey);
		};
	});

	const nodeCount = $derived(graph.nodes.length);
	const edgeCount = $derived(graph.edges.length);

	/** Posição da bolha do editor no desktop, ancorada ao nó (ou à aresta). */
	const bubble = $derived.by(() => {
		void layoutTick;
		const fallback = { left: '0px', top: '0px', side: 'right' as 'left' | 'right' };
		if (typeof window === 'undefined' || !stageEl) return fallback;
		let world: { x: number; y: number } | null = null;
		if (editNode) world = { x: editNode.x, y: editNode.y };
		else if (editEdge) {
			const a = findNode(editEdge.from);
			const b = findNode(editEdge.to);
			if (a && b) world = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		}
		if (!world) return fallback;
		const rect = stageEl.getBoundingClientRect();
		const px = rect.left + view.x + world.x * view.k;
		const py = rect.top + view.y + world.y * view.k;
		const width = 340;
		const height = 420;
		let side: 'left' | 'right' = 'right';
		let left = px + 46;
		if (left + width > window.innerWidth - 12) {
			side = 'left';
			left = px - width - 46;
		}
		left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
		const top = Math.max(12, Math.min(py - 80, window.innerHeight - height - 12));
		return { left: `${left}px`, top: `${top}px`, side };
	});
</script>

<div class="graph-view">
	<div class="gv-head">
		<div>
			<h1>Vida</h1>
			<small>{nodeCount} nós · {edgeCount} transições</small>
		</div>
		<div class="gv-head-actions">
			<button class="gv-ic" class:on={showList} aria-pressed={showList} aria-label="Alternar visão em lista" onclick={() => (showList = !showList)}>☰</button>
			<button class="gv-ic" aria-label="Centralizar grafo" onclick={() => canvas?.fit()}>◎</button>
		</div>
	</div>

	<div class="gv-legend"><span><i class="gv-lg-dot"></i>Objetivo</span><span><i class="gv-lg-tri"></i>Marco</span></div>

	<div class="gv-stage" bind:this={stageEl}>
		<GraphCanvas
			bind:this={canvas}
			{graph}
			bind:view
			selectedId={editNode?.id ?? ''}
			{sound}
			{haptics}
			onmove={moveNodeTo}
			onconnect={connect}
			oncreate={openNewNode}
			onopennode={openNode}
			onopenedge={openEdge}
			ondeletenode={deleteNode}
			onclose={closeEditor}
		/>
		<button class="gv-fab" aria-label="Novo nó" onclick={newAtCenter}>+</button>
	</div>

	{#if showList}
		<GraphList {graph} onopennode={openNode} onopenedge={openEdge} onreset={resetDemo} />
	{/if}
</div>

{#if editNode}
	{@const node = editNode}
	<GraphSheet label={isNewNode ? 'Novo nó' : 'Editar nó'} bx={bubble.left} by={bubble.top} side={bubble.side} onclose={closeEditor}>
		<GraphNodeSheet
			node={node}
			domains={graph.domains}
			hasIncoming={incoming(node.id).length > 0}
			isNew={isNewNode}
			onpatch={updateNode}
			ontoggle={() => toggleReached(node)}
			ondelete={deleteSelectedNode}
			onclose={closeEditor}
		/>
	</GraphSheet>
{/if}

{#if editEdge}
	{@const edge = editEdge}
	<GraphSheet label="Editar transição" bx={bubble.left} by={bubble.top} side={bubble.side} onclose={closeEditor}>
		<GraphEdgeSheet
			edge={edge}
			{snapshot}
			fromName={findNode(edge.from)?.name ?? '—'}
			toName={findNode(edge.to)?.name ?? '—'}
			onpatch={updateEdge}
			onsource={setEdgeSource}
			onprogress={setEdgeProgress}
			ondelete={deleteSelectedEdge}
			onclose={closeEditor}
		/>
	</GraphSheet>
{/if}
