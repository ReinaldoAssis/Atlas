<script lang="ts">
	import { onMount } from 'svelte';
	import { isTauri } from '@tauri-apps/api/core';
	import {
		ArrowDownLeft, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, CalendarDays,
		Check, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Flame,
		LayoutDashboard, Menu, MoreHorizontal, Plus, Settings2, Target, TrendingDown, Vibrate, Volume2,
		TrendingUp, Wallet, X, type LucideIcon
	} from '@lucide/svelte';
	import {
		currentStreak, dateOffset, didMeetTarget, formatMinutes, id, localDate, money, weekStartDate, WEEK_MAX,
		TIME_SLOT_START_HOUR, TIME_SLOT_COUNT, TIME_SLOT_MINUTES,
		experienceProgress, type AppPreferences, type AtlasSnapshot, type Category, type Habit, type HabitLog,
		type NavigationKey, type TimeBlock, type Transaction
	} from '#lib/atlas';
	import { exportBackup, importBackup, loadSnapshot, saveSnapshot } from '#lib/storage';
	import {
		burstAt, centerOf, confetti, emitParticles, floatValue, playFeedback, playTone, popElement,
		prefersReducedMotion, pulseHaptic, vibrate
	} from '#lib/feedback';
	import '../app.css';

	type Period = 'week' | 'month' | 'custom';
	type ModalKind = 'transaction' | 'habit' | 'settings' | 'pause' | null;

	const navItems: { id: NavigationKey; label: string; icon: LucideIcon }[] = [
		{ id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
		{ id: 'finance', label: 'Finanças', icon: Wallet },
		{ id: 'habits', label: 'Hábitos', icon: Target },
		{ id: 'time', label: 'Tempo', icon: CalendarDays }
	];

	let snapshot = $state<AtlasSnapshot | null>(null);
	let ready = $state(false);
	let loadError = $state('');
	let activeTab = $state<NavigationKey>('dashboard');
	let period = $state<Period>('week');
	let customStart = $state(dateOffset(localDate(), -6));
	let customEnd = $state(localDate());
	let timeWeekStart = $state(weekStart(localDate()));
	let currentTime = $state(new Date());
	let modal = $state<ModalKind>(null);
	let toast = $state('');
	let toastWarning = $state(false);
	let toastUndo = $state<(() => void) | null>(null);
	let isMobileNavOpen = $state(false);
	let editingTransactionId = $state('');
	let formError = $state('');
	let wasPaused = $state(false);
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
	let incomeTotal = $derived(rangeTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amountMinor, 0));
	let expenseTotal = $derived(rangeTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amountMinor, 0));
	let completedMinutes = $derived(rangeBlocks.filter((item) => item.status === 'completed').reduce((sum, item) => sum + (item.actualMinutes ?? item.plannedMinutes), 0));
	let plannedMinutes = $derived(rangeBlocks.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + item.plannedMinutes, 0));
	let habitCompletion = $derived.by(() => {
		if (!snapshot?.habits.length) return 0;
		const eligible = snapshot.habits.filter((habit) => habit.active && habit.scheduledDays.includes(new Date(`${today}T12:00:00`).getDay()));
		if (!eligible.length) return 0;
		const done = eligible.filter((habit) => {
			const log = snapshot?.habitLogs.find((item) => item.habitId === habit.id && item.date === today);
			return Boolean(log && didMeetTarget(habit, log.value));
		}).length;
		return Math.round((done / eligible.length) * 100);
	});
	let recentTransactions = $derived([...(rangeTransactions ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5));
	let todayBlocks = $derived(snapshot?.timeBlocks.filter((item) => item.startAt.slice(0, 10) === today).sort((a, b) => a.startAt.localeCompare(b.startAt)) ?? []);
	let habitPeriodStats = $derived.by(() => {
		if (!snapshot) return { done: 0, scheduled: 0, percent: 0 };
		let done = 0;
		let scheduled = 0;
		for (let date = currentRange.start; date <= currentRange.end; date = dateOffset(date, 1)) {
			if (isPausedOn(date, snapshot)) continue;
			const weekday = new Date(`${date}T12:00:00`).getDay();
			for (const habit of snapshot.habits.filter((item) => item.active && item.scheduledDays.includes(weekday))) {
				scheduled += 1;
				const log = snapshot.habitLogs.find((item) => item.habitId === habit.id && item.date === date);
				if (log && didMeetTarget(habit, log.value)) done += 1;
			}
		}
		return { done, scheduled, percent: scheduled ? Math.round((done / scheduled) * 100) : 0 };
	});
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
	let todayHabitCount = $derived(habitWeekDays.find((item) => item.date === today)?.planned ?? 0);
	let todayHabitDone = $derived(habitWeekDays.find((item) => item.date === today)?.done ?? 0);
	let todayHabitGoal = $derived(Math.min(3, todayHabitCount));
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
			if (!button || button.matches('.tp-c, .tp-cat, .habit-log-button, .habit-complete-button')) return;
			playFeedback('tap', snapshot?.preferences.soundEnabled);
			pulseHaptic(snapshot?.preferences.hapticsEnabled, 6);
		};
		const onResize = () => {
			if (activeTab === 'time') {
				timeLayout();
				handleTimeScroll();
			}
		};
		void initialize();
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
		window.addEventListener('click', onClickFeedback);
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
			window.removeEventListener('resize', onResize);
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
			loadError = 'Não foi possível abrir os dados locais.';
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
		} catch (error) {
			console.error(error);
			toastMessage('Não foi possível salvar no dispositivo. Tente novamente.');
			throw error;
		}
	}

	function isCurrentPause(data: AtlasSnapshot): boolean {
		return Boolean(data.lifeForce.pausedFrom && data.lifeForce.pausedUntil && localDate() >= data.lifeForce.pausedFrom && localDate() < data.lifeForce.pausedUntil);
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

	function openTransaction() {
		formError = '';
		editingTransactionId = '';
		transactionForm = { type: 'expense', amount: '', categoryId: snapshot?.categories.find((item) => item.module === 'finance')?.id ?? '', date: localDate(), description: '' };
		modal = 'transaction';
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

	function openTime() {
		activeTab = 'time';
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

	function openComplete(block: TimeBlock) {
		if (!snapshot) return;
		const next = cloneSnapshot();
		const target = next.timeBlocks.find((item) => item.id === block.id);
		if (!target || target.status === 'cancelled') return;
		const created = target.status !== 'completed';
		target.actualMinutes = created ? Math.min(30, target.plannedMinutes) : null;
		target.status = created ? 'completed' : 'planned';
		void commit(next, true, created);
		if (created) {
			playFeedback('success', snapshot.preferences.soundEnabled);
			pulseHaptic(snapshot.preferences.hapticsEnabled, [12, 24, 18]);
			emitParticles(document.querySelector(`[data-time-slot="${block.startAt.slice(0, 10)}-${block.startAt.slice(11, 16)}"]`));
		}
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

	async function setFeedbackPreference(key: 'soundEnabled' | 'hapticsEnabled', event: Event) {
		const enabled = (event.currentTarget as HTMLInputElement).checked;
		await updatePreferences({ [key]: enabled });
		if (key === 'soundEnabled') playFeedback('success', enabled);
		else pulseHaptic(enabled, [10, 22, 14]);
	}

	async function changeCurrency(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (!window.confirm('Alterar a moeda base muda apenas a forma de exibição. O Atlas não converte os valores já registrados. Deseja continuar?')) return;
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
		const name = window.prompt('Nome da categoria', category.name)?.trim();
		if (!name || !snapshot) return;
		const next = cloneSnapshot();
		const found = next.categories.find((item) => item.id === category.id);
		if (found) found.name = name;
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

	async function saveBackup() {
		if (!snapshot) return;
		try {
			const encrypted = window.confirm('Proteger este backup com uma senha?\n\nOK: criptografar · Cancelar: exportar sem senha');
			let password: string | undefined;
			if (encrypted) {
				password = window.prompt('Crie uma senha para o backup. Ela não poderá ser recuperada pelo Atlas.') ?? undefined;
				if (!password || password.length < 8) {
					toastMessage('Use uma senha com pelo menos 8 caracteres.');
					return;
				}
				const confirmation = window.prompt('Digite a senha novamente para confirmar.') ?? '';
				if (confirmation !== password) {
					toastMessage('As senhas não coincidem.');
					return;
				}
			}
			const blob = await exportBackup(snapshot, password);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `atlas-backup-${localDate()}${encrypted ? '.encrypted' : ''}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
			toastMessage('Backup exportado.');
		} catch (error) {
			console.error(error);
			toastMessage('Não foi possível exportar o backup.');
		}
	}

	async function restoreBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			let password: string | undefined;
			const header = JSON.parse(await file.text()) as { format?: string };
			if (header.format === 'atlas-backup-encrypted-v1') {
				password = window.prompt('Digite a senha do backup criptografado.') ?? undefined;
				if (!password) return;
			}
			const imported = await importBackup(file, password);
			const confirmed = window.confirm('Importar este backup substituirá todos os dados locais deste dispositivo. Deseja continuar?');
			if (!confirmed) return;
			await saveSnapshot(imported);
			snapshot = imported;
			toastMessage('Backup importado.');
		} catch (error) {
			toastMessage(error instanceof Error ? error.message : 'Não foi possível importar o backup.');
		} finally {
			input.value = '';
		}
	}

	function setActiveTab(key: NavigationKey) {
		activeTab = key;
		isMobileNavOpen = false;
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
	<div class="app-shell">
		<aside class:open={isMobileNavOpen} class="sidebar">
			<div class="brand-lockup">
				<div class="brand-mark">A<span></span></div>
				<div><strong>atlas</strong><small>seu espaço de vida</small></div>
			</div>
			<div class="sidebar-label">ESPAÇO PESSOAL</div>
			<nav class="main-nav" aria-label="Navegação principal">
				{#each navItems as item}
					<button class:active={activeTab === item.id} class="nav-item" onclick={() => setActiveTab(item.id)}>
						<item.icon size={19} strokeWidth={1.8} />
						<span>{item.label}</span>
						{#if item.id === 'habits' && snapshot.habits.filter((habit) => habit.active).length}<small>{snapshot.habits.filter((habit) => habit.active).length}</small>{/if}
					</button>
				{/each}
			</nav>
			<div class="sidebar-spacer"></div>
			<div class="sidebar-life">
				<div class="life-caption"><span>Life Force</span><span>{lifeForcePercent}%</span></div>
				<div class="life-track"><div class="life-fill" style={`width:${lifeForcePercent}%`}></div></div>
				<div class="life-note">Sua presença no Atlas</div>
			</div>
			<button class="nav-item settings-link" onclick={openSettings}><Settings2 size={18} /><span>Preferências</span></button>
			<div class="sidebar-foot"><span class="local-dot"></span>Dados guardados neste dispositivo</div>
		</aside>

		<div class="main-column">
			<header class="topbar">
				<button class="icon-button mobile-menu" aria-label="Abrir menu" onclick={() => (isMobileNavOpen = !isMobileNavOpen)}><Menu size={20} /></button>
				<div class="breadcrumb"><span>Atlas</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === activeTab)?.label}</strong></div>
				<div class="topbar-actions">
					<button class="life-chip" aria-label="Life Force" onclick={() => (modal = 'pause')}><Flame size={16} fill={lifeForcePercent > 0 ? 'currentColor' : 'none'} /><span>{lifeForcePercent}%</span></button>
					<button class="icon-button" aria-label="Preferências" onclick={openSettings}><Settings2 size={18} /></button>
				</div>
			</header>

			<main class="workspace">
				{#if activeTab === 'dashboard'}
					<div class="page-heading dashboard-heading">
		<div><div class="eyebrow">{humanDate(today, { weekday: 'long' }).toUpperCase()} · {humanDate(today, { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}</div><h1>Seu ritmo, <em>em perspectiva.</em></h1><p>Um retrato do que você está vivendo, construído por você.</p></div>
						<div class="heading-actions"><button class="button-secondary" onclick={openSettings}><Settings2 size={16} /> Ajustes</button><button class="button-primary" onclick={openTransaction}><Plus size={17} /> Novo registro</button></div>
					</div>
					<div class="period-toolbar">
						<div class="period-tabs" aria-label="Período do dashboard">
							<button class:chosen={period === 'week'} onclick={() => changePeriod('week')}>Esta semana</button>
							<button class:chosen={period === 'month'} onclick={() => changePeriod('month')}>Este mês</button>
							<button class:chosen={period === 'custom'} onclick={() => changePeriod('custom')}>Personalizado</button>
						</div>
						{#if period === 'custom'}<div class="range-inputs"><input aria-label="Início do período" type="date" bind:value={customStart} /><span>até</span><input aria-label="Fim do período" type="date" bind:value={customEnd} /></div>{/if}
						<span class="period-label">{humanDate(currentRange.start)} — {humanDate(currentRange.end)}</span>
					</div>

					<section class="overview-grid" aria-label="Resumo dos módulos">
						<article class="overview-card finance-overview">
							<div class="card-topline"><span class="card-icon finance-icon"><Wallet size={17} /></span><span class="overline">FINANÇAS</span><button class="card-arrow" aria-label="Abrir finanças" onclick={() => setActiveTab('finance')}><ArrowUpRight size={16} /></button></div>
							<div class="metric-label">Saldo no período</div><div class="metric-value">{money(incomeTotal - expenseTotal, currency())}</div>
							<div class="finance-split"><span><i class="income-dot"></i>Entradas <b>{money(incomeTotal, currency())}</b></span><span><i class="expense-dot"></i>Saídas <b>{money(expenseTotal, currency())}</b></span></div>
							<div class="mini-bar"><span style={`width:${incomeTotal + expenseTotal ? Math.min(100, incomeTotal / (incomeTotal + expenseTotal) * 100) : 0}%`}></span></div>
						</article>
						<article class="overview-card habit-overview">
							<div class="card-topline"><span class="card-icon habit-icon"><Target size={17} /></span><span class="overline">HÁBITOS DE HOJE</span><button class="card-arrow" aria-label="Abrir hábitos" onclick={() => setActiveTab('habits')}><ArrowUpRight size={16} /></button></div>
							<div class="metric-value habit-value">{habitCompletion}<small>%</small></div><div class="metric-label">das metas de hoje alcançadas</div>
							<div class="progress-track"><div class="progress-lime" style={`width:${habitCompletion}%`}></div></div>
							<div class="card-footnote">{snapshot.habits.filter((habit) => habit.active && habit.scheduledDays.includes(new Date(`${today}T12:00:00`).getDay())).length} hábitos previstos para hoje</div>
						</article>
						<article class="overview-card time-overview">
							<div class="card-topline"><span class="card-icon time-icon"><Clock3 size={17} /></span><span class="overline">TEMPO</span><button class="card-arrow" aria-label="Abrir agenda" onclick={() => setActiveTab('time')}><ArrowUpRight size={16} /></button></div>
							<div class="metric-value">{formatMinutes(completedMinutes)}</div><div class="metric-label">realizados de {formatMinutes(plannedMinutes)} planejados</div>
							<div class="progress-track"><div class="progress-blue" style={`width:${plannedMinutes ? Math.min(100, completedMinutes / plannedMinutes * 100) : 0}%`}></div></div>
							<div class="card-footnote">{rangeBlocks.filter((item) => item.status === 'completed').length} blocos concluídos no período</div>
						</article>
						<article class="overview-card lifeforce-overview">
							<div class="card-topline"><span class="card-icon life-icon"><Flame size={17} /></span><span class="overline">LIFE FORCE</span><button class="card-arrow" aria-label="Pausar Life Force" onclick={() => (modal = 'pause')}><MoreHorizontal size={18} /></button></div>
							<div class="metric-value">{lifeForcePercent}<small>%</small></div><div class="metric-label">interação recente com Atlas</div>
							<div class="life-track large-life"><div class="life-fill" style={`width:${lifeForcePercent}%`}></div></div>
							<div class="card-footnote">Não mede bem-estar nem desempenho.</div>
						</article>
					</section>

					<section class="dashboard-lower">
						<article class="panel recent-panel">
							<div class="panel-heading"><div><div class="overline">MOVIMENTO RECENTE</div><h2>Últimos registros</h2></div><button class="text-button" onclick={() => setActiveTab('finance')}>Ver finanças <ArrowRight size={14} /></button></div>
							{#if recentTransactions.length}
								<div class="activity-list">
									{#each recentTransactions as transaction}
										<div class="activity-row"><span class="activity-icon" class:positive={transaction.type === 'income'}>{#if transaction.type === 'income'}<ArrowDownLeft size={16} />{:else}<ArrowUpRight size={16} />{/if}</span><div class="activity-main"><strong>{transaction.description}</strong><span>{categoryName(transaction.categoryId)} · {recentLabel(transaction.date)}</span></div><b class:positive-text={transaction.type === 'income'}>{transaction.type === 'income' ? '+' : '−'}{money(transaction.amountMinor, currency())}</b></div>
									{/each}
								</div>
							{:else}
								<div class="empty-state compact-empty"><div class="empty-orbit"><CircleDollarSign size={20} /></div><strong>Seus registros começam aqui</strong><span>Adicione um movimento e veja o panorama ganhar forma.</span><button class="button-secondary" onclick={openTransaction}><Plus size={15} /> Registrar movimento</button></div>
							{/if}
						</article>
						<article class="panel today-panel">
							<div class="panel-heading"><div><div class="overline">PLANO DE HOJE</div><h2>Tempo reservado</h2></div><button class="icon-button subtle" aria-label="Adicionar bloco" onclick={openTime}><Plus size={18} /></button></div>
							{#if todayBlocks.length}
								<div class="today-list">
									{#each todayBlocks.slice(0, 4) as block}
										<div class="today-row"><div class="timeline"><span class:done={block.status === 'completed'}></span></div><div class="today-time">{new Date(block.startAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}<small>{formatMinutes(block.plannedMinutes)}</small></div><div class="today-activity"><strong>{block.title}</strong><span><i style={`background:${currentCategory(block.categoryId)?.color ?? '#9da3a3'}`}></i>{categoryName(block.categoryId)}</span></div>{#if block.status === 'completed'}<Check size={16} class="done-check" />{:else}<button class="mini-action" aria-label="Marcar bloco realizado" onclick={() => openComplete(block)}><Check size={15} /></button>{/if}</div>
									{/each}
								</div>
								{#if todayBlocks.length > 4}<button class="text-button centered" onclick={() => setActiveTab('time')}>Ver agenda completa <ArrowRight size={14} /></button>{/if}
							{:else}
								<div class="empty-state compact-empty"><div class="empty-orbit time-empty"><CalendarDays size={19} /></div><strong>Sem blocos planejados</strong><span>Reserve um espaço para algo que importa hoje.</span><button class="button-secondary" onclick={openTime}><Plus size={15} /> Planejar tempo</button></div>
							{/if}
						</article>
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
				{/if}
			</main>
		</div>
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
						<div class="settings-content"><section class="settings-section"><div class="settings-title"><div><strong>Preferências</strong><span>Este dispositivo</span></div></div><label class="settings-row"><span><Bell size={17} /><span><strong>Lembretes locais</strong><small>Hábito e blocos de tempo</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.notificationsEnabled} onchange={toggleNotifications} /></label><label class="settings-row"><span><Volume2 size={17} /><span><strong>Sons da interface</strong><small>Toques discretos em ações e registros</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.soundEnabled} onchange={(event) => setFeedbackPreference('soundEnabled', event)} /></label><label class="settings-row"><span><Vibrate size={17} /><span><strong>Feedback tátil</strong><small>Vibração curta em dispositivos compatíveis</small></span></span><input class="toggle-input" type="checkbox" checked={snapshot.preferences.hapticsEnabled} onchange={(event) => setFeedbackPreference('hapticsEnabled', event)} /></label><label class="settings-row"><span><CircleDollarSign size={17} /><span><strong>Moeda base</strong><small>Resumos financeiros</small></span></span><select class="compact-select" value={snapshot.preferences.currency} onchange={changeCurrency}><option value="BRL">BRL · Real</option><option value="USD">USD · Dólar</option><option value="EUR">EUR · Euro</option></select></label></section><section class="settings-section"><div class="settings-title"><div><strong>Backup local</strong><span>Escolha o formato ao exportar</span></div></div><div class="backup-actions"><button class="button-secondary" onclick={saveBackup}><ArrowDownRight size={16} /> Exportar dados</button><label class="button-secondary import-label"><ArrowUpRight size={16} /> Importar arquivo<input type="file" accept="application/json,.json" onchange={restoreBackup} /></label></div><p class="settings-footnote">A importação substitui os dados deste dispositivo. Guarde o arquivo em um local seguro.</p></section><section class="settings-section"><div class="settings-title"><div><strong>Categorias</strong><span>Finanças e tempo</span></div></div><form class="inline-category-form" onsubmit={addCategory}><select bind:value={categoryForm.module}><option value="finance">Finanças</option><option value="time">Tempo</option></select><input bind:value={categoryForm.name} placeholder="Nova categoria" required /><input aria-label="Cor da categoria" type="color" bind:value={categoryForm.color} /><button class="icon-button add-category" aria-label="Adicionar categoria"><Plus size={16} /></button></form><div class="category-edit-list">{#each snapshot.categories as category}<button onclick={() => renameCategory(category)}><i style={`background:${category.color}`}></i>{category.name}<span>{category.module === 'finance' ? 'Finanças' : 'Tempo'}</span></button>{/each}</div></section><button class="pause-link" onclick={() => (modal = 'pause')}><Flame size={16} /> Pausar Atlas até uma data</button></div>
					{/if}
			</div>
		</div>
	{/if}
	<canvas bind:this={effectsCanvas} class="atlas-confetti" aria-hidden="true"></canvas>
	{#if toast}<div class:warn={toastWarning} class="toast">{#if !toastWarning}<Check size={16} />{/if}{toast}{#if toastUndo}<button class="toast-undo" onclick={() => { const action = toastUndo; toastUndo = null; toast = ''; action?.(); }}>Desfazer</button>{/if}</div>{/if}
{:else}
	<div class="loading-screen"><div class="empty-orbit"><X size={20} /></div><strong>Não foi possível abrir Atlas</strong><button class="button-secondary" onclick={initialize}>Tentar novamente</button></div>
{/if}
