import Database from '@tauri-apps/plugin-sql';
import { invoke, isTauri } from '@tauri-apps/api/core';
import JSZip from 'jszip';
import {
	createEmptySnapshot,
	defaultCategories,
	id as newId,
	normalizeCategoryLimitMode,
	normalizeDailyGoal,
	normalizeFirstDayOfWeek,
	normalizeTargetDirection,
	type AtlasSnapshot,
	type Category,
	type ExperienceState,
	type FinanceState,
	type Habit,
	type HabitLog,
	type LifeForceState,
	type TimeBlock,
	type Tracker,
	type TrackerEntry,
	type Transaction
} from './atlas';
import { normalizeGraph, type GraphDomain, type GraphEdge, type GraphNode } from './graph';
import { reconcileGraph } from './graph-sources';
import type { Note, NoteFolder } from './notes';
import { normalizeNotesState } from './notes';
import { runMigrations, type SqlContext } from './db/migrations';
import {
	SHARED_SETTING_KEYS,
	XP_COUNTER_KEY,
	planRows,
	settingStatements,
	tombstoneIds,
	tombstoneStatements,
	type BatchStatement,
	type RowStamp
} from './db/persist';
import { demoSnapshot } from './fixtures';
import { nextStamp, observeStamp } from './hlc';
import { activeDbName, previewKey, readTestMode } from './test-mode';
import { TRASH_RETENTION_DAYS } from './trash';

const PREVIEW_KEY = 'atlas-preview-state-v1';
const LIFEFORCE_MIGRATION_KEY = 'atlas-preview-lifeforce-v3';
/** Maior carimbo já visto (HLC); vive em `app_settings` porque é local. */
const HLC_KEY = 'hlc_last';

/**
 * Tabelas replicadas no sync P2P: cada linha tem payload (ou valor) e as
 * colunas de carimbo `updated_at`/`deleted_at`/`device_id`.
 */
export const SYNC_TABLES = [
	'categories',
	'transactions',
	'habits',
	'habit_logs',
	'trackers',
	'tracker_entries',
	'time_blocks',
	'graph_domains',
	'graph_nodes',
	'graph_edges',
	'notes',
	'folders',
	'shared_settings',
	'counters'
] as const;

/**
 * Tabelas cujas lápides são purgadas. A purga só alcança carimbos anteriores ao
 * último sync de **todos** os pares pareados (ver `purgeTombstones`): apagar uma
 * lápide que um par ainda não viu ressuscita o dado apagado.
 */
const PURGE_TABLES = SYNC_TABLES;

/**
 * Últimos ids ativos conhecidos por tabela.
 *
 * Como o app mantém o snapshot inteiro em memória e chama `saveSnapshot` a
 * cada mudança, a diferença `knownActiveIds - ids atuais` é o conjunto de
 * linhas removidas → viram lápides (`deleted_at`) em vez de `DELETE`.
 * Preenchido no `loadSnapshot` e atualizado a cada `saveSnapshot`.
 */
const knownActiveIds: Record<string, Set<string>> = {};

/**
 * Conteúdo + carimbo da última gravação de cada linha, por tabela.
 *
 * É o que permite gravar só a linha alterada e preservar
 * `updated_at`/`device_id` das demais (ver `planRows`). Preenchido no
 * `loadSnapshot` (a partir do banco) e atualizado a cada gravação.
 */
const knownRowStamps: Record<string, Record<string, RowStamp>> = {};

/**
 * Contribuições de XP já conhecidas: chave do contador → origem → valor.
 * Escrever só a diferença da minha origem (`totalXp` − soma das outras) é o que
 * impede o LWW de engolir o XP ganho do outro aparelho.
 */
let knownCounters: Record<string, Record<string, number>> = {};

/** Carimbo HLC desta sessão (por banco ativo). */
let hlcDb: string | undefined;
let hlcLast = 0;

let database: Promise<Database> | undefined;

export async function getDatabase(): Promise<Database> {
	if (!database) database = Database.load(activeDbName());
	return database;
}

let initialized: Promise<Database> | undefined;

/**
 * Fecha os caches de conexão/estado.
 *
 * Necessário ao alternar o modo de teste: o banco ativo muda de arquivo e as
 * conexões, o schema e os ids conhecidos deixam de valer.
 */
export function resetStorageCache(): void {
	database = undefined;
	initialized = undefined;
	writeQueue = Promise.resolve();
	for (const key of Object.keys(knownActiveIds)) delete knownActiveIds[key];
	for (const key of Object.keys(knownRowStamps)) delete knownRowStamps[key];
	knownCounters = {};
	hlcDb = undefined;
	hlcLast = 0;
	lastPreferencesJson = undefined;
}

/**
 * Abre o banco e garante o schema uma única vez por sessão.
 * Antes, `initializeDatabase` rodava a cada load/save (dezenas de
 * comandos IPC por gravação, caro no iOS).
 */
