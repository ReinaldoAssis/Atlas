<script lang="ts">
	import { untrack } from 'svelte';
	import { id, type Category, type FirstDayOfWeek, type RoutineBlock, type RoutineState } from '#lib/atlas';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { intlLocale } from '#lib/i18n/intl';

	/**
	 * Editor da rotina semanal: pinta a semana padrão em blocos de 30 min.
	 * A rotina não tem datas — `+page.svelte` materializa as próximas semanas.
	 */
	let {
		routine,
		categories,
		windowStart,
		windowEnd,
		firstDay,
		onclose,
		onsave
	}: {
		routine: RoutineState;
		categories: Category[];
		windowStart: number;
		windowEnd: number;
		firstDay: FirstDayOfWeek;
		onclose: () => void;
		onsave: (blocks: RoutineBlock[]) => void;
	} = $props();

	const SLOT_MINUTES = 30;
	const SLOTS_PER_DAY = 24 * 60 / SLOT_MINUTES;

	function cellKey(weekday: number, slot: number): string {
		return `${weekday}-${slot}`;
	}

	function slotsFrom(blocks: RoutineBlock[]): Map<string, string> {
		const map = new Map<string, string>();
		for (const block of blocks) {
			const start = block.startMinutes / SLOT_MINUTES;
			const count = block.durationMinutes / SLOT_MINUTES;
			for (let offset = 0; offset < count; offset += 1) {
				map.set(cellKey(block.weekday, start + offset), block.categoryId);
			}
		}
		return map;
	}

	let slots = $state<Map<string, string>>(untrack(() => slotsFrom(routine.blocks)));
	let selected = $state<string>(untrack(() => categories[0]?.id ?? 'x'));

	/** Semana de referência (segunda-feira) só para os rótulos do cabeçalho. */
	const weekLabels = Array.from({ length: 7 }, (_, index) => {
		const date = new Date('2024-01-01T12:00:00');
		date.setDate(date.getDate() + index);
		const label = date.toLocaleDateString(intlLocale(), { weekday: 'short' }).replace('.', '');
		return label.charAt(0).toUpperCase() + label.slice(1);
	});

	const dayOrder = $derived(firstDay === 'sun' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]);
	const startSlot = $derived(Math.max(0, Math.min(SLOTS_PER_DAY - 1, windowStart * 2)));
	const endSlot = $derived(Math.max(startSlot + 2, Math.min(SLOTS_PER_DAY, (windowEnd + 1) * 2)));

	function colorOf(categoryId: string): string {
		return categories.find((category) => category.id === categoryId)?.color ?? '#8d968a';
	}

	function labelOf(categoryId: string): string {
		return categories.find((category) => category.id === categoryId)?.name ?? '';
	}

	function toggle(weekday: number, slot: number) {
		const next = new Map(slots);
		const key = cellKey(weekday, slot);
		if (selected === 'x' || next.get(key) === selected) next.delete(key);
		else next.set(key, selected);
		slots = next;
	}

	function clear() {
		const next = new Map(slots);
		for (let weekday = 0; weekday < 7; weekday += 1) {
			for (let slot = startSlot; slot < endSlot; slot += 1) next.delete(cellKey(weekday, slot));
		}
		slots = next;
	}

	function toBlocks(): RoutineBlock[] {
		const blocks: RoutineBlock[] = [];
		for (let weekday = 0; weekday < 7; weekday += 1) {
			let runCategory = '';
			let runStart = 0;
			for (let slot = 0; slot <= SLOTS_PER_DAY; slot += 1) {
				const category = slot < SLOTS_PER_DAY ? slots.get(cellKey(weekday, slot)) ?? '' : '';
				if (category === runCategory) continue;
				if (runCategory) {
					const startMinutes = runStart * SLOT_MINUTES;
					const durationMinutes = (slot - runStart) * SLOT_MINUTES;
					blocks.push({
						id: id(),
						title: labelOf(runCategory),
						categoryId: runCategory,
						weekday,
						startMinutes,
						durationMinutes
					});
				}
				runCategory = category;
				runStart = slot;
			}
		}
		return blocks;
	}

	function hourLabel(hour: number): string {
		return `${String(hour).padStart(2, '0')}:00`;
	}

	function cellLabel(weekday: number, slot: number, categoryId: string): string {
		const day = weekLabels[(weekday + 6) % 7];
		const time = `${String(Math.floor((slot * SLOT_MINUTES) / 60)).padStart(2, '0')}:${String((slot * SLOT_MINUTES) % 60).padStart(2, '0')}`;
		const category = categoryId ? labelOf(categoryId) : m.time_routine_empty_cell();
		return `${day} ${time} · ${category}`;
	}
