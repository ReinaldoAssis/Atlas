// Grafo da vida — modelo, defaults e cálculo de progresso.
// Fase 1: estrutura completa com progresso manual. Fase 2 liga as fontes de módulo.
import { m } from './paraglide/messages.js';

export type GraphHorizon = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'five';

/** Fonte de dado de módulo que alimenta uma aresta. `manual` é o fallback. */
export type GraphSourceKind =
	| 'habitValue'
	| 'habitStreak'
	| 'timeHours'
	| 'financeSavings'
	| 'financeLimit'
	| 'trackerLast'
	| 'trackerAverage'
	| 'trackerGoal'
	| 'manual';

/** Janela do valor acumulado medido por uma aresta. */
export type GraphWindow = 'week' | 'month' | 'total' | 'fixed';

export interface GraphNode {
	id: string;
	name: string;
	horizon: GraphHorizon;
	domainId: string;
	x: number;
	y: number;
	/** Nó de origem ("Estado atual"): único, fixo, não recebe arestas de entrada. */
	origin?: boolean;
	/** Toggle manual de "alcançado" para nós sem aresta de entrada. */
	reachedManual?: boolean;
}

export interface GraphEdge {
	id: string;
	/** Pré-requisito. */
	from: string;
	/** Resultado. */
	to: string;
	/** Rótulo da ação. */
	label: string;
	source: GraphSourceKind;
	/** Referência à origem no módulo (habitId / categoryId). Fase 2. */
	refId?: string;
	/** Meta na unidade da fonte. Fase 2. */
	target: number;
	window: GraphWindow;
	/** Início da janela quando `window === 'fixed'`. Fase 2. */
	windowFrom?: string;
	/** Progresso manual em 0..100 quando `source === 'manual'`. */
	manualProgress: number;
	/** Cache derivado de progresso concluído. */
	done?: boolean;
}

export interface GraphDomain {
	id: string;
	name: string;
	color: string;
	custom?: boolean;
}

export interface GraphState {
	nodes: GraphNode[];
	edges: GraphEdge[];
	domains: GraphDomain[];
}

export const HORIZONS: { id: GraphHorizon }[] = [
	{ id: 'today' },
	{ id: 'week' },
	{ id: 'month' },
	{ id: 'quarter' },
	{ id: 'year' },
	{ id: 'five' }
];

export const GRAPH_WINDOWS: { id: GraphWindow }[] = [
	{ id: 'week' },
	{ id: 'month' },
	{ id: 'total' },
	{ id: 'fixed' }
];

export const GRAPH_SOURCES: { id: GraphSourceKind }[] = [
	{ id: 'habitValue' },
	{ id: 'habitStreak' },
	{ id: 'timeHours' },
	{ id: 'financeSavings' },
	{ id: 'financeLimit' },
	{ id: 'trackerLast' },
	{ id: 'trackerAverage' },
	{ id: 'trackerGoal' },
	{ id: 'manual' }
];

const DOMAIN_SEED: GraphDomain[] = [
	{ id: 'saude', name: m.domain_saude(), color: '#f1a5c5' },
	{ id: 'fin', name: m.domain_fin(), color: '#ffd45a' },
	{ id: 'rel', name: m.domain_rel(), color: '#9cc8ff' },
	{ id: 'car', name: m.domain_car(), color: '#c6a8ff' },
	{ id: 'apr', name: m.domain_apr(), color: '#7fe3c4' },
	{ id: 'laz', name: m.domain_laz(), color: '#ffb347' }
];

