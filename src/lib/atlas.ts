import { createGraph, type GraphState } from './graph';

export type ModuleId = 'finance' | 'habits' | 'time';
export type TransactionType = 'income' | 'expense';
export type HabitMetric = 'boolean' | 'duration' | 'count' | 'weekly';
export type NavigationKey = 'dashboard' | ModuleId | 'graph' | 'notes';
export type FirstDayOfWeek = 'mon' | 'sun';
/** `limit`: gastar dentro do teto. `goal`: atingir/passar é positivo. */
export type CategoryLimitMode = 'limit' | 'goal';
/** Lado da meta que conta como bom (`up` = maior é melhor). */
export type TargetDirection = 'up' | 'down';

export interface Category {
	id: string;
	module: 'finance' | 'time';
	name: string;
	color: string;
	custom?: boolean;
	kind?: 'in' | 'out';
	limitMinor?: number;
	/** Só em finanças; ausente = `limit`. */
	limitMode?: CategoryLimitMode;
	weeklyGoalHours?: number;
}

export const TIME_SLOT_START_HOUR = 7;
export const TIME_SLOT_COUNT = 32;
export const TIME_SLOT_MINUTES = 30;

export interface Transaction {
	id: string;
	type: TransactionType;
	amountMinor: number;
	categoryId: string;
	date: string;
	description: string;
}

export interface Habit {
	id: string;
	name: string;
	metric: HabitMetric;
	unit: string;
	target: number;
	scheduledDays: number[];
	active: boolean;
	reminder?: string;
	bestStreak: number;
	/** Lado da meta que conta como cumprida; ausente = `up`. */
	targetDirection?: TargetDirection;
	/**
	 * Só para `metric: 'boolean'`: qual valor (0/1) conta como o positivo e os
	 * rótulos mostrados. Ausentes = `1`, "Feito" e "Não feito".
	 */
	positiveValue?: 0 | 1;
	positiveLabel?: string;
	negativeLabel?: string;
}

export interface HabitLog {
	id: string;
	habitId: string;
	date: string;
	value: number;
	completed: boolean;
	experienceAwarded?: boolean;
	/**
	 * Só em hábito semanal: dia (`YYYY-MM-DD`) do último incremento. É o que
	 * permite o hábito contar na meta do dia em que foi mexido.
	 */
	lastIncrementDate?: string;
	/** Só em hábito semanal: dias em que houve incremento na semana. */
	incrementDates?: string[];
}

/**
 * Tracker — acompanhamento sem recorrência (ex.: peso corporal).
 *
 * Diferente de hábito: não tem dias programados, streak nem meta diária.
 * Os tipos de medida são os mesmos dos hábitos (`boolean`, `duration`,
 * `count`) — sem `weekly`. Guarda um histórico de registros (`TrackerEntry`),
 * vários por dia.
 */
export type TrackerMetric = 'boolean' | 'duration' | 'count';

export interface Tracker {
	id: string;
	name: string;
	metric: TrackerMetric;
	unit: string;
	/** Valor de referência opcional (ex.: 70 para 70 kg). */
	target: number | null;
	/** Qual lado da meta é o "bom" (`up` = maior é melhor). */
	targetDirection: 'up' | 'down';
	/** Perguntar a hora no lançamento rápido (senão usa a hora atual). */
	askTime: boolean;
	/** Só para `metric: 'boolean'` (ver `Habit`). Ausentes = `1`, "Sim" e "Não". */
	positiveValue?: 0 | 1;
	positiveLabel?: string;
	negativeLabel?: string;
	active: boolean;
	createdAt: string;
}

export interface TrackerEntry {
	id: string;
	trackerId: string;
	/** Data local `YYYY-MM-DD`. */
	date: string;
	/** Hora local `HH:MM` opcional. */
	time?: string;
	value: number;
	note?: string;
}

export interface ExperienceState {
	totalXp: number;
}

export interface FinanceState {
	savingsGoalMinor: number;
	streak: number;
	lastEntryDate: string;
	goalHit: boolean;
}

export interface TimeBlock {
	id: string;
	title: string;
	categoryId: string;
	startAt: string;
	endAt: string;
	plannedMinutes: number;
	actualMinutes: number | null;
	status: 'planned' | 'completed' | 'cancelled';
	reminder?: string;
}

export interface LifeForceState {
	value: number;
	lastMeaningfulAt: string;
	pausedUntil: string | null;
	pausedFrom: string | null;
	pausePeriods: { start: string; end: string }[];
	lastDecayDate: string;
	/** Data (YYYY-MM-DD) da primeira nota criada no dia; usada para pontuar uma vez por dia. */
	lastNoteDate: string;
}