export function getReadyDatabase(): Promise<Database> {
	if (!initialized) {
		initialized = getDatabase().then(async (db) => {
			await initializeDatabase(db);
			return db;
		});
		initialized.catch(() => {
			initialized = undefined;
		});
	}
	return initialized;
}

/**
 * Fila global de escrita.
 *
 * O plugin SQL usa um pool do sqlx, então `BEGIN IMMEDIATE`/`COMMIT`
 * enviados como comandos separados não garantem a mesma conexão quando há
 * gravações concorrentes (o app dispara vários `saveSnapshot` sem `await`).
 * Serializar mantém cada transação num único fluxo e evita
 * `database is locked` ou perda de gravação.
 *
 * Não chamar `runSerialized` dentro de uma tarefa já serializada: aninhar
 * enfileira a tarefa atrás de si mesma e trava. Use as variantes internas.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function runSerialized<T>(task: () => Promise<T>): Promise<T> {
	const result = writeQueue.then(task, task);
	writeQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

async function initializeDatabase(db: Database): Promise<void> {
	await db.execute('PRAGMA foreign_keys = ON');
	const ctx: SqlContext = {
		execute: async (sql, params) => {
			await db.execute(sql, params);
		},
		select: (sql, params) => db.select(sql, params)
	};
	await runMigrations(ctx);
	await purgeTombstones(db);
	// A lixeira global não guarda evento além da retenção (a purga dos
	// tombstones é outra, comandada pelo sync).
	await db.execute('DELETE FROM trash_events WHERE deleted_at < $1', [
		String(Date.now() - TRASH_RETENTION_DAYS * 86_400_000)
	]);
	const deviceId = await ensureDeviceId(db);
	const categoryRows = await db.select<Array<{ id: string }>>(
		'SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1'
	);
	if (categoryRows.length === 0) {
		// As categorias padrão já entram carimbadas: linha com `updated_at = 0`
		// nunca seria enviada a um par (o cursor começa em 0).
		const at = await nextWriteStamp(db);
		for (const category of defaultCategories) {
			await db.execute(
				'INSERT INTO categories (id, module, payload, updated_at, device_id) VALUES ($1, $2, $3, $4, $5)',
				[category.id, category.module, JSON.stringify(category), String(at), deviceId]
			);
		}
	}
	if (readTestMode()) await seedTestData(db, deviceId);
}

/** Popula o banco de teste com dados de exemplo, uma vez. */
async function seedTestData(db: Database, deviceId: string): Promise<void> {
	const seeded = await db.select<Array<{ key: string }>>('SELECT key FROM app_settings WHERE key = $1', [
		'test_seeded'
	]);
	if (seeded.length > 0) return;
	const [habits, transactions, blocks] = await Promise.all([
		db.select<Array<{ id: string }>>('SELECT id FROM habits WHERE deleted_at IS NULL LIMIT 1'),
		db.select<Array<{ id: string }>>('SELECT id FROM transactions WHERE deleted_at IS NULL LIMIT 1'),
		db.select<Array<{ id: string }>>('SELECT id FROM time_blocks WHERE deleted_at IS NULL LIMIT 1')
	]);
	if (habits.length + transactions.length + blocks.length > 0) return;
	const at = await nextWriteStamp(db);
	const statements = buildSnapshotStatements(demoSnapshot(), deviceId, at);
	statements.push(
		hlcStatement(at),
		{
			sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)',
			params: ['test_seeded', JSON.stringify(true)]
		}
	);
	await invoke('db_batch', { db: activeDbName(), statements });
}

/**
 * Remove lápides que nenhum par confiável ainda pode precisar.
 *
 * Regra (decisão de produto, `docs/SYNC.md`): apaga só o que é mais antigo que o
 * último sync de **todos** os pares pareados. Com TTL fixo, um aparelho offline
 * por mais tempo reenviaria linhas apagadas — e elas ressuscitariam. Sem par
 * nenhum não há o que proteger: purga tudo. Par que nunca sincronizou
 * (`last_sync_at = 0`) segura a purga.
 */