export function graphId(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
	return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function horizonLabel(id: GraphHorizon): string {
	return {
		today: m.graph_horizon_today,
		week: m.graph_horizon_week,
		month: m.graph_horizon_month,
		quarter: m.graph_horizon_quarter,
		year: m.graph_horizon_year,
		five: m.graph_horizon_five
	}[id]();
}

export function windowLabel(id: GraphWindow): string {
	return {
		week: m.graph_window_week,
		month: m.graph_window_month,
		total: m.graph_window_total,
		fixed: m.graph_window_fixed
	}[id]();
}

export function sourceLabel(id: GraphSourceKind): string {
	return {
		habitValue: m.graph_source_habit_value,
		habitStreak: m.graph_source_habit_streak,
		timeHours: m.graph_source_time_hours,
		financeSavings: m.graph_source_finance_savings,
		financeLimit: m.graph_source_finance_limit,
		trackerLast: m.graph_source_tracker_last,
		trackerAverage: m.graph_source_tracker_average,
		trackerGoal: m.graph_source_tracker_goal,
		manual: m.graph_source_manual
	}[id]();
}

export function defaultDomains(): GraphDomain[] {
	return structuredClone(DOMAIN_SEED);
}

export function originNode(domainId = 'car'): GraphNode {
	return { id: 'origem', name: m.seed_origin(), horizon: 'today', domainId, x: 0, y: 0, origin: true };
}

function makeEdge(from: string, to: string, label: string, manualProgress: number): GraphEdge {
	return { id: graphId(), from, to, label, source: 'manual', target: 0, window: 'month', manualProgress };
}

/** Grafo mínimo: domínios + nó de origem. */
export function createGraph(): GraphState {
	const domains = defaultDomains();
	return { domains, nodes: [originNode(domains[3]?.id ?? domains[0].id)], edges: [] };
}

/** Grafo de exemplo, espelhando o protótipo. */
export function createGraphFromDemo(): GraphState {
	const nodes: GraphNode[] = [
		{ id: 'origem', name: 'Estado atual', horizon: 'today', domainId: 'car', x: 0, y: 0, origin: true },
		{ id: 'demo-treino', name: 'Rotina de treino', horizon: 'quarter', domainId: 'saude', x: -170, y: -120 },
		{ id: 'demo-reserva', name: 'Reserva de emergência', horizon: 'quarter', domainId: 'fin', x: 170, y: -110 },
		{ id: 'demo-leitura', name: 'Hábito de leitura', horizon: 'quarter', domainId: 'car', x: -150, y: 130 },
		{ id: 'demo-oportunidade', name: 'Nova oportunidade', horizon: 'year', domainId: 'car', x: 340, y: 70 },
		{ id: 'demo-saude', name: 'Saúde estável', horizon: 'year', domainId: 'saude', x: -340, y: -30 }
	];
	const edges: GraphEdge[] = [
		makeEdge('origem', 'demo-treino', 'Treinar 12x no mês', 0),
		makeEdge('origem', 'demo-reserva', 'Economizar R$ 2.000', 0),
		makeEdge('origem', 'demo-leitura', 'Ler 30h no mês', 0),
		makeEdge('demo-leitura', 'demo-oportunidade', 'Testar um projeto', 20),
		makeEdge('demo-reserva', 'demo-oportunidade', 'Folga para arriscar', 0),
		makeEdge('demo-treino', 'demo-saude', 'Sustentar por meses', 10)
	];
	return { domains: defaultDomains(), nodes, edges };
}

/** Garante um grafo válido vindo de storage/backup antigo. */
export function normalizeGraph(input?: Partial<GraphState> | null): GraphState {
	const domains = input?.domains?.length ? input.domains : defaultDomains();
	const nodes: GraphNode[] = (input?.nodes ?? []).map((node) => ({
		...node,
		horizon: node.horizon ?? 'quarter',
		domainId: node.domainId ?? domains[0].id,
		reachedManual: Boolean(node.reachedManual)
	}));
	if (!nodes.some((node) => node.origin)) nodes.unshift(originNode(domains[3]?.id ?? domains[0].id));
	const edges: GraphEdge[] = (input?.edges ?? []).map((edge) => ({
		...edge,
		source: edge.source ?? 'manual',
		window: edge.window ?? 'month',
		target: edge.target ?? 0,
		manualProgress: edge.manualProgress ?? 0
	}));
	return { domains, nodes, edges };
}

/** Progresso efetivo 0..1 da aresta (cache em `manualProgress`, preenchido pela reconciliação). */
export function edgeRatio(edge: GraphEdge): number {
	return clamp01((edge.manualProgress ?? 0) / 100);
}

export function edgeDone(edge: GraphEdge): boolean {
	if (typeof edge.done === 'boolean') return edge.done;
	return edgeRatio(edge) >= 1;
}

/** Nó alcançado quando todas as arestas de entrada concluem; origem sempre. */
export function nodeReached(node: GraphNode, edges: GraphEdge[]): boolean {
	if (node.origin) return true;
	const incoming = edges.filter((edge) => edge.to === node.id);
	if (!incoming.length) return Boolean(node.reachedManual);
	return incoming.every(edgeDone);
}

/** Longo prazo (mais de 3 meses) = marco; o restante = objetivo de curto prazo. */
export const MILESTONE_HORIZONS: GraphHorizon[] = ['year', 'five'];

export function isMilestone(node: GraphNode): boolean {
	return MILESTONE_HORIZONS.includes(node.horizon);
}

export function nodeRoleLabel(node: GraphNode): string {
	return isMilestone(node) ? m.graph_role_milestone() : m.graph_role_goal();
}

/** Adicionar `from → to` criaria ciclo? */
export function wouldCreateCycle(edges: GraphEdge[], from: string, to: string): boolean {
	if (from === to) return true;
	const seen = new Set([to]);
	const stack = [to];
	while (stack.length) {
		const current = stack.pop() as string;
		if (current === from) return true;
		for (const edge of edges) {
			if (edge.from === current && !seen.has(edge.to)) {
				seen.add(edge.to);
				stack.push(edge.to);
			}
		}
	}
	return false;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}