export interface AppPreferences {
	currency: string;
	notificationsEnabled: boolean;
	soundEnabled: boolean;
	typingSoundEnabled: boolean;
	hapticsEnabled: boolean;
	backupEncryption: 'ask' | 'encrypted' | 'plain';
	/** Primeiro dia da semana dos ciclos (hábito semanal, trackers, calendário). */
	firstDayOfWeek: FirstDayOfWeek;
}

export interface AtlasSnapshot {
	categories: Category[];
	transactions: Transaction[];
	habits: Habit[];
	habitLogs: HabitLog[];
	trackers: Tracker[];
	trackerEntries: TrackerEntry[];
	timeBlocks: TimeBlock[];
	lifeForce: LifeForceState;
	experience: ExperienceState;
	finance: FinanceState;
	/** Meta padrão de hábitos concluídos por dia (1–12, sincronizada). */
	dailyGoal: number;
	preferences: AppPreferences;
	graph: GraphState;
}

export const DAILY_GOAL_DEFAULT = 3;
export const DAILY_GOAL_MIN = 1;
export const DAILY_GOAL_MAX = 12;

export function normalizeDailyGoal(value: unknown): number {
	const number = Number(value);
	if (!Number.isFinite(number)) return DAILY_GOAL_DEFAULT;
	return Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, Math.round(number)));
}

export function normalizeFirstDayOfWeek(value: unknown): FirstDayOfWeek {
	return value === 'sun' ? 'sun' : 'mon';
}

export function normalizeTargetDirection(value: unknown): TargetDirection {
	return value === 'down' ? 'down' : 'up';
}

export function normalizeCategoryLimitMode(value: unknown): CategoryLimitMode {
	return value === 'goal' ? 'goal' : 'limit';
}

const today = () => localDate();

export const defaultCategories: Category[] = [
	{ id: 'sal', module: 'finance', name: 'Salário', color: '#d4f25a', kind: 'in' },
	{ id: 'moa', module: 'finance', name: 'Moradia', color: '#9cc8ff', kind: 'out', limitMinor: 120000, limitMode: 'limit' },
	{ id: 'ali', module: 'finance', name: 'Alimentação', color: '#ffb347', kind: 'out', limitMinor: 80000, limitMode: 'limit' },
	{ id: 'trn', module: 'finance', name: 'Transporte', color: '#c6a8ff', kind: 'out', limitMinor: 30000, limitMode: 'limit' },
	{ id: 'laz', module: 'finance', name: 'Lazer', color: '#f1a5c5', kind: 'out', limitMinor: 25000, limitMode: 'limit' },
	{ id: 'deep-work', module: 'time', name: 'Foco profundo', color: '#d4f25a', weeklyGoalHours: 10 },
	{ id: 'reading', module: 'time', name: 'Leitura', color: '#c6a8ff', weeklyGoalHours: 5 },
	{ id: 'admin', module: 'time', name: 'Administração', color: '#9cc8ff', weeklyGoalHours: 0 },
	{ id: 'health-time', module: 'time', name: 'Saúde', color: '#f1a5c5', weeklyGoalHours: 4 },
	{ id: 'personal', module: 'time', name: 'Pessoal', color: '#ffb347', weeklyGoalHours: 0 },
	{ id: 'rest', module: 'time', name: 'Descanso', color: '#7fe3c4', weeklyGoalHours: 0 }
];

export const WEEK_MAX = 7;

export function createEmptySnapshot(): AtlasSnapshot {
	return {
		categories: structuredClone(defaultCategories),
		transactions: [],
		habits: [],
		habitLogs: [],
		trackers: [],
		trackerEntries: [],
		timeBlocks: [],
		experience: { totalXp: 0 },
		lifeForce: {
			value: 50,
			lastMeaningfulAt: new Date().toISOString(),
			pausedUntil: null,
			pausedFrom: null,
			pausePeriods: [],
			lastDecayDate: today(),
			lastNoteDate: ''
		},
		finance: { savingsGoalMinor: 0, streak: 0, lastEntryDate: '', goalHit: false },
		dailyGoal: DAILY_GOAL_DEFAULT,
		preferences: {
			currency: 'BRL',
			notificationsEnabled: true,
			soundEnabled: true,
			typingSoundEnabled: true,
			hapticsEnabled: true,
			backupEncryption: 'ask',
			firstDayOfWeek: 'mon'
		},
		graph: createGraph()
	};
}

