import Database from '@tauri-apps/plugin-sql';
import { isTauri } from '@tauri-apps/api/core';
import {
	createEmptySnapshot,
	type AtlasSnapshot,
	type Category,
	type Habit,
	type HabitLog,
	type ExperienceState,
	type LifeForceState,
	type TimeBlock,
	type Transaction,
	defaultCategories,
	defaultHabits,
	demoFinanceState,
	demoTransactions,
	demoTimeBlocks,
	type FinanceState
} from './atlas';
import { normalizeGraph, type GraphState } from './graph';
import { reconcileGraph } from './graph-sources';

const PREVIEW_KEY = 'atlas-preview-state-v1';
const LIFEFORCE_MIGRATION_KEY = 'atlas-preview-lifeforce-v3';
let database: Promise<Database> | undefined;

async function getDatabase(): Promise<Database> {
	if (!database) database = Database.load('sqlite:atlas.db');
	return database;
}

async function initializeDatabase(db: Database): Promise<void> {
	await db.execute('PRAGMA foreign_keys = ON');
	await db.execute(`CREATE TABLE IF NOT EXISTS categories (
		id TEXT PRIMARY KEY, module TEXT NOT NULL, payload TEXT NOT NULL
	)`);
	await db.execute(`CREATE TABLE IF NOT EXISTS transactions (
		id TEXT PRIMARY KEY, occurred_on TEXT NOT NULL, payload TEXT NOT NULL
	)`);
	await db.execute('CREATE INDEX IF NOT EXISTS transactions_by_date ON transactions(occurred_on)');
	await db.execute(`CREATE TABLE IF NOT EXISTS habits (
		id TEXT PRIMARY KEY, payload TEXT NOT NULL
	)`);
	await db.execute(`CREATE TABLE IF NOT EXISTS habit_logs (
		id TEXT PRIMARY KEY, habit_id TEXT NOT NULL, occurred_on TEXT NOT NULL, payload TEXT NOT NULL,
		UNIQUE(habit_id, occurred_on)
	)`);
	await db.execute('CREATE INDEX IF NOT EXISTS habit_logs_by_date ON habit_logs(occurred_on)');
	await db.execute(`CREATE TABLE IF NOT EXISTS time_blocks (
		id TEXT PRIMARY KEY, starts_at TEXT NOT NULL, payload TEXT NOT NULL
	)`);
	await db.execute('CREATE INDEX IF NOT EXISTS time_blocks_by_start ON time_blocks(starts_at)');
	await db.execute(`CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY, value TEXT NOT NULL
	)`);
	const categoryRows = await db.select<Array<{ id: string }>>('SELECT id FROM categories LIMIT 1');
	if (categoryRows.length === 0) {
		for (const category of defaultCategories) {
			await db.execute('INSERT INTO categories (id, module, payload) VALUES ($1, $2, $3)', [
				category.id,
				category.module,
				JSON.stringify(category)
			]);
		}
	}
	const settingsRows = await db.select<Array<{ key: string }>>('SELECT key FROM app_settings WHERE key = $1', ['lifeForce']);
	if (settingsRows.length === 0) {
		const initial = createEmptySnapshot();
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'lifeForce',
			JSON.stringify(initial.lifeForce)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'preferences',
			JSON.stringify(initial.preferences)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'finance',
			JSON.stringify(initial.finance)
		]);
	}
	const experienceRows = await db.select<Array<{ key: string }>>('SELECT key FROM app_settings WHERE key = $1', ['experience']);
	if (experienceRows.length === 0) {
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'experience',
			JSON.stringify(createEmptySnapshot().experience)
		]);
	}
	const seededRows = await db.select<Array<{ key: string }>>('SELECT key FROM app_settings WHERE key = $1', ['seeded']);
	if (seededRows.length === 0) {
		const habitRows = await db.select<Array<{ id: string }>>('SELECT id FROM habits LIMIT 1');
		if (habitRows.length === 0) {
			for (const habit of defaultHabits()) {
				await db.execute('INSERT INTO habits (id, payload) VALUES ($1, $2)', [habit.id, JSON.stringify(habit)]);
			}
		}
		const transactionRows = await db.select<Array<{ id: string }>>('SELECT id FROM transactions LIMIT 1');
		if (transactionRows.length === 0) {
			for (const item of demoTransactions()) {
				await db.execute('INSERT INTO transactions (id, occurred_on, payload) VALUES ($1, $2, $3)', [
					item.id,
					item.date,
					JSON.stringify(item)
				]);
			}
		}
		const timeRows = await db.select<Array<{ id: string }>>('SELECT id FROM time_blocks LIMIT 1');
		if (timeRows.length === 0) {
			for (const block of demoTimeBlocks()) {
				await db.execute('INSERT INTO time_blocks (id, starts_at, payload) VALUES ($1, $2, $3)', [
					block.id,
					block.startAt,
					JSON.stringify(block)
				]);
			}
		}
		await db.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)', [
			'finance',
			JSON.stringify(demoFinanceState())
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', ['seeded', JSON.stringify(true)]);
	}
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

