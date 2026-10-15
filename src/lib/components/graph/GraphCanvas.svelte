<script lang="ts">
	import { onMount } from 'svelte';
	import { edgeRatio, horizonLabel, isMilestone, nodeReached, nodeRoleLabel, type GraphNode, type GraphState } from '#lib/graph';
	import { playTone, pulseHaptic } from '#lib/feedback';

	type View = { k: number; x: number; y: number };

	let {
		graph,
		view = $bindable({ k: 1, x: 0, y: 0 }),
		selectedId = '',
		sound = true,
		haptics = true,
		onmove,
		onconnect,
		oncreate,
		onopennode,
		onopenedge,
		ondeletenode,
		onclose
	}: {
		graph: GraphState;
		view?: View;
		selectedId?: string;
		sound?: boolean;
		haptics?: boolean;
		onmove: (id: string, x: number, y: number) => void;
		onconnect: (from: string, to: string) => void;
		oncreate: (x: number, y: number, from?: string) => void;
		onopennode: (id: string) => void;
		onopenedge: (id: string) => void;
		ondeletenode: (node: GraphNode) => void;
		onclose: () => void;
	} = $props();

	const R0 = 26;
	const MIN_K = 0.35;
	const MAX_K = 2.6;

	let svgEl = $state<SVGSVGElement | null>(null);
	let dragNode = $state<{ id: string; x: number; y: number } | null>(null);
	let link = $state<{ from: string; x: number; y: number; over: string } | null>(null);
	let framed = false;

	type Gesture =
		| { mode: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
		| { mode: 'drag'; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean }
		| { mode: 'link'; from: string; sx: number; sy: number; moved: boolean }
		| { mode: 'edge'; id: string; sx: number; sy: number; moved: boolean }
		| { mode: 'pinch'; d0: number; k0: number; wx: number; wy: number };

	let gesture: Gesture | null = null;
	const pointers = new Map<number, { x: number; y: number }>();
	let pressTimer: ReturnType<typeof setTimeout> | null = null;

	const findNode = (id: string) => graph.nodes.find((node) => node.id === id);
	const domainOf = (id: string) => graph.domains.find((domain) => domain.id === id);
	const nodeColor = (node: GraphNode) => domainOf(node.domainId)?.color ?? '#8d968a';
	const domainName = (id: string) => domainOf(id)?.name ?? 'Sem domínio';
	const reached = (node: GraphNode) => nodeReached(node, graph.edges);

	/* ---------- câmera ---------- */
	function toWorld(clientX: number, clientY: number): { x: number; y: number } {
		if (!svgEl) return { x: 0, y: 0 };
		const rect = svgEl.getBoundingClientRect();
		return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
	}

	export function fit() {
		if (!svgEl || !graph.nodes.length) return;
		const rect = svgEl.getBoundingClientRect();
		const xs = graph.nodes.map((node) => node.x);
		const ys = graph.nodes.map((node) => node.y);
		const x0 = Math.min(...xs) - 90;
		const x1 = Math.max(...xs) + 90;
		const y0 = Math.min(...ys) - 90;
		const y1 = Math.max(...ys) + 110;
		const k = Math.min(1.3, rect.width / (x1 - x0), rect.height / (y1 - y0));
		view = { k, x: rect.width / 2 - ((x0 + x1) / 2) * k, y: rect.height / 2 - ((y0 + y1) / 2) * k };
	}

	function zoomAt(clientX: number, clientY: number, factor: number) {
		if (!svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		const cx = clientX - rect.left;
		const cy = clientY - rect.top;
		const k = Math.max(MIN_K, Math.min(MAX_K, view.k * factor));
		const wx = (cx - view.x) / view.k;
		const wy = (cy - view.y) / view.k;
		view = { k, x: cx - wx * k, y: cy - wy * k };
	}

	function wheelAction(element: SVGElement) {
		const handler = (event: WheelEvent) => {
			event.preventDefault();
			zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 0.9);
		};
		element.addEventListener('wheel', handler, { passive: false });
		return { destroy: () => element.removeEventListener('wheel', handler) };
	}

	/* ---------- geometria ---------- */
	function edgeGeometry(a: { x: number; y: number }, b: { x: number; y: number }) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = Math.hypot(dx, dy) || 1;
		const ux = dx / length;
		const uy = dy / length;
		const sx = a.x + ux * (R0 + 2);
		const sy = a.y + uy * (R0 + 2);
		const ex = b.x - ux * (R0 + 12);
		const ey = b.y - uy * (R0 + 12);
		const cx = (a.x + b.x) / 2 - uy * length * 0.13;
		const cy = (a.y + b.y) / 2 + ux * length * 0.13;
		return {
			d: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`,
			mx: (sx + 2 * cx + ex) / 4,
			my: (sy + 2 * cy + ey) / 4
		};
	}

	function nodeAt(world: { x: number; y: number }, exclude?: string): GraphNode | undefined {
		return graph.nodes.find((node) => node.id !== exclude && Math.hypot(node.x - world.x, node.y - world.y) < R0 + 12);
	}

	/** Posição viva do nó: usa o arrasto atual quando ele está sendo movido. */
	function livePos(node: GraphNode): { x: number; y: number } {
		return dragNode && dragNode.id === node.id ? { x: dragNode.x, y: dragNode.y } : { x: node.x, y: node.y };
	}

	/* ---------- ponteiro ---------- */
	function clearPress() {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	function onPointerDown(event: PointerEvent) {
		onclose();
		try {
			svgEl?.setPointerCapture(event.pointerId);
		} catch {
			/* Alguns WebViews recusam captura. */
		}
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			if (!svgEl) return;
			const rect = svgEl.getBoundingClientRect();
			const cx = (a.x + b.x) / 2 - rect.left;
			const cy = (a.y + b.y) / 2 - rect.top;
			gesture = {
				mode: 'pinch',
				d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
				k0: view.k,
				wx: (cx - view.x) / view.k,
				wy: (cy - view.y) / view.k
			};
			dragNode = null;
			link = null;
			clearPress();
			return;
		}

		const target = event.target as Element;
		const world = toWorld(event.clientX, event.clientY);
		const handle = target.closest('[data-gv-handle]');
		const nodeEl = target.closest('[data-gv-node]');
		const edgeEl = target.closest('[data-gv-edge]');

		if (handle) {
			const id = handle.getAttribute('data-gv-handle') as string;
			link = { from: id, x: world.x, y: world.y, over: '' };
			gesture = { mode: 'link', from: id, sx: event.clientX, sy: event.clientY, moved: false };
			playTone(500, 0.06, 'sine', 0.04, sound);
			pulseHaptic(haptics, 8);
			return;
		}
		if (nodeEl) {
			const id = nodeEl.getAttribute('data-gv-node') as string;
			const node = findNode(id);
			if (!node) return;
			gesture = { mode: 'drag', id, dx: node.x - world.x, dy: node.y - world.y, sx: event.clientX, sy: event.clientY, moved: false };
			dragNode = { id, x: node.x, y: node.y };
			return;
		}
		if (edgeEl) {
			gesture = { mode: 'edge', id: edgeEl.getAttribute('data-gv-edge') as string, sx: event.clientX, sy: event.clientY, moved: false };
			return;
		}

		gesture = { mode: 'pan', sx: event.clientX, sy: event.clientY, vx: view.x, vy: view.y, moved: false };
		pressTimer = setTimeout(() => {
			pressTimer = null;
			if (gesture && gesture.mode === 'pan' && !gesture.moved) {
				const point = toWorld(event.clientX, event.clientY);
				gesture = null;
				oncreate(point.x, point.y);
			}
		}, 550);
	}

	function onPointerMove(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

		if (gesture?.mode === 'pinch') {
			if (pointers.size < 2 || !svgEl) return;
			const [a, b] = [...pointers.values()];
			const rect = svgEl.getBoundingClientRect();
			const cx = (a.x + b.x) / 2 - rect.left;
			const cy = (a.y + b.y) / 2 - rect.top;
			const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
			const k = Math.max(MIN_K, Math.min(MAX_K, gesture.k0 * (distance / gesture.d0)));
			view = { k, x: cx - gesture.wx * k, y: cy - gesture.wy * k };
			return;
		}
		if (!gesture) return;

		const moved = Math.hypot(event.clientX - gesture.sx, event.clientY - gesture.sy) > 6;
		if (moved && 'moved' in gesture) gesture.moved = true;

		if (gesture.mode === 'pan') {
			if (!gesture.moved) return;
			clearPress();
			view = { ...view, x: gesture.vx + (event.clientX - gesture.sx), y: gesture.vy + (event.clientY - gesture.sy) };
		} else if (gesture.mode === 'drag') {
			const world = toWorld(event.clientX, event.clientY);
			dragNode = { id: gesture.id, x: world.x + gesture.dx, y: world.y + gesture.dy };
		} else if (gesture.mode === 'link') {
			const world = toWorld(event.clientX, event.clientY);
			const over = nodeAt(world, gesture.from);
			if (over && over.id !== link?.over) {
				playTone(720, 0.06, 'sine', 0.04, sound);
				pulseHaptic(haptics, 5);
			}
			link = { from: gesture.from, x: world.x, y: world.y, over: over?.id ?? '' };
		}
	}

	function onPointerUp(event: PointerEvent) {
		pointers.delete(event.pointerId);
		const current = gesture;
		if (!current) return;
		if (current.mode === 'pinch') {
			if (pointers.size < 2) gesture = null;
			return;
		}
		gesture = null;
		clearPress();

		if (current.mode === 'drag') {
			if (current.moved && dragNode) {
				onmove(dragNode.id, dragNode.x, dragNode.y);
				playTone(300, 0.06, 'sine', 0.04, sound);
			} else {
				onopennode(current.id);
			}
			dragNode = null;
		} else if (current.mode === 'edge') {
			if (!current.moved) onopenedge(current.id);
		} else if (current.mode === 'link') {
			const world = toWorld(event.clientX, event.clientY);
			const target = nodeAt(world, current.from);
			link = null;
			if (target) onconnect(current.from, target.id);
			else if (current.moved) oncreate(world.x, world.y, current.from);
		}
	}

	function onNodeKey(event: KeyboardEvent, node: GraphNode) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onopennode(node.id);
		} else if (event.key.startsWith('Arrow')) {
			event.preventDefault();
			const step = 12;
			let { x, y } = node;
			if (event.key === 'ArrowLeft') x -= step;
			if (event.key === 'ArrowRight') x += step;
			if (event.key === 'ArrowUp') y -= step;
			if (event.key === 'ArrowDown') y += step;
			onmove(node.id, x, y);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			if (node.origin) return;
			event.preventDefault();
			ondeletenode(node);
		}
	}

	function onEdgeKey(event: KeyboardEvent, id: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onopenedge(id);
		}
	}

	onMount(() => {
		if (!framed) {
			framed = true;
			requestAnimationFrame(() => fit());
		}
		const onResize = () => fit();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
</script>

<svg
	bind:this={svgEl}
	class="gv-svg"
	use:wheelAction
	role="application"
	aria-label="Grafo da vida"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<defs>
		<marker id="gv-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto">
			<path d="M0 0L10 5L0 10z" fill="#6b746b" />
		</marker>
		<pattern id="gv-grid" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x * 0.5},${view.y * 0.5})`}>
			<circle cx="2" cy="2" r="1.3" fill="#2e332e" />
		</pattern>
	</defs>
	<rect width="100%" height="100%" fill="url(#gv-grid)" />

	<g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
		{#each graph.edges as edge (edge.id)}
			{@const a = findNode(edge.from)}
			{@const b = findNode(edge.to)}
			{#if a && b}
				{@const geo = edgeGeometry(livePos(a), livePos(b))}
				{@const ratio = edgeRatio(edge)}
				<g class="gv-e" data-gv-edge={edge.id} role="button" tabindex="0" aria-label={`${a.name} para ${b.name}: ${edge.label}, ${Math.round(ratio * 100)}%`} onkeydown={(event) => onEdgeKey(event, edge.id)}>
					<path class="gv-eh" d={geo.d} />
					<path class={edge.source === 'manual' ? 'gv-eb gv-hy' : 'gv-eb'} d={geo.d} marker-end="url(#gv-arrow)" />
					{#if ratio > 0}
						<path class="gv-ep" pathLength="1" stroke-dasharray={`${ratio} 2`} d={geo.d} />
					{/if}
					<text class="gv-el" x={geo.mx} y={geo.my - 6} text-anchor="middle">{edge.label}{edge.source !== 'manual' || ratio > 0 ? ` · ${Math.round(ratio * 100)}%` : ''}</text>
				</g>
			{/if}
		{/each}

		{#if link}
			{@const a = findNode(link.from)}
			{#if a}
				<path class="gv-lk" d={`M${a.x},${a.y} L${link.x},${link.y}`} />
			{/if}
		{/if}

		{#each graph.nodes as node (node.id)}
			{@const position = livePos(node)}
			{@const color = nodeColor(node)}
			{@const isReached = reached(node)}
			{@const selected = selectedId === node.id}
			{@const milestone = isMilestone(node)}
			{@const ring = milestone ? 38 : 35}
			{@const scale = dragNode && dragNode.id === node.id ? 1.14 : link && link.over === node.id ? 1.12 : 1}
			<g
				class="gv-node"
				class:re={isReached}
				data-gv-node={node.id}
				role="button"
				tabindex="0"
				aria-label={`${node.name}, ${node.origin ? 'origem' : nodeRoleLabel(node)}, ${horizonLabel(node.horizon)}, ${domainName(node.domainId)}${isReached ? ', alcançado' : ''}`}
				transform={`translate(${position.x},${position.y}) scale(${scale})`}
				onkeydown={(event) => onNodeKey(event, node)}
			>
				{#if selected}
					<circle class="gv-sel" r={ring} />
				{/if}
				{#if node.origin}
					<circle class="gv-pr" r="36" />
				{/if}
				{#if milestone && !node.origin}
					<polygon class="gv-nb" points="0,-31 26.85,15.5 -26.85,15.5" fill="#1b1e1b" stroke={color} />
				{:else}
					<circle class="gv-nb" r={R0} fill={node.origin ? 'var(--lime)' : '#1b1e1b'} stroke={node.origin ? 'var(--lime)' : color} />
				{/if}
				<circle r="7" fill={node.origin ? '#141a0a' : color} />
				{#if isReached}
					<path class="gv-ck" d={milestone ? 'M-9 -45l6 6 12-12' : 'M-9 -34l6 6 12-12'} />
				{/if}
				<text class="gv-nl" y="48" text-anchor="middle">{node.name.length > 20 ? `${node.name.slice(0, 19)}…` : node.name}</text>
				<g data-gv-handle={node.id}>
					<circle cx="24" cy="24" r="22" fill="transparent" />
					<circle class="gv-handle" cx="24" cy="24" r="9" />
				</g>
			</g>
		{/each}
	</g>
</svg>
