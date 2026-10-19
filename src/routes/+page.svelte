<script lang="ts">
	import { onMount, tick, untrack, onDestroy } from 'svelte';
	import { isTauri } from '@tauri-apps/api/core';
	import {
		Archive, ArchiveRestore, CalendarDays, Check, ChevronLeft,
		Flame, FlaskConical, History, LayoutDashboard, Menu, MoreHorizontal, NotebookPen, Pencil, Plus, Route, Settings2, Target, Trash2,
		Wallet, X, type LucideIcon
	} from '@lucide/svelte';
	import {
		HABIT_BOOLEAN_LABELS, booleanLabelOf, currentStreak, dateOffset, didMeetTarget, formatMinutes, habitLogId, habitProgress, id, localDate, money, nextBooleanLog, normalizeDailyGoal, normalizeFirstDayOfWeek, positiveValueOf, remapWeeklyLogs, weekStartDate, WEEK_MAX,
		TIME_SLOT_START_HOUR, TIME_SLOT_COUNT, TIME_SLOT_MINUTES,
		experienceProgress, type AppPreferences, type AtlasSnapshot, type Category, type CategoryLimitMode, type Habit, type HabitLog,
		type NavigationKey, type TimeBlock, type Tracker, type TrackerEntry, type Transaction
	} from '#lib/atlas';
	import {
		amountForCategory,
		budgetOverview,
		categoryLimitStatus,
		transactionsInMonth
	} from '#lib/finance';
	import {
		exportBackupV2,
		importBackupV2,
		loadSnapshot,
		resetStorageCache,
		saveSnapshot,
		type ImportedBackup
	} from '#lib/storage';
	import { backupFileName, pickFile, safetyCopyName, saveBytes, writeSafetyCopy } from '#lib/backup-io';
	import { describeBackup, summarizeBackup } from '#lib/backup';
import { readTestMode, writeTestMode } from '#lib/test-mode';
import { checkForUpdate, relaunchApp, updaterSupportedHere } from '#lib/updater';
	import { m } from '#lib/paraglide/messages.js';
	import {
		onPairRequest,
		onPaired,
		onSyncApplied,
		shortId,
		syncDiscovered,
		syncDiscoveryRestart,
		syncNow,
		syncPairBegin,
		syncPairConfirm,
		syncStart,
		syncStatus,
		syncStop,
		syncSetAuto,
		syncSupported,
		syncUnpair,
		type SyncDiscovered,
		type SyncStatus
	} from '#lib/sync';
