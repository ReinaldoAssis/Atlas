<script lang="ts">
	import Segmented from '#lib/components/ui/Segmented.svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { plan, requestUpgrade } from '#lib/plan.svelte';
	import { historyFloor } from '#lib/plan';
		import { formatClock } from '#lib/duration';
	import { buildHistoryChart } from '#lib/history-chart';
	import HistoryList from './HistoryList.svelte';
	import type { HistoryGroup } from '#lib/history-list';
	import {
		HABIT_BOOLEAN_LABELS,
		booleanLabelOf,
		dateOffset,
		didMeetTarget,
		localDate,
		type Habit,
		type HabitLog
	} from '#lib/atlas';

	/** Histórico de hábito: mesma leitura do tracker, sem ações de edição. */
	let {
		habit,
		logs,
		onopen,
		onclose
	}: {
		habit: Habit;
		logs: HabitLog[];
		onopen: (log: HabitLog) => void;
		onclose: () => void;
	} = $props();

	const today = localDate();
	let range = $state<'7' | '30' | 'all'>('30');

	function dateLabel(date: string): string {
		if (date === today) return m.habit_today();
		if (date === dateOffset(today, -1)) return m.habit_yesterday();
		const [year, month, day] = date.split('-');
		return `${day}/${month}${year !== today.slice(0, 4) ? `/${year}` : ''}`;
	}

	function valueLabel(value: number): string {
		if (habit.metric === 'duration') return formatClock(value);
		if (habit.metric === 'boolean') return booleanLabelOf(habit, value, HABIT_BOOLEAN_LABELS);
		if (habit.metric === 'weekly') return m.habit_weekly_progress({ value, target: habit.target });
		return `${value} ${habit.unit}`.trim();
	}

	const filtered = $derived.by(() => {
		const cutoff = range === 'all' ? '' : dateOffset(today, range === '7' ? -6 : -29);
		return logs
			.filter((log) => !cutoff || log.date >= cutoff)
			.slice()
			.sort((a, b) => b.date.localeCompare(a.date));
	});

	const latest = $derived(filtered[0] ?? null);
	const groups = $derived.by(() => {
		const map = new Map<string, HistoryGroup['rows']>();
		for (const log of filtered) {
			const rows = map.get(log.date) ?? [];
			rows.push({ id: log.id, value: valueLabel(log.value) });
			map.set(log.date, rows);
		}
		return [...map].map(([date, rows]) => ({ date, rows }));
	});
	const chart = $derived(
		habit.metric === 'boolean'
			? null
			: buildHistoryChart(
					[...filtered]
						.sort((a, b) => a.date.localeCompare(b.date))
						.map((log) => ({ date: log.date, value: log.value })),
					habit.target
				)
	);
</script>

<Sheet title={habit.name} closeLabel={m.common_close()} {onclose}>
	<div class="hh-head">
		<span class="hh-value">
			{#if latest}
				<b>{valueLabel(latest.value)}</b>
				<small>{dateLabel(latest.date)}</small>
			{:else}
				<b>—</b>
				<small>{m.common_no_records()}</small>
			{/if}
		</span>
		<span class="hh-goal">
			{m.common_goal_value({ value: valueLabel(habit.target) })}{#if habit.metric !== 'boolean'}<span class:ok={latest ? didMeetTarget(habit, latest.value) : false}></span>{/if}
		</span>
	</div>

	{#if chart}
		<svg class="hh-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={m.common_history_of({ name: habit.name })}>
			<path class="hh-area" d={chart.area} />
			<path class="hh-line" d={chart.line} />
			{#if chart.targetY != null}
				<line class="hh-target" x1="0" x2={chart.width} y1={chart.targetY} y2={chart.targetY} />
			{/if}
			{#each chart.coords as [cx, cy], index (index)}
				<circle class="hh-dot" cx={cx} cy={cy} r="2.6" />
			{/each}
		</svg>
		<Segmented
			label={m.common_chart_period()}
			options={[
				{ value: '7', label: m.common_range_days({ count: 7 }) },
				{ value: '30', label: m.common_range_days({ count: 30 }) },
				{ value: 'all', label: m.common_range_all() }
			]}
			bind:value={range}
		/>
	{/if}

	{#if filtered.length}
		<HistoryList
			{groups}
			floorDate={historyFloor(localDate(), plan.status)}
			onupgrade={() => requestUpgrade(null)}
			onopen={(id) => {
				const log = logs.find((item) => item.id === id);
				if (log) onopen(log);
			}}
		/>
	{:else}
		<p class="hh-empty">{m.common_empty_period()}</p>
	{/if}
</Sheet>

<style>
	.hh-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		padding: 4px 0 12px;
	}
	.hh-value {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.hh-value b {
		color: var(--tx);
		font-size: 28px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.hh-value small,
	.hh-goal {
		color: var(--mu);
		font-size: 12px;
	}
	.hh-goal {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}
	.hh-goal span.ok {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--lime);
	}
	.hh-chart {
		display: block;
		width: 100%;
		height: auto;
		margin: 2px 0 10px;
	}
	.hh-area {
		fill: color-mix(in srgb, var(--lime) 12%, transparent);
	}
	.hh-line {
		fill: none;
		stroke: var(--lime);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.hh-target {
		stroke: var(--mu);
		stroke-width: 1;
		stroke-dasharray: 4 4;
		opacity: 0.6;
	}
	.hh-dot {
		fill: var(--lime);
	}
	.hh-empty {
		margin: 18px 0 4px;
		color: var(--mu);
		font-size: 13px;
		text-align: center;
	}
</style>
