import {
	TIME_SLOT_MINUTES,
	TIME_SLOT_START_HOUR,
	createEmptySnapshot,
	dateOffset,
	defaultCategories,
	localDate,
	weekStartDate,
	type AtlasSnapshot,
	type FinanceState,
	type Habit,
	type TimeBlock,
	type Tracker,
	type TrackerEntry,
	type Transaction
} from './atlas';
import { createGraphFromDemo } from './graph';
import type { Note, NoteFolder, NotesState } from './notes';

/**
 * Dados de exemplo do Atlas.
 *
 * Não são semeados automaticamente no 1º boot (ver `createEmptySnapshot`).
 * Servem para o **modo de teste** e para os testes unitários/integração.
 */

export function demoHabits(): Habit[] {
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
			title: defaultCategories().find((item) => item.id === categoryId)?.name ?? '',
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

/** Snapshot completo e populado, usado pelo modo de teste. */
export function demoTrackers(): Tracker[] {
	const created = new Date().toISOString();
	return [
		{ id: 'demo-tracker-peso', name: 'Peso', metric: 'count', unit: 'kg', target: 72, targetDirection: 'down', askTime: true, active: true, createdAt: created },
		{ id: 'demo-tracker-humor', name: 'Humor', metric: 'count', unit: '', target: null, targetDirection: 'up', askTime: false, active: true, createdAt: created }
	];
}

export function demoTrackerEntries(): TrackerEntry[] {
	return [
		{ id: 'demo-te-peso-1', trackerId: 'demo-tracker-peso', date: dateOffset(localDate(), -4), time: '07:20', value: 74.6 },
		{ id: 'demo-te-peso-2', trackerId: 'demo-tracker-peso', date: dateOffset(localDate(), -2), time: '07:10', value: 74.1 },
		{ id: 'demo-te-peso-3', trackerId: 'demo-tracker-peso', date: localDate(), time: '07:05', value: 73.8, note: 'Depois da corrida' },
		{ id: 'demo-te-humor-1', trackerId: 'demo-tracker-humor', date: dateOffset(localDate(), -1), value: 4 },
		{ id: 'demo-te-humor-2', trackerId: 'demo-tracker-humor', date: localDate(), time: '21:00', value: 5 }
	];
}

export function demoSnapshot(): AtlasSnapshot {
	const base = createEmptySnapshot();
	return {
		...base,
		transactions: demoTransactions(),
		habits: demoHabits(),
		trackers: demoTrackers(),
		trackerEntries: demoTrackerEntries(),
		timeBlocks: demoTimeBlocks(),
		finance: demoFinanceState(),
		graph: createGraphFromDemo(),
		lifeForce: { ...base.lifeForce, value: 78, lastNoteDate: localDate() },
		experience: { totalXp: 320 }
	};
}

/** Notas/pastas de exemplo do modo de teste. */
export function demoNotes(): NotesState {
	const now = new Date().toISOString();
	const folders: NoteFolder[] = [
		{ id: 'demo-folder-diario', parentId: null, name: 'Diário', color: '#9cc8ff', position: 0, createdAt: now, updatedAt: now },
		{ id: 'demo-folder-projetos', parentId: null, name: 'Projetos', color: '#d4f25a', position: 1, createdAt: now, updatedAt: now }
	];
	const notes: Note[] = [
		{
			id: 'demo-note-1',
			folderId: 'demo-folder-diario',
			title: 'Bom dia',
			body: 'Comecei o dia com foco.\n\n- [x] Meditar\n- [ ] Ler 30 min',
			tags: ['rotina'],
			pinned: true,
			createdAt: now,
			updatedAt: now,
			trashedAt: null
		},
		{
			id: 'demo-note-2',
			folderId: 'demo-folder-projetos',
			title: 'Ideias do Atlas',
			body: 'Sincronizar devices pela rede local.\n\nVer [[Bom dia]].',
			tags: ['atlas', 'ideias'],
			pinned: false,
			createdAt: now,
			updatedAt: now,
			trashedAt: null
		}
	];
	return { notes, folders };
}