import { collectAttachments, loadNotes, replaceNotesState, resetNotesCache, restoreAttachments, upsertNote } from '#lib/notes-store';
	import { backlinks, createNote, findNoteByTitle, type Note, type NoteMode, type NotesState } from '#lib/notes';
	import NoteEditor from '#lib/components/notes/NoteEditor.svelte';
	import { notesForBlock, type NoteRef } from '#lib/tempo-ref';
	import { notePreview } from '#lib/note-preview';
	import { addDays, clampRange, defaultRange, rangeLabel } from '#lib/time-range';
	import { TimeBubble } from '#lib/bubble';
	import { edgeRatio, isMilestone, nodeReached, type GraphState } from '#lib/graph';
	import { reconcileGraph } from '#lib/graph-sources';
	import {
		forgetTrashEvent,
		loadTrashEvents,
		recordTrashEvent,
		restoreTrashEvent
	} from '#lib/trash-store';
	import type { TrashEvent, TrashEventInput } from '#lib/trash';
	import {
		financeCategoryTables,
		graphEdgeTables,
		graphNodeTables,
		habitLogTables,
		habitTables,
		timeCategoryTables,
		trackerEntryTables,
		trackerTables,
		transactionTables
	} from '#lib/trash-build';
	import GraphView from '#lib/components/graph/GraphView.svelte';
	import NotesView from '#lib/components/notes/NotesView.svelte';
	import TrashSheet from '#lib/components/trash/TrashSheet.svelte';
	import TrackersView from '#lib/components/habits/TrackersView.svelte';
	import HabitHistorySheet from '#lib/components/habits/HabitHistorySheet.svelte';
	import PlannerNotesSheet from '#lib/components/time/PlannerNotesSheet.svelte';
	import PlannerNoteSheet from '#lib/components/time/PlannerNoteSheet.svelte';
	import TimeRangeSheet from '#lib/components/time/TimeRangeSheet.svelte';
	import SettingsSheet from '#lib/components/settings/SettingsSheet.svelte';
	import SyncIntroSheet from '#lib/components/settings/SyncIntroSheet.svelte';
	import SyncPairSheet from '#lib/components/settings/SyncPairSheet.svelte';
	import SyncSasSheet from '#lib/components/settings/SyncSasSheet.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import CardMenu from '#lib/components/ui/CardMenu.svelte';
	import Chip from '#lib/components/ui/Chip.svelte';
	import DurationField from '#lib/components/ui/DurationField.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Segmented from '#lib/components/ui/Segmented.svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import ValueSheet from '#lib/components/ui/ValueSheet.svelte';
	import {
		burstAt, centerOf, confetti, floatValue, playFeedback, playTone, popElement,
		prefersReducedMotion, pulseHaptic, vibrate
	} from '#lib/feedback';
	import { formatClock } from '#lib/duration';
	import '../app.css';

	type Period = 'week' | 'month' | 'custom';
	type ModalKind = 'transaction' | 'habit' | 'settings' | 'pause' | null;

	const navItems: { id: NavigationKey; label: string; icon: LucideIcon }[] = [
		{ id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
		{ id: 'finance', label: 'Finanças', icon: Wallet },
		{ id: 'habits', label: 'Hábitos', icon: Target },
		{ id: 'time', label: 'Tempo', icon: CalendarDays },
		{ id: 'notes', label: 'Notas', icon: NotebookPen },
		{ id: 'graph', label: 'Planejamento', icon: Route }
	];

	const TAB_ORDER: NavigationKey[] = ['dashboard', 'finance', 'habits', 'time', 'notes', 'graph'];
	/** Abas fixas da barra inferior mobile. */
	const PRIMARY_TABS: NavigationKey[] = ['dashboard', 'habits', 'time'];
	/** Abas que ficam no menu "Mais". */
	const MORE_TABS: NavigationKey[] = ['finance', 'notes', 'graph'];

	let snapshot = $state<AtlasSnapshot | null>(null);
	let ready = $state(false);
	let loadError = $state('');
	let activeTab = $state<NavigationKey>('dashboard');
	/** Sub-aba do módulo Hábitos: hábitos recorrentes ou trackers. */
	let habitView = $state<'habits' | 'trackers'>('habits');
	let habitPagerEl = $state<HTMLDivElement>();
	let habitPagerMounted: HTMLDivElement | undefined;
	let habitScrollTimer: ReturnType<typeof setTimeout> | undefined;
	let habitScrollSide = 0;
	let notesState = $state<NotesState>({ notes: [], folders: [] });
	let notesVersion = $state(0);
	/** Pede ao NotesView para reler do banco (merge de outro aparelho). */
	let notesReloadToken = $state(0);
	let syncAvailable = $state(false);
	let sync = $state<SyncStatus | null>(null);
	let syncBusy = $state(false);
	let pairOpen = $state(false);
	let pairDevices = $state<SyncDiscovered[]>([]);
	let pairTimer: ReturnType<typeof setInterval> | undefined;
	let sasPrompt = $state<{ peer: string; name: string; sas: string } | null>(null);
	let syncIntro = $state<{ summary: string; path: string | null } | null>(null);
	let period = $state<Period>('week');
	let customStart = $state(dateOffset(localDate(), -6));
	let customEnd = $state(localDate());
	const initialRange = defaultRange(localDate());
	let timeRangeStart = $state(initialRange.start);
	let timeRangeDays = $state(7);
	let timeCalendarOpen = $state(false);
	let currentTime = $state(new Date());
	let modal = $state<ModalKind>(null);
	let testModeActive = $state(false);
	let updaterAvailable = $state(false);
	let updaterBusy = $state(false);
	let updaterStatus = $state('');
	let toast = $state('');
	let toastWarning = $state(false);
	let toastUndo = $state<(() => void) | null>(null);
	let trashOpen = $state(false);
	let trashEvents = $state<TrashEvent[]>([]);
	let sidebarCollapsed = $state(false);
	let quickMenuOpen = $state(false);
	let moreMenuOpen = $state(false);
	let navDirection = $state(1);
	let notesCreateToken = $state(0);
	/** Deep-link de nota: abrir a nota `notesOpenId` quando o token muda. */
	let notesOpenId = $state('');
	let notesOpenToken = $state(0);
	/** Bolha de notas de um horário no planejador. */
	let timeGridEl = $state<HTMLElement | null>(null);
	let plannerBubble: TimeBubble | null = null;
	let plannerBubbleCurrent: NoteRef[] = [];
	/** Bolha fixa do long press no mobile (não fecha ao soltar). */
	let plannerPinBubble: TimeBubble | null = null;
	let plannerPinCurrent: { note: Note; label: string; color: string }[] = [];
	/** Editor de nota em overlay, aberto a partir da bolha do Tempo. */
	let noteOverlay = $state<Note | null>(null);
	let noteOverlayOpen = $state(false);
	let noteOverlayMode = $state<NoteMode>('preview');
	let noteOverlayMorph = $state<DOMRect | null>(null);
	let noteOverlaySeq = 0;
	/** Auto-dwell: tela parada por 4 s abre o dialog das notas visíveis. */
	let autoDwellTimer: ReturnType<typeof setTimeout> | undefined;
	let autoDwellRings: SVGSVGElement[] = [];
	let autoDwellAllowed = true;
	let autoDwellUnlockAt = 0;
	let plannerNotesOpen = $state(false);
	let plannerNotesItems = $state<{ note: Note; label: string; color: string }[]>([]);
	let plannerNoteOpen = $state<Note | null>(null);
	let editingTransactionId = $state('');
	let formError = $state('');
	let wasPaused = $state(false);
	type DialogRequest = {
		kind: 'confirm' | 'prompt';
		title: string;
		message?: string;
		label?: string;
		placeholder?: string;
		confirmLabel: string;
		danger?: boolean;
		resolve: (value: string | null) => void;
	};
	let dialog = $state<DialogRequest | null>(null);
	let dialogValue = $state('');
	let dialogInput = $state<HTMLInputElement | null>(null);
	let lifeForcePercent = $derived(snapshot?.lifeForce.value ?? 50);
	let today = $derived(localDate(currentTime));
	let currentCategory = $derived((id: string) => snapshot?.categories.find((category) => category.id === id));
	let currentRange = $derived.by(() => {
		const now = new Date();
		if (period === 'custom') return { start: customStart, end: customEnd };
		if (period === 'month') {
			return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, end: localDate() };
		}
		const mondayOffset = (now.getDay() + 6) % 7;
		return { start: dateOffset(localDate(), -mondayOffset), end: localDate() };
	});
	let rangeTransactions = $derived(snapshot?.transactions.filter((item) => item.date >= currentRange.start && item.date <= currentRange.end) ?? []);
	let rangeBlocks = $derived(snapshot?.timeBlocks.filter((item) => item.startAt.slice(0, 10) >= currentRange.start && item.startAt.slice(0, 10) <= currentRange.end) ?? []);
	let timeRangeEnd = $derived(addDays(timeRangeStart, timeRangeDays - 1));
	let timeGrid = $derived.by(() => {
		const grid: (string | null)[][] = Array.from({ length: timeRangeDays }, () => Array<string | null>(TIME_SLOT_COUNT).fill(null));
		if (!snapshot) return grid;
		for (const block of snapshot.timeBlocks) {
			if (block.status === 'cancelled') continue;
			const index = timeDayIndex(block.startAt.slice(0, 10));
			if (index < 0 || index >= timeRangeDays) continue;
			const startMinutes = Number(block.startAt.slice(11, 13)) * 60 + Number(block.startAt.slice(14, 16));
			const startSlot = Math.round((startMinutes - TIME_SLOT_START_HOUR * 60) / TIME_SLOT_MINUTES);
			const slots = Math.max(1, Math.round(block.plannedMinutes / TIME_SLOT_MINUTES));
			for (let offset = 0; offset < slots; offset += 1) {
				const slot = startSlot + offset;
				if (slot >= 0 && slot < TIME_SLOT_COUNT) grid[index][slot] = block.categoryId;
			}
		}
		return grid;
	});
	/** Id do bloco por célula (paralelo ao `timeGrid`) — para marcar quem tem nota. */
	let timeGridBlocks = $derived.by(() => {
		const grid: (string | null)[][] = Array.from({ length: timeRangeDays }, () => Array<string | null>(TIME_SLOT_COUNT).fill(null));
		if (!snapshot) return grid;
		for (const block of snapshot.timeBlocks) {
			if (block.status === 'cancelled') continue;
			const index = timeDayIndex(block.startAt.slice(0, 10));
			if (index < 0 || index >= timeRangeDays) continue;
			const startMinutes = Number(block.startAt.slice(11, 13)) * 60 + Number(block.startAt.slice(14, 16));
			const startSlot = Math.round((startMinutes - TIME_SLOT_START_HOUR * 60) / TIME_SLOT_MINUTES);
			const slots = Math.max(1, Math.round(block.plannedMinutes / TIME_SLOT_MINUTES));
			for (let offset = 0; offset < slots; offset += 1) {
				const slot = startSlot + offset;
				if (slot >= 0 && slot < TIME_SLOT_COUNT) grid[index][slot] = block.id;
			}
		}
		return grid;
	});
	/** Notas que referenciam cada bloco (`tempo`/`time`) no range visível. */
	let timeBlockNotes = $derived.by(() => {
		const map = new Map<string, NoteRef[]>();
		if (!snapshot) return map;
		const active = notesState.notes.filter((note) => !note.trashedAt);
		if (!active.length) return map;
		for (const block of snapshot.timeBlocks) {
			if (block.status === 'cancelled') continue;
			const date = block.startAt.slice(0, 10);
			if (date < timeRangeStart || date > timeRangeEnd) continue;
			const found = notesForBlock(block, active);
			if (found.length) map.set(block.id, found);
		}
		return map;
	});
	let timeTodayIndex = $derived.by(() => {
		const index = timeDayIndex(today);
		return index >= 0 && index < timeRangeDays ? index : -1;
	});
	const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
	let timeHeaderDays = $derived(Array.from({ length: timeRangeDays }, (_, index) => {
		const date = addDays(timeRangeStart, index);
		const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
		return { label: weekdayLabels[weekday], dayNumber: Number(date.slice(8, 10)) };
	}));
	let timeWeekBars = $derived.by(() => {
		const daySlots = timeGrid.map((day) => day.filter(Boolean).length);
		const max = Math.max(8, ...daySlots);
		return daySlots.map((slots, index) => {
			const date = addDays(timeRangeStart, index);
			const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
			return {
				label: weekdayLabels[weekday],
				dayNumber: Number(date.slice(8, 10)),
				percent: slots ? (slots / max) * 100 : 0
			};
		});
	});
	let timeTotalsLabel = $derived.by(() => {
		const total = timeGrid.reduce((sum, day) => sum + day.filter(Boolean).length, 0);
		const free = Math.max(0, timeRangeDays * TIME_SLOT_COUNT - total);
		return `${rangeLabel(timeRangeStart, timeRangeEnd)} · ${hmSlots(total)} alocadas · ${hmSlots(free)} livres`;
	});
	let timeNow = $derived.by(() => {
		if (timeTodayIndex < 0) return null;
		const minutes = currentTime.getHours() * 60 + currentTime.getMinutes();
		const slot = (minutes - TIME_SLOT_START_HOUR * 60) / TIME_SLOT_MINUTES;
		if (slot < 0 || slot > TIME_SLOT_COUNT) return null;
		return { top: slot * 28, left: 38 + timeTodayIndex * timeColumnWidth + 2, width: Math.max(20, timeColumnWidth - 4) };
	});
	let timeCategories = $derived(snapshot?.categories.filter((item) => item.module === 'time') ?? []);
	let habitWeekDays = $derived.by(() => {
		const data = snapshot;
		if (!data) return [];
		const start = weekStart(today);
		const labels = firstDayOfWeek(data) === 'sun'
			? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
			: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
		return Array.from({ length: 7 }, (_, index) => {
			const date = dateOffset(start, index);
			const paused = isPausedOn(date, data);
			const planned = paused ? [] : habitsForDate(data, date);
			const done = planned.filter((habit) => habitDoneOn(data, habit, date)).length;
			return { date, label: labels[index], done, planned: planned.length, goal: paused ? 0 : Math.min(dailyGoalOf(data), planned.length), paused };
		});
	});
	let prototypeTodayHabits = $derived.by(() => (snapshot ? habitsForDate(snapshot, today) : []));
	let prototypeTodayDone = $derived(
		snapshot ? prototypeTodayHabits.filter((habit) => habitDoneOn(snapshot!, habit, today)).length : 0
	);
	let prototypeTodayGoal = $derived(Math.min(dailyGoalOf(snapshot), prototypeTodayHabits.length));
	let habitDayStreak = $derived.by(() => getHabitDayStreak(snapshot));
	let levelProgress = $derived(experienceProgress(snapshot?.experience.totalXp ?? 0));
	let levelPercent = $derived(levelProgress.nextLevelXp ? Math.min(1, levelProgress.currentXp / levelProgress.nextLevelXp) : 0);
	let activeNavItem = $derived(navItems.find((item) => item.id === activeTab) ?? navItems[0]);
	let sidebarIndex = $derived(Math.max(0, navItems.findIndex((item) => item.id === activeTab)));
	let bottomIndex = $derived(activeTab === 'dashboard' ? 0 : activeTab === 'habits' ? 1 : activeTab === 'time' ? 3 : 4);
	let financeCategories = $derived(snapshot?.categories.filter((item) => item.module === 'finance') ?? []);
	let financeMonthTransactions = $derived(monthTransactionsOf(snapshot));
	let financeIncome = $derived(financeMonthTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amountMinor, 0));
	let financeExpense = $derived(financeMonthTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amountMinor, 0));
	let financeBalance = $derived(financeIncome - financeExpense);
	let financeGoal = $derived(snapshot?.finance.savingsGoalMinor ?? 0);
	let financeGoalPercent = $derived(financeGoal > 0 ? Math.max(0, Math.min(1, financeBalance / financeGoal)) : 0);
	let financeExpenseCategories = $derived(financeCategories.filter((item) => item.kind !== 'in'));
	let financeGreenCount = $derived(financeExpenseCategories.filter((item) => {
		const status = categoryLimitStatus(item, categoryTotal(item.id));
		if (status.limitMinor <= 0) return false;
		return status.mode === 'goal' ? status.reached : !status.over;
	}).length);
	let financeBudget = $derived(budgetOverview(financeCategories, financeMonthTransactions));
	let financeRecent = $derived([...(snapshot?.transactions ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6));
	let financeMonthLabel = $derived(new Date().toLocaleDateString('pt-BR', { month: 'long' }).replace(/^./, (character) => character.toUpperCase()));
	let financeEntryCategories = $derived(financeCategories.filter((item) => (financeEntry.type === 'income' ? item.kind === 'in' : item.kind !== 'in')));

	// ===== Dashboard (Visão geral) =====
	let dashMenu = $state(false);
	let dashHabitPicker = $state(false);
	let dashPeriodLabel = $derived(period === 'week' ? 'semana' : period === 'month' ? 'mês' : 'período');
	let lifeForceLabel = $derived(lifeForcePercent >= 70 ? 'Viva' : lifeForcePercent >= 30 ? 'Estável' : 'Apagando');
	let dashGoalPercent = $derived(prototypeTodayGoal ? Math.min(prototypeTodayDone, prototypeTodayGoal) / prototypeTodayGoal : 0);
	let dashDays = $derived.by(() => {
		const days: string[] = [];
		let cursor = currentRange.start;
		let guard = 0;
		while (cursor <= currentRange.end && guard < 400) {
			days.push(cursor);
			cursor = dateOffset(cursor, 1);
			guard += 1;
		}
		return days;
	});
	let dashBalanceSeries = $derived.by(() => {
		const byDate = new Map<string, number>();
		for (const transaction of snapshot?.transactions ?? []) {
			byDate.set(transaction.date, (byDate.get(transaction.date) ?? 0) + (transaction.type === 'income' ? transaction.amountMinor : -transaction.amountMinor));
		}
		let running = 0;
		return dashDays.map((date) => {
			running += byDate.get(date) ?? 0;
			return running;
		});
	});
	let dashBalance = $derived(dashBalanceSeries.length ? dashBalanceSeries[dashBalanceSeries.length - 1] : 0);
	let dashSpark = $derived.by(() => {
		const values = dashBalanceSeries;
		if (!values.length) return { line: '', area: '', left: 100, top: 50 };
		const min = Math.min(...values, 0);
		const max = Math.max(...values, 0);
		const span = max - min || 1;
		const step = values.length === 1 ? 0 : 300 / (values.length - 1);
		const y = (value: number) => 84 - ((value - min) / span) * 70;
		const points = values.map((value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`);
		return {
			line: `M${points.join(' L')}`,
			area: `M${points.join(' L')} L300,90 L0,90 Z`,
			left: values.length === 1 ? 0 : 100,
			top: (y(values[values.length - 1]) / 90) * 100
		};
	});
	let dashExpenses = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const transaction of rangeTransactions) {
			if (transaction.type === 'expense') totals.set(transaction.categoryId, (totals.get(transaction.categoryId) ?? 0) + transaction.amountMinor);
		}
		const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
		const circumference = 2 * Math.PI * 38;
		const label = money(Math.ceil(total / 100) * 100, currency()).replace(',00', '');
		let offset = 0;
		const segments = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([categoryId, amount]) => {
			const length = total ? (amount / total) * circumference : 0;
			const segment = {
				categoryId,
				amount,
				color: currentCategory(categoryId)?.color ?? '#8d968a',
				dash: `${Math.max(0, length - 2).toFixed(2)} ${circumference.toFixed(2)}`,
				offset: -offset
			};
			offset += length;
			return segment;
		});
		return { total, label, segments };
	});
	let dashHabitDays = $derived.by(() => dashDays.map((date) => {
		const data = snapshot;
		if (!data) return { date, value: 0, paused: false, today: false };
		const paused = isPausedOn(date, data);
		const weekday = new Date(`${date}T12:00:00`).getDay();
		const planned = paused ? [] : data.habits.filter((habit) => habit.active && habit.scheduledDays.includes(weekday));
		const done = planned.filter((habit) => {
			const log = data.habitLogs.find((item) => item.habitId === habit.id && item.date === date);
			return Boolean(log && didMeetTarget(habit, log.value));
		}).length;
		return { date, value: planned.length ? done / planned.length : 0, paused, today: date === today };
	}));
	let dashTime = $derived.by(() => {
		const perDay = new Map<string, Map<string, number>>();
		const totals = new Map<string, number>();
		for (const block of rangeBlocks) {
			if (block.status === 'cancelled') continue;
			const date = block.startAt.slice(0, 10);
			const hours = block.plannedMinutes / 60;
			const day = perDay.get(date) ?? new Map<string, number>();
			day.set(block.categoryId, (day.get(block.categoryId) ?? 0) + hours);
			perDay.set(date, day);
			totals.set(block.categoryId, (totals.get(block.categoryId) ?? 0) + hours);
		}
		const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((entry) => entry[0]);
		const hasOther = [...totals.keys()].some((key) => !top.includes(key));
		const keys = [...top, ...(hasOther ? ['__other'] : [])];
		const colorOf = (key: string) => (key === '__other' ? '#8d968a' : currentCategory(key)?.color ?? '#8d968a');
		const nameOf = (key: string) => (key === '__other' ? 'Outros' : currentCategory(key)?.name ?? '—');
		const otherHours = (day: Map<string, number>) => [...day.entries()].filter(([key]) => !top.includes(key)).reduce((sum, [, value]) => sum + value, 0);
		let maxHours = 1;
		for (const day of perDay.values()) {
			const sum = keys.reduce((total, key) => total + (key === '__other' ? otherHours(day) : day.get(key) ?? 0), 0);
			maxHours = Math.max(maxHours, sum);
		}
		const letters = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
		const days = dashDays.map((date) => {
			const day = perDay.get(date) ?? new Map<string, number>();
			const segments = keys.map((key) => {
				const hours = key === '__other' ? otherHours(day) : day.get(key) ?? 0;
				return { color: colorOf(key), name: nameOf(key), percent: (hours / maxHours) * 100, hours };
			}).filter((segment) => segment.hours > 0);
			const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
			return { date, segments, label: dashDays.length <= 10 ? letters[weekday] : date.slice(8, 10) };
		});
		const legend = keys.map((key) => ({ id: key, name: nameOf(key), color: colorOf(key) }));
		return { days, legend, empty: !totals.size };
	});
	let dashObjectives = $derived.by(() => {
		const graph = snapshot?.graph;
		if (!graph) return { rows: [] as { id: string; name: string; milestone: boolean; ratio: number; color: string }[], extra: 0 };
		const rows = graph.nodes.filter((node) => !node.origin).map((node) => {
			const incoming = graph.edges.filter((edge) => edge.to === node.id);
			const ratio = incoming.length ? Math.min(...incoming.map((edge) => edgeRatio(edge))) : nodeReached(node, graph.edges) ? 1 : 0;
			return { id: node.id, name: node.name, milestone: isMilestone(node), ratio, color: graph.domains.find((item) => item.id === node.domainId)?.color ?? '#8d968a' };
		}).sort((a, b) => Number(a.milestone) - Number(b.milestone) || b.ratio - a.ratio);
		return { rows: rows.slice(0, 5), extra: Math.max(0, rows.length - 5) };
	});

	let transactionForm = $state({ type: 'expense' as 'income' | 'expense', amount: '', categoryId: '', date: localDate(), description: '' });
	let amountInput = $state<HTMLInputElement | null>(null);
	let habitForm = $state({
		name: '',
		metric: 'boolean' as Habit['metric'],
		unit: '',
		target: '1',
		scheduledDays: [1, 2, 3, 4, 5] as number[],
		reminder: '',
		targetDirection: 'up' as 'up' | 'down',
		positiveLabel: HABIT_BOOLEAN_LABELS.positive,
		negativeLabel: HABIT_BOOLEAN_LABELS.negative,
		positiveValue: 1 as 0 | 1
	});
	/** Hábito em edição (vazio = criando). */
	let editingHabitId = $state('');
	/** Menu do card de hábito (segurar/botão direito/⋯). */
	let habitMenu = $state<{ habit: Habit; x: number; y: number } | null>(null);
	let habitPressTimer: ReturnType<typeof setTimeout> | undefined;
	let habitPressOrigin = { x: 0, y: 0 };
	/** O clique que fecha o long-press não pode registrar/abrir o hábito. */
	let habitPressSuppress = false;
	let habitValues = $state<Record<string, string>>({});
	let habitSheet = $state<Habit | null>(null);
	let habitSheetValue = $state(0);
	let habitHistory = $state<Habit | null>(null);
	let habitLogEdit = $state<{ habit: Habit; log: HabitLog } | null>(null);
	let habitLogEditValue = $state(0);
	let dayGoalSheet = $state(false);
	let dayGoalDraft = $state(3);
	let financeGoalSheet = $state<{ open: boolean; amountMinor: number }>({ open: false, amountMinor: 0 });
	let financeCatPressTimer: ReturnType<typeof setTimeout> | undefined;
	let financeCatPressOrigin = { x: 0, y: 0 };
	let financeCatPressSuppress = false;
	/** Um toque que abriu o sheet via long press não pode fechá-lo no mesmo gesto. */
	let finOverlayDown = false;
	let habitCelebration = $state<number | null>(null);
	let effectsCanvas = $state<HTMLCanvasElement | null>(null);
	let financeEntry = $state<{ open: boolean; type: 'income' | 'expense'; categoryId: string; amountMinor: number; description: string }>({ open: false, type: 'expense', categoryId: '', amountMinor: 0, description: '' });
	let financeCategoryForm = $state<{ open: boolean; id: string | null; type: 'income' | 'expense'; name: string; color: string; limitMinor: number; limitMode: CategoryLimitMode; back: boolean }>({ open: false, id: null, type: 'expense', name: '', color: '#9cc8ff', limitMinor: 50000, limitMode: 'limit', back: false });
	/** Categoria com lançamentos só exclui depois de 5 s de armar. */
	let financeDeleteArm = $state<'idle' | 'arming' | 'armed'>('idle');
	let financeDeleteTimer: ReturnType<typeof setTimeout> | undefined;
	let financeCategoryLinkedCount = $derived(
		financeCategoryForm.id
			? (snapshot?.transactions.filter((item) => item.categoryId === financeCategoryForm.id).length ?? 0)
			: 0
	);
	onDestroy(() => clearTimeout(financeDeleteTimer));
	let financeCelebration = $state<number | null>(null);
	let timeSelected = $state('deep-work');
	let timeScroll = $state<HTMLElement | null>(null);
	let timeWeekBarsEl = $state<HTMLElement | null>(null);
	let timeColumnWidth = $state(100);
	let timeVisibleCount = $state(7);
	let timeVisibleStart = $state(0);
	/** Enquanto false, a grade recentraliza hoje se o container mudar de largura. */
	let timeUserAdjusted = false;
	let timePainting = false;
	let timePaintMode: 'add' | 'del' = 'add';
	let timePaintSeen = new Set<string>();
	let timePaintCount = { add: 0, del: 0 };
	let timePaintSnapshot = '';
	let timePaintLastCell: [number, number] | null = null;
	let timeTouch: {
		x: number;
		y: number;
		cell: { day: number; slot: number };
		armed: boolean;
		painting: boolean;
		navigating: boolean;
	} | null = null;
	let timeTouchArmTimer: ReturnType<typeof setTimeout> | undefined;
	let timeTouchDialogTimer: ReturnType<typeof setTimeout> | undefined;
	let timeCategorySheet = $state<{ open: boolean; id: string | null; name: string; color: string; goalHours: number }>({ open: false, id: null, name: '', color: '#9cc8ff', goalHours: 0 });
	let timeSummaryOpen = $state(false);
	let timeScrollReady = false;
	let pauseForm = $state({ until: dateOffset(localDate(), 7) });
	onMount(() => {
		let interval: ReturnType<typeof setInterval> | undefined;
		const onPointerMove = (event: PointerEvent) => {
			if (event.pointerType !== 'touch') continueTimePaint(event);
		};
		const onPointerUp = (event: PointerEvent) => {
			if (event.pointerType === 'touch') return;
			void finishTimePaint();
		};
		const onClickFeedback = (event: MouseEvent) => {
			const button = (event.target as HTMLElement | null)?.closest('button');
			if (!button || button.closest('.graph-view') || button.closest('.gv-sheet') || button.closest('.nt-prototype') || button.closest('.nt-ed') || button.closest('.nt-sh') || button.matches('.tp-c, .tp-cat')) return;
			playFeedback('tap', snapshot?.preferences.soundEnabled);
			pulseHaptic(snapshot?.preferences.hapticsEnabled, 6);
		};
		const onDashOutside = (event: MouseEvent) => {
			if (!dashMenu) return;
			const target = event.target as HTMLElement | null;
			if (!target?.closest('.dash-fab, .dash-menu')) dashMenu = false;
		};
		const onResize = () => {
			if (activeTab === 'time') {
				timeLayout();
				handleTimeScroll();
			}
		};
		void initialize();
		const unlisteners: Array<() => void> = [];
		if (syncSupported()) {
			void (async () => {
				try {
					unlisteners.push(
						await onSyncApplied(async () => {
							notesReloadToken += 1;
							snapshot = await loadSnapshot();
							toastMessage(m.sync_updated());
						})
					);
					unlisteners.push(await onPairRequest((payload) => (sasPrompt = payload)));
					unlisteners.push(await onPaired(() => void refreshSync()));
				} catch {
					/* build sem sync (iOS até o P4) */
				}
			})();
		}
		try {
			sidebarCollapsed = localStorage.getItem('atlas-sidebar-collapsed') === '1';
		} catch {
			/* localStorage indisponível */
		}
		const onKeydown = (event: KeyboardEvent) => {
			const tag = (document.activeElement as HTMLElement | null)?.tagName ?? '';
			if (event.key === '[' && !/INPUT|TEXTAREA|SELECT/.test(tag)) toggleSidebar();
			if (event.key === 'Escape') closeShellMenus();
		};
		window.addEventListener('keydown', onKeydown);
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
		window.addEventListener('click', onClickFeedback);
		window.addEventListener('click', onDashOutside);
		window.addEventListener('resize', onResize);
		interval = setInterval(() => {
			currentTime = new Date();
			if (snapshot) {
				if (localDate() > snapshot.lifeForce.lastDecayDate) {
					const next = cloneSnapshot();
					advanceLifeForce(next);
					snapshot = next;
					void saveSnapshot(next);
				}
				const paused = isCurrentPause(snapshot);
				if (wasPaused && !paused) void syncIOSReminders(snapshot);
				wasPaused = paused;
				void checkDesktopReminders(snapshot);
			}
		}, 30_000);
		return () => {
			for (const off of unlisteners) off();
			if (pairTimer) clearInterval(pairTimer);
			if (interval) clearInterval(interval);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
			window.removeEventListener('click', onClickFeedback);
			window.removeEventListener('click', onDashOutside);
			window.removeEventListener('resize', onResize);
			window.removeEventListener('keydown', onKeydown);
		};
	});

	$effect(() => {
		if (activeTab !== 'time') {
			timeScrollReady = false;
			timeUserAdjusted = false;
			return;
		}
		const scroll = timeScroll;
		if (!scroll) return;
		return untrack(() => {
			if (timeScrollReady) return;
			timeScrollReady = true;
			timeUserAdjusted = false;
			timeLayout();
			const centerToday = () => {
				const column = scroll.querySelector<HTMLElement>('.tp-h')?.getBoundingClientRect().width ?? timeColumnWidth;
				const available = Math.max(0, scroll.clientWidth - 38);
				const centered = timeTodayIndex >= 0 ? timeTodayIndex * column - (available - column) / 2 : 0;
				scroll.scrollLeft = Math.max(0, centered);
				handleTimeScroll();
			};
			centerToday();
			// No primeiro frame o container pode medir mais estreito que o layout final
			// (barra lateral/transição de aba); recentraliza quando a largura estabiliza.
			const recenterTimers = [180, 480].map((delay) =>
				setTimeout(() => {
					timeLayout();
					if (!timeUserAdjusted) centerToday();
				}, delay)
			);
			const markAdjusted = () => (timeUserAdjusted = true);
			scroll.addEventListener('pointerdown', markAdjusted, { passive: true });
			scroll.addEventListener('wheel', markAdjusted, { passive: true });
			scroll.addEventListener('touchstart', markAdjusted, { passive: true });
			const observer = new ResizeObserver(() => {
				timeLayout();
				if (!timeUserAdjusted) centerToday();
			});
			observer.observe(scroll);
			const minutes = currentTime.getHours() * 60 + currentTime.getMinutes();
			const nowSlot = (minutes - TIME_SLOT_START_HOUR * 60) / TIME_SLOT_MINUTES;
			scroll.scrollTop = Math.max(0, (nowSlot - 3) * 28);
			handleTimeScroll();
			return () => {
				recenterTimers.forEach((timer) => clearTimeout(timer));
				observer.disconnect();
				scroll.removeEventListener('pointerdown', markAdjusted);
				scroll.removeEventListener('wheel', markAdjusted);
				scroll.removeEventListener('touchstart', markAdjusted);
			};
		});
	});

	/**
	 * iOS (WKWebView) trata o arrasto como scroll nativo e cancela o gesto.
	 * Enquanto um bloco está sendo pintado (após o toque longo), bloqueamos o
	 * `touchmove` para o navegador não roubar o arrasto para o scroll da grade.
	 */
	$effect(() => {
		const element = timeScroll;
		if (!element) return;
		const guard = (event: TouchEvent) => {
			if (timePainting) event.preventDefault();
		};
		element.addEventListener('touchmove', guard, { passive: false });
		return () => element.removeEventListener('touchmove', guard);
	});

	$effect(() => {
		const ratio = Math.max(0, Math.min(100, lifeForcePercent)) / 100;
		const saturation = (12 + 68 * ratio).toFixed(1);
		const lightness = (34 + 32 * ratio).toFixed(1);
		const accent = `hsl(72 ${saturation}% ${lightness}%)`;
		const soft = `hsl(72 ${saturation}% ${lightness}% / .14)`;
		const root = document.documentElement.style;
		root.setProperty('--lime', accent);
		root.setProperty('--dash-accent', accent);
		root.setProperty('--dash-accent-dim', soft);
		root.setProperty('--fp-acc', accent);
		root.setProperty('--hp-accent', accent);
		root.setProperty('--hp-accent-dim', soft);
		root.setProperty('--acc', accent);
		root.setProperty('--accd', soft);
	});

	$effect(() => {
		const request = dialog;
		const element = dialogInput;
		if (request?.kind !== 'prompt' || !element) return;
		const timer = setTimeout(() => element.focus(), 60);
		return () => clearTimeout(timer);
	});

	async function initialize() {
		testModeActive = readTestMode();
		updaterAvailable = updaterSupportedHere();
		try {
			const loaded = await loadSnapshot();
			advanceLifeForce(loaded);
			snapshot = loaded;
			ready = true;
			wasPaused = isCurrentPause(loaded);
			await saveSnapshot(loaded);
			// As notas são necessárias no planejador (referências `tempo`).
			notesState = await loadNotes();
			await syncIOSReminders(loaded);
			await initializeSync();
		} catch (error) {
			console.error(error);
			const detail = error instanceof Error ? error.message : String(error);
			loadError = `Não foi possível abrir os dados locais. (${detail})`;
			ready = true;
		}
	}

	/* ---------- sync (P5) ---------- */
	async function initializeSync() {
		if (!syncSupported() || testModeActive) {
			syncAvailable = false;
			sync = null;
			return;
		}
		try {
			sync = await syncStatus();
			syncAvailable = true;
			// Aceite do S10: ligado volta sozinho ao abrir o app.
			if (sync.enabled && !sync.running) sync = await syncStart();
		} catch {
			// iOS até o P4 (comando ausente) ou banco falhando: some a seção.
			syncAvailable = false;
		}
	}

	async function refreshSync() {
		if (!syncSupported()) return;
		try {
			sync = await syncStatus();
			syncAvailable = true;
		} catch {
			sync = null;
		}
	}

	async function startSync() {
		syncBusy = true;
		try {
			sync = await syncStart();
		} catch (error) {
			toastMessage(m.sync_error(), { warning: true });
			console.error(error);
		} finally {
			syncBusy = false;
		}
	}

	async function setSyncEnabled(enabled: boolean) {
		if (!enabled) {
			syncBusy = true;
			try {
				sync = await syncStop();
			} catch (error) {
				console.error(error);
			} finally {
				syncBusy = false;
			}
			return;
		}
		try {
			const current = await syncStatus();
			const firstSync = current.peers.every((peer) => peer.lastSyncAt === 0);
			if (firstSync && snapshot) {
				// Primeiro sync: backup automático + resumo antes de conectar.
				const bytes = await currentBackupBytes();
				const path = await writeSafetyCopy(
					bytes,
					`atlas-antes-do-sync-${Date.now()}.zip`
				).catch(() => null);
				const summary = describeBackup(
					summarizeBackup({ snapshot, notes: notesState.notes, folders: notesState.folders })
				);
				syncIntro = { summary, path };
				return;
			}
		} catch (error) {
			console.error(error);
		}
		await startSync();
	}

	async function confirmSyncIntro() {
		syncIntro = null;
		await startSync();
	}

	async function restartSyncDiscovery() {
		syncBusy = true;
		try {
			sync = await syncDiscoveryRestart();
		} catch (error) {
			toastMessage(m.sync_error(), { warning: true });
			console.error(error);
		} finally {
			syncBusy = false;
		}
	}

	/** Configurações › Avançado: toggle e intervalo do auto-sync. */
	async function updateSyncAuto(patch: { autoSync?: boolean; intervalSecs?: number }) {
		const enabled = patch.autoSync ?? sync?.autoSync ?? true;
		const intervalSecs = patch.intervalSecs ?? sync?.intervalSecs ?? 2;
		syncBusy = true;
		try {
			sync = await syncSetAuto(enabled, intervalSecs);
		} catch (error) {
			toastMessage(m.sync_error(), { warning: true });
			console.error(error);
		} finally {
			syncBusy = false;
		}
	}

	async function refreshPairDevices() {
		if (!pairOpen) return;
		try {
			pairDevices = await syncDiscovered();
		} catch (error) {
			console.error(error);
		}
	}

	async function openPairing() {
		pairDevices = [];
		pairOpen = true;
		if (pairTimer) clearInterval(pairTimer);
		await refreshPairDevices();
		pairTimer = setInterval(() => void refreshPairDevices(), 2000);
	}

	function closePairing() {
		pairOpen = false;
		if (pairTimer) {
			clearInterval(pairTimer);
			pairTimer = undefined;
		}
	}

	async function pairWith(peer: string, address?: string) {
		syncBusy = true;
		try {
			const started = await syncPairBegin(peer, address);
			const name = pairDevices.find((device) => device.endpointId === peer)?.name ?? shortId(peer);
			closePairing();
			sasPrompt = { peer, name, sas: started.sas };
		} catch (error) {
			toastMessage(String(error), { warning: true });
		} finally {
			syncBusy = false;
		}
	}

	async function confirmSas(accept: boolean) {
		const prompt = sasPrompt;
		if (!prompt) return;
		sasPrompt = null;
		syncBusy = true;
		try {
			await syncPairConfirm(prompt.peer, accept);
			if (accept) toastMessage(m.sync_paired());
		} catch (error) {
			toastMessage(String(error), { warning: true });
		} finally {
			syncBusy = false;
			await refreshSync();
		}
	}

	async function unpair(peer: SyncStatus['peers'][number]) {
		const confirmed = await askConfirm({
			title: m.sync_unpair(),
			message: m.sync_unpair_confirm({ name: peer.name }),
			confirmLabel: m.sync_unpair()
		});
		if (!confirmed) return;
		syncBusy = true;
		try {
			sync = await syncUnpair(peer.endpointId);
		} catch (error) {
			toastMessage(String(error), { warning: true });
		} finally {
			syncBusy = false;
		}
	}

	async function runSyncNow() {
		syncBusy = true;
		try {
			sync = await syncNow();
		} catch (error) {
			toastMessage(String(error), { warning: true });
		} finally {
			syncBusy = false;
		}
	}

	function weekStart(date: string): string {
		return weekStartDate(date, firstDayOfWeek());
	}

	/** Índice do dia dentro do range atual (negativo/fora = não desenhar). */
	function timeDayIndex(date: string): number {
		return Math.round(
			(new Date(`${date}T12:00:00`).getTime() - new Date(`${timeRangeStart}T12:00:00`).getTime()) / 86_400_000
		);
	}

	function allPausePeriods(data: AtlasSnapshot) {
		const periods = [...data.lifeForce.pausePeriods];
		if (data.lifeForce.pausedFrom && data.lifeForce.pausedUntil) {
			const pauseEnd = dateOffset(data.lifeForce.pausedUntil, -1);
			periods.push({ start: data.lifeForce.pausedFrom, end: pauseEnd < today ? pauseEnd : today });
		}
		return periods;
	}

	function idleDaysThrough(start: string, end: string, data: AtlasSnapshot): number {
		let days = 0;
		let cursor = dateOffset(start, 1);
		while (cursor <= end) {
			if (!isPausedOn(cursor, data)) days += 1;
			cursor = dateOffset(cursor, 1);
		}
		return days;
	}

	function isPausedOn(date: string, data: AtlasSnapshot): boolean {
		const currentPause = data.lifeForce.pausedFrom && data.lifeForce.pausedUntil && date >= data.lifeForce.pausedFrom && date < data.lifeForce.pausedUntil;
		const previousPause = data.lifeForce.pausePeriods.some((item) => date >= item.start && date <= item.end);
		return Boolean(currentPause || previousPause);
	}

	/** Primeiro dia da semana configurado (default segunda). */
	function firstDayOfWeek(data: AtlasSnapshot | null = snapshot) {
		return normalizeFirstDayOfWeek(data?.preferences.firstDayOfWeek);
	}

	/** Hábitos que contam no dia: weekly sempre, os demais pelo dia da semana. */
	function habitsForDate(data: AtlasSnapshot, date: string): Habit[] {
		const weekday = new Date(`${date}T12:00:00`).getDay();
		return data.habits.filter((habit) => habit.active && (habit.metric === 'weekly' || habit.scheduledDays.includes(weekday)));
	}

	/** Weekly fecha na semana (log no início dela); os outros fecham no dia. */
	function habitDoneOn(data: AtlasSnapshot, habit: Habit, date: string): boolean {
		if (habit.metric === 'weekly') {
			const week = weekStartDate(date, firstDayOfWeek(data));
			const log = data.habitLogs.find((item) => item.habitId === habit.id && item.date === week);
			if (!log) return false;
			// Sem `incrementDates` (logs antigos), usa o último dia incrementado.
			return Boolean(log.incrementDates?.includes(date) || log.lastIncrementDate === date);
		}
		const log = data.habitLogs.find((item) => item.habitId === habit.id && item.date === date);
		return Boolean(log && didMeetTarget(habit, log.value));
	}

	function dailyGoalOf(data: AtlasSnapshot | null): number {
		return normalizeDailyGoal(data?.dailyGoal);
	}

	function dailyProgress(data: AtlasSnapshot, date = today): { done: number; goal: number } {
		const habits = habitsForDate(data, date);
		return {
			done: habits.filter((habit) => habitDoneOn(data, habit, date)).length,
			// Meta efetiva: hábito que não incide no dia não entra na conta.
			goal: Math.min(dailyGoalOf(data), habits.length)
		};
	}

	function getHabitDayStreak(data: AtlasSnapshot | null): number {
		if (!data) return 0;
		let date = today;
		const todayHabits = habitsForDate(data, today);
		const todayProgress = dailyProgress(data, today);
		if (todayHabits.length === 0 || todayProgress.done < todayProgress.goal) date = dateOffset(today, -1);
		let streak = 0;
		for (let index = 0; index < 730; index += 1) {
			if (isPausedOn(date, data)) {
				date = dateOffset(date, -1);
				continue;
			}
			const eligible = habitsForDate(data, date);
			if (!eligible.length) {
				date = dateOffset(date, -1);
				continue;
			}
			const done = eligible.filter((habit) => habitDoneOn(data, habit, date)).length;
			const goal = Math.min(dailyGoalOf(data), eligible.length);
			if (done < goal) break;
			streak += 1;
			date = dateOffset(date, -1);
		}
		return streak;
	}

	function getDailyHabitGoal(data: AtlasSnapshot, date = today): { done: number; goal: number } {
		return dailyProgress(data, date);
	}

	function prototypeValue(habit: Habit, value: number): string {
		if (habit.metric === 'duration') return formatClock(value);
		if (habit.unit.toLowerCase() === 'ml' && value >= 1000) return `${(value / 1000).toFixed(2).replace(/\.?0+$/, '')} L`;
		return habit.metric === 'count' ? `${value} ${habit.unit}` : value ? 'Feito' : 'Hoje';
	}

	function prototypeSheetMax(habit: Habit): number {
		const values = snapshot?.habitLogs.filter((log) => log.habitId === habit.id).map((log) => log.value) ?? [];
		// "Menos é melhor" precisa aceitar o excesso para registrar o dia ruim.
		const ceiling = habit.targetDirection === 'down' ? habit.target * 2 : habit.target;
		return Math.max(ceiling, ...values, 1);
	}

	function prototypeSheetStep(habit: Habit): number {
		if (habit.metric === 'duration') return 5;
		return habit.unit.toLowerCase() === 'ml' ? 50 : 1;
	}

	function prototypePresets(habit: Habit): number[] {
		if (habit.metric === 'duration') return [15, 30, 45, 60].map((value) => Math.min(value, prototypeSheetMax(habit)));
		// Contagem: atalhos em 1/4, 1/2, 3/4 e o range completo do sheet.
		const max = prototypeSheetMax(habit);
		return [0.25, 0.5, 0.75, 1].map((ratio) => Math.max(1, Math.round(max * ratio)));
	}

	function weeklyValue(habit: Habit): number {
		const week = weekStartDate(today, firstDayOfWeek());
		return snapshot?.habitLogs.find((item) => item.habitId === habit.id && item.date === week)?.value ?? 0;
	}

	async function setWeeklyValue(habit: Habit, value: number) {
		if (!snapshot) return;
		const week = weekStartDate(today, firstDayOfWeek());
		const existing = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === week);
		const clamped = Math.max(0, Math.min(WEEK_MAX, value));
		const tile = document.querySelector<HTMLElement>(`[data-habit-id="${habit.id}"]`);
		const [x, y] = centerOf(tile);
		playTone(360 + clamped * 40, 0.07, 'sine', 0.04, snapshot.preferences.soundEnabled);
		vibrate(6);
		await saveHabitLog(habit, clamped, !existing, week, [x, y]);
	}

	function celebrate(streak: number) {
		const final = Math.max(0, streak);
		const sound = snapshot?.preferences.soundEnabled ?? true;
		habitCelebration = Math.max(0, final - 1);
		confetti(effectsCanvas, 100);
		[523, 659, 784, 1047].forEach((frequency, index) => setTimeout(() => playTone(frequency, 0.3, 'triangle', 0.07, sound), index * 110));
		vibrate([20, 40, 20, 40, 70]);
		setTimeout(() => {
			habitCelebration = final;
			if (!prefersReducedMotion()) {
				const flame = document.querySelector('.habit-prototype-celebration svg');
				flame?.animate(
					[{ transform: 'scale(1)' }, { transform: 'scale(1.5) rotate(-8deg)' }, { transform: 'scale(1)' }],
					{ duration: 650, easing: 'cubic-bezier(.3,1.6,.5,1)' }
				);
			}
			playTone(1319, 0.35, 'sine', 0.07, sound);
			vibrate(30);
		}, 950);
	}

	function resetPrototypeDay() {
		if (!snapshot) return;
		const next = cloneSnapshot();
		const week = weekStartDate(today);
		next.habitLogs = next.habitLogs.filter((item) => item.date !== today && item.date !== week);
		void commit(next);
		playFeedback('tap', snapshot.preferences.soundEnabled);
		toastMessage('Dia reiniciado.');
	}

	const FINANCE_COLORS = ['#d4f25a', '#9cc8ff', '#ffb347', '#c6a8ff', '#f1a5c5', '#7fe3c4'];

	function monthTransactionsOf(data: AtlasSnapshot | null): Transaction[] {
		if (!data) return [];
		return transactionsInMonth(data.transactions);
	}

	function categoryTotal(categoryId: string, data: AtlasSnapshot | null = snapshot): number {
		return amountForCategory(monthTransactionsOf(data), categoryId);
	}

	function shortDay(date: string): string {
		return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
	}

	function hexToRgba(hex: string, alpha: number): string {
		const value = (hex || '#888888').replace('#', '');
		const full = value.length === 3 ? value.split('').map((character) => character + character).join('') : value;
		const int = parseInt(full, 16);
		const red = (int >> 16) & 255;
		const green = (int >> 8) & 255;
		const blue = int & 255;
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}

	function restoreFinance(json: string) {
		snapshot = JSON.parse(json) as AtlasSnapshot;
		void saveSnapshot(snapshot);
	}

	function openFinanceEntry(type: 'income' | 'expense' = 'expense', categoryId = '') {
		const categories = financeCategories.filter((item) => (type === 'income' ? item.kind === 'in' : item.kind !== 'in'));
		financeEntry = { open: true, type, categoryId: categoryId || categories[0]?.id || '', amountMinor: 0, description: '' };
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function setFinanceEntryType(type: 'income' | 'expense') {
		const categories = financeCategories.filter((item) => (type === 'income' ? item.kind === 'in' : item.kind !== 'in'));
		financeEntry = { ...financeEntry, type, categoryId: categories[0]?.id || '' };
		playTone(420, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function setFinanceEntryCategory(categoryId: string) {
		financeEntry = { ...financeEntry, categoryId };
		playTone(520, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled, 5);
	}

	function financeKey(key: string) {
		if (!financeEntry.open) return;
		const previous = financeEntry.amountMinor;
		financeEntry = {
			...financeEntry,
			amountMinor: key === '⌫' ? Math.floor(previous / 10) : Math.min(99999999, previous * (key === '00' ? 100 : 10) + (key === '00' ? 0 : Number(key)))
		};
		playTone(key === '⌫' ? 220 : 300 + (Number(key) || 0) * 34, 0.05, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled, 4);
	}

	async function addFinanceTransaction() {
		if (!snapshot || !financeEntry.amountMinor) return;
		const category = snapshot.categories.find((item) => item.id === financeEntry.categoryId);
		if (!category) return;
		const kind: 'income' | 'expense' = category.kind === 'in' ? 'income' : 'expense';
		const sound = snapshot.preferences.soundEnabled;
		const previousStreak = snapshot.finance.streak;
		const beforeBalance = financeBalance;
		const previousSpent = categoryTotal(category.id);
		const undoJson = JSON.stringify(snapshot);
		const amount = financeEntry.amountMinor;
		const next = cloneSnapshot();
		next.transactions.unshift({
			id: id(), type: kind, amountMinor: amount, categoryId: category.id,
			date: today, description: financeEntry.description.trim() || category.name
		});
		if (next.finance.lastEntryDate !== today) {
			next.finance.streak = next.finance.lastEntryDate === dateOffset(today, -1) ? next.finance.streak + 1 : 1;
			next.finance.lastEntryDate = today;
		}
		const tile = document.querySelector<HTMLElement>(`[data-fin-cat="${category.id}"]`);
		const [x, y] = centerOf(document.querySelector('.fin-fab'));
		financeEntry = { open: false, type: 'expense', categoryId: '', amountMinor: 0, description: '' };
		await commit(next, true, true);
		if (tile) popElement(tile);
		if (kind === 'income') {
			burstAt(x, y, 18, { up: true, color: 'var(--gold)' });
			floatValue(x, y - 40, `+${money(amount, currency())}`, 'var(--gold)');
			playTone(1175, 0.12, 'triangle', 0.06, sound);
			setTimeout(() => playTone(1568, 0.2, 'triangle', 0.06, sound), 90);
			vibrate([10, 30, 10]);
		} else {
			burstAt(x, y, 10, { up: true, color: '#8d968a' });
			playTone(200, 0.16, 'sine', 0.07, sound);
			vibrate(14);
		}
		const limit = category.limitMinor ?? 0;
		const beforeStatus = categoryLimitStatus(category, previousSpent);
		const afterStatus = categoryLimitStatus(category, categoryTotal(category.id));
		const streakNow = snapshot?.finance.streak ?? previousStreak;
		const streakMessage = `Sequência de ${streakNow} dias`;
		if (kind === 'expense' && limit > 0 && category.limitMode === 'goal') {
			if (!beforeStatus.reached && afterStatus.reached) {
				const beyond = afterStatus.percentBeyond > 0 ? ` · +${afterStatus.percentBeyond}% além da meta` : '';
				setTimeout(() => toastMessage(`${category.name} bateu a meta${beyond}`), 500);
				burstAt(x, y, 18, { up: true, color: category.color });
				playTone(784, 0.18, 'triangle', 0.06, sound);
				setTimeout(() => playTone(1047, 0.24, 'triangle', 0.06, sound), 90);
				vibrate([10, 30, 10]);
			} else if (streakNow > previousStreak) {
				setTimeout(() => toastMessage(streakMessage), 500);
			}
		} else if (kind === 'expense' && limit > 0) {
			if (beforeStatus.ratio <= 1 && afterStatus.ratio > 1) {
				setTimeout(() => toastMessage(`${category.name} passou do limite`, { warning: true, undo: () => restoreFinance(undoJson) }), 500);
				playTone(330, 0.25, 'triangle', 0.05, sound);
			} else if (beforeStatus.ratio < 0.8 && afterStatus.ratio >= 0.8) {
				setTimeout(() => toastMessage(`${category.name} em ${Math.round(afterStatus.ratio * 100)}% do limite`, { warning: true }), 500);
			} else if (streakNow > previousStreak) {
				setTimeout(() => toastMessage(streakMessage), 500);
			}
		} else if (streakNow > previousStreak) {
			setTimeout(() => toastMessage(streakMessage), 500);
		}
		if (snapshot && !snapshot.finance.goalHit && financeGoal > 0 && beforeBalance < financeGoal && financeBalance >= financeGoal) {
			const flagged = cloneSnapshot();
			flagged.finance.goalHit = true;
			await commit(flagged);
			setTimeout(celebrateFinance, 800);
		}
	}

	async function removeFinanceTransaction(transactionId: string) {
		if (!snapshot) return;
		const transaction = snapshot.transactions.find((item) => item.id === transactionId);
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.transactions = next.transactions.filter((item) => item.id !== transactionId);
		await commit(next);
		const trash = transaction
			? await recordTrash({
					module: 'finance',
					kind: 'transaction',
					entityId: transaction.id,
					label: transaction.description.trim() || categoryName(transaction.categoryId),
					tables: transactionTables([transaction])
				})
			: null;
		playTone(200, 0.12, 'sine', 0.05, snapshot.preferences.soundEnabled);
		vibrate(8);
		toastMessage('Lançamento removido', {
			undo: () => {
				forgetQuietly(trash);
				restoreFinance(undoJson);
			}
		});
	}

	async function clearFinanceTransactions() {
		if (!snapshot || !testModeActive) return;
		const transactions = [...snapshot.transactions];
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.transactions = [];
		await commit(next);
		const trash = transactions.length
			? await recordTrash({
					module: 'finance',
					kind: 'transaction',
					entityId: `clear:${Date.now()}`,
					label: `${transactions.length} lançamento${transactions.length === 1 ? '' : 's'}`,
					tables: transactionTables(transactions)
				})
			: null;
		toastMessage('Lançamentos removidos', {
			warning: true,
			undo: () => {
				forgetQuietly(trash);
				restoreFinance(undoJson);
			}
		});
	}

	function openFinanceCategory(back: boolean) {
		financeEntry = { ...financeEntry, open: false };
		resetFinanceDeleteArm();
		financeCategoryForm = { open: true, id: null, type: back ? financeEntry.type : 'expense', name: '', color: FINANCE_COLORS[1], limitMinor: 50000, limitMode: 'limit', back };
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	/**
	 * Backdrop dos sheets de Finanças. O clique só fecha se o gesto começou no
	 * próprio backdrop — assim o `click` sintetizado no fim de um long press que
	 * abriu o sheet não o fecha imediatamente.
	 */
	function onFinOverlayPointerDown(event: PointerEvent) {
		finOverlayDown = event.target === event.currentTarget;
	}

	function onFinOverlayClick(event: MouseEvent, close: () => void) {
		if (finOverlayDown && event.target === event.currentTarget) close();
		finOverlayDown = false;
	}

	/** Long press (mobile) / clique direito (desktop) no tile de categoria. */
	function openFinanceCategoryEdit(category: Category) {
		resetFinanceDeleteArm();
		financeCategoryForm = {
			open: true,
			id: category.id,
			type: category.kind === 'in' ? 'income' : 'expense',
			name: category.name,
			color: category.color,
			limitMinor: category.limitMinor ?? 50000,
			limitMode: category.limitMode === 'goal' ? 'goal' : 'limit',
			back: false
		};
		financeCatPressSuppress = true;
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 12);
	}

	function startFinanceCatPress(event: PointerEvent, category: Category) {
		if (event.button !== 0 || event.pointerType === 'mouse') return;
		financeCatPressSuppress = false;
		financeCatPressOrigin = { x: event.clientX, y: event.clientY };
		clearTimeout(financeCatPressTimer);
		financeCatPressTimer = setTimeout(() => openFinanceCategoryEdit(category), 460);
	}

	function moveFinanceCatPress(event: PointerEvent) {
		if (!financeCatPressTimer) return;
		if (Math.hypot(event.clientX - financeCatPressOrigin.x, event.clientY - financeCatPressOrigin.y) > 9) {
			clearTimeout(financeCatPressTimer);
			financeCatPressTimer = undefined;
		}
	}

	function cancelFinanceCatPress() {
		clearTimeout(financeCatPressTimer);
		financeCatPressTimer = undefined;
	}

	function openFinanceCategoryContext(event: MouseEvent, category: Category) {
		event.preventDefault();
		openFinanceCategoryEdit(category);
	}

	function setFinanceCategoryType(type: 'income' | 'expense') {
		financeCategoryForm = { ...financeCategoryForm, type };
		playTone(420, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function closeFinanceCategoryForm() {
		resetFinanceDeleteArm();
		financeCategoryForm = { ...financeCategoryForm, open: false };
	}

	function resetFinanceDeleteArm() {
		clearTimeout(financeDeleteTimer);
		financeDeleteTimer = undefined;
		financeDeleteArm = 'idle';
	}

	/**
	 * Categoria com lançamentos exige 5 s de armar antes do segundo toque: o
	 * outline preenche no tempo e o gesto não apaga histórico por engano.
	 */
	function armFinanceCategoryDelete() {
		if (financeDeleteArm === 'armed') {
			void deleteFinanceCategory();
			return;
		}
		if (financeDeleteArm === 'arming') return;
		if (financeCategoryLinkedCount === 0) {
			void deleteFinanceCategory();
			return;
		}
		const sound = snapshot?.preferences.soundEnabled ?? true;
		financeDeleteArm = 'arming';
		playTone(300, 0.1, 'sine', 0.05, sound);
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 8);
		financeDeleteTimer = setTimeout(() => {
			financeDeleteTimer = undefined;
			financeDeleteArm = 'armed';
			playTone(520, 0.1, 'triangle', 0.05, sound);
			pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 12);
		}, 5000);
	}

	async function deleteFinanceCategory() {
		if (!snapshot || !financeCategoryForm.id) return;
		const target = financeCategoryForm.id;
		const category = snapshot.categories.find((item) => item.id === target);
		if (!category) return;
		const transactions = snapshot.transactions.filter((item) => item.categoryId === target);
		const undoJson = JSON.stringify(snapshot);
		const sound = snapshot.preferences.soundEnabled;
		const next = cloneSnapshot();
		next.categories = next.categories.filter((item) => item.id !== target);
		next.transactions = next.transactions.filter((item) => item.categoryId !== target);
		closeFinanceCategoryForm();
		await commit(next);
		const trash = await recordTrash({
			module: 'finance',
			kind: 'category',
			entityId: category.id,
			label: category.name,
			tables: financeCategoryTables(category, transactions)
		});
		playTone(200, 0.14, 'sine', 0.05, sound);
		vibrate(10);
		toastMessage(
			transactions.length
				? `Categoria e ${transactions.length} lançamento${transactions.length === 1 ? '' : 's'} excluídos.`
				: 'Categoria excluída.',
			{
				undo: () => {
					forgetQuietly(trash);
					restoreFinance(undoJson);
				}
			}
		);
	}

	function setFinanceLimitMode(limitMode: CategoryLimitMode) {
		financeCategoryForm = { ...financeCategoryForm, limitMode };
		playTone(limitMode === 'goal' ? 660 : 420, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function setFinanceLimit(minor: number) {
		financeCategoryForm = { ...financeCategoryForm, limitMinor: minor };
		playTone(520, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function moneyInput(minor: number): string {
		return (minor / 100).toFixed(2).replace('.', ',');
	}

	function handleFinanceLimitInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const text = input.value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
		const reais = Number(text);
		if (!Number.isFinite(reais) || reais < 0) {
			input.value = moneyInput(financeCategoryForm.limitMinor);
			return;
		}
		setFinanceLimit(Math.round(reais * 100));
		input.value = moneyInput(Math.round(reais * 100));
	}

	async function createFinanceCategory() {
		if (!snapshot) return;
		const name = financeCategoryForm.name.trim();
		if (!name) return;
		const next = cloneSnapshot();
		const editingId = financeCategoryForm.id;
		const isIncome = financeCategoryForm.type === 'income';
		let createdId: string | null = null;
		if (editingId) {
			const found = next.categories.find((item) => item.id === editingId);
			if (found) {
				found.name = name;
				found.color = financeCategoryForm.color;
				found.kind = isIncome ? 'in' : 'out';
				found.limitMinor = isIncome ? undefined : financeCategoryForm.limitMinor;
				found.limitMode = isIncome ? undefined : financeCategoryForm.limitMode;
			}
		} else {
			const newId = id();
			createdId = newId;
			next.categories.push({
				id: newId, module: 'finance', name, color: financeCategoryForm.color, custom: true,
				kind: isIncome ? 'in' : 'out',
				limitMinor: isIncome ? undefined : financeCategoryForm.limitMinor,
				limitMode: isIncome ? undefined : financeCategoryForm.limitMode
			});
			if (financeCategoryForm.back) financeEntry = { ...financeEntry, open: true, type: isIncome ? 'income' : 'expense', categoryId: newId };
		}
		const targetId = editingId ?? createdId ?? '';
		const sound = snapshot.preferences.soundEnabled;
		resetFinanceDeleteArm();
		financeCategoryForm = { ...financeCategoryForm, open: false, id: null, name: '', back: false };
		await commit(next);
		if (editingId) {
			toastMessage('Categoria atualizada.');
			playTone(660, 0.12, 'triangle', 0.06, sound);
			return;
		}
		const tile = document.querySelector<HTMLElement>(`[data-fin-cat="${targetId}"]`);
		if (tile) popElement(tile);
		burstAt(window.innerWidth / 2, window.innerHeight * 0.45, 16, { color: financeCategoryForm.color });
		playTone(660, 0.15, 'triangle', 0.06, sound);
		setTimeout(() => playTone(880, 0.18, 'triangle', 0.06, sound), 90);
		vibrate([10, 30, 10]);
	}

	function celebrateFinance() {
		const sound = snapshot?.preferences.soundEnabled ?? true;
		financeCelebration = financeBalance;
		confetti(effectsCanvas, 150, { colors: ['#ffd45a', '#d4f25a', '#ffb347', '#fff3b0'], fromTop: true });
		[523, 659, 784, 1047, 1319].forEach((frequency, index) => setTimeout(() => playTone(frequency, 0.3, 'triangle', 0.07, sound), index * 100));
		vibrate([20, 40, 20, 40, 70]);
	}

	function openDayGoal() {
		if (!snapshot) return;
		dayGoalDraft = normalizeDailyGoal(snapshot.dailyGoal);
		dayGoalSheet = true;
	}

	function setDayGoalDraft(value: number) {
		dayGoalDraft = normalizeDailyGoal(value);
		playTone(320 + dayGoalDraft * 36, 0.05, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 4);
	}

	async function saveDayGoal() {
		if (!snapshot) return;
		const next = cloneSnapshot();
		next.dailyGoal = normalizeDailyGoal(dayGoalDraft);
		dayGoalSheet = false;
		await commit(next);
		toastMessage(`Meta do dia: ${next.dailyGoal} hábito${next.dailyGoal === 1 ? '' : 's'}`);
	}

	function openFinanceGoal() {
		if (!snapshot) return;
		financeGoalSheet = { open: true, amountMinor: snapshot.finance.savingsGoalMinor };
	}

	function financeGoalKey(key: string) {
		if (!financeGoalSheet.open) return;
		const previous = financeGoalSheet.amountMinor;
		const amountMinor =
			key === '⌫'
				? Math.floor(previous / 10)
				: Math.min(99999999, previous * (key === '00' ? 100 : 10) + (key === '00' ? 0 : Number(key)));
		financeGoalSheet = { ...financeGoalSheet, amountMinor };
		playTone(key === '⌫' ? 220 : 300 + (Number(key) || 0) * 34, 0.05, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 4);
	}

	function setFinanceGoalPreset(minor: number) {
		financeGoalSheet = { ...financeGoalSheet, amountMinor: minor };
		playTone(520, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 5);
	}

	async function saveFinanceGoal() {
		if (!snapshot) return;
		const next = cloneSnapshot();
		next.finance = {
			...next.finance,
			savingsGoalMinor: financeGoalSheet.amountMinor,
			// Meta nova recomeça a celebração da meta batida.
			goalHit: false
		};
		financeGoalSheet = { open: false, amountMinor: 0 };
		await commit(next);
		toastMessage('Meta de economia atualizada.');
	}

	function openHabitHistory(habit: Habit) {
		habitMenu = null;
		habitHistory = habit;
		playTone(520, 0.06, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 8);
	}

	function openHabitLogEdit(habit: Habit, log: HabitLog) {
		habitLogEdit = { habit, log };
		habitLogEditValue = log.value;
	}

	async function saveHabitLogEdit() {
		if (!habitLogEdit) return;
		const { habit, log } = habitLogEdit;
		habitLogEdit = null;
		// Histórico não concede XP de novo nem dispara celebração de hoje.
		await saveHabitLog(habit, habitLogEditValue, false, log.date, undefined, false);
	}

	async function deleteHabitLogEdit() {
		if (!habitLogEdit || !snapshot) return;
		const { habit, log } = habitLogEdit;
		const ok = await askConfirm({
			title: 'Excluir registro',
			message: `Excluir o registro de ${log.date}?`,
			confirmLabel: 'Excluir',
			danger: true
		});
		if (!ok) return;
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.habitLogs = next.habitLogs.filter((item) => item.id !== log.id);
		if (log.experienceAwarded) next.experience.totalXp = Math.max(0, next.experience.totalXp - 10);
		habitLogEdit = null;
		await commit(next);
		const trash = await recordTrash({
			module: 'habits',
			kind: 'habitLog',
			entityId: log.id,
			label: `${habit.name} · ${log.date}`,
			tables: habitLogTables([log])
		});
		toastMessage('Registro excluído.', {
			undo: () => {
				forgetQuietly(trash);
				restoreSnapshotJson(undoJson);
			}
		});
	}

	function openHabitSheet(habit: Habit) {
		const current = snapshot?.habitLogs.find((item) => item.habitId === habit.id && item.date === today)?.value ?? 0;
		habitSheet = habit;
		habitSheetValue = current;
		playFeedback('tap', snapshot?.preferences.soundEnabled);
		pulseHaptic(snapshot?.preferences.hapticsEnabled, 8);
	}

	function updateHabitSheetValue(value: number) {
		if (!habitSheet) return;
		const previous = habitSheetValue;
		habitSheetValue = Math.max(0, value);
		if (previous !== habitSheetValue) {
			playFeedback('paint', snapshot?.preferences.soundEnabled, habitSheetValue);
			pulseHaptic(snapshot?.preferences.hapticsEnabled, 3);
		}
	}

	async function saveHabitSheet() {
		if (!habitSheet || !snapshot) return;
		const existing = snapshot.habitLogs.find((item) => item.habitId === habitSheet?.id && item.date === today);
		const habit = habitSheet;
		habitSheet = null;
		await saveHabitLog(habit, habitSheetValue, !existing);
	}

	function advanceLifeForce(data: AtlasSnapshot) {
		const force = data.lifeForce;
		const currentDay = localDate();
		if (force.pausedFrom && force.pausedUntil && currentDay >= force.pausedUntil) {
			force.pausePeriods.push({ start: force.pausedFrom, end: dateOffset(force.pausedUntil, -1) });
			force.pausedFrom = null;
			force.pausedUntil = null;
		}
		let cursor = force.lastDecayDate || localDate(new Date(force.lastMeaningfulAt));
		while (cursor < currentDay) {
			cursor = dateOffset(cursor, 1);
			if (isPausedOn(cursor, data)) {
				force.lastDecayDate = cursor;
				continue;
			}
			const idleDays = idleDaysThrough(localDate(new Date(force.lastMeaningfulAt)), cursor, data);
			if (idleDays === 3 && force.value > 30) force.value = 30;
			else if (idleDays > 3) force.value = Math.max(0, force.value - 5);
			force.lastDecayDate = cursor;
		}
	}

	/** Teclado do pad de lançamento (dígitos caem direto no valor). */
	function onShellKeydown(event: KeyboardEvent) {
		if (!financeEntry.open) return;
		if (/^[0-9]$/.test(event.key)) {
			event.preventDefault();
			financeKey(event.key);
			return;
		}
		if (event.key === 'Backspace') {
			event.preventDefault();
			financeKey('⌫');
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			void addFinanceTransaction();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			financeEntry = { ...financeEntry, open: false };
		}
	}

	/** Teclado do lançamento: dígitos caem no Valor quando o foco não está num campo. */
	$effect(() => {
		if (modal !== 'transaction') return;
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const active = document.activeElement as HTMLElement | null;
			const inField = Boolean(
				active &&
					(active.tagName === 'INPUT' ||
						active.tagName === 'TEXTAREA' ||
						active.tagName === 'SELECT' ||
						active.isContentEditable)
			);
			if (inField) return;
			if (/^[0-9]$/.test(event.key) || event.key === ',' || event.key === '.') {
				event.preventDefault();
				transactionForm.amount = `${transactionForm.amount}${event.key}`;
				amountInput?.focus();
				return;
			}
			if (event.key === 'Backspace') {
				event.preventDefault();
				transactionForm.amount = transactionForm.amount.slice(0, -1);
				amountInput?.focus();
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				document.querySelector<HTMLFormElement>('.sheet-form')?.requestSubmit();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function cloneSnapshot(): AtlasSnapshot {
		return JSON.parse(JSON.stringify(snapshot)) as AtlasSnapshot;
	}

	async function commit(next: AtlasSnapshot, meaningful = false, created: boolean | number = false) {
		const beforeSources = new Map((snapshot?.graph.edges ?? []).map((edge) => [edge.id, edge.source]));
		next.graph = reconcileGraph(next.graph, next);
		const orphaned = next.graph.edges.some(
			(edge) => edge.source === 'manual' && beforeSources.get(edge.id) !== undefined && beforeSources.get(edge.id) !== 'manual'
		);
		if (meaningful && !isCurrentPause(next)) {
			advanceLifeForce(next);
			const points = typeof created === 'number' ? created : created ? 1 : 0;
			if (points) next.lifeForce.value = Math.min(100, next.lifeForce.value + points);
			next.lifeForce.lastMeaningfulAt = new Date().toISOString();
			next.lifeForce.lastDecayDate = localDate();
		}
		try {
			await saveSnapshot(next);
			snapshot = next;
			if (orphaned) toastMessage('Fonte removida no módulo: a transição virou manual.');
		} catch (error) {
			console.error(error);
			toastMessage('Não foi possível salvar no dispositivo. Tente novamente.');
			throw error;
		}
	}

	function isCurrentPause(data: AtlasSnapshot): boolean {
		return Boolean(data.lifeForce.pausedFrom && data.lifeForce.pausedUntil && localDate() >= data.lifeForce.pausedFrom && localDate() < data.lifeForce.pausedUntil);
	}

	async function commitGraph(next: GraphState) {
		if (!snapshot) return;
		const previous = snapshot.graph;
		const copy = cloneSnapshot();
		copy.graph = next;
		await commit(copy);

		const removedNodes = previous.nodes.filter((node) => !next.nodes.some((item) => item.id === node.id));
		const removedEdges = previous.edges.filter((edge) => !next.edges.some((item) => item.id === edge.id));
		for (const node of removedNodes) {
			await recordTrash({
				module: 'graph',
				kind: 'graphNode',
				entityId: node.id,
				label: node.name,
				tables: graphNodeTables(
					node,
					previous.edges.filter((edge) => edge.from === node.id || edge.to === node.id)
				)
			});
		}
		for (const edge of removedEdges) {
			if (removedNodes.some((node) => node.id === edge.from || node.id === edge.to)) continue;
			await recordTrash({
				module: 'graph',
				kind: 'graphEdge',
				entityId: edge.id,
				label: edge.label,
				tables: graphEdgeTables([edge])
			});
		}

		// Undo do grafo (ou sync) pode trazer um item de volta: ele não deve
		// continuar na lixeira.
		const restoredIds = new Set([
			...next.nodes.filter((node) => !previous.nodes.some((item) => item.id === node.id)).map((node) => node.id),
			...next.edges.filter((edge) => !previous.edges.some((item) => item.id === edge.id)).map((edge) => edge.id)
		]);
		if (restoredIds.size) {
			const events = await loadTrashEvents();
			for (const event of events) {
				if (event.module === 'graph' && restoredIds.has(event.entityId)) await forgetTrashEvent(event.id);
			}
			trashEvents = trashEvents.filter((event) => !(event.module === 'graph' && restoredIds.has(event.entityId)));
		}
	}

	function graphToast(message: string, undo?: () => void) {
		toastMessage(message, undo ? { undo } : {});
	}

	/** Primeira nota criada no dia soma 1 ponto de Life Force, uma vez por dia. */
	async function onNoteCreated(_note: Note) {
		if (!snapshot || snapshot.lifeForce.lastNoteDate === today || isCurrentPause(snapshot)) return;
		const next = cloneSnapshot();
		advanceLifeForce(next);
		next.lifeForce.value = Math.min(100, next.lifeForce.value + 1);
		next.lifeForce.lastNoteDate = today;
		next.lifeForce.lastMeaningfulAt = new Date().toISOString();
		next.lifeForce.lastDecayDate = localDate();
		await commit(next);
	}

	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function toastMessage(message: string, options: { warning?: boolean; undo?: () => void } = {}) {
		toast = message;
		toastWarning = Boolean(options.warning);
		toastUndo = options.undo ?? null;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast = '';
			toastUndo = null;
		}, options.undo ? 5000 : 2800);
	}

	/* ---------- lixeira global ---------- */
	async function recordTrash(input: TrashEventInput): Promise<TrashEvent | null> {
		try {
			const event = await recordTrashEvent(input);
			trashEvents = [event, ...trashEvents];
			return event;
		} catch (error) {
			// A exclusão em si não pode falhar por causa do índice da lixeira.
			console.error('Não foi possível registrar a exclusão na lixeira', error);
			return null;
		}
	}

	function forgetQuietly(event: TrashEvent | null): void {
		if (!event) return;
		void forgetTrashEvent(event.id)
			.then(() => {
				trashEvents = trashEvents.filter((item) => item.id !== event.id);
			})
			.catch((error) => console.error(error));
	}

	async function openTrash() {
		closeShellMenus();
		try {
			trashEvents = await loadTrashEvents();
			trashOpen = true;
		} catch (error) {
			console.error(error);
			toastMessage('Não foi possível abrir a lixeira.', { warning: true });
		}
	}

	async function restoreFromTrash(event: TrashEvent) {
		try {
			const restored = await restoreTrashEvent(event.id);
			if (!restored) {
				toastMessage('Este item não está mais na lixeira.', { warning: true });
				trashEvents = await loadTrashEvents();
				return;
			}
			snapshot = await loadSnapshot();
			trashEvents = await loadTrashEvents();
			toastMessage(`${event.label} restaurado.`);
		} catch (error) {
			console.error(error);
			toastMessage('Não foi possível restaurar.', { warning: true });
		}
	}

	async function forgetFromTrash(event: TrashEvent) {
		try {
			await forgetTrashEvent(event.id);
			trashEvents = trashEvents.filter((item) => item.id !== event.id);
			toastMessage('Item removido da lixeira.');
		} catch (error) {
			console.error(error);
			toastMessage('Não foi possível remover.', { warning: true });
		}
	}

	function editTransaction(transaction: Transaction) {
		formError = '';
		editingTransactionId = transaction.id;
		transactionForm = {
			type: transaction.type,
			amount: (transaction.amountMinor / 100).toFixed(2).replace('.', ','),
			categoryId: transaction.categoryId,
			date: transaction.date,
			description: transaction.description
		};
		modal = 'transaction';
	}

	async function saveTransaction(event: SubmitEvent) {
		event.preventDefault();
		if (!snapshot) return;
		const amount = Number(transactionForm.amount.replace(',', '.'));
		if (!Number.isFinite(amount) || amount <= 0 || !transactionForm.categoryId) {
			formError = 'Informe um valor e uma categoria válidos.';
			return;
		}
		const next = cloneSnapshot();
		const transaction: Transaction = {
			id: editingTransactionId || id(),
			type: transactionForm.type,
			amountMinor: Math.round(amount * 100),
			categoryId: transactionForm.categoryId,
			date: transactionForm.date,
			description: transactionForm.description.trim() || 'Sem descrição'
		};
		const existingIndex = next.transactions.findIndex((item) => item.id === editingTransactionId);
		if (existingIndex >= 0) next.transactions[existingIndex] = transaction;
		else next.transactions.unshift(transaction);
		await commit(next, true, existingIndex < 0);
		modal = null;
		editingTransactionId = '';
		toastMessage(existingIndex >= 0 ? 'Lançamento atualizado.' : 'Lançamento salvo.');
	}

	function openHabit(habit?: Habit) {
		formError = '';
		editingHabitId = habit?.id ?? '';
		habitForm = habit
			? {
					name: habit.name,
					metric: habit.metric,
					unit: habit.unit,
					target: String(habit.target),
					scheduledDays: [...habit.scheduledDays],
					reminder: habit.reminder ?? '',
					targetDirection: habit.targetDirection ?? 'up',
					positiveLabel: habit.positiveLabel?.trim() || HABIT_BOOLEAN_LABELS.positive,
					negativeLabel: habit.negativeLabel?.trim() || HABIT_BOOLEAN_LABELS.negative,
					positiveValue: positiveValueOf(habit)
				}
			: {
					name: '',
					metric: 'boolean',
					unit: '',
					target: '1',
					scheduledDays: [1, 2, 3, 4, 5],
					reminder: '',
					targetDirection: 'up',
					positiveLabel: HABIT_BOOLEAN_LABELS.positive,
					negativeLabel: HABIT_BOOLEAN_LABELS.negative,
					positiveValue: 1
				};
		modal = 'habit';
	}

	/** Abre o menu do card de hábito (segurar no toque / botão direito / ⋯). */
	function openHabitMenu(habit: Habit, x: number, y: number) {
		habitMenu = { habit, x: Math.min(x, window.innerWidth - 200), y: Math.min(y, window.innerHeight - 210) };
	}

	function startHabitPress(event: PointerEvent, habit: Habit) {
		if (event.button !== 0 || event.pointerType === 'mouse') return;
		if ((event.target as HTMLElement | null)?.closest('.habit-prototype-pip')) return;
		habitPressSuppress = false;
		habitPressOrigin = { x: event.clientX, y: event.clientY };
		clearTimeout(habitPressTimer);
		habitPressTimer = setTimeout(() => {
			habitPressSuppress = true;
			openHabitMenu(habit, event.clientX, event.clientY);
		}, 460);
	}

	function cancelHabitPress() {
		clearTimeout(habitPressTimer);
	}

	/* ---------- pager Hábitos ↔ Trackers (scroll nativo) ---------- */
	function changeHabitView(next: 'habits' | 'trackers') {
		habitView = next;
		if (!habitPagerEl) return;
		habitScrollSide = next === 'trackers' ? 1 : 0;
		habitPagerEl.scrollTo({
			left: habitScrollSide * habitPagerEl.clientWidth,
			behavior: prefersReducedMotion() ? 'auto' : 'smooth'
		});
	}

	function finishHabitScroll() {
		clearTimeout(habitScrollTimer);
		if (!habitPagerEl) return;
		const width = habitPagerEl.clientWidth;
		if (!width) return;
		const next = Math.round(habitPagerEl.scrollLeft / width) >= 1 ? 'trackers' : 'habits';
		if (next !== habitView) habitView = next;
	}

	function onHabitScroll() {
		if (!habitPagerEl) return;
		const width = habitPagerEl.clientWidth;
		if (!width) return;
		const side = Math.round(habitPagerEl.scrollLeft / width) >= 1 ? 1 : 0;
		if (side !== habitScrollSide) {
			habitScrollSide = side;
			pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 4);
		}
		// Só troca o painel ativo quando o snap nativo assenta; trocar no meio do
		// gesto fazia o efeito abaixo puxar o scroll e dar a sensação de jitter.
		clearTimeout(habitScrollTimer);
		habitScrollTimer = setTimeout(finishHabitScroll, 140);
	}

	/** `scrollend` acelera o fim; o debounce acima é o fallback. */
	function scrollEnd(node: HTMLElement) {
		const handler = () => finishHabitScroll();
		node.addEventListener('scrollend', handler);
		return {
			destroy() {
				node.removeEventListener('scrollend', handler);
				clearTimeout(habitScrollTimer);
			}
		};
	}

	// Alinha só quando o pager nasce (troca de aba/reload). Não depende de
	// `habitView` no gesto, então o swipe termina no snap nativo.
	$effect(() => {
		const pager = habitPagerEl;
		if (!pager || pager === habitPagerMounted) return;
		habitPagerMounted = pager;
		untrack(() => {
			const side = habitView === 'trackers' ? 1 : 0;
			habitScrollSide = side;
			if (Math.abs(pager.scrollLeft - side * pager.clientWidth) > 4) pager.scrollLeft = side * pager.clientWidth;
		});
	});

	async function deleteHabit(habit: Habit) {
		if (!snapshot) return;
		const beforeHabits = snapshot.habits.map((item) => ({ ...item }));
		const beforeLogs = snapshot.habitLogs.filter((item) => item.habitId === habit.id).map((item) => ({ ...item }));
		const next = cloneSnapshot();
		next.habits = next.habits.filter((item) => item.id !== habit.id);
		next.habitLogs = next.habitLogs.filter((item) => item.habitId !== habit.id);
		await commit(next);
		const trash = await recordTrash({
			module: 'habits',
			kind: 'habit',
			entityId: habit.id,
			label: habit.name,
			tables: habitTables([habit], beforeLogs)
		});
		toastMessage(`Hábito "${habit.name}" excluído.`, {
			undo: () => {
				forgetQuietly(trash);
				const copy = cloneSnapshot();
				copy.habits = beforeHabits;
				copy.habitLogs = beforeLogs;
				void commit(copy);
			}
		});
	}

	async function archiveHabit(habit: Habit, active: boolean) {
		if (!snapshot) return;
		const before = snapshot.habits.map((item) => ({ ...item }));
		const next = cloneSnapshot();
		next.habits = next.habits.map((item) => (item.id === habit.id ? { ...item, active } : item));
		await commit(next);
		toastMessage(active ? 'Hábito reativado.' : 'Hábito arquivado. O histórico fica guardado.', {
			undo: () => {
				const copy = cloneSnapshot();
				copy.habits = before;
				void commit(copy);
			}
		});
	}

	function toggleScheduledDay(day: number) {
		habitForm.scheduledDays = habitForm.scheduledDays.includes(day)
			? habitForm.scheduledDays.filter((item) => item !== day)
			: [...habitForm.scheduledDays, day].sort((a, b) => a - b);
	}

	async function saveHabit(event: SubmitEvent) {
		event.preventDefault();
		if (!snapshot) return;
		if (!habitForm.name.trim() || (habitForm.metric !== 'weekly' && !habitForm.scheduledDays.length) || (habitForm.metric !== 'boolean' && Number(habitForm.target) <= 0)) {
			formError = 'Informe um nome, uma meta válida e pelo menos um dia.';
			return;
		}
		const labels =
			habitForm.metric === 'boolean'
				? {
						positiveLabel: habitForm.positiveLabel.trim() || HABIT_BOOLEAN_LABELS.positive,
						negativeLabel: habitForm.negativeLabel.trim() || HABIT_BOOLEAN_LABELS.negative,
						positiveValue: habitForm.positiveValue
					}
				: {};
		const fields = {
			name: habitForm.name.trim(),
			metric: habitForm.metric,
			unit:
				habitForm.metric === 'duration'
					? 'min'
					: habitForm.metric === 'weekly'
						? 'semana'
						: habitForm.unit.trim(),
			target:
				habitForm.metric === 'boolean'
					? 1
					: habitForm.metric === 'weekly'
						? Math.max(1, Math.min(7, Number(habitForm.target)))
						: Number(habitForm.target),
			scheduledDays:
				habitForm.metric === 'weekly'
					? [0, 1, 2, 3, 4, 5, 6]
					: [...habitForm.scheduledDays],
			reminder: habitForm.reminder || undefined,
			targetDirection: habitForm.metric === 'boolean' || habitForm.metric === 'weekly' ? 'up' : habitForm.targetDirection,
			...labels
		};
		const next = cloneSnapshot();
		const beforeDaily = getDailyHabitGoal(snapshot);
		const existingIndex = editingHabitId ? next.habits.findIndex((item) => item.id === editingHabitId) : -1;
		let savedHabit: Habit;
		if (existingIndex >= 0) {
			savedHabit = { ...next.habits[existingIndex], ...fields };
			next.habits[existingIndex] = savedHabit;
		} else {
			savedHabit = { id: id(), active: true, bestStreak: 0, ...fields };
			next.habits.unshift(savedHabit);
		}
		const isNew = existingIndex < 0;
		await commit(next, isNew, isNew);
		const afterDaily = getDailyHabitGoal(next);
		if (afterDaily.goal > 0 && beforeDaily.done < beforeDaily.goal && afterDaily.done >= afterDaily.goal) {
			celebrate(getHabitDayStreak(next));
		}
		await scheduleHabitReminder(savedHabit);
		modal = null;
		editingHabitId = '';
		toastMessage(isNew ? 'Hábito criado.' : 'Hábito atualizado.');
	}

	function logHabit(habit: Habit) {
		if (!snapshot) return;
		const existing = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === today);
		if (habit.metric === 'boolean') {
			const nextValue = nextBooleanLog(Boolean(existing), existing?.value ?? 0, positiveValueOf(habit));
			if (nextValue === 'remove') {
				void removeHabitLog(habit);
				return;
			}
			void saveHabitLog(habit, nextValue, !existing);
			return;
		}
		{
			const input = document.querySelector<HTMLInputElement>(`[data-habit-input="${habit.id}"]`);
			const value = Number(input?.value ?? habitValues[habit.id]);
			if (!Number.isFinite(value) || value < 0) {
				toastMessage('Informe uma quantidade válida.');
				return;
			}
			void saveHabitLog(habit, value, !existing);
		}
	}

	async function removeHabitLog(habit: Habit) {
		if (!snapshot) return;
		const existing = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === today);
		if (!existing) return;
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.habitLogs = next.habitLogs.filter((item) => item.id !== existing.id);
		await commit(next);
		const trash = await recordTrash({
			module: 'habits',
			kind: 'habitLog',
			entityId: existing.id,
			label: `${habit.name} · ${existing.date}`,
			tables: habitLogTables([existing])
		});
		toastMessage('Registro removido.', {
			undo: () => {
				forgetQuietly(trash);
				restoreSnapshotJson(undoJson);
			}
		});
	}

	async function saveHabitLog(habit: Habit, value: number, created: boolean, date = today, coords?: [number, number], award = true) {
		if (!snapshot) return;
		const beforeDailyGoal = getDailyHabitGoal(snapshot);
		const next = cloneSnapshot();
		const existingIndex = next.habitLogs.findIndex((item) => item.habitId === habit.id && item.date === date);
		const existingLog = existingIndex >= 0 ? next.habitLogs[existingIndex] : null;
		const qualifies = didMeetTarget(habit, value);
		const awardExperience = award && qualifies && !existingLog?.experienceAwarded;
		const currentWeek = weekStartDate(today, firstDayOfWeek());
		const isCurrentWeek = habit.metric === 'weekly' && date === currentWeek;
		const incrementDates = habit.metric === 'weekly'
			? new Set([
					...(existingLog?.incrementDates ?? (existingLog?.lastIncrementDate ? [existingLog.lastIncrementDate] : [])),
					...(isCurrentWeek && value > (existingLog?.value ?? 0) ? [today] : [])
				])
			: null;
		const lastIncrementDate = habit.metric === 'weekly' && incrementDates?.size
			? [...incrementDates].sort().at(-1)
			: existingLog?.lastIncrementDate;
		const log: HabitLog = {
			id: existingLog?.id ?? habitLogId(habit.id, date), habitId: habit.id, date, value,
			completed: habit.metric === 'boolean' ? qualifies : value > 0,
			experienceAwarded: Boolean(existingLog?.experienceAwarded || awardExperience),
			...(habit.metric === 'weekly'
				? { lastIncrementDate, incrementDates: incrementDates ? [...incrementDates].sort() : undefined }
				: {})
		};
		if (existingIndex >= 0) next.habitLogs[existingIndex] = log;
		else next.habitLogs.unshift(log);
		if (awardExperience) next.experience.totalXp += 10;
		const streak = currentStreak(habit, next.habitLogs, today, allPausePeriods(next), firstDayOfWeek(next));
		const habitIndex = next.habits.findIndex((item) => item.id === habit.id);
		if (habitIndex >= 0) next.habits[habitIndex].bestStreak = Math.max(next.habits[habitIndex].bestStreak, streak);
		const afterDailyGoal = getDailyHabitGoal(next);
		const sound = next.preferences.soundEnabled;
		const reduced = prefersReducedMotion();
		await commit(next, true, created);
		playFeedback(qualifies ? 'success' : 'tap', sound);
		pulseHaptic(next.preferences.hapticsEnabled, qualifies ? [12, 25, 18] : 8);
		const tile = document.querySelector<HTMLElement>(`[data-habit-id="${habit.id}"]`);
		const [px, py] = coords ?? centerOf(tile);
		if (qualifies) popElement(tile);
		if (awardExperience) {
			const done = prototypeTodayDone;
			const scale = [523, 587, 659, 784, 880, 1047];
			const base = scale[Math.min(Math.max(done - 1, 0), 5)];
			if (!reduced) burstAt(px, py, 18);
			playTone(base, 0.22, 'triangle', 0.07, sound);
			setTimeout(() => playTone(base * 1.5, 0.2, 'triangle', 0.05, sound), 90);
			if (!reduced) floatValue(px, py - 24, '+10 XP');
			const beforeLevel = experienceProgress(snapshot.experience.totalXp - 10).level;
			const afterLevel = experienceProgress(snapshot.experience.totalXp).level;
			toastMessage(afterLevel > beforeLevel ? `Nível ${afterLevel} alcançado · +10 XP` : '+10 XP · Meta do hábito alcançada');
		}
		const allDone = prototypeTodayGoal > 0 && prototypeTodayDone >= prototypeTodayHabits.length;
		if (afterDailyGoal.goal > 0 && beforeDailyGoal.done < beforeDailyGoal.goal && afterDailyGoal.done >= afterDailyGoal.goal) {
			celebrate(getHabitDayStreak(next));
		} else if (allDone) {
			toastMessage('Dia perfeito');
			confetti(effectsCanvas, 70);
			[784, 988, 1175, 1568].forEach((frequency, index) => setTimeout(() => playTone(frequency, 0.25, 'triangle', 0.06, sound), 400 + index * 90));
		}
		modal = null;
		if (!awardExperience && !reduced) toastMessage(qualifies ? 'Registro feito.' : 'Registro atualizado.');
	}

	function openDashHabitPick() {
		dashMenu = false;
		dashHabitPicker = true;
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	/* ---------- trackers (acompanhamento sem recorrência) ---------- */
	async function saveTracker(tracker: Tracker, isNew: boolean) {
		if (!snapshot) return;
		const next = cloneSnapshot();
		const index = next.trackers.findIndex((item) => item.id === tracker.id);
		if (index >= 0) next.trackers[index] = tracker;
		else next.trackers.unshift(tracker);
		await commit(next);
		toastMessage(isNew ? 'Tracker criado.' : 'Tracker atualizado.');
	}

	async function archiveTracker(tracker: Tracker, active: boolean) {
		if (!snapshot) return;
		const before = snapshot.trackers.map((item) => ({ ...item }));
		const next = cloneSnapshot();
		next.trackers = next.trackers.map((item) => (item.id === tracker.id ? { ...item, active } : item));
		await commit(next);
		toastMessage(active ? 'Tracker reativado.' : 'Tracker arquivado. O histórico fica guardado.', {
			undo: () => {
				const copy = cloneSnapshot();
				copy.trackers = before;
				void commit(copy);
			}
		});
	}

	async function deleteTracker(tracker: Tracker) {
		if (!snapshot) return;
		const beforeTrackers = snapshot.trackers.map((item) => ({ ...item }));
		const beforeEntries = snapshot.trackerEntries.filter((item) => item.trackerId === tracker.id).map((item) => ({ ...item }));
		const next = cloneSnapshot();
		next.trackers = next.trackers.filter((item) => item.id !== tracker.id);
		next.trackerEntries = next.trackerEntries.filter((item) => item.trackerId !== tracker.id);
		await commit(next);
		const trash = await recordTrash({
			module: 'habits',
			kind: 'tracker',
			entityId: tracker.id,
			label: tracker.name,
			tables: trackerTables([tracker], beforeEntries)
		});
		toastMessage(`Tracker "${tracker.name}" excluído.`, {
			undo: () => {
				forgetQuietly(trash);
				const copy = cloneSnapshot();
				copy.trackers = beforeTrackers;
				copy.trackerEntries = beforeEntries;
				void commit(copy);
			}
		});
	}

	async function saveTrackerEntry(entry: TrackerEntry, isNew: boolean) {
		if (!snapshot) return;
		const next = cloneSnapshot();
		const index = next.trackerEntries.findIndex((item) => item.id === entry.id);
		if (index >= 0) next.trackerEntries[index] = entry;
		else next.trackerEntries.unshift(entry);
		await commit(next);
		toastMessage(isNew ? 'Registro salvo.' : 'Registro atualizado.');
	}

	async function deleteTrackerEntry(entry: TrackerEntry) {
		if (!snapshot) return;
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.trackerEntries = next.trackerEntries.filter((item) => item.id !== entry.id);
		await commit(next);
		const trash = await recordTrash({
			module: 'habits',
			kind: 'trackerEntry',
			entityId: entry.id,
			label: `${snapshot.trackers.find((item) => item.id === entry.trackerId)?.name ?? 'Tracker'} · ${entry.date}`,
			tables: trackerEntryTables([entry])
		});
		toastMessage('Registro removido.', {
			undo: () => {
				forgetQuietly(trash);
				restoreSnapshotJson(undoJson);
			}
		});
	}

	function pickDashHabit(habit: Habit) {
		dashHabitPicker = false;
		if (habit.metric === 'boolean') {
			logHabit(habit);
			return;
		}
		openHabitSheet(habit);
	}

	function openDashEntry() {
		dashMenu = false;
		openFinanceEntry();
	}

	function slotToTime(slot: number): string {
		const hours = TIME_SLOT_START_HOUR + Math.floor(slot / 2);
		const minutes = slot % 2 ? 30 : 0;
		return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
	}

	/* ---------- bolha de notas do planejador (briefing do animador) ---------- */
	function escapeText(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	async function openNoteFromPlanner(noteId: string, source?: DOMRect) {
		const note = notesState.notes.find((item) => item.id === noteId);
		if (!note) {
			// Nota ainda não carregada (não deve acontecer): cai no deep-link.
			notesOpenId = noteId;
			notesOpenToken += 1;
			goTab('notes');
			return;
		}
		plannerBubble?.hide(true);
		plannerPinBubble?.hide(true);
		cancelAutoDwell();
		noteOverlaySeq += 1;
		noteOverlayMorph = source ?? null;
		noteOverlayMode = note.lastMode ?? 'preview';
		noteOverlay = note;
		noteOverlayOpen = false;
		await tick();
		noteOverlayOpen = true;
		pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 8);
		playTone(520, 0.08, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	async function closeNoteOverlay() {
		const seq = ++noteOverlaySeq;
		noteOverlayOpen = false;
		await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : 380));
		if (seq !== noteOverlaySeq) return;
		noteOverlay = null;
		noteOverlayMorph = null;
	}

	const overlayNotes = $derived(notesState.notes.filter((item) => !item.trashedAt));
	const overlayBacklinks = $derived(noteOverlay ? backlinks(overlayNotes, noteOverlay) : []);

	function patchOverlayNote(patch: Partial<Note>): void {
		if (!noteOverlay) return;
		const updated: Note = { ...noteOverlay, ...patch, updatedAt: new Date().toISOString() };
		noteOverlay = updated;
		notesState = {
			...notesState,
			notes: notesState.notes.map((item) => (item.id === updated.id ? updated : item))
		};
		void upsertNote(updated).catch((error) => {
			console.error('Não foi possível salvar a nota', error);
			toastMessage('Não foi possível salvar a nota.', { warning: true });
		});
	}

	/** Troca de modo não é edição de conteúdo: não mexe no `updatedAt`. */
	function setOverlayMode(mode: NoteMode): void {
		if (!noteOverlay) return;
		const updated: Note = { ...noteOverlay, lastMode: mode };
		noteOverlay = updated;
		noteOverlayMode = mode;
		notesState = {
			...notesState,
			notes: notesState.notes.map((item) => (item.id === updated.id ? updated : item))
		};
		void upsertNote(updated).catch((error) => console.error('Não foi possível salvar o modo da nota', error));
	}

	function pinOverlayNote(): void {
		if (!noteOverlay) return;
		const pinned = !noteOverlay.pinned;
		patchOverlayNote({ pinned });
		toastMessage(pinned ? 'Nota fixada.' : 'Nota desafixada.');
	}

	async function deleteOverlayNote(): Promise<void> {
		const target = noteOverlay;
		if (!target) return;
		const before = { ...target };
		patchOverlayNote({ trashedAt: new Date().toISOString() });
		await closeNoteOverlay();
		toastMessage('Nota movida para a lixeira', {
			undo: () => {
				notesState = {
					...notesState,
					notes: notesState.notes.map((item) => (item.id === before.id ? before : item))
				};
				void upsertNote(before);
			}
		});
	}

	async function openOverlayFolder(): Promise<void> {
		const id = noteOverlay?.id;
		await closeNoteOverlay();
		if (!id) return;
		notesOpenId = id;
		notesOpenToken += 1;
		goTab('notes');
	}

	async function openOverlayWikiLink(title: string): Promise<void> {
		const existing = findNoteByTitle(overlayNotes, title);
		if (existing) {
			noteOverlaySeq += 1;
			noteOverlayMorph = null;
			noteOverlay = existing;
			noteOverlayMode = existing.lastMode ?? 'preview';
			await tick();
			noteOverlayOpen = true;
			return;
		}
		const created = createNote(noteOverlay?.folderId ?? null, title);
		notesState = { ...notesState, notes: [created, ...notesState.notes] };
		await upsertNote(created);
		noteOverlaySeq += 1;
		noteOverlayMorph = null;
		noteOverlay = created;
		noteOverlayMode = 'write';
		await tick();
		noteOverlayOpen = true;
	}

	async function openOverlayBacklink(note: Note): Promise<void> {
		noteOverlaySeq += 1;
		noteOverlayMorph = null;
		noteOverlay = note;
		noteOverlayMode = note.lastMode ?? 'preview';
		await tick();
		noteOverlayOpen = true;
	}

	function hideBlockNotes() {
		plannerBubble?.hide(true);
		plannerPinBubble?.hide(true);
	}

	function plannerBlockTint(blockId: string): string {
		const block = snapshot?.timeBlocks.find((item) => item.id === blockId);
		return (block ? currentCategory(block.categoryId)?.color : null) ?? '#d4f25a';
	}

	function plannerBubbleHtml(items: { note: { title: string; body: string; updatedAt?: string } }[]): string {
		const rows = items
			.map(
				(item, index) =>
					`<button class="tbb-r" data-i="${index}"><div class="tbb-1">${escapeText(item.note.title || 'Sem título')}</div><div class="tbb-2">${escapeText(notePreview(item.note.body, item.note.updatedAt))}</div></button>`
			)
			.join('');
		return `<div class="tbb-lb">Notas neste horário</div>${rows}`;
	}

	function showPlannerBubble(anchor: HTMLElement, items: NoteRef[], blockId: string) {
		plannerPinBubble?.hide(true);
		plannerBubbleCurrent = items;
		plannerBubble?.show(anchor, plannerBubbleHtml(items), plannerBlockTint(blockId));
	}

	/** Células que pertencem ao mesmo bloco (um bloco pode ocupar vários slots). */
	function dwellBlockCells(blockId: string): HTMLElement[] {
		const grid = timeGridEl;
		if (!grid || !blockId) return [];
		return Array.from(grid.querySelectorAll<HTMLElement>(`[data-tp-block="${CSS.escape(blockId)}"]`));
	}

	function dwellBlockRect(blockId: string): DOMRect | null {
		const cells = dwellBlockCells(blockId);
		if (!cells.length) return null;
		let top = Number.POSITIVE_INFINITY;
		let left = Number.POSITIVE_INFINITY;
		let right = Number.NEGATIVE_INFINITY;
		let bottom = Number.NEGATIVE_INFINITY;
		for (const cell of cells) {
			const rect = cell.getBoundingClientRect();
			top = Math.min(top, rect.top);
			left = Math.min(left, rect.left);
			right = Math.max(right, rect.right);
			bottom = Math.max(bottom, rect.bottom);
		}
		return new DOMRect(left, top, right - left, bottom - top);
	}

	/** Blocos com nota que estão visíveis na tela neste momento. */
	function visibleNoteBlocks(): string[] {
		const grid = timeGridEl;
		if (!grid) return [];
		const ids = new Set<string>();
		for (const cell of grid.querySelectorAll<HTMLElement>('[data-tp-block]')) {
			const id = cell.dataset.tpBlock;
			if (!id || !timeBlockNotes.get(id)?.length) continue;
			const rect = cell.getBoundingClientRect();
			if (
				rect.bottom <= 0 ||
				rect.top >= window.innerHeight ||
				rect.right <= 0 ||
				rect.left >= window.innerWidth
			) {
				continue;
			}
			ids.add(id);
		}
		return [...ids];
	}

	/** Agrega as notas de todos os blocos visíveis, sem repetir a mesma nota. */
	function plannerNoteItems(blockIds: string[]): { note: Note; label: string; color: string }[] {
		const rows: { note: Note; label: string; color: string; startAt: string }[] = [];
		for (const blockId of blockIds) {
			const block = snapshot?.timeBlocks.find((item) => item.id === blockId);
			const label = block ? `${shortDay(block.startAt.slice(0, 10))} ${block.startAt.slice(11, 16)}` : '';
			for (const ref of timeBlockNotes.get(blockId) ?? []) {
				const note = notesState.notes.find((item) => item.id === ref.note.id) ?? (ref.note as Note);
				rows.push({
					note,
					label,
					color: plannerBlockTint(blockId),
					startAt: block?.startAt ?? ''
				});
			}
		}
		rows.sort((a, b) => a.startAt.localeCompare(b.startAt));
		const seen = new Set<string>();
		return rows
			.filter((row) => {
				if (seen.has(row.note.id)) return false;
				seen.add(row.note.id);
				return true;
			})
			.map(({ note, label, color }) => ({ note, label, color }));
	}

	function clearDwellRings() {
		for (const ring of autoDwellRings) ring.remove();
		autoDwellRings = [];
	}

	function addDwellRing(blockId: string) {
		const rect = dwellBlockRect(blockId);
		if (!rect) return;
		const margin = 3;
		const width = rect.width + margin * 2;
		const height = rect.height + margin * 2;
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('class', 'tp-dwell-ring');
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		svg.setAttribute('aria-hidden', 'true');
		svg.style.left = `${rect.left - margin}px`;
		svg.style.top = `${rect.top - margin}px`;
		svg.style.width = `${width}px`;
		svg.style.height = `${height}px`;
		const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		outline.setAttribute('x', '1');
		outline.setAttribute('y', '1');
		outline.setAttribute('width', String(Math.max(0, width - 2)));
		outline.setAttribute('height', String(Math.max(0, height - 2)));
		outline.setAttribute('rx', '7');
		outline.setAttribute('fill', 'none');
		outline.setAttribute('pathLength', '100');
		outline.style.strokeDasharray = '100';
		outline.style.strokeDashoffset = prefersReducedMotion() ? '0' : '100';
		outline.setAttribute('stroke-width', '2.5');
		outline.style.stroke = plannerBlockTint(blockId);
		svg.appendChild(outline);
		document.body.appendChild(svg);
		autoDwellRings.push(svg);
		if (prefersReducedMotion()) return;
		requestAnimationFrame(() => {
			outline.style.transition = 'stroke-dashoffset 4s linear';
			outline.style.strokeDashoffset = '0';
		});
	}

	function showDwellRings(blockIds: string[]) {
		clearDwellRings();
		for (const blockId of blockIds) addDwellRing(blockId);
	}

	function cancelAutoDwell() {
		if (autoDwellTimer) clearTimeout(autoDwellTimer);
		autoDwellTimer = undefined;
		clearDwellRings();
	}

	function autoDwellEligible(): boolean {
		if (activeTab !== 'time' || !timeGridEl) return false;
		if (modal || habitSheet || timeSummaryOpen || timeCategorySheet.open) return false;
		if (plannerNotesOpen || plannerNoteOpen || moreMenuOpen || quickMenuOpen) return false;
		return window.matchMedia('(hover: none)').matches;
	}

	/** Agenda a abertura automática depois de 4 s sem toque/scroll. */
	function scheduleAutoDwell() {
		cancelAutoDwell();
		if (!autoDwellAllowed || Date.now() < autoDwellUnlockAt || !autoDwellEligible()) return;
		const blocks = visibleNoteBlocks();
		if (!blocks.length) return;
		showDwellRings(blocks);
		autoDwellTimer = setTimeout(() => {
			autoDwellTimer = undefined;
			if (!autoDwellAllowed || !autoDwellEligible()) {
				cancelAutoDwell();
				return;
			}
			const current = visibleNoteBlocks();
			const items = plannerNoteItems(current.length ? current : blocks);
			cancelAutoDwell();
			if (!items.length) return;
			plannerNotesItems = items;
			plannerNotesOpen = true;
			autoDwellAllowed = false;
			pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 10);
			playTone(660, 0.08, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		}, 4000);
	}

	function openPlannerNote(note: Note) {
		plannerNoteOpen = note;
		cancelAutoDwell();
	}

	function closePlannerNotes() {
		plannerNotesOpen = false;
		plannerNoteOpen = null;
		autoDwellAllowed = false;
		autoDwellUnlockAt = Date.now() + 500;
		cancelAutoDwell();
	}

	function closePlannerNote() {
		plannerNoteOpen = null;
		autoDwellAllowed = false;
		autoDwellUnlockAt = Date.now() + 500;
	}

	/* Auto-dwell por tempo removido no mobile; descomente para voltar.
	// Abre o dialog das notas quando a tela do planejador fica parada.
	$effect(() => {
		const grid = timeGridEl;
		if (activeTab !== 'time' || !grid) {
			cancelAutoDwell();
			return;
		}
		autoDwellAllowed = true;
		autoDwellUnlockAt = 0;
		let scrollTimer: ReturnType<typeof setTimeout> | undefined;
		let wheelTimer: ReturnType<typeof setTimeout> | undefined;
		const inPlanner = (target: EventTarget | null) =>
			target instanceof Element && Boolean(target.closest('.tp-prototype'));
		const onPointerDown = (event: PointerEvent) => {
			if (Date.now() < autoDwellUnlockAt) return;
			// Toque cancela a espera; só um gesto no planejador rearma.
			cancelAutoDwell();
			if (inPlanner(event.target)) autoDwellAllowed = true;
		};
		const onPointerUp = (event: PointerEvent) => {
			if (Date.now() < autoDwellUnlockAt) return;
			if (!inPlanner(event.target)) return;
			autoDwellAllowed = true;
			scheduleAutoDwell();
		};
		const onScroll = (event: Event) => {
			const target = event.target;
			const plannerScroll =
				target === document ||
				target === window ||
				(target instanceof Element && target.classList.contains('tp-scroll'));
			if (!plannerScroll) return;
			cancelAutoDwell();
			autoDwellAllowed = true;
			if (scrollTimer) clearTimeout(scrollTimer);
			if (Date.now() >= autoDwellUnlockAt) {
				scrollTimer = setTimeout(() => scheduleAutoDwell(), 220);
			}
		};
		const onWheel = () => {
			cancelAutoDwell();
			autoDwellAllowed = true;
			if (wheelTimer) clearTimeout(wheelTimer);
			if (Date.now() >= autoDwellUnlockAt) {
				wheelTimer = setTimeout(() => scheduleAutoDwell(), 220);
			}
		};
		const start = setTimeout(() => {
			autoDwellAllowed = true;
			scheduleAutoDwell();
		}, 250);
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('pointerup', onPointerUp, true);
		window.addEventListener('pointercancel', onPointerUp, true);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('wheel', onWheel, { passive: true });
		return () => {
			clearTimeout(start);
			if (scrollTimer) clearTimeout(scrollTimer);
			if (wheelTimer) clearTimeout(wheelTimer);
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('pointerup', onPointerUp, true);
			window.removeEventListener('pointercancel', onPointerUp, true);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('wheel', onWheel);
			cancelAutoDwell();
		};
	});
	*/

	// Qualquer sheet aberto suspende o auto-dwell.
	$effect(() => {
		if (
			modal ||
			habitSheet ||
			timeSummaryOpen ||
			timeCategorySheet.open ||
			plannerNotesOpen ||
			plannerNoteOpen ||
			moreMenuOpen ||
			quickMenuOpen
		) {
			cancelAutoDwell();
		}
	});

	// Cria a bolha de hover do planejador (desktop).
	$effect(() => {
		const grid = timeGridEl;
		if (!grid) return;
		const bubble = new TimeBubble({
			interactive: true,
			offset: 8,
			sound: snapshot?.preferences.soundEnabled ?? true,
			haptics: snapshot?.preferences.hapticsEnabled ?? true,
			onRowClick: (index, row) => {
				const item = plannerBubbleCurrent[index];
				if (item) void openNoteFromPlanner(item.note.id, row.getBoundingClientRect());
			}
		});
		plannerBubble = bubble;
		const onOver = (event: PointerEvent) => {
			const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tp-block]');
			const blockId = cell?.dataset.tpBlock ?? '';
			const found = blockId ? timeBlockNotes.get(blockId) : undefined;
			if (!cell || !blockId || !found?.length) {
				if (bubble.isOpen) bubble.later();
				return;
			}
			showPlannerBubble(cell, found, blockId);
		};
		const onLeave = () => bubble.later();
		grid.addEventListener('pointerover', onOver);
		grid.addEventListener('pointerleave', onLeave);
		return () => {
			grid.removeEventListener('pointerover', onOver);
			grid.removeEventListener('pointerleave', onLeave);
			bubble.destroy();
			plannerBubble = null;
		};
	});

	// Bolha fixa do long press (mobile): não fecha ao soltar; só clique fora/Esc.
	$effect(() => {
		const grid = timeGridEl;
		if (!grid) return;
		const bubble = new TimeBubble({
			interactive: true,
			sticky: true,
			touch: true,
			offset: 8,
			sound: snapshot?.preferences.soundEnabled ?? true,
			haptics: snapshot?.preferences.hapticsEnabled ?? true,
			onRowClick: (index, row) => {
				const item = plannerPinCurrent[index];
				if (item) void openNoteFromPlanner(item.note.id, row.getBoundingClientRect());
			}
		});
		plannerPinBubble = bubble;
		return () => {
			bubble.destroy();
			plannerPinBubble = null;
		};
	});

	function hmSlots(slots: number): string {
		const hours = Math.floor(slots / 2);
		const half = slots % 2;
		return hours && half ? `${hours}h30` : hours ? `${hours}h` : half ? '30m' : '0h';
	}

	function findTimeBlock(date: string, time: string): TimeBlock | undefined {
		const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
		return snapshot?.timeBlocks.find((block) => {
			if (block.status === 'cancelled' || block.startAt.slice(0, 10) !== date) return false;
			const start = Number(block.startAt.slice(11, 13)) * 60 + Number(block.startAt.slice(14, 16));
			return minute >= start && minute < start + block.plannedMinutes;
		});
	}

	function timeCellData(day: number, slot: number) {
		const categoryId = timeGrid[day]?.[slot] ?? null;
		if (!categoryId) return { categoryId: null, color: '', label: '', isStart: false, isEnd: false };
		const prev = slot > 0 ? timeGrid[day][slot - 1] : null;
		const next = slot < TIME_SLOT_COUNT - 1 ? timeGrid[day][slot + 1] : null;
		const isStart = prev !== categoryId;
		const isEnd = next !== categoryId;
		let label = '';
		if (isStart) label = currentCategory(categoryId)?.name ?? '';
		else if (timeGrid[day][slot - 1] === categoryId && (slot - 2 < 0 || timeGrid[day][slot - 2] !== categoryId)) {
			let end = slot;
			while (end + 1 < TIME_SLOT_COUNT && timeGrid[day][end + 1] === categoryId) end += 1;
			label = hmSlots(end - (slot - 1) + 1);
		}
		return { categoryId, color: currentCategory(categoryId)?.color ?? '#888888', label, isStart, isEnd };
	}

	function timeCategoryHours(categoryId: string): number {
		let slots = 0;
		for (const day of timeGrid) for (const slotCategory of day) if (slotCategory === categoryId) slots += 1;
		return slots / 2;
	}

	function countSlotsIn(data: AtlasSnapshot, categoryId: string): number {
		let slots = 0;
		for (const block of data.timeBlocks) {
			if (block.status === 'cancelled' || block.categoryId !== categoryId) continue;
			const index = timeDayIndex(block.startAt.slice(0, 10));
			if (index < 0 || index >= timeRangeDays) continue;
			slots += Math.max(1, Math.round(block.plannedMinutes / TIME_SLOT_MINUTES));
		}
		return slots;
	}

	function timeLayout() {
		if (!timeScroll) return;
		const width = timeScroll.clientWidth;
		const capacity = width < 560 ? 2 : width < 780 ? 3 : width < 1000 ? 5 : 7;
		timeVisibleCount = Math.max(1, Math.min(timeRangeDays, capacity));
		timeColumnWidth = Math.max(64, (width - 38) / timeVisibleCount);
	}

	function handleTimeScroll() {
		cancelAutoDwell();
		hideBlockNotes();
		if (!timeScroll) return;
		timeVisibleStart = Math.round(timeScroll.scrollLeft / timeColumnWidth);
		if (timeWeekBarsEl) timeWeekBarsEl.scrollLeft = Math.max(0, timeScroll.scrollLeft - 38);
	}

	function scrollToDay(index: number) {
		if (!timeScroll) return;
		const max = Math.max(0, timeRangeDays - timeVisibleCount);
		timeScroll.scrollTo({ left: Math.min(Math.max(0, index), max) * timeColumnWidth, behavior: 'smooth' });
		playTone(420, 0.05, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled, 4);
	}

	/** Aplica o range do calendário e leva a grade para o primeiro dia. */
	async function applyTimeRange(start: string, end: string) {
		const range = clampRange(start, end);
		timeRangeStart = range.start;
		timeRangeDays = range.days;
		timeCalendarOpen = false;
		timeUserAdjusted = true;
		await tick();
		timeLayout();
		scrollToDay(0);
	}

	function selectTimeCategory(categoryId: string) {
		if (categoryId !== 'x' && timeSelected === categoryId) {
			openTimeCategorySheet(categoryId);
			return;
		}
		timeSelected = categoryId;
		playTone(categoryId === 'x' ? 220 : 520, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled, 5);
	}

	function timeCellCenter(day: number, slot: number): [number, number] {
		if (!timeScroll) return [window.innerWidth / 2, window.innerHeight / 2];
		const rect = timeScroll.getBoundingClientRect();
		return [
			rect.left + 38 + day * timeColumnWidth + timeColumnWidth / 2 - timeScroll.scrollLeft,
			rect.top + 40 + slot * 28 + 14 - timeScroll.scrollTop
		];
	}

	function makeTimeBlock(date: string, time: string, categoryId: string): TimeBlock {
		const endTotal = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + TIME_SLOT_MINUTES;
		const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
		return {
			id: id(), title: currentCategory(categoryId)?.name ?? '', categoryId,
			startAt: `${date}T${time}:00`, endAt: `${date}T${endTime}:00`,
			plannedMinutes: TIME_SLOT_MINUTES, actualMinutes: null, status: 'planned'
		};
	}

	function applyTimePaint(day: number, slot: number) {
		if (!snapshot) return;
		const key = `${day}-${slot}`;
		if (timePaintSeen.has(key)) return;
		timePaintSeen.add(key);
		timePaintLastCell = [day, slot];
		const date = addDays(timeRangeStart, day);
		const time = slotToTime(slot);
		const existing = findTimeBlock(date, time);
		const sound = snapshot.preferences.soundEnabled;
		if (timePaintMode === 'add') {
			if (existing && existing.categoryId === timeSelected) return;
			if (existing) {
				const block = snapshot.timeBlocks.find((item) => item.id === existing.id);
				if (block) { block.categoryId = timeSelected; block.title = currentCategory(timeSelected)?.name ?? ''; }
			} else {
				snapshot.timeBlocks.unshift(makeTimeBlock(date, time, timeSelected));
			}
			timePaintCount.add += 1;
			const [x, y] = timeCellCenter(day, slot);
			burstAt(x, y, 3, { color: currentCategory(timeSelected)?.color ?? '#d4f25a' });
			playTone(392 + Math.min(timePaintCount.add, 8) * 40, 0.08, 'sine', 0.035, sound);
			pulseHaptic(snapshot.preferences.hapticsEnabled, 4);
		} else if (existing) {
			const block = snapshot.timeBlocks.find((item) => item.id === existing.id);
			if (block) block.status = 'cancelled';
			timePaintCount.del += 1;
			const [x, y] = timeCellCenter(day, slot);
			burstAt(x, y, 2, { color: '#8d968a' });
			playTone(190, 0.05, 'sine', 0.04, sound);
			pulseHaptic(snapshot.preferences.hapticsEnabled, 3);
		}
	}

	function timeCellAt(x: number, y: number): { day: number; slot: number } | null {
		const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-tp-day]');
		if (!element || element.dataset.tpSlot === undefined) return null;
		return { day: Number(element.dataset.tpDay), slot: Number(element.dataset.tpSlot) };
	}

	function timeCellFromEvent(event: PointerEvent): { day: number; slot: number } | null {
		return timeCellAt(event.clientX, event.clientY);
	}

	function startTimePaint(cell: { day: number; slot: number }) {
		if (!snapshot) return;
		timePainting = true;
		timePaintSnapshot = JSON.stringify(snapshot);
		timePaintSeen = new Set();
		timePaintCount = { add: 0, del: 0 };
		const existing = findTimeBlock(addDays(timeRangeStart, cell.day), slotToTime(cell.slot));
		timePaintMode = timeSelected === 'x' || existing?.categoryId === timeSelected ? 'del' : 'add';
		vibrate(12);
		playTone(500, 0.06, 'sine', 0.04, snapshot.preferences.soundEnabled);
		applyTimePaint(cell.day, cell.slot);
	}

	/** Long press sem movimento: notas do bloco (bolha fixa) ou categoria. */
	function openPlannerBlockDialog(day: number, slot: number) {
		const blockId = timeGridBlocks[day]?.[slot] ?? '';
		if (!blockId) return;
		const block = snapshot?.timeBlocks.find((item) => item.id === blockId);
		const items = plannerNoteItems([blockId]);
		if (items.length) {
			const anchor = timeGridEl?.querySelector<HTMLElement>(
				`[data-tp-day="${day}"][data-tp-slot="${slot}"]`
			);
			if (!anchor) return;
			plannerPinCurrent = items;
			plannerBubble?.hide(true);
			plannerPinBubble?.show(anchor, plannerBubbleHtml(items), plannerBlockTint(blockId));
			pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 10);
			playTone(660, 0.08, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
			return;
		}
		if (block?.categoryId) {
			pulseHaptic(snapshot?.preferences.hapticsEnabled ?? true, 10);
			openTimeCategorySheet(block.categoryId);
		}
	}

	function clearTimeTouchTimers() {
		if (timeTouchArmTimer) clearTimeout(timeTouchArmTimer);
		if (timeTouchDialogTimer) clearTimeout(timeTouchDialogTimer);
		timeTouchArmTimer = undefined;
		timeTouchDialogTimer = undefined;
	}

	/**
	 * Toque no planejador (mobile): qualquer arrasto antes de 250 ms rola a
	 * grade; segurar 250 ms arma a pintura (o movimento seguinte pinta); toque
	 * curto pinta uma célula; 650 ms parado abre a bolha de notas ou a categoria.
	 */
	function beginTimeTouch(event: TouchEvent) {
		if (!snapshot || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const cell = timeCellAt(touch.clientX, touch.clientY);
		if (!cell) return;
		clearTimeTouchTimers();
		cancelAutoDwell();
		timeTouch = { x: touch.clientX, y: touch.clientY, cell, armed: false, painting: false, navigating: false };
		timeTouchArmTimer = setTimeout(() => {
			if (!timeTouch || timeTouch.navigating || timeTouch.painting) return;
			timeTouch.armed = true;
			vibrate(8);
		}, 250);
		timeTouchDialogTimer = setTimeout(() => {
			if (!timeTouch || timeTouch.navigating || timeTouch.painting) return;
			const current = timeTouch;
			timeTouch = null;
			clearTimeTouchTimers();
			openPlannerBlockDialog(current.cell.day, current.cell.slot);
		}, 650);
	}

	function moveTimeTouch(event: TouchEvent) {
		if (!timeTouch || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const distance = Math.hypot(touch.clientX - timeTouch.x, touch.clientY - timeTouch.y);
		if (timeTouch.painting) {
			if (event.cancelable) event.preventDefault();
			const cell = timeCellAt(touch.clientX, touch.clientY);
			if (cell) applyTimePaint(cell.day, cell.slot);
			return;
		}
		if (timeTouch.navigating) return;
		if (timeTouch.armed && distance > 8) {
			timeTouch.painting = true;
			if (timeTouchDialogTimer) clearTimeout(timeTouchDialogTimer);
			timeTouchDialogTimer = undefined;
			startTimePaint(timeTouch.cell);
			if (event.cancelable) event.preventDefault();
			const cell = timeCellAt(touch.clientX, touch.clientY);
			if (cell) applyTimePaint(cell.day, cell.slot);
			return;
		}
		if (!timeTouch.armed && distance > 8) {
			// Antes de armar, o arrasto é navegação nativa.
			timeTouch.navigating = true;
			clearTimeTouchTimers();
		}
	}

	function endTimeTouch(event: TouchEvent) {
		clearTimeTouchTimers();
		const current = timeTouch;
		timeTouch = null;
		if (!current) return;
		if (current.painting) {
			void finishTimePaint();
			return;
		}
		if (current.navigating) return;
		// Toque curto (ou segurar sem mover): pinta uma célula.
		startTimePaint(current.cell);
		void finishTimePaint();
	}

	function cancelTimeTouch() {
		clearTimeTouchTimers();
		const current = timeTouch;
		timeTouch = null;
		if (current?.painting) void finishTimePaint();
	}

	/** Listeners de toque no grid, não-passivos para poder segurar+arrastar. */
	function timeGestures(node: HTMLElement) {
		const start = (event: TouchEvent) => beginTimeTouch(event);
		const move = (event: TouchEvent) => moveTimeTouch(event);
		const end = (event: TouchEvent) => endTimeTouch(event);
		const cancel = () => cancelTimeTouch();
		node.addEventListener('touchstart', start, { passive: true });
		node.addEventListener('touchmove', move, { passive: false });
		node.addEventListener('touchend', end);
		node.addEventListener('touchcancel', cancel);
		return {
			destroy() {
				node.removeEventListener('touchstart', start);
				node.removeEventListener('touchmove', move);
				node.removeEventListener('touchend', end);
				node.removeEventListener('touchcancel', cancel);
			}
		};
	}

	function beginTimePaint(event: PointerEvent) {
		if (event.button !== 0 || !snapshot) return;
		if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
		const cell = timeCellFromEvent(event);
		if (!cell) return;
		cancelAutoDwell();
		startTimePaint(cell);
	}

	function continueTimePaint(event: PointerEvent) {
		if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
		if (!timePainting) return;
		const cell = timeCellFromEvent(event);
		if (cell) applyTimePaint(cell.day, cell.slot);
	}

	function restoreTimeSnapshot(json: string) {
		snapshot = JSON.parse(json) as AtlasSnapshot;
		void saveSnapshot(snapshot);
	}

	/** Undo genérico de um snapshot inteiro (usado por lixeira/toasts). */
	function restoreSnapshotJson(json: string) {
		restoreTimeSnapshot(json);
	}

	async function finishTimePaint() {
		if (!timePainting || !snapshot) return;
		timePainting = false;
		timePaintSeen = new Set();
		if (JSON.stringify(snapshot) === timePaintSnapshot) return;
		const before = JSON.parse(timePaintSnapshot) as AtlasSnapshot;
		const crossing = timeCategories.find((category) => {
			const weeklyGoal = category.weeklyGoalHours ?? 0;
			if (!weeklyGoal) return false;
			const goal = (weeklyGoal * timeRangeDays) / 7;
			return countSlotsIn(before, category.id) / 2 < goal && timeCategoryHours(category.id) >= goal;
		});
		const snapshotBefore = timePaintSnapshot;
		const mode = timePaintMode;
		const added = timePaintCount.add;
		const removed = timePaintCount.del;
		const category = currentCategory(timeSelected);
		const [x, y] = timePaintLastCell ? timeCellCenter(timePaintLastCell[0], timePaintLastCell[1]) : [window.innerWidth / 2, window.innerHeight / 2];
		const sound = snapshot.preferences.soundEnabled;
		try {
			await commit(cloneSnapshot(), true, mode === 'add' ? 1 : 0);
		} catch {
			snapshot = before;
			return;
		}
		if (mode === 'add') {
			playTone(523 + Math.min(added, 8) * 40, 0.18, 'triangle', 0.06, sound);
			setTimeout(() => playTone(784 + Math.min(added, 8) * 40, 0.2, 'triangle', 0.05, sound), 90);
			floatValue(x, y - 20, `+${hmSlots(added)}`, category?.color);
			vibrate([10, 30, 10]);
			toastMessage(`+${hmSlots(added)} ${category?.name ?? ''}`.trim(), { undo: () => restoreTimeSnapshot(snapshotBefore) });
		} else {
			floatValue(x, y - 20, `−${hmSlots(removed)}`, '#8d968a');
			vibrate(8);
			toastMessage(`−${hmSlots(removed)}`, { undo: () => restoreTimeSnapshot(snapshotBefore) });
		}
		if (crossing) {
			setTimeout(() => {
				confetti(effectsCanvas, 90, { colors: [crossing.color, '#ecefe6', '#ffd45a', crossing.color] });
				[523, 659, 784, 1047].forEach((frequency, index) => setTimeout(() => playTone(frequency, 0.28, 'triangle', 0.07, sound), index * 100));
				vibrate([20, 40, 20, 40, 70]);
				toastMessage(`Meta de ${crossing.name} concluída`);
			}, 350);
		}
	}

	function openTimeCategorySheet(categoryId: string | null) {
		const category = categoryId ? currentCategory(categoryId) : undefined;
		const palette = ['#d4f25a', '#9cc8ff', '#ffb347', '#c6a8ff', '#f1a5c5', '#7fe3c4', '#ff8a80', '#e6e06a'];
		const index = (timeCategories.length || 0) % palette.length;
		timeCategorySheet = {
			open: true,
			id: categoryId,
			name: category?.name ?? '',
			color: category?.color ?? palette[index],
			goalHours: category?.weeklyGoalHours ?? 0
		};
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	async function saveTimeCategory() {
		if (!snapshot) return;
		const sound = snapshot.preferences.soundEnabled;
		const name = timeCategorySheet.name.trim();
		if (!name) return;
		const next = cloneSnapshot();
		if (timeCategorySheet.id) {
			const category = next.categories.find((item) => item.id === timeCategorySheet.id);
			if (category) {
				category.name = name;
				category.color = timeCategorySheet.color;
				category.weeklyGoalHours = timeCategorySheet.goalHours;
			}
		} else {
			const newId = id();
			next.categories.push({ id: newId, module: 'time', name, color: timeCategorySheet.color, custom: true, weeklyGoalHours: timeCategorySheet.goalHours });
			timeSelected = newId;
		}
		timeCategorySheet = { ...timeCategorySheet, open: false };
		await commit(next);
		playTone(660, 0.15, 'triangle', 0.06, sound);
		setTimeout(() => playTone(880, 0.18, 'triangle', 0.06, sound), 90);
		vibrate([10, 30, 10]);
	}

	async function deleteTimeCategory() {
		if (!snapshot || !timeCategorySheet.id) return;
		const sound = snapshot.preferences.soundEnabled;
		const undoJson = JSON.stringify(snapshot);
		const targetId = timeCategorySheet.id;
		const category = snapshot.categories.find((item) => item.id === targetId);
		const blocks = snapshot.timeBlocks.filter((item) => item.categoryId === targetId);
		const next = cloneSnapshot();
		next.categories = next.categories.filter((item) => item.id !== targetId);
		next.timeBlocks = next.timeBlocks.filter((item) => item.categoryId !== targetId);
		if (timeSelected === targetId) timeSelected = next.categories.find((item) => item.module === 'time')?.id ?? 'x';
		timeCategorySheet = { ...timeCategorySheet, open: false };
		await commit(next);
		const trash = category
			? await recordTrash({
					module: 'time',
					kind: 'category',
					entityId: category.id,
					label: category.name,
					tables: timeCategoryTables(category, blocks)
				})
			: null;
		playTone(200, 0.14, 'sine', 0.05, sound);
		vibrate(10);
		toastMessage('Categoria excluída', {
			undo: () => {
				forgetQuietly(trash);
				restoreTimeSnapshot(undoJson);
			}
		});
	}

	function openTimeSummary() {
		timeSummaryOpen = true;
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	async function cancelBlock(blockId: string) {
		if (!snapshot) return;
		const next = cloneSnapshot();
		const block = next.timeBlocks.find((item) => item.id === blockId);
		if (block) block.status = 'cancelled';
		await commit(next);
		if (block && isIOSApp()) {
			try { const plugin = await import('@tauri-apps/plugin-notification'); await plugin.cancel([numericNotificationId(`time:${block.id}`)]); } catch { /* Best effort for native scheduled reminders. */ }
		}
		toastMessage('Bloco cancelado.');
	}

	function openSettings() {
		modal = 'settings';
	}

	async function updatePreferences(patch: Partial<AppPreferences>) {
		if (!snapshot) return;
		const next = cloneSnapshot();
		next.preferences = { ...next.preferences, ...patch };
		await commit(next);
	}

	/**
	 * Liga/desliga o modo de teste.
	 *
	 * Troca o banco ativo (`atlas.db` ↔ `atlas.test.db`), limpa os caches e
	 * recarrega tudo. Os dados reais nunca são tocados.
	 */
	async function toggleTestMode(enabled: boolean) {
		if (enabled && syncSupported()) {
			await syncStop().catch(() => null);
			sync = null;
			syncAvailable = false;
			closePairing();
		}
		const hasData = Boolean(
			snapshot && (snapshot.transactions.length || snapshot.habits.length || snapshot.timeBlocks.length)
		);
		if (enabled && hasData) {
			const confirmed = await askConfirm({
				title: 'Ativar modo de teste?',
				message:
					'O Atlas passa a usar um banco separado com dados de exemplo. Seus dados reais ficam intactos e voltam ao desativar.',
				confirmLabel: 'Ativar'
			});
			if (!confirmed) return;
		}
		writeTestMode(enabled);
		resetStorageCache();
		resetNotesCache();
		testModeActive = enabled;
		snapshot = null;
		ready = false;
		notesVersion += 1;
		await initialize();
		toastMessage(enabled ? 'Modo de teste ativado.' : 'Modo de teste desativado.');
	}

	async function onTestModeToggle(event: Event) {
		await toggleTestMode((event.currentTarget as HTMLInputElement).checked);
	}

	async function setFeedbackPreference(
		key: 'soundEnabled' | 'hapticsEnabled' | 'typingSoundEnabled',
		enabled: boolean
	) {
		await updatePreferences({ [key]: enabled });
		if (key === 'hapticsEnabled') pulseHaptic(enabled, [10, 22, 14]);
		else playFeedback(key === 'typingSoundEnabled' ? 'paint' : 'success', enabled);
	}

	/**
	 * Diálogos próprios do Atlas.
	 *
	 * `window.confirm`/`window.prompt` não são confiáveis no WKWebView (iOS):
	 * o delegate nativo não implementa os painéis JS, então `confirm` sempre
	 * retorna falso e `prompt` sempre retorna nulo. Estes helpers dão o mesmo
	 * contrato via UI própria.
	 */
	function askConfirm(options: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
		return new Promise((resolve) => {
			dialog = {
				kind: 'confirm',
				title: options.title,
				message: options.message,
				confirmLabel: options.confirmLabel ?? 'Confirmar',
				danger: options.danger,
				resolve: (value) => resolve(value !== null)
			};
		});
	}

	function askText(options: { title: string; label: string; value?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
		return new Promise((resolve) => {
			dialogValue = options.value ?? '';
			dialog = {
				kind: 'prompt',
				title: options.title,
				label: options.label,
				placeholder: options.placeholder,
				confirmLabel: options.confirmLabel ?? 'Salvar',
				resolve
			};
		});
	}

	function closeDialog(result: string | null) {
		const current = dialog;
		if (!current) return;
		dialog = null;
		current.resolve(result);
	}

	function submitDialog(event: Event) {
		event.preventDefault();
		if (!dialog) return;
		closeDialog(dialog.kind === 'prompt' ? dialogValue : 'ok');
	}

	/**
	 * Backup local.
	 *
	 * Export: zip (`atlas-backup-v2`) com snapshot, notas, pastas e anexos.
	 * Import: substitui tudo, mas guarda uma cópia do estado atual em
	 * `backups/` antes de sobrescrever.
	 */
	async function currentBackupBytes(): Promise<Uint8Array> {
		if (!snapshot) return new Uint8Array();
		const blob = await exportBackupV2(
			{ snapshot, notes: notesState.notes, folders: notesState.folders },
			await collectAttachments()
		);
		return new Uint8Array(await blob.arrayBuffer());
	}

	async function exportData() {
		if (!snapshot) return;
		try {
			const result = await saveBytes(await currentBackupBytes(), backupFileName());
			toastMessage(result === 'saved' ? 'Backup exportado.' : 'Exportação cancelada.');
		} catch (error) {
			console.error('Falha ao exportar o backup', error);
			toastMessage('Não foi possível exportar o backup.', { warning: true });
		}
	}

	async function importData() {
		if (!snapshot) return;
		const picked = await pickFile(['zip', 'json']);
		if (!picked) return;
		let imported: ImportedBackup;
		try {
			imported = await importBackupV2(new File([picked.bytes as BlobPart], picked.name));
		} catch (error) {
			toastMessage(error instanceof Error ? error.message : 'Não foi possível ler o backup.', {
				warning: true
			});
			return;
		}
		const confirmed = await askConfirm({
			title: 'Importar backup?',
			message: `${picked.name} — ${describeBackup(summarizeBackup(imported.data, imported.attachments))}. Os dados atuais serão substituídos.`,
			confirmLabel: 'Importar'
		});
		if (!confirmed) return;
		await writeSafetyCopy(await currentBackupBytes(), safetyCopyName()).catch(() => null);
		await saveSnapshot(imported.data.snapshot);
		await replaceNotesState({ notes: imported.data.notes, folders: imported.data.folders });
		await restoreAttachments(imported.attachments);
		resetStorageCache();
		resetNotesCache();
		snapshot = null;
		ready = false;
		notesVersion += 1;
		await initialize();
		toastMessage('Backup importado.');
	}

	/** S8: updater (GitHub Releases) — só Windows. */
	async function checkAppUpdate() {
		if (updaterBusy) return;
		updaterBusy = true;
		updaterStatus = 'Procurando atualização…';
		try {
			const update = await checkForUpdate();
			if (!update) {
				updaterStatus = 'Atlas está na versão mais recente';
				return;
			}
			updaterStatus = `Versão ${update.version} disponível`;
			const confirmed = await askConfirm({
				title: 'Instalar atualização?',
				message: `O Atlas baixa a versão ${update.version}, instala e reinicia.`,
				confirmLabel: 'Instalar'
			});
			if (!confirmed) {
				updaterStatus = '';
				return;
			}
			await update.install((percent) => {
				updaterStatus = percent === null ? 'Baixando…' : `Baixando… ${percent}%`;
			});
			updaterStatus = 'Instalado — reabrindo';
			toastMessage('Atualização instalada.');
			await relaunchApp();
		} catch (error) {
			console.error(error);
			updaterStatus = 'Não foi possível atualizar agora';
			toastMessage('Não foi possível atualizar agora.', { warning: true });
		} finally {
			updaterBusy = false;
		}
	}

	async function changeCurrency(value: string): Promise<boolean> {
		if (!snapshot || value === snapshot.preferences.currency) return true;
		const confirmed = await askConfirm({
			title: 'Trocar moeda base',
			message: 'Alterar a moeda base muda apenas a forma de exibição. O Atlas não converte os valores já registrados.',
			confirmLabel: 'Trocar'
		});
		if (!confirmed) return false;
		await updatePreferences({ currency: value });
		return true;
	}

	/**
	 * Troca o primeiro dia da semana remapeando o log da semana atual.
	 * Sem isso, a semana em aberto sumiria do hábito semanal.
	 */
	async function changeFirstDayOfWeek(value: 'mon' | 'sun') {
		if (!snapshot || value === snapshot.preferences.firstDayOfWeek) return;
		const oldStart = weekStartDate(today, firstDayOfWeek(snapshot));
		const newStart = weekStartDate(today, value);
		const next = cloneSnapshot();
		next.preferences.firstDayOfWeek = value;
		const weekly = new Set(next.habits.filter((habit) => habit.metric === 'weekly').map((habit) => habit.id));
		next.habitLogs = remapWeeklyLogs(next.habitLogs, weekly, oldStart, newStart);
		await commit(next);
		toastMessage(value === 'sun' ? 'Semana começa no domingo.' : 'Semana começa na segunda.');
	}

	async function startPause(event: SubmitEvent) {
		event.preventDefault();
		if (!snapshot || pauseForm.until < today) {
			formError = 'Escolha uma data de retorno futura.';
			return;
		}
		const next = cloneSnapshot();
		advanceLifeForce(next);
		if (isCurrentPause(next)) {
			if (!next.lifeForce.pausedUntil || pauseForm.until <= next.lifeForce.pausedUntil) {
				formError = 'Escolha uma data posterior à data de retorno atual.';
				return;
			}
		} else {
			next.lifeForce.pausedFrom = today;
		}
		next.lifeForce.pausedUntil = pauseForm.until;
		await commit(next);
		try { const plugin = await import('@tauri-apps/plugin-notification'); await plugin.cancelAll(); } catch { /* Browser preview has no native queue. */ }
		wasPaused = true;
		modal = null;
		toastMessage(`Pausa ativa até ${new Date(`${pauseForm.until}T12:00:00`).toLocaleDateString('pt-BR')}.`);
	}

	function isIOSApp(): boolean {
		return isTauri() && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
	}

	function numericNotificationId(key: string): number {
		let hash = 0;
		for (const character of key) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
		return Math.abs(hash) || 1;
	}

	async function scheduleHabitReminder(habit: Habit) {
		if (!snapshot?.preferences.notificationsEnabled || isCurrentPause(snapshot) || !isIOSApp() || !habit.reminder) return;
		try {
			const { Schedule, sendNotification, cancel } = await import('@tauri-apps/plugin-notification');
			const [hour, minute] = habit.reminder.split(':').map(Number);
			for (const weekday of habit.scheduledDays) {
				const notificationId = numericNotificationId(`habit:${habit.id}:${weekday}`);
				await cancel([notificationId]);
				await sendNotification({
					id: notificationId,
					title: 'Atlas · hábito',
					body: habit.name,
					schedule: Schedule.interval({ weekday: weekday + 1, hour, minute })
				});
			}
		} catch (error) {
			console.warn('Não foi possível agendar o lembrete de hábito', error);
		}
	}

	async function scheduleTimeReminder(block: TimeBlock) {
		if (!snapshot?.preferences.notificationsEnabled || isCurrentPause(snapshot) || !isIOSApp() || !block.reminder) return;
		try {
			const { Schedule, sendNotification, cancel } = await import('@tauri-apps/plugin-notification');
			const fireAt = new Date(`${block.startAt.slice(0, 10)}T${block.reminder}:00`);
			if (fireAt <= new Date()) return;
			const notificationId = numericNotificationId(`time:${block.id}`);
			await cancel([notificationId]);
			await sendNotification({ id: notificationId, title: 'Atlas · tempo', body: block.title, schedule: Schedule.at(fireAt) });
		} catch (error) {
			console.warn('Não foi possível agendar o lembrete de tempo', error);
		}
	}

	async function syncIOSReminders(data: AtlasSnapshot) {
		if (!isIOSApp()) return;
		try {
			const plugin = await import('@tauri-apps/plugin-notification');
			await plugin.cancelAll();
		} catch (error) {
			console.warn('Não foi possível atualizar os lembretes locais', error);
		}
		if (!data.preferences.notificationsEnabled || isCurrentPause(data)) return;
		for (const habit of data.habits.filter((item) => item.active && item.reminder)) await scheduleHabitReminder(habit);
		for (const block of data.timeBlocks.filter((item) => item.status === 'planned' && item.reminder)) await scheduleTimeReminder(block);
	}

	async function checkDesktopReminders(data: AtlasSnapshot) {
		if (!data.preferences.notificationsEnabled || isCurrentPause(data) || isIOSApp()) return;
		const now = new Date();
		for (const habit of data.habits) {
			if (!habit.active || !habit.reminder || !habit.scheduledDays.includes(now.getDay())) continue;
			const due = new Date(`${localDate()}T${habit.reminder}:00`);
			const key = `reminder-habit-${habit.id}-${localDate()}`;
			if (now >= due && now.getTime() - due.getTime() < 60_000 && !sessionStorage.getItem(key)) {
				await showNotification('Atlas · hábito', habit.name);
				sessionStorage.setItem(key, 'sent');
			}
		}
		for (const block of data.timeBlocks) {
			if (!block.reminder || block.status !== 'planned') continue;
			const due = new Date(`${block.startAt.slice(0, 10)}T${block.reminder}:00`);
			const key = `reminder-time-${block.id}`;
			if (now >= due && now.getTime() - due.getTime() < 60_000 && !sessionStorage.getItem(key)) {
				await showNotification('Atlas · tempo', block.title);
				sessionStorage.setItem(key, 'sent');
			}
		}
	}

	async function showNotification(title: string, body: string) {
		if ('Notification' in window && Notification.permission === 'granted') {
			new Notification(title, { body });
			return;
		}
		try {
			const plugin = await import('@tauri-apps/plugin-notification');
			if (await plugin.isPermissionGranted()) plugin.sendNotification({ title, body });
		} catch (error) {
			console.warn('Notificação indisponível', error);
		}
	}

	async function toggleNotifications(enabled: boolean) {
		if (!snapshot) return;
		const nextEnabled = enabled;
		if (nextEnabled) {
			try {
				if (isTauriApp()) {
					const plugin = await import('@tauri-apps/plugin-notification');
					if (!(await plugin.isPermissionGranted()) && (await plugin.requestPermission()) !== 'granted') throw new Error('permission');
				} else if ('Notification' in window && Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
					throw new Error('permission');
				}
			} catch {
				toastMessage('Permissão de notificações não concedida.');
				return;
			}
		}
		await updatePreferences({ notificationsEnabled: nextEnabled });
		if (nextEnabled && snapshot) await syncIOSReminders(snapshot);
		if (!nextEnabled) {
			try { const plugin = await import('@tauri-apps/plugin-notification'); await plugin.cancelAll(); } catch { /* Browser preview has no native queue. */ }
		}
	}

	function isTauriApp() {
		return isTauri();
	}

	function humanDate(date: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }) {
		return new Intl.DateTimeFormat('pt-BR', options).format(new Date(`${date}T12:00:00`));
	}

	function categoryName(categoryId: string): string {
		return snapshot?.categories.find((item) => item.id === categoryId)?.name ?? 'Sem categoria';
	}

	function currency() { return snapshot?.preferences.currency ?? 'BRL'; }

	function changePeriod(value: Period) { period = value; }

	/* Backup local: desativado por ora.
	   A exportação antiga usava blob + `<a download>`, que o WKWebView (iOS)
	   não baixa, e `window.confirm/prompt`, que o delegate nativo não exibe.
	   Será reimplementado com `plugin-dialog` + `plugin-fs`. */


	function setActiveTab(key: NavigationKey) {
		activeTab = key;
		closeShellMenus();
	}

	/* ---------- Shell (app shell) ---------- */
	function snapSound(): boolean {
		return snapshot?.preferences.soundEnabled ?? false;
	}

	function snapHaptics(): boolean {
		return snapshot?.preferences.hapticsEnabled ?? false;
	}

	function closeShellMenus() {
		quickMenuOpen = false;
		moreMenuOpen = false;
	}

	function toggleSidebar() {
		sidebarCollapsed = !sidebarCollapsed;
		try {
			localStorage.setItem('atlas-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
		} catch {
			/* localStorage indisponível */
		}
		playTone(sidebarCollapsed ? 420 : 560, 0.08, 'sine', 0.05, snapSound());
		pulseHaptic(snapHaptics(), 5);
	}

	function goTab(key: NavigationKey) {
		closeShellMenus();
		if (key === activeTab) {
			pulseHaptic(snapHaptics(), 3);
			return;
		}
		navDirection = TAB_ORDER.indexOf(key) >= TAB_ORDER.indexOf(activeTab) ? 1 : -1;
		playTone(480, 0.05, 'sine', 0.05, snapSound());
		pulseHaptic(snapHaptics(), 6);
		setActiveTab(key);
		window.scrollTo({ top: 0 });
	}

	function toggleQuickMenu() {
		const next = !quickMenuOpen;
		closeShellMenus();
		quickMenuOpen = next;
		if (next) {
			playTone(380, 0.18, 'triangle', 0.05, snapSound());
			pulseHaptic(snapHaptics(), 10);
		}
	}

	function toggleMoreMenu() {
		const next = !moreMenuOpen;
		closeShellMenus();
		moreMenuOpen = next;
		playTone(next ? 520 : 380, 0.08, 'sine', 0.05, snapSound());
		pulseHaptic(snapHaptics(), 6);
	}

	function quickAction(kind: 'habit' | 'entry' | 'note') {
		closeShellMenus();
		playTone(660, 0.12, 'triangle', 0.06, snapSound());
		pulseHaptic(snapHaptics(), [10, 30, 10]);
		if (kind === 'habit') openDashHabitPick();
		else if (kind === 'entry') openDashEntry();
		else {
			notesCreateToken += 1;
			goTab('notes');
		}
	}

	function recentLabel(date: string) {
		return date === today ? 'Hoje' : humanDate(date);
	}
</script>

<svelte:head>
	<title>Atlas — seu espaço de vida</title>
	<meta name="description" content="Registre e consulte seus dados de finanças, hábitos e tempo em um espaço local e pessoal." />
</svelte:head>

<svelte:window
	onpointermove={(event) => {
		if (habitPressTimer === undefined) return;
		if (Math.hypot(event.clientX - habitPressOrigin.x, event.clientY - habitPressOrigin.y) > 9) cancelHabitPress();
	}}
	onpointerup={cancelHabitPress}
	onpointercancel={cancelHabitPress}
	onkeydown={onShellKeydown}
/>

{#if !ready}
	<div class="loading-screen"><div class="loading-mark">A</div><span>Preparando seu Atlas…</span></div>
{:else if loadError}
	<div class="loading-screen"><div class="loading-mark">A</div><strong>Atlas não conseguiu abrir</strong><span>{loadError}</span><Button variant="secondary" onclick={() => { ready = false; loadError = ''; void initialize(); }}>Tentar novamente</Button></div>
{:else if snapshot}
	<div class:col={sidebarCollapsed} class="app-shell">
		<aside id="sb" aria-label="Navegação principal">
			<div class="sb-head">
				<div class="sb-logo">A</div>
				<b class="lab">Atlas</b>
				<button class="sb-col" aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'} onclick={toggleSidebar}><ChevronLeft size={18} /></button>
			</div>
			<div class="pf">
				<div class="ring">
					<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" fill="none" stroke="#272b27" stroke-width="4" /><circle class="v" cx="22" cy="22" r="18" fill="none" stroke="var(--acc)" stroke-width="4" stroke-linecap="round" stroke-dasharray="113" stroke-dashoffset={113 * (1 - levelPercent)} /></svg>
					<b>{levelProgress.level}</b>
				</div>
				<div class="lab">
					<b>Nível {levelProgress.level}</b>
					<div class="xb"><i style={`width:${levelPercent * 100}%`}></i></div>
					<div class="r2"><small>{levelProgress.currentXp}/{levelProgress.nextLevelXp} XP</small><span class="fire"><Flame size={14} fill="currentColor" /><span>{habitDayStreak}</span></span></div>
				</div>
			</div>
			<button class="sb-new" aria-expanded={quickMenuOpen} onclick={toggleQuickMenu}><Plus size={20} strokeWidth={2.6} /><span class="lab">Novo</span></button>
			{#if quickMenuOpen}
				<div class="qm-desk">
					<button onclick={() => quickAction('habit')}><Target size={18} />Hábito</button>
					<button onclick={() => quickAction('entry')}><Wallet size={18} />Lançamento</button>
					<button onclick={() => quickAction('note')}><NotebookPen size={18} />Nota</button>
				</div>
			{/if}
			<nav class="nv" aria-label="Seções">
				<i class="sind" style={`transform:translateY(${sidebarIndex * 46}px)`}></i>
				{#each navItems as item}
					<button class:on={activeTab === item.id} class="si" data-tip={item.label} onclick={() => goTab(item.id)}>
						<item.icon size={22} strokeWidth={2} /><span class="lab">{item.label}</span>
					</button>
				{/each}
			</nav>
			<div class="grow"></div>
			<nav class="nv" aria-label="Atalhos">
				<button class="si" data-tip="Lixeira" onclick={() => void openTrash()}><Trash2 size={22} strokeWidth={2} /><span class="lab">Lixeira</span></button>
				<button class="si" data-tip="Pausar Atlas" onclick={() => { closeShellMenus(); modal = 'pause'; }}><Flame size={22} strokeWidth={2} /><span class="lab">Pausa</span></button>
				<button class="si" data-tip="Configurações" onclick={() => { closeShellMenus(); openSettings(); }}><Settings2 size={22} strokeWidth={2} /><span class="lab">Configurações</span></button>
			</nav>
		</aside>

		<header class="tb">
			<h1>{#each navItems as item}{#if item.id === activeTab}<item.icon size={22} />{/if}{/each}{activeNavItem.label}</h1>
			<span class="fire" aria-label={`Sequência de ${habitDayStreak} dias`}><Flame size={20} fill="currentColor" /><span>{habitDayStreak}</span></span>
			<div class="lv" aria-label={`Nível ${levelProgress.level}`}><b>{levelProgress.level}</b><div class="xb"><i style={`width:${levelPercent * 100}%`}></i></div></div>
		</header>

		<main class="workspace">
			<div id="pg" class={navDirection >= 0 ? 'inr' : 'inl'}>
				{#if activeTab === 'dashboard'}
					<section class="dash-prototype" aria-label="Visão geral">
						<div class="dash-top">
							<div><h1>Hoje</h1><small>{humanDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
						</div>
						<div class="dash-period">
							<div class="dash-slide" role="tablist" aria-label="Período do dashboard" style={`--i:${period === 'week' ? 0 : period === 'month' ? 1 : 2}`}>
								<span class="dash-slide-knob"></span>
								<button role="tab" aria-selected={period === 'week'} class:on={period === 'week'} onclick={() => changePeriod('week')}>Esta semana</button>
								<button role="tab" aria-selected={period === 'month'} class:on={period === 'month'} onclick={() => changePeriod('month')}>Este mês</button>
								<button role="tab" aria-selected={period === 'custom'} class:on={period === 'custom'} onclick={() => changePeriod('custom')}>Personalizado</button>
							</div>
							<div class="dash-dots">
								<button aria-label="Esta semana" class:on={period === 'week'} onclick={() => changePeriod('week')}></button>
								<button aria-label="Este mês" class:on={period === 'month'} onclick={() => changePeriod('month')}></button>
								<button aria-label="Personalizado" class:on={period === 'custom'} onclick={() => changePeriod('custom')}></button>
							</div>
							{#if period === 'custom'}<div class="dash-range"><input aria-label="Início do período" type="date" bind:value={customStart} /><span>→</span><input aria-label="Fim do período" type="date" bind:value={customEnd} /></div>{/if}
							<span class="dash-range-label">{humanDate(currentRange.start)} — {humanDate(currentRange.end)}</span>
						</div>
						<div class="dash-grid">
							<article class="dash-card dash-w2 dash-life">
								<h3>Life Force</h3>
								<div class="dash-life-row"><strong>{lifeForcePercent}%</strong><span>{lifeForceLabel}</span></div>
								<div class="dash-bar"><i style={`width:${lifeForcePercent}%`}></i></div>
							</article>
							<div class="dash-card dash-cat" aria-hidden="true">
								<svg class="dash-cat-svg" viewBox="0 0 120 100"><path class="bd" d="M16 42L20 6L54 26Z" /><path class="bd" d="M104 42L100 6L66 26Z" /><ellipse class="bd" cx="60" cy="60" rx="48" ry="38" /><path class="cl" d="M31 58q10 8 20 0M69 58q10 8 20 0" /><path d="M55 69h10l-5 6z" fill="#f1a5c5" /><path d="M60 75q-6 7-12 2M60 75q6 7 12 2" fill="none" stroke="#8d968a" stroke-width="2" stroke-linecap="round" /><text class="z" x="100" y="22">z</text></svg>
								<b>Invocar</b><small>Em breve</small>
							</div>
							<button type="button" class="dash-card dash-goal" aria-label="Definir meta do dia" onclick={openDayGoal}>
								<div class="dash-ring"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="39" fill="none" stroke="var(--panel-2)" stroke-width="10" /><circle cx="48" cy="48" r="39" fill="none" stroke="var(--lime)" stroke-width="10" stroke-linecap="round" stroke-dasharray="245" stroke-dashoffset={245 * (1 - dashGoalPercent)} /></svg><div class="dash-ring-center">{Math.min(prototypeTodayDone, prototypeTodayGoal)}/{prototypeTodayGoal}</div></div>
								<small>Meta do dia</small>
							</button>
							<article class="dash-card dash-w2">
								<h3>Saldo · {dashPeriodLabel}</h3>
								<div class="dash-big">{money(dashBalance, currency())}</div>
								<div class="dash-line">
									<svg viewBox="0 0 300 90" aria-hidden="true"><defs><linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--lime)" stop-opacity=".3" /><stop offset="1" stop-color="var(--lime)" stop-opacity="0" /></linearGradient></defs><path d={dashSpark.area} fill="url(#dashGrad)" /><path class="dr" d={dashSpark.line} /></svg>
									<i class="pt" style={`left:${dashSpark.left}%;top:${dashSpark.top}%`}></i>
								</div>
							</article>
							<article class="dash-card dash-w2">
								<h3>Tempo · {dashPeriodLabel}</h3>
								{#if dashTime.empty}
									<p class="dash-empty">Sem tempo alocado no período.</p>
								{:else}
									<div class="dash-bars" style={`grid-template-columns: repeat(${dashTime.days.length}, minmax(0, 1fr))`}>
										{#each dashTime.days as day}
											<div class="dash-col"><div class="dash-stack">{#each day.segments as segment}<span class="dash-col-seg" style={`height:${segment.percent}%;background:${segment.color}`}><b class="dash-tip">{segment.name} · {formatMinutes(Math.round(segment.hours * 60))}</b></span>{/each}</div><small>{day.label}</small></div>
										{/each}
									</div>
									<div class="dash-legend">{#each dashTime.legend as item}<span><i style={`background:${item.color}`}></i>{item.name}</span>{/each}</div>
								{/if}
							</article>
							<article class="dash-card dash-w2">
								<h3>Gastos · {dashPeriodLabel}</h3>
								{#if dashExpenses.total}
									<div class="dash-donut-wrap">
										<div class="dash-donut">
											<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="var(--panel-2)" stroke-width="14" />{#each dashExpenses.segments as segment}<circle cx="50" cy="50" r="38" fill="none" stroke={segment.color} stroke-width="14" stroke-dasharray={segment.dash} stroke-dashoffset={segment.offset} />{/each}</svg>
											<div class="dash-donut-center">{dashExpenses.label}</div>
										</div>
										<div class="dash-legend">{#each dashExpenses.segments as segment}<span><i style={`background:${segment.color}`}></i>{categoryName(segment.categoryId)}</span>{/each}</div>
									</div>
								{:else}
									<p class="dash-empty">Sem gastos no período.</p>
								{/if}
							</article>
							<article class="dash-card dash-w2">
								<h3>Hábitos · {dashPeriodLabel}</h3>
								<div class="dash-heat">{#each dashHabitDays as day}<i class:td={day.today} class:paused={day.paused} style={`--v:${day.value.toFixed(2)}`}></i>{/each}</div>
							</article>
							<article class="dash-card dash-w4">
								<h3>Objetivos</h3>
								{#if dashObjectives.rows.length}
									{#each dashObjectives.rows as row}
										<button class="dash-obj" onclick={() => setActiveTab('graph')}>
											<div class="dash-obj-head"><span><i style={`background:${row.color}`}></i>{row.name}</span><small>{row.milestone ? 'Marco' : 'Objetivo'} · {Math.round(row.ratio * 100)}%</small></div>
											<div class="dash-track"><i style={`width:${Math.max(0, Math.min(100, row.ratio * 100))}%`}></i></div>
										</button>
									{/each}
									{#if dashObjectives.extra}<button class="dash-more" onclick={() => setActiveTab('graph')}>+{dashObjectives.extra} na aba Planejamento</button>{/if}
								{:else}
									<p class="dash-empty">Sem objetivos no grafo ainda.</p>
								{/if}
							</article>
						</div>
					</section>
				{:else if activeTab === 'finance'}
					<section class="fin-prototype" aria-label="Finanças">
						<div class:over={financeBudget.over} class="fin-budget">
							<div class="fin-budget-head">
								<span>Orçamento do mês</span>
								<small>{money(financeBudget.spentMinor, currency())} de {money(financeBudget.allocatedMinor, currency())}</small>
							</div>
							<div class="fin-budget-track" role="progressbar" aria-label="Orçamento do mês" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(financeBudget.ratio * 100)}><i style={`width:${financeBudget.ratio * 100}%`}></i></div>
							<small class="fin-budget-note">
								{#if financeBudget.allocatedMinor === 0}
									Sem orçamento definido
								{:else if financeBudget.over}
									{money(-financeBudget.remainingMinor, currency())} acima
								{:else}
									restam {money(financeBudget.remainingMinor, currency())}
								{/if}
							</small>
						</div>
						<div class="fin-top">
							<h1>{financeMonthLabel}</h1>
						</div>
						<div class="fin-grid">
							<div class="fin-card fin-w2 fin-hero">
								<div>
									<h3>Saldo do mês</h3>
									<div class:neg={financeBalance < 0} class="fin-big">{money(financeBalance, currency())}</div>
									<small>+ {money(financeIncome, currency())}<br />− {money(financeExpense, currency())}</small>
								</div>
								<button type="button" class="fin-ring-wrap" aria-label="Definir meta de economia" onclick={openFinanceGoal}>
									<div class="fin-ring">
										<svg viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="37" class="fin-ring-track"/><circle cx="46" cy="46" r="37" class="fin-ring-value" style={`stroke-dashoffset:${233 * (1 - financeGoalPercent)}`}/></svg>
										<div class="fin-ring-center">{Math.round(financeGoalPercent * 100)}%</div>
									</div>
									<small class="fin-ring-caption">meta {money(financeGoal, currency())}</small>
								</button>
							</div>
						</div>
						<p class="fin-cats-label">Categorias · {financeGreenCount} de {financeExpenseCategories.length} no verde</p>
						<div class="fin-grid">
							{#each financeCategories as category}
								{@const isIncome = category.kind === 'in'}
								{@const total = categoryTotal(category.id)}
								{@const status = categoryLimitStatus(category, total)}
								{#if isIncome}
									<button class="fin-card fin-cat-card in" data-fin-cat={category.id} style={`--cc:${category.color};--cc-soft:${hexToRgba(category.color, 0.26)}`} onclick={() => { if (!financeCatPressSuppress) openFinanceEntry('income', category.id); }} onpointerdown={(event) => startFinanceCatPress(event, category)} onpointermove={moveFinanceCatPress} onpointerup={cancelFinanceCatPress} onpointercancel={cancelFinanceCatPress} oncontextmenu={(event) => openFinanceCategoryContext(event, category)}>
										<b title={category.name}><i></i><span>{category.name}</span></b>
										<span><span class="v">+{money(total, currency())}</span></span>
									</button>
								{:else}
									<button class:over={status.mode === 'limit' && status.over} class:goal-mode={status.mode === 'goal'} class:goal-hit={status.mode === 'goal' && status.reached} class="fin-card fin-cat-card" data-fin-cat={category.id} style={`--cc:${category.color};--cc-soft:${hexToRgba(category.color, 0.26)};--p:${status.displayRatio}`} onclick={() => { if (!financeCatPressSuppress) openFinanceEntry('expense', category.id); }} onpointerdown={(event) => startFinanceCatPress(event, category)} onpointermove={moveFinanceCatPress} onpointerup={cancelFinanceCatPress} onpointercancel={cancelFinanceCatPress} oncontextmenu={(event) => openFinanceCategoryContext(event, category)}>
										<b title={category.name}><i></i><span>{category.name}</span></b>
										<span>
											<span class="v">{money(total, currency())}</span>
											{#if status.limitMinor > 0}
												<br />
												{#if status.mode === 'goal'}
													<span class:goal-badge={status.reached} class="sm">{status.reached ? (status.percentBeyond > 0 ? `+${status.percentBeyond}% além da meta` : 'meta batida') : `faltam ${money(status.remainingMinor, currency())}`}</span>
												{:else}
													<span class="sm">{status.over ? `+${money(total - status.limitMinor, currency())} acima` : `restam ${money(status.remainingMinor, currency())}`}</span>
												{/if}
											{/if}
										</span>
									</button>
								{/if}
							{/each}
							<button class="fin-card fin-cat-card fin-new" onclick={() => openFinanceCategory(false)}>+ Categoria</button>
						</div>
						<div class="fin-card fin-w2 fin-lanc-card" style="margin-top:6px">
							<h3>Lançamentos</h3>
							{#if financeRecent.length}
								{#each financeRecent as item}
									{@const itemCategory = currentCategory(item.categoryId)}
									<div class="fin-row">
										<i class="dot" style={`background:${itemCategory?.color ?? '#888888'}`}></i>
										<span>{itemCategory?.name ?? '—'}<small>{shortDay(item.date)}</small></span>
										<b style={`color:${item.type === 'income' ? 'var(--fp-acc)' : 'var(--fp-tx)'}`}>{item.type === 'income' ? '+' : '−'} {money(item.amountMinor, currency())}</b>
										<button class="x" aria-label="Remover lançamento" onclick={() => removeFinanceTransaction(item.id)}>×</button>
									</div>
								{/each}
							{:else}
								<div class="fin-if-empty">Nenhum lançamento ainda.</div>
							{/if}
						</div>
						{#if testModeActive}
							<div class="fin-dev"><button onclick={clearFinanceTransactions}>Limpar lançamentos</button></div>
						{/if}
					</section>
				{:else if activeTab === 'habits'}
					{#if snapshot}
						<div class="habit-switch">
							<Segmented
								label="Seção de hábitos"
								options={[
									{ value: 'habits', label: 'Hábitos' },
									{ value: 'trackers', label: 'Trackers' }
								]}
								value={habitView}
								onchange={(value) => changeHabitView(value === 'trackers' ? 'trackers' : 'habits')}
							/>
						</div>
						<div
							class="habit-pager"
							role="group"
							aria-label="Hábitos e trackers"
							bind:this={habitPagerEl}
							onscroll={onHabitScroll}
							use:scrollEnd
						>
							<div class="habit-pane" aria-hidden={habitView !== 'habits'} inert={habitView !== 'habits'}>
									<section class="habit-prototype" aria-label="Hábitos">
										<div class="habit-prototype-top">
											<div class="habit-prototype-level"><small>Nível {levelProgress.level}</small><div class="habit-prototype-xpbar"><i style={`width:${levelProgress.currentXp / levelProgress.nextLevelXp * 100}%`}></i></div></div>
										</div>

										<div class="habit-prototype-grid">
											<button type="button" class="habit-prototype-card habit-prototype-wide habit-prototype-hero" aria-label="Definir meta do dia" onclick={openDayGoal}>
												<div class="habit-prototype-ring"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="34" class="habit-prototype-ring-track"/><circle cx="42" cy="42" r="34" class="habit-prototype-ring-value" style={`stroke-dashoffset:${214 * (1 - (prototypeTodayGoal ? Math.min(prototypeTodayDone, prototypeTodayGoal) / prototypeTodayGoal : 0))}`}/></svg><strong>{Math.min(prototypeTodayDone, prototypeTodayGoal)}<small>/{prototypeTodayGoal}</small></strong></div>
												<div><h2>{prototypeTodayGoal > 0 && prototypeTodayDone >= prototypeTodayGoal ? 'Meta concluída' : 'Meta do dia'}</h2><p>{prototypeTodayGoal > 0 && prototypeTodayDone >= prototypeTodayGoal ? 'Continue se quiser ir além' : `Faltam ${Math.max(0, prototypeTodayGoal - prototypeTodayDone)}`}</p></div>
											</button>
											<section class="habit-prototype-card habit-prototype-wide habit-prototype-week" aria-label="Sequência da semana">
												{#each habitWeekDays as day, index}
													{@const reached = day.goal > 0 && day.done >= day.goal}
													<div class:done={reached} class:today={day.date === today} class="habit-prototype-day"><span>{#if reached}<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}</span>{day.label[0].toUpperCase()}</div>
												{/each}
											</section>
										</div>

										<div class="habit-prototype-grid habit-prototype-habits">
											<button class="habit-prototype-card habit-prototype-empty" onclick={() => openHabit()}>
												<Plus size={20} /> Hábito
											</button>
											{#each snapshot.habits.filter((habit) => habit.active) as habit (habit.id)}
												{@const scheduledToday = habit.metric === 'weekly' || habit.scheduledDays.includes(new Date(`${today}T12:00:00`).getDay())}
												{#if habit.metric === 'weekly'}
													{@const count = weeklyValue(habit)}
													{@const complete = count >= habit.target}
													{@const weekLog = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === weekStartDate(today, firstDayOfWeek()))}
													{@const touched = Boolean(weekLog?.incrementDates?.includes(today) || weekLog?.lastIncrementDate === today)}
													<div class="hcard habit-prototype-wide">
														<section role="group" class:done={complete} class:touched class="habit-prototype-card habit-prototype-wide habit-prototype-pips" data-habit-id={habit.id} onpointerdown={(event) => startHabitPress(event, habit)}>
															<div class="habit-prototype-row"><b>{habit.name}<span class="habit-week-chip">semana</span></b><small>{count} de {habit.target} na semana</small></div>
															<div class="habit-prototype-pip-track">
																{#each Array.from({ length: WEEK_MAX }, (_, index) => index + 1) as step}
																	<button class="habit-prototype-pip" class:on={step <= count} class:goal={step === habit.target} aria-label={`${step} de ${WEEK_MAX} na semana`} aria-pressed={step <= count} onclick={() => { if (habitPressSuppress) return; setWeeklyValue(habit, count === step ? step - 1 : step); }}></button>
																{/each}
															</div>
														</section>
														<button class="hcard-more" aria-label={`Opções de ${habit.name}`} onclick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openHabitMenu(habit, rect.left, rect.bottom + 6); }}><MoreHorizontal size={16} /></button>
													</div>
												{:else}
													{@const log = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === today)}
													{@const value = log?.value ?? 0}
													{@const complete = log ? didMeetTarget(habit, value) : false}
													{@const progress = log ? habitProgress(habit, value) : 0}
													{@const label = habit.metric === 'boolean' ? (!scheduledToday && !log ? '–' : log ? booleanLabelOf(habit, value, HABIT_BOOLEAN_LABELS) : 'Hoje') : prototypeValue(habit, value)}
													<div class="hcard" class:off={!scheduledToday}>
														<button
															class:done={complete}
															class="habit-prototype-card habit-prototype-habit"
															data-habit-id={habit.id}
															style={`--habit-progress:${progress}`}
															onclick={() => {
																if (habitPressSuppress) return;
																if (habit.metric === 'boolean') logHabit(habit);
																else openHabitSheet(habit);
															}}
															oncontextmenu={(event) => { event.preventDefault(); openHabitMenu(habit, event.clientX, event.clientY); }}
															onpointerdown={(event) => startHabitPress(event, habit)}
														>
															<b>{habit.name}</b><span><span class="habit-prototype-value" class:idle={habit.metric === 'boolean' && !log}>{label}</span><br /><small>{!scheduledToday ? 'Fora de hoje' : habit.metric === 'boolean' ? (log ? (complete ? 'Concluído' : 'Registrado') : 'Toque para registrar') : `meta ${prototypeValue(habit, habit.target)}`}</small></span>{#if complete}<i class="habit-prototype-check"><Check size={15} /></i>{/if}
														</button>
														<button class="hcard-more" aria-label={`Opções de ${habit.name}`} onclick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openHabitMenu(habit, rect.left, rect.bottom + 6); }}><MoreHorizontal size={16} /></button>
													</div>
												{/if}
											{/each}
										</div>
										{#if testModeActive}
											<div class="habit-prototype-dev"><button onclick={resetPrototypeDay}>Reiniciar dia</button></div>
										{/if}
									</section>
								</div>
								<div class="habit-pane" aria-hidden={habitView !== 'trackers'} inert={habitView !== 'trackers'}>
									<TrackersView
										trackers={snapshot.trackers}
										entries={snapshot.trackerEntries}
										sound={snapshot.preferences.soundEnabled}
										haptics={snapshot.preferences.hapticsEnabled}
										oncreatetracker={(tracker) => saveTracker(tracker, true)}
										onupdatetracker={(tracker) => saveTracker(tracker, false)}
										onarchive={archiveTracker}
										ondeletetracker={deleteTracker}
										oncreateentry={(entry) => saveTrackerEntry(entry, true)}
										onupdateentry={(entry) => saveTrackerEntry(entry, false)}
										ondeleteentry={deleteTrackerEntry}
									/>
								</div>
						</div>
					{/if}
				{:else if activeTab === 'time'}
					<section class="tp-prototype" aria-label="Tempo">
						<div class="tp-top">
							<div><h1>Tempo</h1><small class="tp-info">{timeTotalsLabel}</small></div>
							<div class="tp-top-actions">
								<button class="tp-ic" aria-label="Período" title="Selecionar período" onclick={() => (timeCalendarOpen = true)}><CalendarDays size={18} /></button>
								<button class="tp-ic" aria-label="Resumo" onclick={openTimeSummary}>Σ</button>
							</div>
						</div>
						<div class="tp-wkb" bind:this={timeWeekBarsEl}>
							{#each timeWeekBars as item, index}
								<button style={`width:${Math.max(36, timeColumnWidth - 4)}px`} class:td={index === timeTodayIndex} class:vis={index >= timeVisibleStart && index < timeVisibleStart + timeVisibleCount} onclick={() => scrollToDay(index)}>{item.label[0]}<b>{item.dayNumber}</b><span class="tp-bar"><i style={`width:${item.percent}%`}></i></span></button>
							{/each}
						</div>
						<div class="tp-pal">
							{#each timeCategories as category}
								{@const hours = timeCategoryHours(category.id)}
								{@const rangeGoal = ((category.weeklyGoalHours ?? 0) * timeRangeDays) / 7}
								<button class:on={timeSelected === category.id} class="tp-cat" style={`--cc:${category.color}`} onclick={() => selectTimeCategory(category.id)}><i></i>{category.name}{#if rangeGoal > 0}<small>{hmSlots(hours * 2)}/{hmSlots(rangeGoal * 2)}</small>{/if}</button>
							{/each}
							<button class:on={timeSelected === 'x'} class="tp-cat" style="--cc:#828d7d" onclick={() => selectTimeCategory('x')}><i></i>Borracha</button>
							<button class="tp-cat add" onclick={() => openTimeCategorySheet(null)}>+ Categoria</button>
						</div>
						<div class="tp-scroll" bind:this={timeScroll} onscroll={handleTimeScroll} style={`--tp-cw:${timeColumnWidth}px`}>
							<div class="tp-head" style={`grid-template-columns:38px repeat(${timeRangeDays}, var(--tp-cw))`}>
								<span class="tp-corner"></span>
								{#each timeHeaderDays as header, index}<span class:td={index === timeTodayIndex} class="tp-h">{header.label}<b>{header.dayNumber}</b></span>{/each}
							</div>
							<div class="tp-grid" role="grid" tabindex="0" aria-label="Grade de tempo" style={`grid-template-columns:38px repeat(${timeRangeDays}, var(--tp-cw))`} bind:this={timeGridEl} onpointerdown={beginTimePaint} oncontextmenu={(event) => event.preventDefault()} use:timeGestures>
								{#each Array.from({ length: TIME_SLOT_COUNT }, (_, index) => index) as slot}
									<span class="tp-rl">{slot % 2 === 0 ? `${String(TIME_SLOT_START_HOUR + slot / 2).padStart(2, '0')}:00` : ''}</span>
									{#each Array.from({ length: timeRangeDays }, (_, index) => index) as day}
										{@const cell = timeCellData(day, slot)}
										{@const cellBlock = timeGridBlocks[day]?.[slot] ?? null}
										{@const hasNotes = cellBlock ? timeBlockNotes.has(cellBlock) : false}
										<div class:on={cell.categoryId} class:st={cell.isStart} class:en={cell.isEnd} class:hr={slot % 2 === 0} class:nt={hasNotes} class="tp-c" style={cell.categoryId ? `--cc:${cell.color}` : ''} data-tp-day={day} data-tp-slot={slot} data-tp-block={cellBlock ?? ''} aria-label={`${timeHeaderDays[day].label} ${slotToTime(slot)}${hasNotes ? ' · tem nota' : ''}`}>{cell.label}</div>
									{/each}
								{/each}
								{#if timeNow}<div class="tp-now" style={`top:${timeNow.top}px;left:${timeNow.left}px;width:${timeNow.width}px`}></div>{/if}
							</div>
						</div>
					</section>
				{:else if activeTab === 'notes'}
					{#key notesVersion}
						<NotesView
							sound={snapshot.preferences.soundEnabled}
							typingSound={snapshot.preferences.typingSoundEnabled}
							haptics={snapshot.preferences.hapticsEnabled}
							createToken={notesCreateToken}
							timeBlocks={snapshot.timeBlocks}
							openNoteId={notesOpenId}
							openNoteToken={notesOpenToken}
							reloadToken={notesReloadToken}
							onchange={(state) => (notesState = state)}
							oncreate={onNoteCreated}
							ontoast={toastMessage}
						/>
					{/key}
				{:else if activeTab === 'graph'}
					<GraphView snapshot={snapshot} oncommit={commitGraph} ontoast={graphToast} />
				{/if}
			</div>
			{#if activeTab === 'finance'}
				<button class="fin-fab" aria-label="Novo lançamento" onclick={() => openFinanceEntry()}>+</button>
			{/if}
		</main>

		<nav id="bn" aria-label="Navegação rápida">
			<div class="bg"></div>
			<i class="ind" style={`left:calc((${bottomIndex} + 0.5) * 20% - 13px)`}></i>
			<button class:on={activeTab === 'dashboard'} aria-label="Visão geral" onclick={() => goTab('dashboard')}><LayoutDashboard size={23} /><span>Visão</span></button>
			<button class:on={activeTab === 'habits'} aria-label="Hábitos" onclick={() => goTab('habits')}><Target size={23} /><span>Hábitos</span></button>
			<span class="sp"></span>
			<button class:on={activeTab === 'time'} aria-label="Tempo" onclick={() => goTab('time')}><CalendarDays size={23} /><span>Tempo</span></button>
			<button class:on={MORE_TABS.includes(activeTab)} aria-label="Mais" aria-expanded={moreMenuOpen} onclick={toggleMoreMenu}><Menu size={23} /><span>Mais</span></button>
			<button id="plus" class:on={quickMenuOpen} aria-label="Adicionar" aria-expanded={quickMenuOpen} onclick={toggleQuickMenu}>
				<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="pl" d="M12 5v14M5 12h14" /><circle class="rg" cx="12" cy="12" r="7" /></svg>
			</button>
		</nav>

		<div id="qm" class:on={quickMenuOpen}>
			<button class="qi" onclick={() => quickAction('habit')}><span class="qc"><Target size={24} /></span><span>Hábito</span></button>
			<button class="qi" onclick={() => quickAction('entry')}><span class="qc"><Wallet size={24} /></span><span>Lançamento</span></button>
			<button class="qi" onclick={() => quickAction('note')}><span class="qc"><NotebookPen size={24} /></span><span>Nota</span></button>
		</div>

		<div id="mm" class:on={moreMenuOpen}>
			{#each MORE_TABS as key, index}
				{@const tab = navItems.find((item) => item.id === key)}
				{#if tab}
					{@const TabIcon = tab.icon}
					<button class="mi" style={`--i:${index}`} onclick={() => goTab(tab.id)}><TabIcon size={22} />{tab.label}</button>
				{/if}
			{/each}
			<button class="mi" style="--i:3" onclick={() => void openTrash()}><Trash2 size={22} />Lixeira</button>
			<button class="mi hr" style="--i:4" onclick={() => { closeShellMenus(); modal = 'pause'; }}><Flame size={22} />Pausa</button>
			{#if testModeActive}
				<button class="mi warn" style="--i:5" onclick={() => { closeShellMenus(); void toggleTestMode(false); }}><FlaskConical size={22} />Sair do modo de teste</button>
			{/if}
			<button class="mi" style={`--i:${testModeActive ? 6 : 5}`} onclick={() => { closeShellMenus(); openSettings(); }}><Settings2 size={22} />Configurações</button>
		</div>

		<div id="ov" class:on={quickMenuOpen || moreMenuOpen} role="presentation" onclick={closeShellMenus}></div>
	</div>

	{#if noteOverlay && snapshot}
		{#key noteOverlay.id}
			<NoteEditor
				note={noteOverlay}
				notesList={overlayNotes}
				folders={notesState.folders}
				timeBlocks={snapshot.timeBlocks}
				open={noteOverlayOpen}
				initialMode={noteOverlayMode}
				onmode={setOverlayMode}
				morphFrom={noteOverlayMorph}
				sound={snapshot.preferences.soundEnabled}
				typingSound={snapshot.preferences.typingSoundEnabled}
				haptics={snapshot.preferences.hapticsEnabled}
				backlinks={overlayBacklinks}
				onpatch={patchOverlayNote}
				onpin={pinOverlayNote}
				ondeletenote={() => void deleteOverlayNote()}
				onopenfolder={() => void openOverlayFolder()}
				onclose={() => void closeNoteOverlay()}
				onwikilink={(title) => void openOverlayWikiLink(title)}
				onopenbacklink={(note) => void openOverlayBacklink(note)}
				ontoast={toastMessage}
			/>
		{/key}
	{/if}

	{#if trashOpen}
		<TrashSheet
			events={trashEvents}
			onclose={() => (trashOpen = false)}
			onrestore={restoreFromTrash}
			onforget={forgetFromTrash}
		/>
	{/if}

	{#if plannerNotesOpen}
		<PlannerNotesSheet
			items={plannerNotesItems}
			onopen={openPlannerNote}
			onclose={closePlannerNotes}
		/>
	{/if}

	{#if plannerNoteOpen}
		<PlannerNoteSheet
			note={plannerNoteOpen}
			onopenfull={(note) => {
				closePlannerNote();
				closePlannerNotes();
				openNoteFromPlanner(note.id);
			}}
			onclose={closePlannerNote}
		/>
	{/if}

	{#if habitSheet}
		{@const sheetHabit = habitSheet}
		<ValueSheet
			title={sheetHabit.name}
			value={habitSheetValue}
			max={prototypeSheetMax(sheetHabit)}
			step={prototypeSheetStep(sheetHabit)}
			unit={sheetHabit.metric === 'duration' ? '' : sheetHabit.unit}
			duration={sheetHabit.metric === 'duration'}
			hint={`Meta ${prototypeValue(sheetHabit, sheetHabit.target)}`}
			accentAt={sheetHabit.target}
			saveLabel="Registrar"
			presets={prototypePresets(sheetHabit).map((preset) => ({
				value: preset,
				label: sheetHabit.unit.toLowerCase() === 'ml' ? `+${prototypeValue(sheetHabit, preset)}` : prototypeValue(sheetHabit, preset),
				additive: sheetHabit.unit.toLowerCase() === 'ml'
			}))}
			onchange={updateHabitSheetValue}
			onsave={saveHabitSheet}
			onclose={() => (habitSheet = null)}
		/>
	{/if}

	{#if habitHistory}
		<HabitHistorySheet
			habit={habitHistory}
			logs={snapshot?.habitLogs.filter((log) => log.habitId === habitHistory!.id) ?? []}
			onopen={(log) => openHabitLogEdit(habitHistory!, log)}
			onclose={() => {
				habitHistory = null;
				habitLogEdit = null;
			}}
		/>
	{/if}

	{#if habitLogEdit}
		{@const editHabit = habitLogEdit.habit}
		{#if editHabit.metric === 'boolean'}
			<Sheet title="Editar registro" closeLabel="Fechar" onclose={() => (habitLogEdit = null)}>
				<form
					class="sheet-form"
					onsubmit={(event) => {
						event.preventDefault();
						void saveHabitLogEdit();
					}}
				>
					<Segmented
						label="Registro"
						options={[
							{ value: '1', label: booleanLabelOf(editHabit, 1, HABIT_BOOLEAN_LABELS) },
							{ value: '0', label: booleanLabelOf(editHabit, 0, HABIT_BOOLEAN_LABELS) }
						]}
						value={String(habitLogEditValue)}
						onchange={(value) => (habitLogEditValue = value === '0' ? 0 : 1)}
					/>
					<div class="sheet-actions">
						<Button variant="danger" onclick={() => void deleteHabitLogEdit()}>Excluir</Button>
						<Button variant="secondary" onclick={() => (habitLogEdit = null)}>Cancelar</Button>
						<Button type="submit">Salvar</Button>
					</div>
				</form>
			</Sheet>
		{:else}
			<ValueSheet
				title={`Editar ${editHabit.name}`}
				value={habitLogEditValue}
				max={prototypeSheetMax(editHabit)}
				step={prototypeSheetStep(editHabit)}
				unit={editHabit.metric === 'duration' ? '' : editHabit.unit}
				duration={editHabit.metric === 'duration'}
				hint={`Meta ${prototypeValue(editHabit, editHabit.target)}`}
				presets={editHabit.metric === 'weekly' ? [] : prototypePresets(editHabit).map((preset) => ({
					value: preset,
					label: prototypeValue(editHabit, preset)
				}))}
				saveLabel="Salvar"
				onchange={(value) => (habitLogEditValue = value)}
				onsave={() => void saveHabitLogEdit()}
				ondelete={() => void deleteHabitLogEdit()}
				onclose={() => (habitLogEdit = null)}
			/>
		{/if}
	{/if}

	{#if dayGoalSheet}
		<Sheet title="Meta do dia" closeLabel="Fechar" onclose={() => (dayGoalSheet = false)}>
			<div class="sheet-form">
				<p class="goal-hint">Quantos hábitos concluir por dia? Conta também os semanais.</p>
				<div class="goal-stepper">
					<button type="button" aria-label="Diminuir meta" onclick={() => setDayGoalDraft(dayGoalDraft - 1)}>−</button>
					<input
						type="number"
						min="1"
						max="12"
						inputmode="numeric"
						aria-label="Meta de hábitos por dia"
						value={dayGoalDraft}
						oninput={(event) => {
							const value = Number(event.currentTarget.value);
							if (Number.isInteger(value) && value >= 1 && value <= 12) dayGoalDraft = value;
						}}
						onchange={(event) => setDayGoalDraft(Number(event.currentTarget.value))}
						onkeydown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur();
						}}
					/>
					<button type="button" aria-label="Aumentar meta" onclick={() => setDayGoalDraft(dayGoalDraft + 1)}>+</button>
				</div>
				<div class="goal-chips">
					{#each [1, 2, 3, 4, 5, 6, 7] as value}
						<button type="button" class:on={dayGoalDraft === value} aria-label={`Meta ${value}`} onclick={() => setDayGoalDraft(value)}>{value}</button>
					{/each}
				</div>
				<div class="sheet-actions">
					<Button variant="secondary" onclick={() => (dayGoalSheet = false)}>Cancelar</Button>
					<Button onclick={saveDayGoal}>Salvar</Button>
				</div>
			</div>
		</Sheet>
	{/if}

	{#if habitMenu}
		<CardMenu
			x={habitMenu.x}
			y={habitMenu.y}
			onclose={() => (habitMenu = null)}
			items={[
				{ label: 'Histórico', icon: History, action: () => openHabitHistory(habitMenu!.habit) },
				{ label: 'Editar', icon: Pencil, action: () => openHabit(habitMenu!.habit) },
				{
					label: habitMenu.habit.active ? 'Arquivar' : 'Reativar',
					icon: habitMenu.habit.active ? Archive : ArchiveRestore,
					action: () => archiveHabit(habitMenu!.habit, !habitMenu!.habit.active)
				},
				{ label: 'Excluir', danger: true, action: () => deleteHabit(habitMenu!.habit) }
			]}
		/>
	{/if}

	{#if habitCelebration !== null}
		<div class="habit-prototype-celebration" role="dialog" aria-modal="true" aria-label="Meta do dia concluída">
			<svg viewBox="0 0 24 24" width="120" height="120" aria-hidden="true"><path fill="currentColor" d="M12 2c.8 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.6-3.8 2.6-5.6.9 1.7 2.1 1.9 2.1.3 0-1.8.1-3.6.8-5.7z"/></svg>
			<strong>{habitCelebration}</strong><h2>Meta do dia concluída</h2><p>dias seguidos</p><button class="habit-prototype-save" onclick={() => (habitCelebration = null)}>Continuar</button>
		</div>
	{/if}

	{#if financeEntry.open}
		<div class="fin-overlay" role="presentation" onpointerdown={onFinOverlayPointerDown} onclick={(event) => onFinOverlayClick(event, () => (financeEntry = { ...financeEntry, open: false }))}>
			<div class="fin-sheet" role="dialog" aria-modal="true" aria-label="Novo lançamento">
				<div class="fin-grip"></div>
				<div class="fin-seg"><button class:on={financeEntry.type === 'expense'} onclick={() => setFinanceEntryType('expense')}>Despesa</button><button class:on={financeEntry.type === 'income'} onclick={() => setFinanceEntryType('income')}>Receita</button></div>
				<div class:in={financeEntry.type === 'income'} class="fin-amt">{money(financeEntry.amountMinor, currency())}</div>
				<input class="fin-inp" placeholder="Descrição (opcional)" maxlength="40" bind:value={financeEntry.description} />
				<div class="fin-chips">{#each financeEntryCategories as category}<button class:on={financeEntry.categoryId === category.id} class="fin-chip" style={`--cc:${category.color}`} onclick={() => setFinanceEntryCategory(category.id)}><i></i>{category.name}</button>{/each}<button class="fin-chip fin-new" onclick={() => openFinanceCategory(true)}>+ Nova</button></div>
				<div class="fin-kp">{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as key}<button onclick={() => financeKey(key)}>{key}</button>{/each}</div>
				<button class="fin-btn" disabled={!financeEntry.amountMinor || !financeEntry.categoryId} onclick={addFinanceTransaction}>Lançar</button>
			</div>
		</div>
	{/if}

	{#if financeCategoryForm.open}
		<div class="fin-overlay" role="presentation" onpointerdown={onFinOverlayPointerDown} onclick={(event) => onFinOverlayClick(event, closeFinanceCategoryForm)}>
			<div class="fin-sheet" role="dialog" aria-modal="true" aria-label={financeCategoryForm.id ? 'Editar categoria' : 'Nova categoria'}>
				<div class="fin-grip"></div>
				{#if !financeCategoryForm.id}
					<div class="fin-seg"><button class:on={financeCategoryForm.type === 'expense'} onclick={() => setFinanceCategoryType('expense')}>Despesa</button><button class:on={financeCategoryForm.type === 'income'} onclick={() => setFinanceCategoryType('income')}>Receita</button></div>
				{/if}
				<input class="fin-inp" placeholder="Nome da categoria" maxlength="40" title={financeCategoryForm.name} bind:value={financeCategoryForm.name} />
				<div class="fin-sw">{#each FINANCE_COLORS as color}<button class:on={financeCategoryForm.color === color} style={`--cc:${color}`} aria-label="Cor" onclick={() => (financeCategoryForm = { ...financeCategoryForm, color })}></button>{/each}</div>
				{#if financeCategoryForm.type === 'expense'}
					<div class="fin-seg fin-mode" role="group" aria-label="Tipo de limite">
						<button class:on={financeCategoryForm.limitMode === 'limit'} onclick={() => setFinanceLimitMode('limit')}>Limite</button>
						<button class="goal" class:on={financeCategoryForm.limitMode === 'goal'} onclick={() => setFinanceLimitMode('goal')}>Meta</button>
					</div>
					<small class="fin-mode-hint">{financeCategoryForm.limitMode === 'goal' ? 'Atingir ou passar é positivo.' : 'Passar do limite vira aviso.'}</small>
					<div class:goal-mode={financeCategoryForm.limitMode === 'goal'} class="fin-lim">
						<span>R$</span>
						<input
							class="fin-lim-input"
							inputmode="decimal"
							aria-label={financeCategoryForm.limitMode === 'goal' ? 'Meta mensal' : 'Limite mensal'}
							value={moneyInput(financeCategoryForm.limitMinor)}
							onchange={handleFinanceLimitInput}
							onkeydown={(event) => {
								if (event.key === 'Enter') event.currentTarget.blur();
							}}
						/>
						<span>/ mês</span>
					</div>
					<input type="range" min="0" max={Math.max(3000, financeCategoryForm.limitMinor / 100)} step="50" aria-label={financeCategoryForm.limitMode === 'goal' ? 'Meta mensal (slider)' : 'Limite mensal (slider)'} value={financeCategoryForm.limitMinor / 100} style={`--f:${financeCategoryForm.limitMinor / 100 / Math.max(3000, financeCategoryForm.limitMinor / 100) * 100}%`} oninput={(event) => setFinanceLimit(Number(event.currentTarget.value) * 100)} />
					<div class="fin-chips" style="justify-content:center;margin-top:12px">{#each [200, 500, 1000, 2000] as value}<button class="fin-chip" onclick={() => setFinanceLimit(value * 100)}>{money(value * 100, currency())}</button>{/each}</div>
				{/if}
				<button class="fin-btn" onclick={createFinanceCategory}>{financeCategoryForm.id ? 'Salvar' : 'Criar categoria'}</button>
				{#if financeCategoryForm.id}
					<button
						type="button"
						class="fin-btn fin-del"
						class:arming={financeDeleteArm === 'arming'}
						class:armed={financeDeleteArm === 'armed'}
						onclick={armFinanceCategoryDelete}
					>
						{#if financeCategoryLinkedCount === 0}
							Excluir categoria
						{:else if financeDeleteArm === 'arming'}
							Excluir em 5 s…
						{:else if financeDeleteArm === 'armed'}
							Excluir categoria e {financeCategoryLinkedCount} lançamento{financeCategoryLinkedCount === 1 ? '' : 's'}
						{:else}
							Excluir categoria ({financeCategoryLinkedCount} lançamento{financeCategoryLinkedCount === 1 ? '' : 's'})
						{/if}
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if financeGoalSheet.open}
		<div class="fin-overlay" role="presentation" onpointerdown={onFinOverlayPointerDown} onclick={(event) => onFinOverlayClick(event, () => (financeGoalSheet = { ...financeGoalSheet, open: false }))}>
			<div class="fin-sheet" role="dialog" aria-modal="true" aria-label="Meta de economia">
				<div class="fin-grip"></div>
				<div class="fin-amt">{money(financeGoalSheet.amountMinor, currency())}</div>
				<small class="fin-goal-hint">Saldo do mês ÷ meta</small>
				<div class="fin-chips">{#each [500, 1000, 2000, 5000] as value}<button class:on={financeGoalSheet.amountMinor === value * 100} class="fin-chip" onclick={() => setFinanceGoalPreset(value * 100)}>{money(value * 100, currency())}</button>{/each}</div>
				<div class="fin-kp">{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as key}<button onclick={() => financeGoalKey(key)}>{key}</button>{/each}</div>
				<button class="fin-btn" onclick={saveFinanceGoal}>Salvar meta</button>
			</div>
		</div>
	{/if}

	{#if financeCelebration !== null}
		<div class="fin-celebration" role="dialog" aria-modal="true" aria-label="Meta de economia batida">
			<div class="fin-coin">R$</div>
			<h2>Meta de economia batida</h2>
			<div class="fin-celebration-amount">{money(financeCelebration, currency())}</div>
			<button class="fin-btn" onclick={() => (financeCelebration = null)}>Continuar</button>
		</div>
	{/if}

	{#if timeCalendarOpen}
		<TimeRangeSheet
			start={timeRangeStart}
			end={timeRangeEnd}
			onapply={applyTimeRange}
			onclose={() => (timeCalendarOpen = false)}
		/>
	{/if}

	{#if timeCategorySheet.open}
		<div class="tp-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) timeCategorySheet = { ...timeCategorySheet, open: false }; }}>
			<div class="tp-sheet" role="dialog" aria-modal="true" aria-label={timeCategorySheet.id ? 'Editar categoria' : 'Nova categoria'}>
				<div class="tp-grip"></div>
				<input class="tp-inp" placeholder="Nome da categoria" maxlength="22" bind:value={timeCategorySheet.name} />
				<div class="tp-sw">{#each ['#d4f25a', '#9cc8ff', '#ffb347', '#c6a8ff', '#f1a5c5', '#7fe3c4', '#ff8a80', '#e6e06a'] as color}<button class:on={timeCategorySheet.color === color} style={`--cc:${color}`} aria-label="Cor" onclick={() => (timeCategorySheet = { ...timeCategorySheet, color })}></button>{/each}</div>
				<div class="tp-gv">{timeCategorySheet.goalHours ? `${timeCategorySheet.goalHours}h por semana` : 'Sem meta'}</div>
				<input type="range" min="0" max="40" step="1" aria-label="Meta semanal" value={timeCategorySheet.goalHours} style={`--f:${(timeCategorySheet.goalHours / 40) * 100}%`} oninput={(event) => (timeCategorySheet = { ...timeCategorySheet, goalHours: Number(event.currentTarget.value) })} />
				<button class="tp-btn" onclick={saveTimeCategory}>{timeCategorySheet.id ? 'Salvar' : 'Criar categoria'}</button>
				{#if timeCategorySheet.id}<button class="tp-btn d" onclick={deleteTimeCategory}>Excluir categoria</button>{/if}
			</div>
		</div>
	{/if}

	{#if timeSummaryOpen}
		<div class="tp-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) timeSummaryOpen = false; }}>
			<div class="tp-sheet" role="dialog" aria-modal="true" aria-label="Resumo do período">
				<div class="tp-grip"></div>
				<div class="tp-sr" style="border:0"><div><b>Período</b><small>{timeTotalsLabel}</small></div></div>
				{#each timeCategories as category}
					{@const categoryHours = timeCategoryHours(category.id)}
					{@const categoryGoal = ((category.weeklyGoalHours ?? 0) * timeRangeDays) / 7}
					<div class="tp-sr" style={`--cc:${category.color}`}>
						<div><span>{category.name}</span><small>{hmSlots(categoryHours * 2)}{categoryGoal ? ` de ${hmSlots(categoryGoal * 2)}` : ''}</small></div>
						<div class="tp-sbar"><i style={`width:${Math.min(100, categoryGoal ? (categoryHours / categoryGoal) * 100 : (categoryHours / (timeRangeDays * TIME_SLOT_COUNT * 0.5)) * 400)}%`}></i></div>
					</div>
				{/each}
				<button class="tp-btn" onclick={() => (timeSummaryOpen = false)}>Fechar</button>
			</div>
		</div>
	{/if}

	{#if dashHabitPicker}
		<div class="habit-prototype-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) dashHabitPicker = false; }}>
			<div class="habit-prototype-sheet" role="dialog" aria-modal="true" aria-label="Registrar hábito">
				<div class="habit-prototype-grip"></div>
				<p>Registrar hábito</p>
				<div class="habit-prototype-chips">
					{#each snapshot.habits.filter((habit) => habit.active && habit.metric !== 'weekly') as habit}
						<button onclick={() => pickDashHabit(habit)}>{habit.name}{#if snapshot.habitLogs.some((log) => log.habitId === habit.id && log.date === today && log.completed)} ✓{/if}</button>
					{/each}
				</div>
				{#if !snapshot.habits.some((habit) => habit.active && habit.metric !== 'weekly')}<p>Nenhum hábito para registrar. Crie um na aba Hábitos.</p>{/if}
				<button class="habit-prototype-save" onclick={() => (dashHabitPicker = false)}>Fechar</button>
			</div>
		</div>
	{/if}

	{#if modal && modal !== 'settings'}
		<Sheet
			title={modal === 'transaction'
				? editingTransactionId
					? 'Editar lançamento'
					: 'Novo lançamento'
				: modal === 'habit'
					? editingHabitId
						? 'Editar hábito'
						: 'Novo hábito'
					: 'Pausa e descanso'}
			closeLabel="Fechar"
			onclose={() => (modal = null)}
		>
			{#if formError}<p class="form-error">{formError}</p>{/if}
			{#if modal === 'transaction'}
				<form class="sheet-form" onsubmit={saveTransaction}>
					<Segmented
						label="Tipo de lançamento"
						options={[
							{ value: 'expense', label: 'Despesa' },
							{ value: 'income', label: 'Receita' }
						]}
						bind:value={transactionForm.type}
					/>
					<Field label="Descrição">
						<input bind:value={transactionForm.description} placeholder="Ex.: mercado da semana" />
					</Field>
					<div class="sheet-row">
						<Field label={`Valor (${currency()})`}>
							<input bind:this={amountInput} data-autofocus bind:value={transactionForm.amount} inputmode="decimal" placeholder="0,00" required />
						</Field>
						<Field label="Data">
							<input bind:value={transactionForm.date} type="date" required />
						</Field>
					</div>
					<Field label="Categoria">
						<select bind:value={transactionForm.categoryId} required>
							{#each snapshot.categories.filter((item) => item.module === 'finance') as category (category.id)}
								<option value={category.id}>{category.name}</option>
							{/each}
						</select>
					</Field>
					<div class="sheet-actions">
						<Button variant="secondary" onclick={() => (modal = null)}>Cancelar</Button>
						<Button type="submit"><Check size={16} /> {editingTransactionId ? 'Salvar alterações' : 'Salvar lançamento'}</Button>
					</div>
				</form>
			{:else if modal === 'habit'}
				<form class="sheet-form" onsubmit={saveHabit}>
					<Field label="Nome do hábito">
						<input bind:value={habitForm.name} placeholder="Ex.: leitura, caminhada…" required />
					</Field>
					<Field label="Como medir?">
						<select bind:value={habitForm.metric}>
							<option value="boolean">Feito ou não feito</option>
							<option value="duration">Duração</option>
							<option value="count">Contagem</option>
							<option value="weekly">Meta na semana</option>
						</select>
					</Field>
					{#if habitForm.metric === 'duration'}
						<Field label="Duração" hint="HH:MM">
							<DurationField
								value={Number(habitForm.target) > 0 ? Number(habitForm.target) : null}
								ariaLabel="Duração do hábito"
								onchange={(minutes) => (habitForm.target = String(minutes ?? 0))}
							/>
						</Field>
					{:else if habitForm.metric === 'weekly'}
						<div class="sheet-row">
							<Field label="Dias por semana">
								<input bind:value={habitForm.target} type="number" min="1" max="7" required />
							</Field>
							<Field label="Unidade"><span class="static">dias</span></Field>
						</div>
					{:else if habitForm.metric === 'count'}
						<div class="sheet-row">
							<Field label="Meta por dia">
								<input bind:value={habitForm.target} type="number" min="1" required />
							</Field>
							<Field label="Unidade">
								<input bind:value={habitForm.unit} placeholder="páginas, copos…" required />
							</Field>
						</div>
					{:else}
						<div class="sheet-row">
							<Field label="Rótulo do positivo">
								<input bind:value={habitForm.positiveLabel} placeholder="Feito" maxlength="14" required />
							</Field>
							<Field label="Rótulo do negativo">
								<input bind:value={habitForm.negativeLabel} placeholder="Não feito" maxlength="14" required />
							</Field>
						</div>
						<div class="sheet-days">
							<span class="sheet-days-label">Qual conta como positivo?</span>
							<Segmented
								label="Qual conta como positivo"
								options={[
									{ value: '1', label: habitForm.positiveLabel.trim() || HABIT_BOOLEAN_LABELS.positive },
									{ value: '0', label: habitForm.negativeLabel.trim() || HABIT_BOOLEAN_LABELS.negative }
								]}
								value={String(habitForm.positiveValue)}
								onchange={(value) => (habitForm.positiveValue = value === '0' ? 0 : 1)}
							/>
						</div>
					{/if}
					{#if habitForm.metric === 'count' || habitForm.metric === 'duration'}
						<div class="sheet-days">
							<span class="sheet-days-label">Como atingir a meta</span>
							<Segmented
								label="Direção da meta"
								options={[
									{ value: 'up', label: 'Mais é melhor' },
									{ value: 'down', label: 'Menos é melhor' }
								]}
								value={habitForm.targetDirection}
								onchange={(value) => (habitForm.targetDirection = value === 'down' ? 'down' : 'up')}
							/>
						</div>
					{/if}
					{#if habitForm.metric !== 'weekly'}
						<div class="sheet-days">
							<span class="sheet-days-label">Dias programados</span>
							<div class="sheet-days-row">
								{#each ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as day, index}
									<Chip
										selected={habitForm.scheduledDays.includes(index)}
										ariaLabel={`Selecionar dia ${index}`}
										onselect={() => toggleScheduledDay(index)}
									>{day}</Chip>
								{/each}
							</div>
						</div>
					{/if}
					<Field label="Lembrete" hint="opcional">
						<input type="time" bind:value={habitForm.reminder} />
					</Field>
					<div class="sheet-actions">
						<Button variant="secondary" onclick={() => (modal = null)}>Cancelar</Button>
						<Button type="submit"><Check size={16} /> {editingHabitId ? 'Salvar' : 'Criar hábito'}</Button>
					</div>
				</form>
			{:else}
				<form class="sheet-form" onsubmit={startPause}>
					<div class="sheet-explain">
						<Flame size={20} />
						<p>Na pausa, Life Force, streaks e lembretes ficam suspensos. Seus dados continuam guardados.</p>
					</div>
					<Field label="Data de retorno">
						<input type="date" bind:value={pauseForm.until} min={dateOffset(today, 1)} required />
					</Field>
					<div class="sheet-actions">
						<Button variant="secondary" onclick={() => (modal = null)}>Agora não</Button>
						<Button type="submit">Ativar pausa</Button>
					</div>
				</form>
			{/if}
		</Sheet>
	{/if}
	{#if modal === 'settings' && snapshot && !pairOpen}
		<SettingsSheet
			{snapshot}
			testMode={testModeActive}
			{syncAvailable}
			{sync}
			{syncBusy}
			{updaterAvailable}
			{updaterBusy}
			{updaterStatus}
			onclose={() => (modal = null)}
			onnotifications={toggleNotifications}
			onpreference={setFeedbackPreference}
			oncurrency={changeCurrency}
			onfirstday={(value) => void changeFirstDayOfWeek(value)}
			ontestmode={toggleTestMode}
			onpause={() => (modal = 'pause')}
			onexport={exportData}
			onimport={importData}
			oncheckupdates={checkAppUpdate}
			onsynctoggle={setSyncEnabled}
			onsyncnow={runSyncNow}
			onsyncdiscoveryrestart={() => void restartSyncDiscovery()}
			onsyncauto={(enabled) => void updateSyncAuto({ autoSync: enabled })}
			onsyncinterval={(secs) => void updateSyncAuto({ intervalSecs: secs })}
			onpair={openPairing}
			onunpair={unpair}
		/>
	{/if}
	{#if modal === 'settings' && snapshot && pairOpen}
		<SyncPairSheet
			devices={pairDevices}
			busy={syncBusy}
			onconnect={pairWith}
			onrefresh={() => void refreshPairDevices()}
			onclose={closePairing}
		/>
	{/if}
	{#if sasPrompt}
		<SyncSasSheet
			peerName={sasPrompt.name}
			sas={sasPrompt.sas}
			busy={syncBusy}
			onconfirm={() => void confirmSas(true)}
			oncancel={() => void confirmSas(false)}
		/>
	{/if}
	{#if syncIntro}
		<SyncIntroSheet
			summary={syncIntro.summary}
			backupPath={syncIntro.path}
			busy={syncBusy}
			onconfirm={confirmSyncIntro}
			oncancel={() => (syncIntro = null)}
		/>
	{/if}
	{#if dialog}
		<Sheet title={dialog.title} closeLabel="Fechar" onclose={() => closeDialog(null)}>
			<form class="sheet-form" onsubmit={submitDialog}>
				{#if dialog.kind === 'prompt'}
					<Field label={dialog.label}>
						<input bind:this={dialogInput} bind:value={dialogValue} placeholder={dialog.placeholder ?? ''} />
					</Field>
				{:else}
					<p class="sheet-message">{dialog.message}</p>
				{/if}
				<div class="sheet-actions">
					<Button variant="secondary" onclick={() => closeDialog(null)}>Cancelar</Button>
					<Button type="submit" variant={dialog.danger ? 'danger' : 'primary'}>{dialog.confirmLabel}</Button>
				</div>
			</form>
		</Sheet>
	{/if}
	<canvas bind:this={effectsCanvas} class="atlas-confetti" aria-hidden="true"></canvas>
	{#if toast}<div class:warn={toastWarning} class="toast">{#if !toastWarning}<Check size={16} />{/if}{toast}{#if toastUndo}<button class="toast-undo" onclick={() => { const action = toastUndo; toastUndo = null; toast = ''; action?.(); }}>Desfazer</button>{/if}</div>{/if}
{:else}
	<div class="loading-screen"><div class="empty-orbit"><X size={20} /></div><strong>Não foi possível abrir Atlas</strong><Button variant="secondary" onclick={initialize}>Tentar novamente</Button></div>
{/if}
