import Database from '@tauri-apps/plugin-sql';
import { invoke, isTauri } from '@tauri-apps/api/core';
import JSZip from 'jszip';
import {
	createEmptySnapshot,
	defaultCategories,
	id as newId,
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
import { normalizeGraph } from './graph';
import { reconcileGraph } from './graph-sources';
import type { Note, NoteFolder } from './notes';
import { normalizeNotesState } from './notes';
import { runMigrations, type SqlContext } from './db/migrations';
import {
	settingStatements,
	tombstoneIds,
	tombstoneStatements,
	upsertSql,
	type BatchStatement
} from './db/persist';
import { demoSnapshot } from './fixtures';
import { activeDbName, previewKey, readTestMode } from './test-mode';

const PREVIEW_KEY = 'atlas-preview-state-v1';
const LIFEFORCE_MIGRATION_KEY = 'atlas-preview-lifeforce-v3';
/** Lápides de deleção são purgadas após esse prazo. */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_TABLES = ['categories', 'transactions', 'habits', 'habit_logs', 'trackers', 'tracker_entries', 'time_blocks'] as const;
/** Tabelas cujas lápides são purgadas (inclui grafo e notas/pastas). */
const PURGE_TABLES = [...SYNC_TABLES, 'graph_domains', 'graph_nodes', 'graph_edges', 'notes', 'folders'];

/**
 * Últimos ids ativos conhecidos por tabela.
 *
 * Como o app mantém o snapshot inteiro em memória e chama `saveSnapshot` a
 * cada mudança, a diferença `knownActiveIds - ids atuais` é o conjunto de
 * linhas removidas → viram lápides (`deleted_at`) em vez de `DELETE`.
 * Preenchido no `loadSnapshot` e atualizado a cada `saveSnapshot`.
 */
const knownActiveIds: Record<string, Set<string>> = {};

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
	const deviceId = await ensureDeviceId(db);
	const categoryRows = await db.select<Array<{ id: string }>>(
		'SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1'
	);
	if (categoryRows.length === 0) {
		for (const category of defaultCategories) {
			await db.execute('INSERT INTO categories (id, module, payload) VALUES ($1, $2, $3)', [
				category.id,
				category.module,
				JSON.stringify(category)
			]);
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
	const nextKnown: Record<string, Set<string>> = {};
	const statements = buildSnapshotStatements(demoSnapshot(), deviceId, Date.now(), nextKnown);
	statements.push({
		sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)',
		params: ['test_seeded', JSON.stringify(true)]
	});
	await invoke('db_batch', { db: activeDbName(), statements });
	Object.assign(knownActiveIds, nextKnown);
}

/** Remove lápides antigas (o sync futuro não precisa revivê-las). */
async function purgeTombstones(db: Database): Promise<void> {
	const cutoff = String(Date.now() - TOMBSTONE_TTL_MS);
	for (const table of PURGE_TABLES) {
		await db.execute(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < $1`, [cutoff]);
	}
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

/** Monta os upserts das linhas e as lápides das que sumiram. */
function pushRows(
	statements: BatchStatement[],
	nextKnown: Record<string, Set<string>>,
	table: string,
	columns: string[],
	rows: string[][],
	currentIds: string[],
	deviceId: string,
	at: number
): void {
	const sql = upsertSql(table, [...columns, 'updated_at', 'device_id']);
	for (const row of rows) {
		statements.push({ sql, params: [...row, String(at), deviceId] });
	}
	const previous = knownActiveIds[table] ?? new Set<string>();
	statements.push(...tombstoneStatements(table, tombstoneIds(previous, currentIds), at, deviceId));
	nextKnown[table] = new Set(currentIds);
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
	const patch: Partial<Category> = {};
	if (!category.kind) patch.kind = isIncome ? 'in' : 'out';
	if (!isIncome && !category.limitMinor) patch.limitMinor = FALLBACK_LIMITS[category.id] || 50000;
	return Object.keys(patch).length ? { ...category, ...patch } : category;
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
			trackers: (stored.trackers ?? defaults.trackers).map(normalizeTracker),
			preferences: { ...defaults.preferences, ...stored.preferences },
			experience: { ...defaults.experience, ...stored.experience },
			lifeForce: { ...defaults.lifeForce, ...stored.lifeForce },
			finance: { ...defaults.finance, ...stored.finance },
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

export async function loadSnapshot(): Promise<AtlasSnapshot> {
	if (!isTauri()) return readPreview();
	const db = await getReadyDatabase();
	await writeQueue;
	const [categories, transactions, habits, habitLogs, trackers, trackerEntries, timeBlocks, graphDomains, graphNodes, graphEdges, settings] = await Promise.all([
		db.select<Array<{ payload: string }>>('SELECT payload FROM categories WHERE deleted_at IS NULL'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM habits WHERE deleted_at IS NULL'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM habit_logs WHERE deleted_at IS NULL ORDER BY occurred_on DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM trackers WHERE deleted_at IS NULL'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM tracker_entries WHERE deleted_at IS NULL ORDER BY occurred_on DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM time_blocks WHERE deleted_at IS NULL ORDER BY starts_at DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM graph_domains WHERE deleted_at IS NULL'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM graph_nodes WHERE deleted_at IS NULL'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM graph_edges WHERE deleted_at IS NULL'),
		db.select<Array<{ key: string; value: string }>>('SELECT key, value FROM app_settings')
	]);
	const settingsMap = Object.fromEntries(settings.map((item) => [item.key, JSON.parse(item.value)]));
	const defaults = createEmptySnapshot();
	const lifeForce = { ...defaults.lifeForce, ...(settingsMap.lifeForce ?? {}) } as LifeForceState;
	const experience = { ...defaults.experience, ...(settingsMap.experience ?? {}) } as ExperienceState;
	const finance = { ...defaults.finance, ...(settingsMap.finance ?? {}) } as FinanceState;
	const preferences = { ...defaults.preferences, ...(settingsMap.preferences ?? {}) };
	const graph =
		graphDomains.length + graphNodes.length + graphEdges.length === 0
			? defaults.graph
			: normalizeGraph({
					domains: graphDomains.map((row) => JSON.parse(row.payload)),
					nodes: graphNodes.map((row) => JSON.parse(row.payload)),
					edges: graphEdges.map((row) => JSON.parse(row.payload))
				});
	const snapshot = {
		categories: categories.map((row) => normalizeCategory(JSON.parse(row.payload) as Category)),
		transactions: transactions.map((row) => JSON.parse(row.payload) as Transaction),
		habits: habits.map((row) => JSON.parse(row.payload) as Habit),
		habitLogs: habitLogs.map((row) => JSON.parse(row.payload) as HabitLog),
		trackers: trackers.map((row) => normalizeTracker(JSON.parse(row.payload) as Partial<Tracker>)),
		trackerEntries: trackerEntries.map((row) => JSON.parse(row.payload) as TrackerEntry),
		timeBlocks: timeBlocks.map((row) => JSON.parse(row.payload) as TimeBlock),
		lifeForce,
		experience,
		finance,
		preferences,
		graph
	};
	snapshot.graph = reconcileGraph(snapshot.graph, snapshot);
	migrateLifeForceBaseline(snapshot);
	knownActiveIds.categories = new Set(snapshot.categories.map((item) => item.id));
	knownActiveIds.transactions = new Set(snapshot.transactions.map((item) => item.id));
	knownActiveIds.habits = new Set(snapshot.habits.map((item) => item.id));
	knownActiveIds.habit_logs = new Set(snapshot.habitLogs.map((item) => item.id));
	knownActiveIds.trackers = new Set(snapshot.trackers.map((item) => item.id));
	knownActiveIds.tracker_entries = new Set(snapshot.trackerEntries.map((item) => item.id));
	knownActiveIds.time_blocks = new Set(snapshot.timeBlocks.map((item) => item.id));
	knownActiveIds.graph_domains = new Set(snapshot.graph.domains.map((item) => item.id));
	knownActiveIds.graph_nodes = new Set(snapshot.graph.nodes.map((item) => item.id));
	knownActiveIds.graph_edges = new Set(snapshot.graph.edges.map((item) => item.id));
	return snapshot;
}

/** Statements do snapshot inteiro (upserts + lápides + settings). */
function buildSnapshotStatements(
	snapshot: AtlasSnapshot,
	deviceId: string,
	at: number,
	nextKnown: Record<string, Set<string>>
): BatchStatement[] {
	const statements: BatchStatement[] = [];
	pushRows(
		statements,
		nextKnown,
		'categories',
		['id', 'module', 'payload'],
		snapshot.categories.map((item) => [item.id, item.module, JSON.stringify(item)]),
		snapshot.categories.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'transactions',
		['id', 'occurred_on', 'payload'],
		snapshot.transactions.map((item) => [item.id, item.date, JSON.stringify(item)]),
		snapshot.transactions.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'habits',
		['id', 'payload'],
		snapshot.habits.map((item) => [item.id, JSON.stringify(item)]),
		snapshot.habits.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'habit_logs',
		['id', 'habit_id', 'occurred_on', 'payload'],
		snapshot.habitLogs.map((item) => [item.id, item.habitId, item.date, JSON.stringify(item)]),
		snapshot.habitLogs.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'trackers',
		['id', 'payload'],
		snapshot.trackers.map((item) => [item.id, JSON.stringify(item)]),
		snapshot.trackers.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'tracker_entries',
		['id', 'tracker_id', 'occurred_on', 'payload'],
		snapshot.trackerEntries.map((item) => [item.id, item.trackerId, item.date, JSON.stringify(item)]),
		snapshot.trackerEntries.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'time_blocks',
		['id', 'starts_at', 'payload'],
		snapshot.timeBlocks.map((item) => [item.id, item.startAt, JSON.stringify(item)]),
		snapshot.timeBlocks.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'graph_domains',
		['id', 'payload'],
		snapshot.graph.domains.map((item) => [item.id, JSON.stringify(item)]),
		snapshot.graph.domains.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'graph_nodes',
		['id', 'payload'],
		snapshot.graph.nodes.map((item) => [item.id, JSON.stringify(item)]),
		snapshot.graph.nodes.map((item) => item.id),
		deviceId,
		at
	);
	pushRows(
		statements,
		nextKnown,
		'graph_edges',
		['id', 'payload'],
		snapshot.graph.edges.map((item) => [item.id, JSON.stringify(item)]),
		snapshot.graph.edges.map((item) => item.id),
		deviceId,
		at
	);
	statements.push(
		...settingStatements({
			lifeForce: snapshot.lifeForce,
			preferences: snapshot.preferences,
			experience: snapshot.experience,
			finance: snapshot.finance
		})
	);
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
		// Só aplicamos os ids conhecidos se a gravação tiver sucesso, para que
		// uma falha não "esqueça" lápides pendentes.
		const nextKnown: Record<string, Set<string>> = {};
		const statements = buildSnapshotStatements(snapshot, deviceId, Date.now(), nextKnown);
		// Uma transação numa única conexão (ver `db_batch` no lib.rs).
		await invoke('db_batch', { db: activeDbName(), statements });
		Object.assign(knownActiveIds, nextKnown);
	});
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