export function xpNeededForLevel(level: number): number {
	return 100 + Math.max(0, level - 1) * 50;
}

export function experienceProgress(totalXp: number): { level: number; currentXp: number; nextLevelXp: number } {
	let remaining = Math.max(0, totalXp);
	let level = 1;
	let nextLevelXp = xpNeededForLevel(level);
	while (remaining >= nextLevelXp) {
		remaining -= nextLevelXp;
		level += 1;
		nextLevelXp = xpNeededForLevel(level);
	}
	return { level, currentXp: remaining, nextLevelXp };
}

export function id(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
	// Contexto inseguro (ex.: dev server em http://LAN) não expõe randomUUID.
	return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Id determinístico do log de um hábito.
 *
 * O log é único por (hábito, data) — a tabela tem `UNIQUE(habit_id, occurred_on)`.
 * Com id aleatório, dois aparelhos criando o log do mesmo dia produzem duas
 * linhas: o upsert do sync é por `id`, então não cobre e a constraint estoura
 * (ou sobra duplicata). Derivar o id da chave de negócio faz os dois lados
 * calcularem a MESMA linha, e aí o LWW resolve valor/undo normalmente.
 */
export function habitLogId(habitId: string, date: string): string {
	return `hlog:${habitId}:${date}`;
}

export function localDate(value = new Date()): string {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, '0');
	const day = String(value.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function dateOffset(date: string, amount: number): string {
	const result = new Date(`${date}T12:00:00`);
	result.setDate(result.getDate() + amount);
	return localDate(result);
}

export function weekStartDate(date = localDate(), firstDay: FirstDayOfWeek = 'mon'): string {
	const day = new Date(`${date}T12:00:00`).getDay();
	const offset = firstDay === 'sun' ? day : (day + 6) % 7;
	return dateOffset(date, -offset);
}

export function weeklyLogKey(date = localDate(), firstDay: FirstDayOfWeek = 'mon'): string {
	return weekStartDate(date, firstDay);
}

/**
 * Log de um hábito semanal na semana que começa em `weekStart`.
 *
 * O canônico é a chave da semana, mas versões antigas gravaram o log no dia do
 * incremento. A leitura tolera as duas formas (semana primeiro, depois o
 * registro mais recente dentro da semana) para o tile não zerar ao reabrir.
 */
export function weeklyLogFor(logs: readonly HabitLog[], habitId: string, weekStart: string): HabitLog | undefined {
	const weekEnd = dateOffset(weekStart, 6);
	const inWeek = logs.filter((log) => log.habitId === habitId && log.date >= weekStart && log.date <= weekEnd);
	if (!inWeek.length) return undefined;
	return inWeek.find((log) => log.date === weekStart) ?? inWeek.sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function money(minor: number, currency = 'BRL'): string {
	return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100);
}

export function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	if (hours === 0) return `${remainder} min`;
	return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
}

export function didMeetTarget(habit: Habit, value: number): boolean {
	if (habit.metric === 'boolean') return value === positiveValueOf(habit);
	if (habit.targetDirection === 'down') return value <= habit.target;
	return value >= habit.target;
}

/** 0..1 para a barra do tile, respeitando "menos é melhor". */
export function habitProgress(habit: Habit, value: number): number {
	if (habit.metric === 'boolean') return didMeetTarget(habit, value) ? 1 : 0;
	if (habit.target <= 0) return 0;
	if (habit.targetDirection === 'down') {
		return value <= habit.target ? 1 : Math.min(1, habit.target / Math.max(1, value));
	}
	return Math.min(1, value / habit.target);
}

/** Valor (0/1) tratado como positivo num sim/não. Default: `1`. */
export function positiveValueOf(source: { positiveValue?: 0 | 1 } | null | undefined): 0 | 1 {
	return source?.positiveValue === 0 ? 0 : 1;
}

export const HABIT_BOOLEAN_LABELS = { positive: 'Feito', negative: 'Não feito' };
export const TRACKER_BOOLEAN_LABELS = { positive: 'Sim', negative: 'Não' };

/** Rótulo do estado lançado (`value`) num sim/não, com fallback por entidade. */
export function booleanLabelOf(
	source: { positiveValue?: 0 | 1; positiveLabel?: string; negativeLabel?: string },
	value: number,
	fallback: { positive: string; negative: string }
): string {
	return value === positiveValueOf(source)
		? source.positiveLabel?.trim() || fallback.positive
		: source.negativeLabel?.trim() || fallback.negative;
}

/** Próximo estado do ciclo do sim/não: positivo → negativo → remover. */
export function nextBooleanLog(hasEntry: boolean, currentValue: number, positive: 0 | 1): 0 | 1 | 'remove' {
	if (!hasEntry) return positive;
	return currentValue === positive ? (positive === 1 ? 0 : 1) : 'remove';
}

export function currentStreak(
	habit: Habit,
	logs: HabitLog[],
	today = localDate(),
	pausePeriods: { start: string; end: string }[] = [],
	firstDay: FirstDayOfWeek = 'mon'
): number {
	if (!habit.active) return 0;
	if (habit.metric === 'weekly') return weeklyStreak(habit, logs, today, pausePeriods, firstDay);
	if (habit.scheduledDays.length === 0) return 0;
	const logByDate = new Map(logs.filter((log) => log.habitId === habit.id).map((log) => [log.date, log]));
	const todayLog = logByDate.get(today);
	const todayIsPaused = pausePeriods.some((period) => period.start <= today && today <= period.end);
	if (todayLog && !didMeetTarget(habit, todayLog.value) && !todayIsPaused) return 0;
	const cursor = todayLog && !todayIsPaused ? today : dateOffset(today, -1);
	let streak = 0;
	let date = cursor;
	for (let i = 0; i < 730; i += 1) {
		const weekday = new Date(`${date}T12:00:00`).getDay();
		const paused = pausePeriods.some((period) => period.start <= date && date <= period.end);
		if (paused) {
			date = dateOffset(date, -1);
			continue;
		}
		if (habit.scheduledDays.includes(weekday)) {
			const log = logByDate.get(date);
			if (!log || !didMeetTarget(habit, log.value)) break;
			streak += 1;
		}
		date = dateOffset(date, -1);
	}
	return streak;
}

/**
 * Move o log da semana atual quando o primeiro dia da semana muda.
 *
 * Só há um log por (hábito semanal, semana). Se o novo início já tiver um log
 * (troca de ida e volta), os dois são fundidos sem duplicar valor.
 */
export function remapWeeklyLogs(
	logs: HabitLog[],
	weeklyHabitIds: ReadonlySet<string>,
	oldStart: string,
	newStart: string
): HabitLog[] {
	if (oldStart === newStart) return logs;
	const moved = logs.filter((log) => weeklyHabitIds.has(log.habitId) && log.date === oldStart);
	if (!moved.length) return logs;
	const rest = logs.filter((log) => !(weeklyHabitIds.has(log.habitId) && log.date === oldStart));
	for (const log of moved) {
		const target = rest.find((item) => item.habitId === log.habitId && item.date === newStart);
		if (target) {
			target.value = Math.max(target.value, log.value);
			target.completed = target.completed || log.completed;
			target.experienceAwarded = Boolean(target.experienceAwarded || log.experienceAwarded);
			target.incrementDates = [...new Set([
				...(target.incrementDates ?? []),
				...(target.lastIncrementDate ? [target.lastIncrementDate] : []),
				...(log.incrementDates ?? []),
				...(log.lastIncrementDate ? [log.lastIncrementDate] : [])
			])].sort();
			target.lastIncrementDate = target.incrementDates.at(-1);
		} else {
			rest.push({ ...log, id: habitLogId(log.habitId, newStart), date: newStart });
		}
	}
	return rest;
}

/**
 * Sequência de semanas consecutivas que bateram a meta.
 *
 * A semana atual só entra na conta quando já bateu a meta; enquanto está em
 * aberto ela não quebra a sequência (o usuário ainda pode incrementar). O log
 * semanal é guardado na data de início da semana.
 */
function weeklyStreak(
	habit: Habit,
	logs: HabitLog[],
	today: string,
	pausePeriods: { start: string; end: string }[],
	firstDay: FirstDayOfWeek
): number {
	const habitLogs = logs.filter((log) => log.habitId === habit.id);
	const thisWeek = weekStartDate(today, firstDay);
	const current = weeklyLogFor(habitLogs, habit.id, thisWeek);
	let week = current && didMeetTarget(habit, current.value) ? thisWeek : dateOffset(thisWeek, -7);
	let streak = 0;
	for (let i = 0; i < 104; i += 1) {
		const weekEnd = dateOffset(week, 6);
		const paused = pausePeriods.some((period) => period.start <= weekEnd && period.end >= week);
		if (paused) {
			week = dateOffset(week, -7);
			continue;
		}
		const log = weeklyLogFor(habitLogs, habit.id, week);
		if (!log || !didMeetTarget(habit, log.value)) break;
		streak += 1;
		week = dateOffset(week, -7);
	}
	return streak;
}