function readPreview(): AtlasSnapshot {
	const raw = localStorage.getItem(PREVIEW_KEY);
	if (!raw) {
		const initial = createEmptySnapshot();
		localStorage.setItem(PREVIEW_KEY, JSON.stringify(initial));
		return initial;
	}
	try {
		const defaults = createEmptySnapshot();
		const stored = JSON.parse(raw) as Partial<AtlasSnapshot>;
		const snapshot = {
			...defaults,
			...stored,
			categories: (stored.categories ?? defaults.categories).map(normalizeCategory),
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
	const db = await getDatabase();
	await initializeDatabase(db);
	const [categories, transactions, habits, habitLogs, timeBlocks, settings] = await Promise.all([
		db.select<Array<{ payload: string }>>('SELECT payload FROM categories'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM transactions ORDER BY occurred_on DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM habits'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM habit_logs ORDER BY occurred_on DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM time_blocks ORDER BY starts_at DESC'),
		db.select<Array<{ key: string; value: string }>>('SELECT key, value FROM app_settings')
	]);
	const settingsMap = Object.fromEntries(settings.map((item) => [item.key, JSON.parse(item.value)]));
	const defaults = createEmptySnapshot();
	const lifeForce = settingsMap.lifeForce as LifeForceState;
	const experience = { ...defaults.experience, ...(settingsMap.experience ?? {}) } as ExperienceState;
	const finance = { ...defaults.finance, ...(settingsMap.finance ?? {}) } as FinanceState;
	const preferences = { ...defaults.preferences, ...(settingsMap.preferences ?? {}) };
	const graph = settingsMap.graph ? normalizeGraph(settingsMap.graph as GraphState) : defaults.graph;
	const snapshot = {
		categories: categories.map((row) => normalizeCategory(JSON.parse(row.payload) as Category)),
		transactions: transactions.map((row) => JSON.parse(row.payload) as Transaction),
		habits: habits.map((row) => JSON.parse(row.payload) as Habit),
		habitLogs: habitLogs.map((row) => JSON.parse(row.payload) as HabitLog),
		timeBlocks: timeBlocks.map((row) => JSON.parse(row.payload) as TimeBlock),
		lifeForce,
		experience,
		finance,
		preferences,
		graph
	};
	snapshot.graph = reconcileGraph(snapshot.graph, snapshot);
	migrateLifeForceBaseline(snapshot);
	return snapshot;
}

export async function saveSnapshot(snapshot: AtlasSnapshot): Promise<void> {
	if (!isTauri()) {
		localStorage.setItem(PREVIEW_KEY, JSON.stringify(snapshot));
		return;
	}
	const db = await getDatabase();
	await initializeDatabase(db);
	await db.execute('BEGIN IMMEDIATE');
	try {
		await db.execute('DELETE FROM categories');
		await db.execute('DELETE FROM transactions');
		await db.execute('DELETE FROM habits');
		await db.execute('DELETE FROM habit_logs');
		await db.execute('DELETE FROM time_blocks');
		await db.execute('DELETE FROM app_settings');
		for (const category of snapshot.categories) {
			await db.execute('INSERT INTO categories (id, module, payload) VALUES ($1, $2, $3)', [
				category.id,
				category.module,
				JSON.stringify(category)
			]);
		}
		for (const item of snapshot.transactions) {
			await db.execute('INSERT INTO transactions (id, occurred_on, payload) VALUES ($1, $2, $3)', [
				item.id,
				item.date,
				JSON.stringify(item)
			]);
		}
		for (const item of snapshot.habits) {
			await db.execute('INSERT INTO habits (id, payload) VALUES ($1, $2)', [item.id, JSON.stringify(item)]);
		}
		for (const item of snapshot.habitLogs) {
			await db.execute('INSERT INTO habit_logs (id, habit_id, occurred_on, payload) VALUES ($1, $2, $3, $4)', [
				item.id,
				item.habitId,
				item.date,
				JSON.stringify(item)
			]);
		}
		for (const item of snapshot.timeBlocks) {
			await db.execute('INSERT INTO time_blocks (id, starts_at, payload) VALUES ($1, $2, $3)', [
				item.id,
				item.startAt,
				JSON.stringify(item)
			]);
		}
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'lifeForce',
			JSON.stringify(snapshot.lifeForce)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'preferences',
			JSON.stringify(snapshot.preferences)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'experience',
			JSON.stringify(snapshot.experience)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'finance',
			JSON.stringify(snapshot.finance)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
			'graph',
			JSON.stringify(snapshot.graph)
		]);
		await db.execute('INSERT INTO app_settings (key, value) VALUES ($1, $2)', ['seeded', JSON.stringify(true)]);
		await db.execute('COMMIT');
	} catch (error) {
		await db.execute('ROLLBACK');
		throw error;
	}
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
	const defaults = createEmptySnapshot();
	const merged = {
		...defaults,
		...snapshot,
		categories: (snapshot.categories ?? defaults.categories).map(normalizeCategory),
		preferences: { ...defaults.preferences, ...snapshot.preferences },
		experience: { ...defaults.experience, ...snapshot.experience },
		lifeForce: { ...defaults.lifeForce, ...snapshot.lifeForce },
		finance: { ...defaults.finance, ...snapshot.finance },
		graph: normalizeGraph(snapshot.graph ?? defaults.graph)
	} as AtlasSnapshot;
	merged.graph = reconcileGraph(merged.graph, merged);
	return merged;
}