async function purgeTombstones(db: Database): Promise<void> {
	const peers = await db.select<Array<{ last_sync_at: unknown }>>('SELECT last_sync_at FROM sync_peers');
	const cutoff = peers.length
		? Math.min(...peers.map((peer) => Number(peer.last_sync_at) || 0))
		: Date.now();
	for (const table of PURGE_TABLES) {
		await db.execute(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < $1`, [String(cutoff)]);
	}
}

/**
 * Lê o carimbo HLC guardado.
 *
 * **Sempre relê**: o merge do sync roda no Rust e sobe `hlc_last` por fora do
 * cache do JS. Se esta função confiasse no valor em memória, uma edição feita
 * durante/após um sync poderia sair com carimbo menor que o recebido e perder no
 * LWW. A query é uma linha por chave primária — barata perto do lote de escrita.
 */
async function ensureHlcLast(db: Database): Promise<void> {
	const name = activeDbName();
	if (hlcDb !== name) {
		hlcDb = name;
		hlcLast = 0;
	}
	const rows = await db.select<Array<{ value: string }>>('SELECT value FROM app_settings WHERE key = $1', [HLC_KEY]);
	const stored = rows.length ? Number(JSON.parse(rows[0].value)) || 0 : 0;
	hlcLast = Math.max(hlcLast, stored);
}

/**
 * Próximo carimbo de escrita (HLC) desta instalação.
 *
 * O maior carimbo visto vive em `app_settings.hlc_last` (local, nunca
 * sincronizado): assim ele continua monotônico entre reinícios e sempre acima
 * do que já chegou de outro aparelho, mesmo com relógios divergentes.
 */
export async function nextWriteStamp(db: Database): Promise<number> {
	await ensureHlcLast(db);
	hlcLast = nextStamp(Date.now(), hlcLast);
	return hlcLast;
}

/** Statement que persiste o carimbo (entra no mesmo lote da gravação). */
function hlcStatement(at: number): BatchStatement {
	return {
		sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)',
		params: [HLC_KEY, JSON.stringify(at)]
	};
}

/** Carimbo HLC para lotes escritos fora do `saveSnapshot` (ex.: restaurar lixeira). */
export function writeStampStatement(at: number): BatchStatement {
	return hlcStatement(at);
}

/** Identidade estável desta instalação (base do sync futuro). */
async function ensureDeviceId(db: Database): Promise<string> {
	const rows = await db.select<Array<{ value: string }>>('SELECT value FROM app_settings WHERE key = $1', [
		'device_id'
	]);
	if (rows.length > 0) return JSON.parse(rows[0].value) as string;
	const value = newId();
	await db.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)', [
		'device_id',
		JSON.stringify(value)
	]);
	return value;
}

/** `device_id` desta instalação, criado se necessário. */
export async function getDeviceId(): Promise<string> {
	const db = await getReadyDatabase();
	return ensureDeviceId(db);
}

/** Linha a gravar no plano: chave lógica + valores + JSON para detectar mudança. */
interface RowInput {
	key: string;
	values: string[];
	json: string;
}

/**
 * Planeja as escritas de uma tabela (só linhas alteradas, via `planRows`) e
 * guarda os carimbos resultantes.
 */
function planTable(args: {
	table: string;
	columns: string[];
	conflict?: string[];
	rows: RowInput[];
	deviceId: string;
	at: number;
}): BatchStatement[] {
	const { table, columns, conflict, rows, deviceId, at } = args;
	const planned = planRows({
		table,
		columns,
		conflict,
		rows: rows.map((row) => ({ key: row.key, values: row.values, json: row.json })),
		previous: knownRowStamps[table],
		deviceId,
		at
	});
	// A tabela recebe o conjunto completo de linhas ativas: o que não veio sumiu.
	knownRowStamps[table] = planned.stamps;
	return planned.statements;
}

/** Lápides das linhas que sumiram do conjunto ativo. */
function planTombstones(table: string, currentIds: string[], deviceId: string, at: number): BatchStatement[] {
	const previous = knownActiveIds[table] ?? new Set<string>();
	knownActiveIds[table] = new Set(currentIds);
	return tombstoneStatements(table, tombstoneIds(previous, currentIds), at, deviceId);
}

const FALLBACK_LIMITS: Record<string, number> = {
	sal: 0,
	food: 80000,
	ali: 80000,
	home: 120000,
	moa: 120000,
	transport: 30000,
	trn: 30000,
	health: 40000,
	laz: 25000
};

const TIME_GOALS: Record<string, number> = { 'deep-work': 10, reading: 5, admin: 0, 'health-time': 4, personal: 0, rest: 0 };

function normalizeCategory(category: Category): Category {
	if (category.module === 'time') {
		if (category.weeklyGoalHours === undefined) return { ...category, weeklyGoalHours: TIME_GOALS[category.id] ?? 0 };
		return category;
	}
	if (category.module !== 'finance') return category;
	const isIncome = category.kind ? category.kind === 'in' : category.id === 'income' || category.id === 'sal' || /renda|sal[áa]rio/i.test(category.name);
	const limitMode = normalizeCategoryLimitMode(category.limitMode);
	const patch: Partial<Category> = {};
	if (!category.kind) patch.kind = isIncome ? 'in' : 'out';
	if (!isIncome && limitMode !== category.limitMode) patch.limitMode = limitMode;
	if (!isIncome && !category.limitMinor) patch.limitMinor = FALLBACK_LIMITS[category.id] || 50000;
	return Object.keys(patch).length ? { ...category, ...patch } : category;
}

/** Hábitos antigos podem não ter direção de meta. */
function normalizeHabit(stored: Partial<Habit>): Habit {
	return {
		id: '',
		name: '',
		metric: 'boolean',
		unit: '',
		target: 1,
		scheduledDays: [],
		active: true,
		bestStreak: 0,
		...stored,
		targetDirection: normalizeTargetDirection(stored.targetDirection)
	} as Habit;
}

/** Trackers criados antes dos tipos de medida (S13) não têm `metric`/`askTime`. */
function normalizeTracker(stored: Partial<Tracker>): Tracker {
	return {
		id: '',
		name: '',
		metric: 'count',
		unit: '',
		target: null,
		targetDirection: 'up',
		askTime: false,
		active: true,
		createdAt: '',
		...stored
	} as Tracker;
}

function readPreview(): AtlasSnapshot {
	const key = previewKey(PREVIEW_KEY);
	const raw = localStorage.getItem(key);
	if (!raw) {
		const initial = readTestMode() ? demoSnapshot() : createEmptySnapshot();
		localStorage.setItem(key, JSON.stringify(initial));
		return initial;
	}
	try {
		const defaults = createEmptySnapshot();
		const stored = JSON.parse(raw) as Partial<AtlasSnapshot>;
		const snapshot = {
			...defaults,
			...stored,
			categories: (stored.categories ?? defaults.categories).map(normalizeCategory),
			habits: (stored.habits ?? defaults.habits).map(normalizeHabit),
			trackers: (stored.trackers ?? defaults.trackers).map(normalizeTracker),
			preferences: {
				...defaults.preferences,
				...stored.preferences,
				firstDayOfWeek: normalizeFirstDayOfWeek(stored.preferences?.firstDayOfWeek)
			},
			experience: { ...defaults.experience, ...stored.experience },
			lifeForce: { ...defaults.lifeForce, ...stored.lifeForce },
			finance: { ...defaults.finance, ...stored.finance },
			dailyGoal: normalizeDailyGoal(stored.dailyGoal ?? defaults.dailyGoal),
			graph: normalizeGraph(stored.graph ?? defaults.graph)
		} as AtlasSnapshot;
		snapshot.graph = reconcileGraph(snapshot.graph, snapshot);
		migrateLifeForceBaseline(snapshot);
		return snapshot;
	} catch {
		return createEmptySnapshot();
	}
}

function migrateLifeForceBaseline(snapshot: AtlasSnapshot): void {
	if (snapshot.lifeForce.value === 100 && localStorage.getItem(LIFEFORCE_MIGRATION_KEY) !== 'done') snapshot.lifeForce.value = 50;
	localStorage.setItem(LIFEFORCE_MIGRATION_KEY, 'done');
}

/** Linha replicada lida do banco. */
interface SyncRow {
	id: string;
	payload: string;
	updated_at: unknown;
	device_id: string | null;
}

/** Guarda ids ativos e carimbos de uma tabela replicada (base do delta). */
function readSyncTable(table: string, rows: SyncRow[]): void {
	const stamps: Record<string, RowStamp> = {};
	const ids = new Set<string>();
	for (const row of rows) {
		ids.add(row.id);
		stamps[row.id] = {
			json: row.payload,
			updatedAt: Number(row.updated_at) || 0,
			deviceId: row.device_id ?? ''
		};
	}
	knownActiveIds[table] = ids;
	knownRowStamps[table] = stamps;
}

/** Maior carimbo visto entre as linhas carregadas (mantém o HLC acima do banco). */
function observeRows(rows: Array<{ updated_at: unknown }>): void {
	let max = 0;
	for (const row of rows) max = Math.max(max, Number(row.updated_at) || 0);
	hlcLast = observeStamp(hlcLast, max);
}

export async function loadSnapshot(): Promise<AtlasSnapshot> {
	if (!isTauri()) return readPreview();
	const db = await getReadyDatabase();
	await writeQueue;
	const [categories, transactions, habits, habitLogs, trackers, trackerEntries, timeBlocks, graphDomains, graphNodes, graphEdges, settings, shared, counters] = await Promise.all([
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM categories WHERE deleted_at IS NULL'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on DESC'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM habits WHERE deleted_at IS NULL'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM habit_logs WHERE deleted_at IS NULL ORDER BY occurred_on DESC'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM trackers WHERE deleted_at IS NULL'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM tracker_entries WHERE deleted_at IS NULL ORDER BY occurred_on DESC'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM time_blocks WHERE deleted_at IS NULL ORDER BY starts_at DESC'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM graph_domains WHERE deleted_at IS NULL'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM graph_nodes WHERE deleted_at IS NULL'),
		db.select<SyncRow[]>('SELECT id, payload, updated_at, device_id FROM graph_edges WHERE deleted_at IS NULL'),
		db.select<Array<{ key: string; value: string }>>('SELECT key, value FROM app_settings'),
		db.select<Array<{ key: string; value: string; updated_at: unknown; device_id: string | null }>>(
			'SELECT key, value, updated_at, device_id FROM shared_settings WHERE deleted_at IS NULL'
		),
		db.select<Array<{ key: string; owner: string; value: unknown; updated_at: unknown; device_id: string | null }>>(
			'SELECT key, owner, value, updated_at, device_id FROM counters WHERE deleted_at IS NULL'
		)
	]);
	await ensureHlcLast(db);
	readSyncTable('categories', categories);
	readSyncTable('transactions', transactions);
	readSyncTable('habits', habits);
	readSyncTable('habit_logs', habitLogs);
	readSyncTable('trackers', trackers);
	readSyncTable('tracker_entries', trackerEntries);
	readSyncTable('time_blocks', timeBlocks);
	readSyncTable('graph_domains', graphDomains);
	readSyncTable('graph_nodes', graphNodes);
	readSyncTable('graph_edges', graphEdges);
	observeRows([
		...categories,
		...transactions,
		...habits,
		...habitLogs,
		...trackers,
		...trackerEntries,
		...timeBlocks,
		...graphDomains,
		...graphNodes,
		...graphEdges,
		...shared,
		...counters
	]);
	const sharedStamps: Record<string, RowStamp> = {};
	for (const row of shared) {
		sharedStamps[row.key] = { json: row.value, updatedAt: Number(row.updated_at) || 0, deviceId: row.device_id ?? '' };
	}
	knownRowStamps.shared_settings = sharedStamps;
	knownCounters = {};
	const counterStamps: Record<string, RowStamp> = {};
	for (const row of counters) {
		const value = Number(row.value) || 0;
		knownCounters[row.key] = { ...(knownCounters[row.key] ?? {}), [row.owner]: value };
		counterStamps[`${row.key}:${row.owner}`] = {
			json: String(value),
			updatedAt: Number(row.updated_at) || 0,
			deviceId: row.device_id ?? ''
		};
	}
	knownRowStamps.counters = counterStamps;

	const settingsMap = Object.fromEntries(settings.map((item) => [item.key, JSON.parse(item.value)]));
	const sharedMap = Object.fromEntries(shared.map((item) => [item.key, JSON.parse(item.value)]));
	const defaults = createEmptySnapshot();
	// `app_settings` fica como fallback do que a migração v6 ainda não moveu
	// (instalações antigas, banco de teste recém-criado).
	const lifeForce = { ...defaults.lifeForce, ...(sharedMap.lifeForce ?? settingsMap.lifeForce ?? {}) } as LifeForceState;
	const finance = { ...defaults.finance, ...(sharedMap.finance ?? settingsMap.finance ?? {}) } as FinanceState;
	const dailyGoal = normalizeDailyGoal(sharedMap.dailyGoal ?? settingsMap.dailyGoal ?? defaults.dailyGoal);
	const totalXp = Object.values(knownCounters[XP_COUNTER_KEY] ?? {}).reduce((sum, value) => sum + value, 0);
	const experience = { totalXp } as ExperienceState;
	const preferences = {
		...defaults.preferences,
		...(settingsMap.preferences ?? {}),
		firstDayOfWeek: normalizeFirstDayOfWeek(settingsMap.preferences?.firstDayOfWeek)
	};
	// Payload corrompido (v0.3.0 deslocava as colunas: o `payload` recebia o
	// carimbo) vira linha descartada, nunca número/objeto sem `id` no snapshot —
	// senão a gravação seguinte manda `undefined` e o `db_batch` recusa. A linha
	// descartada ainda vira lápide na próxima gravação.
	const payloadList = <T extends { id: string }>(rows: Array<{ payload: string }>): T[] =>
		rows
			.map((row) => {
				try {
					return JSON.parse(row.payload) as T;
				} catch {
					return null;
				}
			})
			.filter((item): item is T => Boolean(item) && typeof (item as { id?: unknown }).id === 'string');
	const domains = payloadList<GraphDomain>(graphDomains);
	const nodes = payloadList<GraphNode>(graphNodes);
	const edges = payloadList<GraphEdge>(graphEdges);
	const graph =
		domains.length + nodes.length + edges.length === 0
			? defaults.graph
			: normalizeGraph({ domains, nodes, edges });
	const snapshot = {
		categories: payloadList<Category>(categories).map(normalizeCategory),
		transactions: payloadList<Transaction>(transactions),
		habits: payloadList<Habit>(habits).map((item) => normalizeHabit(item)),
		habitLogs: payloadList<HabitLog>(habitLogs),
		trackers: payloadList<Tracker>(trackers).map((item) => normalizeTracker(item)),
		trackerEntries: payloadList<TrackerEntry>(trackerEntries),
		timeBlocks: payloadList<TimeBlock>(timeBlocks),
		lifeForce,
		experience,
		finance,
		dailyGoal,
		preferences,
		graph
	};
	snapshot.graph = reconcileGraph(snapshot.graph, snapshot);
	migrateLifeForceBaseline(snapshot);
	return snapshot;
}

/** JSON de `preferences` na última gravação (evita reescrever sem mudança). */
let lastPreferencesJson: string | undefined;

/** Statements do snapshot inteiro (upserts só do que mudou + lápides). */
export function buildSnapshotStatements(snapshot: AtlasSnapshot, deviceId: string, at: number): BatchStatement[] {
	const statements: BatchStatement[] = [];
	// A última coluna de todas as tabelas que usam `payloadRows` é `payload`:
	// o JSON da linha entra **aqui**, junto com as colunas da chave. Sem ele os
	// parâmetros deslizam (payload←at, updated_at←device_id, device_id←NULL) e
	// o reload quebra no `JSON.parse` do payload.
	const payloadRows = <T extends { id: string }>(items: T[], columns: (item: T) => string[]): RowInput[] =>
		items.map((item) => {
			const json = JSON.stringify(item);
			return { key: item.id, values: [...columns(item), json], json };
		});

	statements.push(...planTable({ table: 'categories', columns: ['id', 'module', 'payload'], rows: payloadRows(snapshot.categories, (item) => [item.id, item.module]), deviceId, at }));
	statements.push(...planTable({ table: 'transactions', columns: ['id', 'occurred_on', 'payload'], rows: payloadRows(snapshot.transactions, (item) => [item.id, item.date]), deviceId, at }));
	statements.push(...planTable({ table: 'habits', columns: ['id', 'payload'], rows: payloadRows(snapshot.habits, (item) => [item.id]), deviceId, at }));
	statements.push(...planTable({ table: 'habit_logs', columns: ['id', 'habit_id', 'occurred_on', 'payload'], rows: payloadRows(snapshot.habitLogs, (item) => [item.id, item.habitId, item.date]), deviceId, at }));
	statements.push(...planTable({ table: 'trackers', columns: ['id', 'payload'], rows: payloadRows(snapshot.trackers, (item) => [item.id]), deviceId, at }));
	statements.push(...planTable({ table: 'tracker_entries', columns: ['id', 'tracker_id', 'occurred_on', 'payload'], rows: payloadRows(snapshot.trackerEntries, (item) => [item.id, item.trackerId, item.date]), deviceId, at }));
	statements.push(...planTable({ table: 'time_blocks', columns: ['id', 'starts_at', 'payload'], rows: payloadRows(snapshot.timeBlocks, (item) => [item.id, item.startAt]), deviceId, at }));
	statements.push(...planTable({ table: 'graph_domains', columns: ['id', 'payload'], rows: payloadRows(snapshot.graph.domains, (item) => [item.id]), deviceId, at }));
	statements.push(...planTable({ table: 'graph_nodes', columns: ['id', 'payload'], rows: payloadRows(snapshot.graph.nodes, (item) => [item.id]), deviceId, at }));
	statements.push(...planTable({ table: 'graph_edges', columns: ['id', 'payload'], rows: payloadRows(snapshot.graph.edges, (item) => [item.id]), deviceId, at }));

	// Lápides: o que estava ativo e sumiu do snapshot.
	statements.push(...planTombstones('categories', snapshot.categories.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('transactions', snapshot.transactions.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('habits', snapshot.habits.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('habit_logs', snapshot.habitLogs.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('trackers', snapshot.trackers.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('tracker_entries', snapshot.trackerEntries.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('time_blocks', snapshot.timeBlocks.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('graph_domains', snapshot.graph.domains.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('graph_nodes', snapshot.graph.nodes.map((item) => item.id), deviceId, at));
	statements.push(...planTombstones('graph_edges', snapshot.graph.edges.map((item) => item.id), deviceId, at));

	// Singletons sincronizáveis (LWW por linha).
	statements.push(
		...planTable({
			table: 'shared_settings',
			columns: ['key', 'value'],
			conflict: ['key'],
			rows: SHARED_SETTING_KEYS.map((key) => {
				const json = JSON.stringify(snapshot[key]);
				return { key, values: [key, json], json };
			}),
			deviceId,
			at
		})
	);

	// XP: escrevo só a minha contribuição (o total exibido é a soma de todas).
	const otherXp = Object.entries(knownCounters[XP_COUNTER_KEY] ?? {})
		.filter(([owner]) => owner !== deviceId)
		.reduce((sum, [, value]) => sum + value, 0);
	const myXp = Math.max(0, Math.trunc(snapshot.experience.totalXp) - otherXp);
	statements.push(
		...planTable({
			table: 'counters',
			columns: ['key', 'owner', 'value'],
			conflict: ['key', 'owner'],
			rows: [{ key: `${XP_COUNTER_KEY}:${deviceId}`, values: [XP_COUNTER_KEY, deviceId, String(myXp)], json: String(myXp) }],
			deviceId,
			at
		})
	);
	knownCounters[XP_COUNTER_KEY] = { ...(knownCounters[XP_COUNTER_KEY] ?? {}), [deviceId]: myXp };

	// `preferences` é local (som/háptica/tema são do aparelho): sem carimbo nem LWW.
	const preferencesJson = JSON.stringify(snapshot.preferences);
	if (preferencesJson !== lastPreferencesJson) {
		lastPreferencesJson = preferencesJson;
		statements.push(...settingStatements({ preferences: snapshot.preferences }));
	}
	return statements;
}

export function saveSnapshot(snapshot: AtlasSnapshot): Promise<void> {
	if (!isTauri()) {
		localStorage.setItem(previewKey(PREVIEW_KEY), JSON.stringify(snapshot));
		return Promise.resolve();
	}
	return runSerialized(async () => {
		// Garante `load` + schema (e o pool) antes de escrever.
		const db = await getReadyDatabase();
		const deviceId = await ensureDeviceId(db);
		const at = await nextWriteStamp(db);
		// Só aplicamos o estado conhecido se a gravação tiver sucesso, para que
		// uma falha não "esqueça" lápides pendentes (ver `planTable`).
		const previousIds = cloneIds(knownActiveIds);
		const previousStamps = cloneStamps(knownRowStamps);
		const previousXp = { ...knownCounters };
		const previousPreferences = lastPreferencesJson;
		const statements = buildSnapshotStatements(snapshot, deviceId, at);
		if (!statements.length) return;
		statements.push(hlcStatement(at));
		// Uma transação numa única conexão (ver `db_batch` no lib.rs).
		try {
			await invoke('db_batch', { db: activeDbName(), statements });
		} catch (error) {
			restoreKnown(previousIds, previousStamps, previousXp, previousPreferences);
			throw error;
		}
	});
}

function cloneIds(source: Record<string, Set<string>>): Record<string, Set<string>> {
	return Object.fromEntries(Object.entries(source).map(([key, ids]) => [key, new Set(ids)]));
}

function cloneStamps(source: Record<string, Record<string, RowStamp>>): Record<string, Record<string, RowStamp>> {
	return Object.fromEntries(Object.entries(source).map(([key, stamps]) => [key, { ...stamps }]));
}

function restoreKnown(
	ids: Record<string, Set<string>>,
	stamps: Record<string, Record<string, RowStamp>>,
	counters: Record<string, Record<string, number>>,
	preferences: string | undefined
): void {
	for (const key of Object.keys(knownActiveIds)) delete knownActiveIds[key];
	for (const key of Object.keys(knownRowStamps)) delete knownRowStamps[key];
	Object.assign(knownActiveIds, ids);
	Object.assign(knownRowStamps, stamps);
	knownCounters = counters;
	lastPreferencesJson = preferences;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310_000, hash: 'SHA-256' },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function exportBackup(snapshot: AtlasSnapshot, password?: string): Promise<Blob> {
	const exportedAt = new Date().toISOString();
	const payload = JSON.stringify({ exportedAt, snapshot });
	if (!password) {
		return new Blob([JSON.stringify({ format: 'atlas-backup-v1', ...JSON.parse(payload) }, null, 2)], { type: 'application/json' });
	}
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveBackupKey(password, salt);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
	return new Blob([JSON.stringify({
		format: 'atlas-backup-encrypted-v1',
		algorithm: 'PBKDF2-SHA256/AES-256-GCM',
		salt: toBase64(salt),
		iv: toBase64(iv),
		ciphertext: toBase64(new Uint8Array(ciphertext))
	}, null, 2)], { type: 'application/json' });
}

export async function importBackup(file: File, password?: string): Promise<AtlasSnapshot> {
	const parsed = JSON.parse(await file.text()) as {
		format?: string;
		snapshot?: AtlasSnapshot;
		salt?: string;
		iv?: string;
		ciphertext?: string;
	};
	let snapshot = parsed.snapshot;
	if (parsed.format === 'atlas-backup-encrypted-v1') {
		if (!password) throw new Error('Informe a senha usada para criptografar este backup.');
		try {
			const key = await deriveBackupKey(password, fromBase64(parsed.salt ?? ''));
			const plaintext = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: fromBase64(parsed.iv ?? '') as BufferSource },
				key,
				fromBase64(parsed.ciphertext ?? '') as BufferSource
			);
			const decrypted = JSON.parse(new TextDecoder().decode(plaintext)) as { snapshot?: AtlasSnapshot };
			snapshot = decrypted.snapshot;
		} catch {
			throw new Error('Senha incorreta ou backup criptografado inválido.');
		}
	} else if (parsed.format !== 'atlas-backup-v1') {
		throw new Error('Esse arquivo não parece ser um backup do Atlas.');
	}
	if (!snapshot || !Array.isArray(snapshot.transactions) || !Array.isArray(snapshot.habits) || !Array.isArray(snapshot.timeBlocks)) {
		throw new Error('O backup está incompleto ou foi alterado.');
	}
	return normalizeImportedSnapshot(snapshot);
}

function normalizeImportedSnapshot(snapshot: AtlasSnapshot): AtlasSnapshot {
	const defaults = createEmptySnapshot();
	// Backup sem categorias (arquivo editado à mão ou export antigo) deixaria
	// finanças e tempo sem categorias base: cai no padrão.
	const categories = snapshot.categories?.length ? snapshot.categories : defaults.categories;
	const merged = {
		...defaults,
		...snapshot,
		categories: categories.map(normalizeCategory),
		preferences: { ...defaults.preferences, ...snapshot.preferences },
		experience: { ...defaults.experience, ...snapshot.experience },
		lifeForce: { ...defaults.lifeForce, ...snapshot.lifeForce },
		finance: { ...defaults.finance, ...snapshot.finance },
		dailyGoal: normalizeDailyGoal(snapshot.dailyGoal ?? defaults.dailyGoal),
		graph: normalizeGraph(snapshot.graph ?? defaults.graph)
	} as AtlasSnapshot;
	merged.graph = reconcileGraph(merged.graph, merged);
	return merged;
}

/* ------------------------------------------------------------------ */
/* Backup v2 — .zip com snapshot + notas + pastas + anexos             */
/* ------------------------------------------------------------------ */

export interface BackupData {
	snapshot: AtlasSnapshot;
	notes: Note[];
	folders: NoteFolder[];
}

export interface BackupAttachment {
	noteId: string;
	name: string;
	bytes: Uint8Array;
}

export interface ImportedBackup {
	data: BackupData;
	attachments: BackupAttachment[];
}

async function encryptJson(payload: string, password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveBackupKey(password, salt);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
	return {
		salt: toBase64(salt),
		iv: toBase64(iv),
		ciphertext: toBase64(new Uint8Array(ciphertext))
	};
}

async function decryptJson(container: { salt?: string; iv?: string; ciphertext?: string }, password: string): Promise<string> {
	const key = await deriveBackupKey(password, fromBase64(container.salt ?? ''));
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: fromBase64(container.iv ?? '') as BufferSource },
		key,
		fromBase64(container.ciphertext ?? '') as BufferSource
	);
	return new TextDecoder().decode(plaintext);
}

/**
 * Exporta o backup v2.
 * - Sem senha: .zip com `atlas-backup.json` + `attachments/**`.
 * - Com senha: JSON único criptografado (`atlas-backup-encrypted-v2`) com
 *   snapshot + notas + pastas.
 */
export async function exportBackupV2(
	data: BackupData,
	attachments: BackupAttachment[] = [],
	password?: string
): Promise<Blob> {
	const exportedAt = new Date().toISOString();
	const core = { snapshot: data.snapshot, notes: data.notes, folders: data.folders };
	if (password) {
		const encrypted = await encryptJson(JSON.stringify(core), password);
		return new Blob(
			[JSON.stringify({ format: 'atlas-backup-encrypted-v2', algorithm: 'PBKDF2-SHA256/AES-256-GCM', exportedAt, ...encrypted }, null, 2)],
			{ type: 'application/json' }
		);
	}
	const zip = new JSZip();
	zip.file('atlas-backup.json', JSON.stringify({ format: 'atlas-backup-v2', exportedAt, ...core }, null, 2));
	zip.file('README.txt', 'Backup do Atlas (atlas-backup-v2): snapshot, notas, pastas e a pasta de anexos.');
	for (const file of attachments) zip.file(`attachments/${file.noteId}/${file.name}`, file.bytes);
	return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function importBackupV2(file: File, password?: string): Promise<ImportedBackup> {
	const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
	const isZip = head[0] === 0x50 && head[1] === 0x4b;
	if (isZip) {
		const zip = await JSZip.loadAsync(await file.arrayBuffer());
		const entry = zip.file('atlas-backup.json');
		if (!entry) throw new Error('O backup não contém atlas-backup.json.');
		const parsed = JSON.parse(await entry.async('string')) as { format?: string } & Partial<BackupData>;
		if (parsed.format !== 'atlas-backup-v2') throw new Error('Formato de backup não reconhecido.');
		const attachments: BackupAttachment[] = [];
		for (const path of Object.keys(zip.files)) {
			const zipEntry = zip.files[path];
			if (zipEntry.dir || !path.startsWith('attachments/')) continue;
			const match = /^attachments\/([^/]+)\/(.+)$/.exec(path);
			if (!match) continue;
			attachments.push({ noteId: match[1], name: match[2], bytes: await zipEntry.async('uint8array') });
		}
		return { data: buildBackupData(parsed), attachments };
	}

	const parsed = JSON.parse(await file.text()) as Record<string, unknown> & { format?: string; snapshot?: AtlasSnapshot };
	if (parsed.format === 'atlas-backup-encrypted-v2') {
		if (!password) throw new Error('Informe a senha usada para criptografar este backup.');
		try {
			const core = JSON.parse(await decryptJson(parsed as { salt?: string; iv?: string; ciphertext?: string }, password)) as Partial<BackupData>;
			return { data: buildBackupData(core), attachments: [] };
		} catch {
			throw new Error('Senha incorreta ou backup criptografado inválido.');
		}
	}
	if (parsed.format === 'atlas-backup-v2') {
		return { data: buildBackupData(parsed as Partial<BackupData>), attachments: [] };
	}
	// Compatibilidade com o formato v1 (somente snapshot).
	const snapshot = await importBackup(file, password);
	return { data: { snapshot, notes: [], folders: [] }, attachments: [] };
}

function buildBackupData(source: Partial<BackupData>): BackupData {
	if (!source.snapshot || !Array.isArray(source.snapshot.transactions) || !Array.isArray(source.snapshot.habits)) {
		throw new Error('O backup está incompleto ou foi alterado.');
	}
	const notesState = normalizeNotesState({ notes: source.notes, folders: source.folders });
	return {
		snapshot: normalizeImportedSnapshot(source.snapshot),
		notes: notesState.notes,
		folders: notesState.folders
	};
}

