export type ModuleId = 'finance' | 'habits' | 'time';
export type TransactionType = 'income' | 'expense';
export type HabitMetric = 'boolean' | 'duration' | 'count' | 'weekly';
export type NavigationKey = 'dashboard' | ModuleId;

export interface Category {
	id: string;
	module: 'finance' | 'time';
	name: string;
	color: string;
	custom?: boolean;
	kind?: 'in' | 'out';
	limitMinor?: number;
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
}

export interface HabitLog {
	id: string;
	habitId: string;
	date: string;
	value: number;
	completed: boolean;
	experienceAwarded?: boolean;
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
}

export interface AppPreferences {
	currency: string;
	notificationsEnabled: boolean;
	soundEnabled: boolean;
	hapticsEnabled: boolean;
	backupEncryption: 'ask' | 'encrypted' | 'plain';
}

export interface AtlasSnapshot {
	categories: Category[];
	transactions: Transaction[];
	habits: Habit[];
	habitLogs: HabitLog[];
	timeBlocks: TimeBlock[];
	lifeForce: LifeForceState;
	experience: ExperienceState;
	finance: FinanceState;
	preferences: AppPreferences;
}

const today = () => localDate();

export const defaultCategories: Category[] = [
	{ id: 'sal', module: 'finance', name: 'Salário', color: '#d4f25a', kind: 'in' },
	{ id: 'moa', module: 'finance', name: 'Moradia', color: '#9cc8ff', kind: 'out', limitMinor: 120000 },
	{ id: 'ali', module: 'finance', name: 'Alimentação', color: '#ffb347', kind: 'out', limitMinor: 80000 },
	{ id: 'trn', module: 'finance', name: 'Transporte', color: '#c6a8ff', kind: 'out', limitMinor: 30000 },
	{ id: 'laz', module: 'finance', name: 'Lazer', color: '#f1a5c5', kind: 'out', limitMinor: 25000 },
	{ id: 'deep-work', module: 'time', name: 'Foco profundo', color: '#d4f25a', weeklyGoalHours: 10 },
	{ id: 'reading', module: 'time', name: 'Leitura', color: '#c6a8ff', weeklyGoalHours: 5 },
	{ id: 'admin', module: 'time', name: 'Administração', color: '#9cc8ff', weeklyGoalHours: 0 },
	{ id: 'health-time', module: 'time', name: 'Saúde', color: '#f1a5c5', weeklyGoalHours: 4 },
	{ id: 'personal', module: 'time', name: 'Pessoal', color: '#ffb347', weeklyGoalHours: 0 },
	{ id: 'rest', module: 'time', name: 'Descanso', color: '#7fe3c4', weeklyGoalHours: 0 }
];

export const WEEK_MAX = 7;

export function defaultHabits(): Habit[] {
	const everyDay = [0, 1, 2, 3, 4, 5, 6];
	return [
		{ id: 'demo-meditar', name: 'Meditar', metric: 'boolean', unit: '', target: 1, scheduledDays: everyDay, active: true, bestStreak: 0 },
		{ id: 'demo-leitura', name: 'Leitura', metric: 'duration', unit: 'min', target: 30, scheduledDays: everyDay, active: true, bestStreak: 0 },
		{ id: 'demo-sono', name: 'Sono', metric: 'duration', unit: 'min', target: 450, scheduledDays: everyDay, active: true, bestStreak: 0 },
		{ id: 'demo-academia', name: 'Academia', metric: 'weekly', unit: 'x', target: 4, scheduledDays: [], active: true, bestStreak: 0 },
		{ id: 'demo-agua', name: 'Água', metric: 'count', unit: 'ml', target: 2000, scheduledDays: everyDay, active: true, bestStreak: 0 }
	];
}

export function demoFinanceState(): FinanceState {
	return { savingsGoalMinor: 200000, streak: 3, lastEntryDate: dateOffset(localDate(), -1), goalHit: false };
}

export function demoTransactions(): Transaction[] {
	const daysAgo = (amount: number) => dateOffset(localDate(), -amount);
	return [
		{ id: 'demo-sal', type: 'income', amountMinor: 320000, categoryId: 'sal', date: daysAgo(5), description: 'Salário' },
		{ id: 'demo-moa', type: 'expense', amountMinor: 110000, categoryId: 'moa', date: daysAgo(4), description: 'Moradia' },
		{ id: 'demo-ali', type: 'expense', amountMinor: 42000, categoryId: 'ali', date: daysAgo(2), description: 'Alimentação' },
		{ id: 'demo-laz', type: 'expense', amountMinor: 3600, categoryId: 'laz', date: daysAgo(1), description: 'Lazer' }
	];
}

export function demoTimeBlocks(): TimeBlock[] {
	const monday = weekStartDate(localDate());
	const blocks: TimeBlock[] = [];
	const push = (dayIndex: number, slot: number, categoryId: string) => {
		const date = dateOffset(monday, dayIndex);
		const hour = TIME_SLOT_START_HOUR + Math.floor(slot / 2);
		const minute = slot % 2 ? 30 : 0;
		const endMinutes = hour * 60 + minute + TIME_SLOT_MINUTES;
		blocks.push({
			id: `demo-tb-${dayIndex}-${slot}`,
			title: defaultCategories.find((item) => item.id === categoryId)?.name ?? '',
			categoryId,
			startAt: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
			endAt: `${date}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`,
			plannedMinutes: TIME_SLOT_MINUTES,
			actualMinutes: null,
			status: 'planned'
		});
	};
	for (let day = 0; day < 5; day += 1) {
		for (let slot = 4; slot < 8; slot += 1) push(day, slot, 'deep-work');
		push(day, 20, 'health-time');
		push(day, 21, 'health-time');
	}
	for (let slot = 24; slot < 26; slot += 1) push(1, slot, 'reading');
	return blocks;
}

export function createEmptySnapshot(): AtlasSnapshot {
	return {
		categories: structuredClone(defaultCategories),
		transactions: demoTransactions(),
		habits: defaultHabits(),
		habitLogs: [],
		timeBlocks: demoTimeBlocks(),
		experience: { totalXp: 0 },
		lifeForce: {
			value: 50,
			lastMeaningfulAt: new Date().toISOString(),
			pausedUntil: null,
			pausedFrom: null,
			pausePeriods: [],
			lastDecayDate: today()
		},
		finance: demoFinanceState(),
		preferences: {
			currency: 'BRL',
			notificationsEnabled: false,
			soundEnabled: true,
		hapticsEnabled: true,
			backupEncryption: 'ask'
		}
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
	return crypto.randomUUID();
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

export function weekStartDate(date = localDate()): string {
	const day = new Date(`${date}T12:00:00`).getDay();
	return dateOffset(date, -((day + 6) % 7));
}

export function weeklyLogKey(date = localDate()): string {
	return weekStartDate(date);
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
	if (habit.metric === 'boolean') return value > 0;
	return value >= habit.target;
}

export function currentStreak(
	habit: Habit,
	logs: HabitLog[],
	today = localDate(),
	pausePeriods: { start: string; end: string }[] = []
): number {
	if (!habit.active || habit.scheduledDays.length === 0) return 0;
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
