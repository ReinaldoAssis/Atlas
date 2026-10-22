<script lang="ts">
	import { untrack } from 'svelte';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { localDate, normalizeTimeWindow, TIME_WINDOW_DEFAULT_END_HOUR, TIME_WINDOW_DEFAULT_START_HOUR, TIME_WINDOW_MIN_HOURS } from '#lib/atlas';
	import { m } from '#lib/paraglide/messages.js';
	import { intlLocale } from '#lib/i18n/intl';
	import {
		clampRange,
		defaultRange,
		monthLabel,
		monthStart,
		shiftMonth,
		TIME_RANGE_MAX_DAYS
	} from '#lib/time-range';

	/**
	 * Calendário de range do planejador.
	 *
	 * Primeiro toque marca o início; o segundo marca o fim e aplica. Ranges
	 * acima de 14 dias são cortados e o usuário confirma no próprio calendário.
	 */
	let {
		start,
		end,
		windowStart = TIME_WINDOW_DEFAULT_START_HOUR,
		windowEnd = TIME_WINDOW_DEFAULT_END_HOUR,
		onapply,
		onwindow = () => {},
		onclose
	}: {
		start: string;
		end: string;
		/** Janela de horas visível na grade (inclusiva nas duas pontas). */
		windowStart?: number;
		windowEnd?: number;
		onapply: (start: string, end: string) => void;
		onwindow?: (startHour: number, endHour: number) => void;
		onclose: () => void;
	} = $props();

	/** Horários oferecidos: o início precisa deixar espaço para o mínimo de horas. */
	const startHours = Array.from({ length: 24 - TIME_WINDOW_MIN_HOURS + 1 }, (_, index) => index);
	const endHours = Array.from({ length: 24 }, (_, index) => index);

	function hourLabel(hour: number): string {
		return `${String(hour).padStart(2, '0')}:00`;
	}

	function setWindow(startHour: number, endHour: number) {
		const window = normalizeTimeWindow(startHour, endHour);
		onwindow(window.startHour, window.endHour);
	}

	function setWindowStart(value: number) {
		setWindow(value, Math.max(windowEnd, value + TIME_WINDOW_MIN_HOURS - 1));
	}

	function setWindowEnd(value: number) {
		setWindow(Math.min(windowStart, value - TIME_WINDOW_MIN_HOURS + 1), value);
	}

	const today = localDate();
	let month = $state(untrack(() => monthStart(start)));
	let pendingStart = $state<string | null>(null);
	let pendingEnd = $state<string | null>(null);
	let pendingApply = $state<{ start: string; end: string } | null>(null);
	let warning = $state('');

	const shown = $derived(
		pendingStart ? { start: pendingStart, end: pendingEnd ?? pendingStart } : { start, end }
	);

	const cells = $derived.by(() => {
		const first = new Date(`${month}T12:00:00`);
		const lead = (first.getDay() + 6) % 7;
		const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
		const values: (string | null)[] = Array.from({ length: lead }, () => null);
		for (let day = 1; day <= total; day += 1) {
			values.push(`${month.slice(0, 8)}${String(day).padStart(2, '0')}`);
		}
		while (values.length % 7 !== 0) values.push(null);
		return values;
	});

	function dayLabel(date: string): string {
		return new Date(`${date}T12:00:00`).toLocaleDateString(intlLocale(), {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}

	function inRange(date: string): boolean {
		return date >= shown.start && date <= shown.end;
	}

	function pick(date: string) {
		if (pendingApply) {
			onapply(pendingApply.start, pendingApply.end);
			return;
		}
		if (!pendingStart) {
			pendingStart = date;
			pendingEnd = null;
			warning = '';
			return;
		}
		const result = clampRange(pendingStart, date);
		pendingStart = result.start;
		pendingEnd = result.end;
		if (result.clamped) {
			pendingApply = { start: result.start, end: result.end };
			warning = m.planner_range_warning({ days: TIME_RANGE_MAX_DAYS });
			return;
		}
		onapply(result.start, result.end);
	}

	function apply(startDate: string, endDate: string) {
		const result = clampRange(startDate, endDate);
		onapply(result.start, result.end);
	}

	function presetToday() {
		apply(today, today);
	}

	function presetWeek() {
		const range = defaultRange(today);
		apply(range.start, range.end);
	}

	function changeMonth(delta: number) {
		month = shiftMonth(month, delta);
	}
</script>

<Sheet title={m.planner_range_title()} closeLabel={m.planner_close()} {onclose}>
	<div class="cal-shortcuts">
		<button type="button" onclick={presetToday}>{m.planner_range_today()}</button>
		<button type="button" onclick={presetWeek}>{m.planner_range_week()}</button>
		<small>{m.planner_range_max({ days: TIME_RANGE_MAX_DAYS })}</small>
	</div>

	<div class="cal-window">
		<div class="cal-window-head">
			<b>{m.time_window_title()}</b>
			<small>{m.time_window_hint()}</small>
		</div>
		<div class="cal-window-fields">
			<label>
				<small>{m.time_window_from()}</small>
				<select value={windowStart} onchange={(event) => setWindowStart(Number(event.currentTarget.value))}>
					{#each startHours as hour (hour)}<option value={hour}>{hourLabel(hour)}</option>{/each}
				</select>
			</label>
			<label>
				<small>{m.time_window_to()}</small>
				<select value={windowEnd} onchange={(event) => setWindowEnd(Number(event.currentTarget.value))}>
					{#each endHours as hour (hour)}<option value={hour}>{hourLabel(hour)}</option>{/each}
				</select>
			</label>
		</div>
	</div>

	<div class="cal-head">
		<button type="button" class="cal-nav" aria-label={m.planner_range_prev_month()} onclick={() => changeMonth(-1)}>
			<ChevronLeft size={18} />
		</button>
		<b>{monthLabel(month)}</b>
		<button type="button" class="cal-nav" aria-label={m.planner_range_next_month()} onclick={() => changeMonth(1)}>
			<ChevronRight size={18} />
		</button>
	</div>

	<div class="cal-week" aria-hidden="true">
		{#each ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] as label, index (index)}<span>{label}</span>{/each}
	</div>

	<div class="cal-grid" role="grid" aria-label={m.planner_range_pick()}>
		{#each cells as date, index (date ?? `blank-${index}`)}
			{#if date}
				<button
					type="button"
					class:today={date === today}
					class:in={inRange(date) && date !== shown.start && date !== shown.end}
					class:edge={date === shown.start || date === shown.end}
					class:start={date === shown.start}
					class:end={date === shown.end}
					aria-label={dayLabel(date)}
					aria-pressed={inRange(date)}
					onclick={() => pick(date)}
				>
					{Number(date.slice(8, 10))}
				</button>
			{:else}
				<span class="cal-blank" aria-hidden="true"></span>
			{/if}
		{/each}
	</div>

	{#if warning}
		<div class="cal-warning" role="status">
			<span>{warning}</span>
			{#if pendingApply}
				<button type="button" onclick={() => pendingApply && apply(pendingApply.start, pendingApply.end)}>{m.planner_range_apply()}</button>
			{/if}
		</div>
	{:else}
		<p class="cal-hint">{m.planner_range_hint()}</p>
	{/if}
</Sheet>

<style>
	.cal-shortcuts {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-bottom: 10px;
	}
	.cal-shortcuts button {
		padding: 7px 11px;
		border: 0;
		border-radius: 16px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
	}
	.cal-shortcuts small {
		margin-left: auto;
		color: var(--mu);
		font-size: 11px;
	}
	.cal-window {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--s);
	}
	.cal-window-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.cal-window-head b {
		color: var(--tx);
		font-size: 13px;
		font-weight: 700;
	}
	.cal-window-head small {
		color: var(--mu);
		font-size: 11px;
		text-align: right;
	}
	.cal-window-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.cal-window-fields label {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.cal-window-fields label small {
		color: var(--mu);
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.cal-window-fields select {
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: 8px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
	}
	.cal-head {
		display: grid;
		grid-template-columns: 36px 1fr 36px;
		align-items: center;
		gap: 4px;
		padding-bottom: 8px;
	}
	.cal-head b {
		color: var(--tx);
		font-size: 15px;
		font-weight: 700;
		text-align: center;
	}
	.cal-nav {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 8px;
		background: var(--s2);
		color: var(--mu);
	}
	.cal-nav:active {
		color: var(--tx);
		background: var(--s);
	}
	.cal-week,
	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 3px;
	}
	.cal-week span {
		padding-bottom: 3px;
		color: var(--mu);
		font-size: 10px;
		font-weight: 600;
		text-align: center;
	}
	.cal-grid button,
	.cal-blank {
		height: 40px;
		border-radius: 10px;
	}
	.cal-grid button {
		border: 0;
		background: none;
		color: var(--tx);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		text-align: center;
		outline: none;
		transition: background 0.15s, color 0.15s;
	}
	.cal-grid button:active {
		background: var(--s2);
	}
	.cal-grid button:focus-visible {
		outline: none;
		background: var(--s2);
	}
	.cal-grid button.in {
		border-radius: 0;
		background: color-mix(in srgb, var(--acc) 17%, transparent);
	}
	.cal-grid button.start {
		border-radius: 10px 0 0 10px;
	}
	.cal-grid button.end {
		border-radius: 0 10px 10px 0;
	}
	.cal-grid button.edge {
		border-radius: 10px;
		background: var(--acc);
		color: #141a0a;
	}
	.cal-grid button.today:not(.edge) {
		box-shadow: inset 0 0 0 1.5px var(--acc);
	}
	.cal-hint {
		margin: 12px 0 2px;
		color: var(--mu);
		font-size: 12px;
		text-align: center;
	}
	.cal-warning {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 12px;
		padding: 9px 12px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--flame) 14%, transparent);
		color: var(--flame);
		font-size: 12px;
		font-weight: 600;
	}
	.cal-warning button {
		flex: none;
		padding: 7px 11px;
		border: 0;
		border-radius: 8px;
		background: var(--flame);
		color: #141a0a;
		font: inherit;
		font-size: 12px;
		font-weight: 700;
	}
	@media (prefers-reduced-motion: reduce) {
		.cal-grid button {
			transition: none;
		}
	}
</style>