</script>

<Sheet title={m.time_routine_title()} closeLabel={m.common_close()} {onclose}>
	<p class="hint">{m.time_routine_hint()}</p>

	<div class="pal" role="group" aria-label={m.time_routine_categories()}>
		{#each categories as category (category.id)}
			<button
				type="button"
				class:on={selected === category.id}
				class="cat"
				style={`--cc:${category.color}`}
				aria-pressed={selected === category.id}
				onclick={() => (selected = category.id)}
			>
				<i></i>{category.name}
			</button>
		{/each}
		<button type="button" class:on={selected === 'x'} class="cat" style="--cc:#828d7d" aria-pressed={selected === 'x'} onclick={() => (selected = 'x')}>
			<i></i>{m.time_eraser()}
		</button>
	</div>

	<div class="scroll">
		<div class="grid" style={`--days:${dayOrder.length}`}>
			<span class="corner"></span>
			{#each dayOrder as weekday}
				<span class="day">{weekLabels[(weekday + 6) % 7]}</span>
			{/each}
			{#each Array.from({ length: endSlot - startSlot }, (_, index) => startSlot + index) as slot}
				<span class="hour">{slot % 2 === 0 ? hourLabel(slot / 2) : ''}</span>
				{#each dayOrder as weekday}
					{@const category = slots.get(cellKey(weekday, slot)) ?? ''}
					<button
						type="button"
						class:on={category}
						class:hr={slot % 2 === 0}
						class="cell"
						style={category ? `--cc:${colorOf(category)}` : ''}
						aria-label={cellLabel(weekday, slot, category)}
						aria-pressed={Boolean(category)}
						data-rday={weekday}
						data-rslot={slot}
						onclick={() => toggle(weekday, slot)}
					></button>
				{/each}
			{/each}
		</div>
	</div>

	<div class="actions">
		<button type="button" class="btn ghost" onclick={clear}>{m.time_routine_clear()}</button>
		<button type="button" class="btn" onclick={() => onsave(toBlocks())}>{m.time_routine_save()}</button>
	</div>
</Sheet>

<style>
	.hint {
		margin: 0 0 12px;
		color: var(--mu);
		font-size: 12px;
		line-height: 1.45;
	}
	.pal {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 10px;
		scrollbar-width: none;
	}
	.pal::-webkit-scrollbar {
		display: none;
	}
	.cat {
		flex: none;
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 12px;
		border: 0;
		border-radius: 18px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.cat i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--cc);
	}
	.cat.on {
		background: var(--cc);
		color: #141a0a;
	}
	.cat.on i {
		background: #141a0a;
	}
	.scroll {
		overflow: auto;
		max-height: min(56vh, 460px);
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--bg);
	}
	.grid {
		display: grid;
		grid-template-columns: 34px repeat(var(--days, 7), minmax(42px, 1fr));
		min-width: max-content;
	}
	.corner,
	.day {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--bg);
	}
	.corner {
		left: 0;
		z-index: 3;
	}
	.day {
		padding: 5px 0 6px;
		color: var(--mu);
		font-size: 10px;
		font-weight: 700;
		text-align: center;
	}
	.hour {
		position: sticky;
		left: 0;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 1px 5px 0 0;
		background: var(--bg);
		color: var(--mu);
		font-size: 9px;
		font-weight: 600;
	}
	.cell {
		height: 26px;
		margin: 0 1px;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: var(--s2);
		cursor: pointer;
		touch-action: manipulation;
	}
	.cell.hr {
		box-shadow: inset 0 1px 0 #3a403a;
	}
	.cell.on {
		background: var(--cc);
	}
	.cell:active {
		transform: scale(0.94);
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 14px;
	}
	.btn {
		flex: 1;
		min-height: 44px;
		border: 0;
		border-radius: 10px;
		background: var(--acc);
		color: #141a0a;
		font: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
	}
	.btn.ghost {
		background: var(--s2);
		color: var(--tx);
	}
</style>
