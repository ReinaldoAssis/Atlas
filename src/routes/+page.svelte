<script lang="ts">
	import { onMount } from 'svelte';
	import { isTauri } from '@tauri-apps/api/core';
	import {
		ArrowDownRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronLeft, CircleDollarSign,
		Flame, Keyboard, LayoutDashboard, Menu, NotebookPen, Plus, Route, Settings2, Target, Vibrate, Volume2,
		Wallet, X, type LucideIcon
	} from '@lucide/svelte';
	import {
		currentStreak, dateOffset, didMeetTarget, formatMinutes, id, localDate, money, weekStartDate, WEEK_MAX,
		TIME_SLOT_START_HOUR, TIME_SLOT_COUNT, TIME_SLOT_MINUTES,
		experienceProgress, type AppPreferences, type AtlasSnapshot, type Category, type Habit, type HabitLog,
		type NavigationKey, type TimeBlock, type Transaction
	} from '#lib/atlas';
	import { loadSnapshot, saveSnapshot } from '#lib/storage';
	import type { Note, NotesState } from '#lib/notes';
	import { edgeRatio, isMilestone, nodeReached, type GraphState } from '#lib/graph';
	import { reconcileGraph } from '#lib/graph-sources';
	import GraphView from '#lib/components/graph/GraphView.svelte';
	import NotesView from '#lib/components/notes/NotesView.svelte';
	import {
		burstAt, centerOf, confetti, floatValue, playFeedback, playTone, popElement,
		prefersReducedMotion, pulseHaptic, vibrate
	} from '#lib/feedback';
	import '../app.css';

	type Period = 'week' | 'month' | 'custom';
	type ModalKind = 'transaction' | 'habit' | 'settings' | 'pause' | null;

	const navItems: { id: NavigationKey; label: string; icon: LucideIcon }[] = [
		{ id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
		{ id: 'finance', label: 'Finanças', icon: Wallet },
		{ id: 'habits', label: 'Hábitos', icon: Target },
		{ id: 'time', label: 'Tempo', icon: CalendarDays },
		{ id: 'notes', label: 'Notas', icon: NotebookPen },
		{ id: 'graph', label: 'Vida', icon: Route }
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
	let notesState = $state<NotesState>({ notes: [], folders: [] });
	let notesVersion = $state(0);
	let period = $state<Period>('week');
	let customStart = $state(dateOffset(localDate(), -6));
	let customEnd = $state(localDate());
	let timeWeekStart = $state(weekStart(localDate()));
	let currentTime = $state(new Date());
	let modal = $state<ModalKind>(null);
	let toast = $state('');
	let toastWarning = $state(false);
	let toastUndo = $state<(() => void) | null>(null);
	let sidebarCollapsed = $state(false);
	let quickMenuOpen = $state(false);
	let moreMenuOpen = $state(false);
	let navDirection = $state(1);
	let notesCreateToken = $state(0);
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
	let timeGrid = $derived.by(() => {
		const grid: (string | null)[][] = Array.from({ length: 7 }, () => Array<string | null>(TIME_SLOT_COUNT).fill(null));
		if (!snapshot) return grid;
		const weekStartMs = new Date(`${timeWeekStart}T12:00:00`).getTime();
		for (const block of snapshot.timeBlocks) {
			if (block.status === 'cancelled') continue;
			const index = Math.round((new Date(`${block.startAt.slice(0, 10)}T12:00:00`).getTime() - weekStartMs) / 86_400_000);
			if (index < 0 || index > 6) continue;
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
	let timeTodayIndex = $derived((new Date().getDay() + 6) % 7);
	let timeHeaderDays = $derived(Array.from({ length: 7 }, (_, index) => {
		const date = dateOffset(timeWeekStart, index);
		return { label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][index], dayNumber: Number(date.slice(8, 10)) };
	}));
	let timeWeekBars = $derived.by(() => {
		const daySlots = timeGrid.map((day) => day.filter(Boolean).length);
		const max = Math.max(8, ...daySlots);
		return daySlots.map((slots, index) => ({
			label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][index],
			dayNumber: Number(dateOffset(timeWeekStart, index).slice(8, 10)),
			percent: slots ? (slots / max) * 100 : 0
		}));
	});
	let timeTotalsLabel = $derived.by(() => {
		const total = timeGrid.reduce((sum, day) => sum + day.filter(Boolean).length, 0);
		return `${hmSlots(total)} alocadas · ${hmSlots(7 * TIME_SLOT_COUNT - total)} livres`;
	});
	let timeNow = $derived.by(() => {
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
		return Array.from({ length: 7 }, (_, index) => {
			const date = dateOffset(start, index);
			const weekday = new Date(`${date}T12:00:00`).getDay();
			const paused = isPausedOn(date, data);
			const planned = paused ? [] : data.habits.filter((habit) => habit.active && habit.scheduledDays.includes(weekday));
			const done = planned.filter((habit) => {
				const log = snapshot?.habitLogs.find((item) => item.habitId === habit.id && item.date === date);
				return Boolean(log && didMeetTarget(habit, log.value));
			}).length;
			return { date, label: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'][index], done, planned: planned.length, goal: Math.min(3, planned.length), paused };
		});
	});
	let prototypeTodayHabits = $derived.by(() => {
		if (!snapshot) return [] as Habit[];
		const weekday = new Date(`${today}T12:00:00`).getDay();
		return snapshot.habits.filter((habit) => habit.active && (habit.metric === 'weekly' || habit.scheduledDays.includes(weekday)));
	});
	let prototypeTodayDone = $derived(prototypeTodayHabits.filter((habit) => {
		if (habit.metric === 'weekly') return weeklyValue(habit) >= habit.target;
		const log = snapshot?.habitLogs.find((item) => item.habitId === habit.id && item.date === today);
		return Boolean(log && didMeetTarget(habit, log.value));
	}).length);
	let prototypeTodayGoal = $derived(Math.min(3, prototypeTodayHabits.length));
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
	let financeGreenCount = $derived(financeExpenseCategories.filter((item) => (item.limitMinor ?? 0) > 0 && categoryTotal(item.id) <= (item.limitMinor ?? 0)).length);
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
	let habitForm = $state({ name: '', metric: 'boolean' as Habit['metric'], unit: '', target: '1', scheduledDays: [1, 2, 3, 4, 5] as number[], reminder: '' });
	let habitValues = $state<Record<string, string>>({});
	let habitSheet = $state<Habit | null>(null);
	let habitSheetValue = $state(0);
	let habitCelebration = $state<number | null>(null);
	let effectsCanvas = $state<HTMLCanvasElement | null>(null);
	let financeEntry = $state<{ open: boolean; type: 'income' | 'expense'; categoryId: string; amountMinor: number; description: string }>({ open: false, type: 'expense', categoryId: '', amountMinor: 0, description: '' });
	let financeCategoryForm = $state<{ open: boolean; type: 'income' | 'expense'; name: string; color: string; limitMinor: number; back: boolean }>({ open: false, type: 'expense', name: '', color: '#9cc8ff', limitMinor: 50000, back: false });
	let financeCelebration = $state<number | null>(null);
	let timeSelected = $state('deep-work');
	let timeScroll = $state<HTMLElement | null>(null);
	let timeColumnWidth = $state(100);
	let timeVisibleCount = $state(7);
	let timeVisibleStart = $state(0);
	let timePainting = false;
	let timePaintMode: 'add' | 'del' = 'add';
	let timePaintSeen = new Set<string>();
	let timePaintCount = { add: 0, del: 0 };
	let timePaintSnapshot = '';
	let timePaintLastCell: [number, number] | null = null;
	let timePaintPending: { day: number; slot: number } | null = null;
	let timePaintTimer: ReturnType<typeof setTimeout> | null = null;
	let timePaintStart: [number, number] = [0, 0];
	let timeCategorySheet = $state<{ open: boolean; id: string | null; name: string; color: string; goalHours: number }>({ open: false, id: null, name: '', color: '#9cc8ff', goalHours: 0 });
	let timeSummaryOpen = $state(false);
	let timeScrollReady = false;
	let pauseForm = $state({ until: dateOffset(localDate(), 7) });
	let categoryForm = $state({ module: 'finance' as 'finance' | 'time', name: '', color: '#b8cf78' });

	onMount(() => {
		let interval: ReturnType<typeof setInterval> | undefined;
		const onPointerMove = (event: PointerEvent) => continueTimePaint(event);
		const onPointerUp = (event: PointerEvent) => void finishTimePaint(event);
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
			return;
		}
		if (!timeScroll || timeScrollReady) return;
		timeScrollReady = true;
		timeLayout();
		timeScroll.scrollLeft = Math.min(timeTodayIndex, Math.max(0, 7 - timeVisibleCount)) * timeColumnWidth;
		const minutes = currentTime.getHours() * 60 + currentTime.getMinutes();
		const nowSlot = (minutes - TIME_SLOT_START_HOUR * 60) / TIME_SLOT_MINUTES;
		timeScroll.scrollTop = Math.max(0, (nowSlot - 3) * 28);
		handleTimeScroll();
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
		try {
			const loaded = await loadSnapshot();
			advanceLifeForce(loaded);
			snapshot = loaded;
			ready = true;
			wasPaused = isCurrentPause(loaded);
			await saveSnapshot(loaded);
			await syncIOSReminders(loaded);
		} catch (error) {
			console.error(error);
			const detail = error instanceof Error ? error.message : String(error);
			loadError = `Não foi possível abrir os dados locais. (${detail})`;
			ready = true;
		}
	}

	function weekStart(date: string): string {
		const day = new Date(`${date}T12:00:00`).getDay();
		return dateOffset(date, -((day + 6) % 7));
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

	function getHabitDayStreak(data: AtlasSnapshot | null): number {
		if (!data) return 0;
		let date = today;
		const todayHabits = data.habits.filter((habit) => habit.active && habit.scheduledDays.includes(new Date(`${today}T12:00:00`).getDay()));
		const todayDone = todayHabits.filter((habit) => {
			const log = data.habitLogs.find((item) => item.habitId === habit.id && item.date === today);
			return Boolean(log && didMeetTarget(habit, log.value));
		}).length;
		if (todayHabits.length === 0 || todayDone < Math.min(3, todayHabits.length)) date = dateOffset(today, -1);
		let streak = 0;
		for (let index = 0; index < 730; index += 1) {
			if (isPausedOn(date, data)) {
				date = dateOffset(date, -1);
				continue;
			}
			const weekday = new Date(`${date}T12:00:00`).getDay();
			const eligible = data.habits.filter((habit) => habit.active && habit.scheduledDays.includes(weekday));
			if (!eligible.length) {
				date = dateOffset(date, -1);
				continue;
			}
			const done = eligible.filter((habit) => {
				const log = data.habitLogs.find((item) => item.habitId === habit.id && item.date === date);
				return Boolean(log && didMeetTarget(habit, log.value));
			}).length;
			if (done < Math.min(3, eligible.length)) break;
			streak += 1;
			date = dateOffset(date, -1);
		}
		return streak;
	}

	function getDailyHabitGoal(data: AtlasSnapshot, date = today): { done: number; goal: number } {
		const weekday = new Date(`${date}T12:00:00`).getDay();
		const habits = data.habits.filter((habit) => habit.active && habit.scheduledDays.includes(weekday));
		const done = habits.filter((habit) => {
			const log = data.habitLogs.find((item) => item.habitId === habit.id && item.date === date);
			return Boolean(log && didMeetTarget(habit, log.value));
		}).length;
		return { done, goal: Math.min(3, habits.length) };
	}

	function prototypeValue(habit: Habit, value: number): string {
		if (habit.metric === 'duration') {
			const hours = Math.floor(value / 60);
			const minutes = value % 60;
			return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
		}
		if (habit.unit.toLowerCase() === 'ml' && value >= 1000) return `${(value / 1000).toFixed(2).replace(/\.?0+$/, '')} L`;
		return habit.metric === 'count' ? `${value} ${habit.unit}` : value ? 'Feito' : 'Hoje';
	}

	function prototypeSheetMax(habit: Habit): number {
		if (habit.metric === 'duration') return Math.max(180, habit.target * 3);
		return Math.max(habit.target * 2, habit.target + 1);
	}

	function prototypeSheetStep(habit: Habit): number {
		if (habit.metric === 'duration') return 5;
		return habit.unit.toLowerCase() === 'ml' ? 50 : 1;
	}

	function prototypePresets(habit: Habit): number[] {
		if (habit.metric === 'duration') return [15, 30, 45, 60].map((value) => Math.min(value, prototypeSheetMax(habit)));
		if (habit.unit.toLowerCase() === 'ml') return [250, 500, 1000].map((value) => Math.min(value, prototypeSheetMax(habit)));
		return [Math.max(1, Math.ceil(habit.target / 2)), habit.target, Math.min(prototypeSheetMax(habit), Math.ceil(habit.target * 1.5))];
	}

	function weeklyValue(habit: Habit): number {
		const week = weekStartDate(today);
		return snapshot?.habitLogs.find((item) => item.habitId === habit.id && item.date === week)?.value ?? 0;
	}

	async function setWeeklyValue(habit: Habit, value: number) {
		if (!snapshot) return;
		const week = weekStartDate(today);
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
		const now = new Date();
		const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		return data.transactions.filter((item) => item.date.startsWith(prefix));
	}

	function categoryTotal(categoryId: string, data: AtlasSnapshot | null = snapshot): number {
		return monthTransactionsOf(data).filter((item) => item.categoryId === categoryId).reduce((sum, item) => sum + item.amountMinor, 0);
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
		const streakNow = snapshot?.finance.streak ?? previousStreak;
		const streakMessage = `Sequência de ${streakNow} dias`;
		if (kind === 'expense' && limit > 0) {
			const beforeRatio = previousSpent / limit;
			const afterRatio = categoryTotal(category.id) / limit;
			if (beforeRatio <= 1 && afterRatio > 1) {
				setTimeout(() => toastMessage(`${category.name} passou do limite`, { warning: true, undo: () => restoreFinance(undoJson) }), 500);
				playTone(330, 0.25, 'triangle', 0.05, sound);
			} else if (beforeRatio < 0.8 && afterRatio >= 0.8) {
				setTimeout(() => toastMessage(`${category.name} em ${Math.round(afterRatio * 100)}% do limite`, { warning: true }), 500);
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

	function removeFinanceTransaction(transactionId: string) {
		if (!snapshot) return;
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.transactions = next.transactions.filter((item) => item.id !== transactionId);
		void commit(next);
		playTone(200, 0.12, 'sine', 0.05, snapshot.preferences.soundEnabled);
		vibrate(8);
		toastMessage('Lançamento removido', { undo: () => restoreFinance(undoJson) });
	}

	function clearFinanceTransactions() {
		if (!snapshot) return;
		const undoJson = JSON.stringify(snapshot);
		const next = cloneSnapshot();
		next.transactions = [];
		void commit(next);
		toastMessage('Lançamentos removidos', { warning: true, undo: () => restoreFinance(undoJson) });
	}

	function openFinanceCategory(back: boolean) {
		financeEntry = { ...financeEntry, open: false };
		financeCategoryForm = { open: true, type: back ? financeEntry.type : 'expense', name: '', color: FINANCE_COLORS[1], limitMinor: 50000, back };
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function setFinanceCategoryType(type: 'income' | 'expense') {
		financeCategoryForm = { ...financeCategoryForm, type };
		playTone(420, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	function setFinanceLimit(minor: number) {
		financeCategoryForm = { ...financeCategoryForm, limitMinor: minor };
		playTone(520, 0.06, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
	}

	async function createFinanceCategory() {
		if (!snapshot) return;
		const name = financeCategoryForm.name.trim();
		if (!name) return;
		const next = cloneSnapshot();
		const newId = id();
		const isIncome = financeCategoryForm.type === 'income';
		next.categories.push({
			id: newId, module: 'finance', name, color: financeCategoryForm.color, custom: true,
			kind: isIncome ? 'in' : 'out',
			limitMinor: isIncome ? undefined : financeCategoryForm.limitMinor
		});
		const back = financeCategoryForm.back;
		financeCategoryForm = { ...financeCategoryForm, open: false, name: '', back: false };
		await commit(next);
		if (back) financeEntry = { ...financeEntry, open: true, type: isIncome ? 'income' : 'expense', categoryId: newId };
		const tile = document.querySelector<HTMLElement>(`[data-fin-cat="${newId}"]`);
		if (tile) popElement(tile);
		const sound = snapshot.preferences.soundEnabled;
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
		habitSheetValue = Math.min(prototypeSheetMax(habitSheet), Math.max(0, value));
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

	async function togglePrototypeSound() {
		if (!snapshot) return;
		const enabled = !snapshot.preferences.soundEnabled;
		await updatePreferences({ soundEnabled: enabled });
		playFeedback('tap', enabled);
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
		const copy = cloneSnapshot();
		copy.graph = next;
		await commit(copy);
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

	function openHabit() {
		formError = '';
		habitForm = { name: '', metric: 'boolean', unit: '', target: '1', scheduledDays: [1, 2, 3, 4, 5], reminder: '' };
		modal = 'habit';
	}

	function toggleScheduledDay(day: number) {
		habitForm.scheduledDays = habitForm.scheduledDays.includes(day)
			? habitForm.scheduledDays.filter((item) => item !== day)
			: [...habitForm.scheduledDays, day].sort((a, b) => a - b);
	}

	async function saveHabit(event: SubmitEvent) {
		event.preventDefault();
		if (!snapshot) return;
		if (!habitForm.name.trim() || !habitForm.scheduledDays.length || (habitForm.metric !== 'boolean' && Number(habitForm.target) <= 0)) {
			formError = 'Informe um nome, uma meta válida e pelo menos um dia.';
			return;
		}
		const next = cloneSnapshot();
		next.habits.unshift({
			id: id(), name: habitForm.name.trim(), metric: habitForm.metric,
			unit: habitForm.metric === 'duration' ? 'min' : habitForm.unit.trim(),
			target: habitForm.metric === 'boolean' ? 1 : Number(habitForm.target),
			scheduledDays: habitForm.scheduledDays, active: true,
			bestStreak: 0, reminder: habitForm.reminder || undefined
		});
		await commit(next, true, true);
		const savedHabit = next.habits[0];
		await scheduleHabitReminder(savedHabit);
		modal = null;
		toastMessage('Hábito criado.');
	}

	function logHabit(habit: Habit) {
		if (!snapshot) return;
		const existing = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === today);
		if (habit.metric === 'boolean') {
			void saveHabitLog(habit, existing?.completed ? 0 : 1, !existing);
		} else {
			const input = document.querySelector<HTMLInputElement>(`[data-habit-input="${habit.id}"]`);
			const value = Number(input?.value ?? habitValues[habit.id]);
			if (!Number.isFinite(value) || value < 0) {
				toastMessage('Informe uma quantidade válida.');
				return;
			}
			void saveHabitLog(habit, value, !existing);
		}
	}

	async function saveHabitLog(habit: Habit, value: number, created: boolean, date = today, coords?: [number, number]) {
		if (!snapshot) return;
		const beforeDailyGoal = getDailyHabitGoal(snapshot);
		const next = cloneSnapshot();
		const existingIndex = next.habitLogs.findIndex((item) => item.habitId === habit.id && item.date === date);
		const existingLog = existingIndex >= 0 ? next.habitLogs[existingIndex] : null;
		const qualifies = didMeetTarget(habit, value);
		const awardExperience = qualifies && !existingLog?.experienceAwarded;
		const log: HabitLog = {
			id: existingLog?.id ?? id(), habitId: habit.id, date, value, completed: value > 0,
			experienceAwarded: Boolean(existingLog?.experienceAwarded || awardExperience)
		};
		if (existingIndex >= 0) next.habitLogs[existingIndex] = log;
		else next.habitLogs.unshift(log);
		if (awardExperience) next.experience.totalXp += 10;
		const streak = currentStreak(habit, next.habitLogs, today, allPausePeriods(next));
		const habitIndex = next.habits.findIndex((item) => item.id === habit.id);
		if (habitIndex >= 0) next.habits[habitIndex].bestStreak = Math.max(next.habits[habitIndex].bestStreak, streak);
		const afterDailyGoal = getDailyHabitGoal(next);
		const sound = next.preferences.soundEnabled;
		const reduced = prefersReducedMotion();
		await commit(next, true, created);
		playFeedback(value ? 'success' : 'tap', sound);
		pulseHaptic(next.preferences.hapticsEnabled, value ? [12, 25, 18] : 8);
		const tile = document.querySelector<HTMLElement>(`[data-habit-id="${habit.id}"]`);
		const [px, py] = coords ?? centerOf(tile);
		if (value) popElement(tile);
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
		if (!awardExperience && !reduced) toastMessage(value ? 'Registro feito.' : 'Registro atualizado.');
	}

	function openDashHabitPick() {
		dashMenu = false;
		dashHabitPicker = true;
		playTone(380, 0.1, 'sine', 0.05, snapshot?.preferences.soundEnabled ?? true);
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
		const weekStartMs = new Date(`${timeWeekStart}T12:00:00`).getTime();
		let slots = 0;
		for (const block of data.timeBlocks) {
			if (block.status === 'cancelled' || block.categoryId !== categoryId) continue;
			const index = Math.round((new Date(`${block.startAt.slice(0, 10)}T12:00:00`).getTime() - weekStartMs) / 86_400_000);
			if (index < 0 || index > 6) continue;
			slots += Math.max(1, Math.round(block.plannedMinutes / TIME_SLOT_MINUTES));
		}
		return slots;
	}

	function timeLayout() {
		if (!timeScroll) return;
		const width = timeScroll.clientWidth;
		timeVisibleCount = width < 560 ? 2 : width < 780 ? 3 : width < 1000 ? 5 : 7;
		timeColumnWidth = Math.max(64, (width - 38) / timeVisibleCount);
	}

	function handleTimeScroll() {
		if (!timeScroll) return;
		timeVisibleStart = Math.round(timeScroll.scrollLeft / timeColumnWidth);
	}

	function scrollToDay(index: number) {
		if (!timeScroll) return;
		timeScroll.scrollTo({ left: Math.min(index, Math.max(0, 7 - timeVisibleCount)) * timeColumnWidth, behavior: 'smooth' });
		playTone(420, 0.05, 'sine', 0.04, snapshot?.preferences.soundEnabled ?? true);
		pulseHaptic(snapshot?.preferences.hapticsEnabled, 4);
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
		const date = dateOffset(timeWeekStart, day);
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

	function timeCellFromEvent(event: PointerEvent): { day: number; slot: number } | null {
		const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-tp-day]');
		if (!element || element.dataset.tpSlot === undefined) return null;
		return { day: Number(element.dataset.tpDay), slot: Number(element.dataset.tpSlot) };
	}

	function startTimePaint(cell: { day: number; slot: number }) {
		if (!snapshot) return;
		timePainting = true;
		timePaintSnapshot = JSON.stringify(snapshot);
		timePaintSeen = new Set();
		timePaintCount = { add: 0, del: 0 };
		const existing = findTimeBlock(dateOffset(timeWeekStart, cell.day), slotToTime(cell.slot));
		timePaintMode = timeSelected === 'x' || existing?.categoryId === timeSelected ? 'del' : 'add';
		vibrate(12);
		playTone(500, 0.06, 'sine', 0.04, snapshot.preferences.soundEnabled);
		applyTimePaint(cell.day, cell.slot);
	}

	function beginTimePaint(event: PointerEvent) {
		if (event.button !== 0 || !snapshot) return;
		const cell = timeCellFromEvent(event);
		if (!cell) return;
		timePaintStart = [event.clientX, event.clientY];
		if (event.pointerType === 'mouse') {
			startTimePaint(cell);
			return;
		}
		timePaintPending = cell;
		timePaintTimer = setTimeout(() => {
			timePaintTimer = null;
			if (timePaintPending) {
				startTimePaint(timePaintPending);
				timePaintPending = null;
			}
		}, 200);
	}

	function continueTimePaint(event: PointerEvent) {
		if (timePaintPending) {
			if (Math.hypot(event.clientX - timePaintStart[0], event.clientY - timePaintStart[1]) > 8) {
				if (timePaintTimer) clearTimeout(timePaintTimer);
				timePaintTimer = null;
				timePaintPending = null;
			}
			return;
		}
		if (!timePainting) return;
		const cell = timeCellFromEvent(event);
		if (cell) applyTimePaint(cell.day, cell.slot);
	}

	function restoreTimeSnapshot(json: string) {
		snapshot = JSON.parse(json) as AtlasSnapshot;
		void saveSnapshot(snapshot);
	}

	async function finishTimePaint(event?: PointerEvent) {
		if (timePaintTimer) {
			clearTimeout(timePaintTimer);
			timePaintTimer = null;
		}
		if (timePaintPending) {
			const pending = timePaintPending;
			timePaintPending = null;
			if (!event || event.type === 'pointerup') startTimePaint(pending);
		}
		if (!timePainting || !snapshot) return;
		timePainting = false;
		timePaintSeen = new Set();
		if (JSON.stringify(snapshot) === timePaintSnapshot) return;
		const before = JSON.parse(timePaintSnapshot) as AtlasSnapshot;
		const crossing = timeCategories.find((category) => {
			const goal = category.weeklyGoalHours ?? 0;
			if (!goal) return false;
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
		const next = cloneSnapshot();
		next.categories = next.categories.filter((item) => item.id !== targetId);
		next.timeBlocks = next.timeBlocks.filter((item) => item.categoryId !== targetId);
		if (timeSelected === targetId) timeSelected = next.categories.find((item) => item.module === 'time')?.id ?? 'x';
		timeCategorySheet = { ...timeCategorySheet, open: false };
		await commit(next);
		playTone(200, 0.14, 'sine', 0.05, sound);
		vibrate(10);
		toastMessage('Categoria excluída', { undo: () => restoreTimeSnapshot(undoJson) });
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

	async function setFeedbackPreference(key: 'soundEnabled' | 'hapticsEnabled' | 'typingSoundEnabled', event: Event) {
		const enabled = (event.currentTarget as HTMLInputElement).checked;
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

	function backupComingSoon() {
		toastMessage('Backup local chega em breve.');
	}

	async function changeCurrency(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const value = select.value;
		if (!snapshot || value === snapshot.preferences.currency) return;
		const confirmed = await askConfirm({
			title: 'Trocar moeda base',
			message: 'Alterar a moeda base muda apenas a forma de exibição. O Atlas não converte os valores já registrados.',
			confirmLabel: 'Trocar'
		});
		if (!confirmed) {
			select.value = snapshot.preferences.currency;
			return;
		}
		await updatePreferences({ currency: value });
	}

	async function addCategory(event: SubmitEvent) {
		event.preventDefault();
		if (!snapshot || !categoryForm.name.trim()) return;
		const next = cloneSnapshot();
		next.categories.push({ id: id(), module: categoryForm.module, name: categoryForm.name.trim(), color: categoryForm.color, custom: true });
		await commit(next);
		categoryForm.name = '';
		toastMessage('Categoria adicionada.');
	}

	async function renameCategory(category: Category) {
		const name = await askText({
			title: 'Renomear categoria',
			label: 'Nome da categoria',
			value: category.name,
			confirmLabel: 'Salvar'
		});
		const trimmed = name?.trim();
		if (!trimmed || !snapshot) return;
		const next = cloneSnapshot();
		const found = next.categories.find((item) => item.id === category.id);
		if (found) found.name = trimmed;
		await commit(next);
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

	async function toggleNotifications() {
		if (!snapshot) return;
		const nextEnabled = !snapshot.preferences.notificationsEnabled;
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

{#if !ready}
	<div class="loading-screen"><div class="loading-mark">A</div><span>Preparando seu Atlas…</span></div>
{:else if loadError}
	<div class="loading-screen"><div class="loading-mark">A</div><strong>Atlas não conseguiu abrir</strong><span>{loadError}</span><button class="button-secondary" onclick={() => { ready = false; loadError = ''; void initialize(); }}>Tentar novamente</button></div>
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
							<div class="dash-top-actions">
								<span class="dash-streak" aria-label={`Sequência de ${habitDayStreak} dias`}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2c.8 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.6-3.8 2.6-5.6.9 1.7 2.1 1.9 2.1.3 0-1.8.1-3.6.8-5.7z"/></svg><span>{habitDayStreak}</span></span>
								<button class="dash-ic" aria-label={snapshot.preferences.soundEnabled ? 'Desativar som' : 'Ativar som'} onclick={togglePrototypeSound}>{snapshot.preferences.soundEnabled ? '♪' : '×'}</button>
							</div>
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
							<article class="dash-card dash-goal">
								<div class="dash-ring"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="39" fill="none" stroke="var(--panel-2)" stroke-width="10" /><circle cx="48" cy="48" r="39" fill="none" stroke="var(--lime)" stroke-width="10" stroke-linecap="round" stroke-dasharray="245" stroke-dashoffset={245 * (1 - dashGoalPercent)} /></svg><div class="dash-ring-center">{Math.min(prototypeTodayDone, prototypeTodayGoal)}/{prototypeTodayGoal}</div></div>
								<small>Meta do dia</small>
							</article>
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
									{#if dashObjectives.extra}<button class="dash-more" onclick={() => setActiveTab('graph')}>+{dashObjectives.extra} na aba Vida</button>{/if}
								{:else}
									<p class="dash-empty">Sem objetivos no grafo ainda.</p>
								{/if}
							</article>
						</div>
					</section>
				{:else if activeTab === 'finance'}
					<section class="fin-prototype" aria-label="Finanças">
						<div class="fin-top">
							<h1>{financeMonthLabel}</h1>
							<div class="fin-top-actions">
								<span class="fin-streak"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2c.8 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.6-3.8 2.6-5.6.9 1.7 2.1 1.9 2.1.3 0-1.8.1-3.6.8-5.7z"/></svg>{snapshot.finance.streak}</span>
								<button class="fin-ic" aria-label={snapshot.preferences.soundEnabled ? 'Desativar som' : 'Ativar som'} onclick={togglePrototypeSound}>{snapshot.preferences.soundEnabled ? '♪' : '×'}</button>
							</div>
						</div>
						<div class="fin-grid">
							<div class="fin-card fin-w2 fin-hero">
								<div>
									<h3>Saldo do mês</h3>
									<div class:neg={financeBalance < 0} class="fin-big">{money(financeBalance, currency())}</div>
									<small>+ {money(financeIncome, currency())}<br />− {money(financeExpense, currency())}</small>
								</div>
								<div class="fin-ring-wrap">
									<div class="fin-ring">
										<svg viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="37" class="fin-ring-track"/><circle cx="46" cy="46" r="37" class="fin-ring-value" style={`stroke-dashoffset:${233 * (1 - financeGoalPercent)}`}/></svg>
										<div class="fin-ring-center">{Math.round(financeGoalPercent * 100)}%</div>
									</div>
									<small class="fin-ring-caption">meta {money(financeGoal, currency())}</small>
								</div>
							</div>
						</div>
						<p class="fin-cats-label">Categorias · {financeGreenCount} de {financeExpenseCategories.length} no verde</p>
						<div class="fin-grid">
							{#each financeCategories as category}
								{@const isIncome = category.kind === 'in'}
								{@const total = categoryTotal(category.id)}
								{@const limit = category.limitMinor ?? 0}
								{@const over = limit > 0 && total > limit}
								{#if isIncome}
									<button class="fin-card fin-cat-card in" data-fin-cat={category.id} style={`--cc:${category.color};--cc-soft:${hexToRgba(category.color, 0.26)}`} onclick={() => openFinanceEntry('income', category.id)}>
										<b><i></i>{category.name}</b>
										<span><span class="v">+{money(total, currency())}</span></span>
									</button>
								{:else}
									<button class:over class="fin-card fin-cat-card" data-fin-cat={category.id} style={`--cc:${category.color};--cc-soft:${hexToRgba(category.color, 0.26)};--p:${limit > 0 ? Math.min(1, total / limit) : 0}`} onclick={() => openFinanceEntry('expense', category.id)}>
										<b><i></i>{category.name}</b>
										<span><span class="v">{money(total, currency())}</span>{#if limit > 0}<br /><span class="sm">{over ? `+${money(total - limit, currency())} acima` : `restam ${money(limit - total, currency())}`}</span>{/if}</span>
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
						<div class="fin-dev"><button onclick={clearFinanceTransactions}>Limpar lançamentos</button></div>
					</section>
					<button class="fin-fab" aria-label="Novo lançamento" onclick={() => openFinanceEntry()}>+</button>
				{:else if activeTab === 'habits'}
					{#if snapshot}
						<section class="habit-prototype" aria-label="Hábitos">
							<div class="habit-prototype-top">
								<div class="habit-prototype-streak"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M12 2c.8 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.6-3.8 2.6-5.6.9 1.7 2.1 1.9 2.1.3 0-1.8.1-3.6.8-5.7z"/></svg><b>{habitDayStreak}</b></div>
								<div class="habit-prototype-level"><small>Nível {levelProgress.level}</small><div class="habit-prototype-xpbar"><i style={`width:${levelProgress.currentXp / levelProgress.nextLevelXp * 100}%`}></i></div></div>
								<button class="habit-prototype-sound" aria-label={snapshot.preferences.soundEnabled ? 'Desativar som' : 'Ativar som'} onclick={togglePrototypeSound}>{snapshot.preferences.soundEnabled ? '♪' : '×'}</button>
							</div>

							<div class="habit-prototype-grid">
								<section class="habit-prototype-card habit-prototype-wide habit-prototype-hero">
									<div class="habit-prototype-ring"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="34" class="habit-prototype-ring-track"/><circle cx="42" cy="42" r="34" class="habit-prototype-ring-value" style={`stroke-dashoffset:${214 * (1 - (prototypeTodayGoal ? Math.min(prototypeTodayDone, prototypeTodayGoal) / prototypeTodayGoal : 0))}`}/></svg><strong>{Math.min(prototypeTodayDone, prototypeTodayGoal)}<small>/{prototypeTodayGoal}</small></strong></div>
									<div><h2>{prototypeTodayGoal > 0 && prototypeTodayDone >= prototypeTodayGoal ? 'Meta concluída' : 'Meta do dia'}</h2><p>{prototypeTodayGoal > 0 && prototypeTodayDone >= prototypeTodayGoal ? 'Continue se quiser ir além' : `Faltam ${Math.max(0, prototypeTodayGoal - prototypeTodayDone)}`}</p></div>
								</section>
								<section class="habit-prototype-card habit-prototype-wide habit-prototype-week" aria-label="Sequência da semana">
									{#each habitWeekDays as day, index}
										{@const reached = day.goal > 0 && day.done >= day.goal}
										<div class:done={reached} class:today={day.date === today} class="habit-prototype-day"><span>{#if reached}<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}</span>{['S', 'T', 'Q', 'Q', 'S', 'S', 'D'][index]}</div>
									{/each}
								</section>
							</div>

							<div class="habit-prototype-grid habit-prototype-habits">
								{#each snapshot.habits.filter((habit) => habit.active) as habit}
									{#if habit.metric === 'weekly'}
										{@const count = weeklyValue(habit)}
										{@const complete = count >= habit.target}
										<section class:done={complete} class="habit-prototype-card habit-prototype-wide habit-prototype-pips" data-habit-id={habit.id}>
											<div class="habit-prototype-row"><b>{habit.name}</b><small>{count} de {habit.target} na semana</small></div>
											<div class="habit-prototype-pip-track">
												{#each Array.from({ length: WEEK_MAX }, (_, index) => index + 1) as step}
													<button class="habit-prototype-pip" class:on={step <= count} class:goal={step === habit.target} aria-label={`${step} de ${WEEK_MAX} na semana`} aria-pressed={step <= count} onclick={() => setWeeklyValue(habit, count === step ? step - 1 : step)}></button>
												{/each}
											</div>
										</section>
									{:else}
										{@const log = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === today)}
										{@const value = log?.value ?? 0}
										{@const complete = didMeetTarget(habit, value)}
										{@const progress = habit.metric === 'boolean' ? (complete ? 1 : 0) : Math.min(1, value / habit.target)}
										{#if habit.metric === 'boolean'}
											<button class:done={complete} class="habit-prototype-card habit-prototype-habit" data-habit-id={habit.id} style={`--habit-progress:${progress}`} onclick={() => logHabit(habit)}>
												<b>{habit.name}</b><span><span class="habit-prototype-value">{complete ? 'Feito' : 'Hoje'}</span><br /><small>{complete ? 'Concluído' : 'Toque para registrar'}</small></span>{#if complete}<i class="habit-prototype-check"><Check size={15} /></i>{/if}
											</button>
										{:else}
											<button class:done={complete} class="habit-prototype-card habit-prototype-habit" data-habit-id={habit.id} style={`--habit-progress:${progress}`} onclick={() => openHabitSheet(habit)}>
												<b>{habit.name}</b><span><span class="habit-prototype-value">{prototypeValue(habit, value)}</span><br /><small>meta {prototypeValue(habit, habit.target)}</small></span>{#if complete}<i class="habit-prototype-check"><Check size={15} /></i>{/if}
											</button>
										{/if}
									{/if}
								{/each}
								{#if !snapshot.habits.filter((habit) => habit.active).length}
									<button class="habit-prototype-card habit-prototype-wide habit-prototype-empty" onclick={openHabit}><Target size={20} /> Criar primeiro hábito</button>
								{/if}
							</div>
							<div class="habit-prototype-dev"><button onclick={resetPrototypeDay}>Reiniciar dia</button></div>
						</section>
					{/if}
				{:else if activeTab === 'time'}
					<section class="tp-prototype" aria-label="Tempo">
						<div class="tp-top">
							<div><h1>Tempo</h1><small class="tp-info">{timeTotalsLabel}</small></div>
							<div class="tp-top-actions">
								<button class="tp-ic" aria-label="Resumo" onclick={openTimeSummary}>Σ</button>
								<button class="tp-ic" aria-label={snapshot.preferences.soundEnabled ? 'Desativar som' : 'Ativar som'} onclick={togglePrototypeSound}>{snapshot.preferences.soundEnabled ? '♪' : '×'}</button>
							</div>
						</div>
						<div class="tp-wkb">
							{#each timeWeekBars as item, index}
								<button class:td={index === timeTodayIndex} class:vis={index >= timeVisibleStart && index < timeVisibleStart + timeVisibleCount} onclick={() => scrollToDay(index)}>{item.label[0]}<b>{item.dayNumber}</b><span class="tp-bar"><i style={`width:${item.percent}%`}></i></span></button>
							{/each}
						</div>
						<div class="tp-pal">
							{#each timeCategories as category}
								{@const hours = timeCategoryHours(category.id)}
								<button class:on={timeSelected === category.id} class="tp-cat" style={`--cc:${category.color}`} onclick={() => selectTimeCategory(category.id)}><i></i>{category.name}{#if (category.weeklyGoalHours ?? 0) > 0}<small>{hmSlots(hours * 2)}/{category.weeklyGoalHours}h</small>{/if}</button>
							{/each}
							<button class:on={timeSelected === 'x'} class="tp-cat" style="--cc:#828d7d" onclick={() => selectTimeCategory('x')}><i></i>Borracha</button>
							<button class="tp-cat add" onclick={() => openTimeCategorySheet(null)}>+ Categoria</button>
						</div>
						<div class="tp-scroll" bind:this={timeScroll} onscroll={handleTimeScroll} style={`--tp-cw:${timeColumnWidth}px`}>
							<div class="tp-head">
								<span class="tp-corner"></span>
								{#each timeHeaderDays as header, index}<span class:td={index === timeTodayIndex} class="tp-h">{header.label}<b>{header.dayNumber}</b></span>{/each}
							</div>
							<div class="tp-grid" role="grid" tabindex="0" aria-label="Grade semanal de tempo" onpointerdown={beginTimePaint} oncontextmenu={(event) => event.preventDefault()}>
								{#each Array.from({ length: TIME_SLOT_COUNT }, (_, index) => index) as slot}
									<span class="tp-rl">{slot % 2 === 0 ? `${String(TIME_SLOT_START_HOUR + slot / 2).padStart(2, '0')}:00` : ''}</span>
									{#each Array.from({ length: 7 }, (_, index) => index) as day}
										{@const cell = timeCellData(day, slot)}
										<div class:on={cell.categoryId} class:st={cell.isStart} class:en={cell.isEnd} class:hr={slot % 2 === 0} class="tp-c" style={cell.categoryId ? `--cc:${cell.color}` : ''} data-tp-day={day} data-tp-slot={slot} aria-label={`${timeHeaderDays[day].label} ${slotToTime(slot)}`}>{cell.label}</div>
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
							ontogglesound={togglePrototypeSound}
							onchange={(state) => (notesState = state)}
							oncreate={onNoteCreated}
							ontoast={toastMessage}
						/>
					{/key}
				{:else if activeTab === 'graph'}
					<GraphView snapshot={snapshot} oncommit={commitGraph} ontoast={graphToast} />
				{/if}
			</div>
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
			<button class="mi hr" style="--i:3" onclick={() => { closeShellMenus(); modal = 'pause'; }}><Flame size={22} />Pausa</button>
			<button class="mi" style="--i:4" onclick={() => { closeShellMenus(); openSettings(); }}><Settings2 size={22} />Configurações</button>
		</div>

		<div id="ov" class:on={quickMenuOpen || moreMenuOpen} role="presentation" onclick={closeShellMenus}></div>
	</div>

	{#if habitSheet}
		{@const sheetHabit = habitSheet}
		<div class="habit-prototype-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) habitSheet = null; }}>
			<div class="habit-prototype-sheet" role="dialog" aria-modal="true" aria-label={`Registrar ${sheetHabit.name}`}>
				<div class="habit-prototype-grip"></div>
				<p>{sheetHabit.name}</p>
				<div class:hit={habitSheetValue >= sheetHabit.target} class="habit-prototype-sheet-value">{prototypeValue(sheetHabit, habitSheetValue)}</div>
				<small>Meta {prototypeValue(sheetHabit, sheetHabit.target)}</small>
				<input aria-label={`Valor de ${sheetHabit.name}`} type="range" min="0" max={prototypeSheetMax(sheetHabit)} step={prototypeSheetStep(sheetHabit)} value={habitSheetValue} style={`--sheet-progress:${habitSheetValue / prototypeSheetMax(sheetHabit) * 100}%`} oninput={(event) => updateHabitSheetValue(Number(event.currentTarget.value))} />
				<div class="habit-prototype-chips">{#each prototypePresets(sheetHabit) as preset}<button onclick={() => updateHabitSheetValue(sheetHabit.unit.toLowerCase() === 'ml' ? habitSheetValue + preset : preset)}>{sheetHabit.unit.toLowerCase() === 'ml' ? `+${prototypeValue(sheetHabit, preset)}` : prototypeValue(sheetHabit, preset)}</button>{/each}</div>
				<button class="habit-prototype-save" onclick={saveHabitSheet}>Registrar</button>
			</div>
		</div>
	{/if}

	{#if habitCelebration !== null}
		<div class="habit-prototype-celebration" role="dialog" aria-modal="true" aria-label="Meta do dia concluída">
			<svg viewBox="0 0 24 24" width="120" height="120" aria-hidden="true"><path fill="currentColor" d="M12 2c.8 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.6-3.8 2.6-5.6.9 1.7 2.1 1.9 2.1.3 0-1.8.1-3.6.8-5.7z"/></svg>
			<strong>{habitCelebration}</strong><h2>Meta do dia concluída</h2><p>dias seguidos</p><button class="habit-prototype-save" onclick={() => (habitCelebration = null)}>Continuar</button>
		</div>
	{/if}

	{#if financeEntry.open}
		<div class="fin-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) financeEntry = { ...financeEntry, open: false }; }}>
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
		<div class="fin-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) financeCategoryForm = { ...financeCategoryForm, open: false }; }}>
			<div class="fin-sheet" role="dialog" aria-modal="true" aria-label="Nova categoria">
				<div class="fin-grip"></div>
				<div class="fin-seg"><button class:on={financeCategoryForm.type === 'expense'} onclick={() => setFinanceCategoryType('expense')}>Despesa</button><button class:on={financeCategoryForm.type === 'income'} onclick={() => setFinanceCategoryType('income')}>Receita</button></div>
				<input class="fin-inp" placeholder="Nome da categoria" maxlength="20" bind:value={financeCategoryForm.name} />
				<div class="fin-sw">{#each FINANCE_COLORS as color}<button class:on={financeCategoryForm.color === color} style={`--cc:${color}`} aria-label="Cor" onclick={() => (financeCategoryForm = { ...financeCategoryForm, color })}></button>{/each}</div>
				{#if financeCategoryForm.type === 'expense'}
					<div class="fin-lim">{money(financeCategoryForm.limitMinor, currency())} / mês</div>
					<input type="range" min="0" max="3000" step="50" aria-label="Limite mensal" value={financeCategoryForm.limitMinor / 100} style={`--f:${financeCategoryForm.limitMinor / 100 / 30}%`} oninput={(event) => setFinanceLimit(Number(event.currentTarget.value) * 100)} />
					<div class="fin-chips" style="justify-content:center;margin-top:12px">{#each [200, 500, 1000, 2000] as value}<button class="fin-chip" onclick={() => setFinanceLimit(value * 100)}>{money(value * 100, currency())}</button>{/each}</div>
				{/if}
				<button class="fin-btn" onclick={createFinanceCategory}>Criar categoria</button>
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
			<div class="tp-sheet" role="dialog" aria-modal="true" aria-label="Resumo da semana">
				<div class="tp-grip"></div>
				<div class="tp-sr" style="border:0"><div><b>Semana</b><small>{timeTotalsLabel}</small></div></div>
				{#each timeCategories as category}
					{@const categoryHours = timeCategoryHours(category.id)}
					{@const categoryGoal = category.weeklyGoalHours ?? 0}
					<div class="tp-sr" style={`--cc:${category.color}`}>
						<div><span>{category.name}</span><small>{hmSlots(categoryHours * 2)}{categoryGoal ? ` de ${categoryGoal}h` : ''}</small></div>
						<div class="tp-sbar"><i style={`width:${Math.min(100, categoryGoal ? (categoryHours / categoryGoal) * 100 : (categoryHours / (7 * TIME_SLOT_COUNT * 0.5)) * 400)}%`}></i></div>
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

	{#if modal}
		<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) modal = null; }}>
			<div class="modal-card" role="dialog" aria-modal="true" aria-label="Janela Atlas" tabindex="-1">
			<div class="modal-heading"><div><span class="eyebrow">ATLAS · SEU ESPAÇO</span><h2>{modal === 'transaction' ? editingTransactionId ? 'Editar lançamento' : 'Novo lançamento' : modal === 'habit' ? 'Novo hábito' : modal === 'settings' ? 'Preferências' : 'Pausa e descanso'}</h2></div><button class="icon-button" aria-label="Fechar" onclick={() => (modal = null)}><X size={19} /></button></div>
				{#if formError}<div class="form-error">{formError}</div>{/if}
				{#if modal === 'transaction'}
					<form onsubmit={saveTransaction} class="modal-form"><div class="segmented full-segmented"><button type="button" class:chosen={transactionForm.type === 'expense'} onclick={() => (transactionForm.type = 'expense')}>Despesa</button><button type="button" class:chosen={transactionForm.type === 'income'} onclick={() => (transactionForm.type = 'income')}>Receita</button></div><label>Descrição<input bind:value={transactionForm.description} placeholder="Ex.: mercado da semana" /></label><div class="form-row"><label>Valor ({currency()})<input bind:value={transactionForm.amount} inputmode="decimal" placeholder="0,00" required /></label><label>Data<input bind:value={transactionForm.date} type="date" required /></label></div><label>Categoria<select bind:value={transactionForm.categoryId} required>{#each snapshot.categories.filter((item) => item.module === 'finance') as category}<option value={category.id}>{category.name}</option>{/each}</select></label><div class="modal-actions"><button type="button" class="button-secondary" onclick={() => (modal = null)}>Cancelar</button><button class="button-primary"><Check size={16} /> {editingTransactionId ? 'Salvar alterações' : 'Salvar lançamento'}</button></div></form>
					{:else if modal === 'habit'}
						<form onsubmit={saveHabit} class="modal-form"><label>Nome do hábito<input bind:value={habitForm.name} placeholder="Ex.: leitura, caminhada…" required /></label><label>Como medir?<select bind:value={habitForm.metric}><option value="boolean">Feito ou não feito</option><option value="duration">Duração</option><option value="count">Contagem</option></select></label>{#if habitForm.metric !== 'boolean'}<div class="form-row"><label>Meta por dia<input bind:value={habitForm.target} type="number" min="1" required /></label>{#if habitForm.metric === 'count'}<label>Unidade<input bind:value={habitForm.unit} placeholder="páginas, copos…" required /></label>{:else}<div class="static-field"><span>Unidade</span><span class="input-static">minutos</span></div>{/if}</div>{/if}<fieldset class="day-choice"><legend>Dias programados</legend><div>{#each ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as day, index}<button type="button" class:active-day={habitForm.scheduledDays.includes(index)} aria-label={`Selecionar dia ${index}`} onclick={() => toggleScheduledDay(index)}>{day}</button>{/each}</div></fieldset><label class="optional-label">Lembrete <span>opcional</span><input type="time" bind:value={habitForm.reminder} /></label><div class="modal-actions"><button type="button" class="button-secondary" onclick={() => (modal = null)}>Cancelar</button><button class="button-primary"><Check size={16} /> Criar hábito</button></div></form>
					{:else if modal === 'pause'}
						<form onsubmit={startPause} class="modal-form"><div class="pause-explainer"><Flame size={20} /><p>Na pausa, Life Force, streaks e lembretes ficam suspensos. Seus dados continuam guardados.</p></div><label>Data de retorno<input type="date" bind:value={pauseForm.until} min={dateOffset(today, 1)} required /></label><div class="modal-actions"><button type="button" class="button-secondary" onclick={() => (modal = null)}>Agora não</button><button class="button-primary">Ativar pausa</button></div></form>
					{:else if modal === 'settings'}
						<div class="settings-content"><section class="settings-section"><div class="settings-title"><div><strong>Preferências</strong><span>Este dispositivo</span></div></div><label class="settings-row"><span><Bell size={17} /><span><strong>Lembretes locais</strong><small>Hábito e blocos de tempo</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.notificationsEnabled} onchange={toggleNotifications} /></label><label class="settings-row"><span><Volume2 size={17} /><span><strong>Sons da interface</strong><small>Toques discretos em ações e registros</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.soundEnabled} onchange={(event) => setFeedbackPreference('soundEnabled', event)} /></label><label class="settings-row"><span><Keyboard size={17} /><span><strong>Som de digitação</strong><small>Teclas ao escrever notas e pesquisar</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.typingSoundEnabled} onchange={(event) => setFeedbackPreference('typingSoundEnabled', event)} /></label><label class="settings-row"><span><Vibrate size={17} /><span><strong>Feedback tátil</strong><small>Vibração curta em dispositivos compatíveis</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.hapticsEnabled} onchange={(event) => setFeedbackPreference('hapticsEnabled', event)} /></label><label class="settings-row"><span><CircleDollarSign size={17} /><span><strong>Moeda base</strong><small>Resumos financeiros</small></span></span><select class="compact-select" value={snapshot.preferences.currency} onchange={changeCurrency}><option value="BRL">BRL · Real</option><option value="USD">USD · Dólar</option><option value="EUR">EUR · Euro</option></select></label></section><section class="settings-section"><div class="settings-title"><div><strong>Backup local</strong><span>Escolha o formato ao exportar</span></div></div><div class="backup-actions"><button type="button" class="button-secondary is-soon" aria-disabled="true" onclick={backupComingSoon}><ArrowDownRight size={16} /> Exportar dados<span class="soon-tag">Em breve</span></button><button type="button" class="button-secondary is-soon" aria-disabled="true" onclick={backupComingSoon}><ArrowUpRight size={16} /> Importar arquivo<span class="soon-tag">Em breve</span></button></div><p class="settings-footnote">Backup local chega em breve. Os dados já ficam salvos neste dispositivo.</p></section><section class="settings-section"><div class="settings-title"><div><strong>Categorias</strong><span>Finanças e tempo</span></div></div><form class="inline-category-form" onsubmit={addCategory}><select bind:value={categoryForm.module}><option value="finance">Finanças</option><option value="time">Tempo</option></select><input bind:value={categoryForm.name} placeholder="Nova categoria" required /><input aria-label="Cor da categoria" type="color" bind:value={categoryForm.color} /><button class="icon-button add-category" aria-label="Adicionar categoria"><Plus size={16} /></button></form><div class="category-edit-list">{#each snapshot.categories as category}<button onclick={() => renameCategory(category)}><i style={`background:${category.color}`}></i>{category.name}<span>{category.module === 'finance' ? 'Finanças' : 'Tempo'}</span></button>{/each}</div></section><button class="pause-link" onclick={() => (modal = 'pause')}><Flame size={16} /> Pausar Atlas até uma data</button></div>
					{/if}
			</div>
		</div>
	{/if}
	{#if dialog}
		<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeDialog(null); }}>
			<div class="modal-card dialog-card" role="dialog" aria-modal="true" aria-label={dialog.title}>
				<div class="modal-heading"><div><span class="eyebrow">ATLAS · SEU ESPAÇO</span><h2>{dialog.title}</h2></div><button class="icon-button" aria-label="Fechar" onclick={() => closeDialog(null)}><X size={19} /></button></div>
				<form class="modal-form" onsubmit={submitDialog}>
					{#if dialog.kind === 'prompt'}
						<label>{dialog.label}<input bind:this={dialogInput} bind:value={dialogValue} placeholder={dialog.placeholder ?? ''} /></label>
					{:else}
						<p class="dialog-message">{dialog.message}</p>
					{/if}
					<div class="modal-actions">
						<button type="button" class="button-secondary" onclick={() => closeDialog(null)}>Cancelar</button>
						<button class="button-primary" class:danger={dialog.danger}>{dialog.confirmLabel}</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
	<canvas bind:this={effectsCanvas} class="atlas-confetti" aria-hidden="true"></canvas>
	{#if toast}<div class:warn={toastWarning} class="toast">{#if !toastWarning}<Check size={16} />{/if}{toast}{#if toastUndo}<button class="toast-undo" onclick={() => { const action = toastUndo; toastUndo = null; toast = ''; action?.(); }}>Desfazer</button>{/if}</div>{/if}
{:else}
	<div class="loading-screen"><div class="empty-orbit"><X size={20} /></div><strong>Não foi possível abrir Atlas</strong><button class="button-secondary" onclick={initialize}>Tentar novamente</button></div>
{/if}
