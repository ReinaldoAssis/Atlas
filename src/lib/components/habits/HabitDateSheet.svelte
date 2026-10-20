<script lang="ts">
	import { untrack } from 'svelte';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { addDays, monthLabel, monthStart, shiftMonth } from '#lib/time-range';

	let {
		selected,
		today,
		firstDay = 'mon',
		onpick,
		onclose
	}: {
		selected: string;
		today: string;
		firstDay?: 'mon' | 'sun';
		onpick: (date: string) => void;
		onclose: () => void;
	} = $props();

	let month = $state(monthStart(untrack(() => selected)));
	let sheet = $state<{ close: () => void } | null>(null);
	let pending = $state<string | null>(null);

	const weekLabels = $derived(firstDay === 'sun' ? ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] : ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']);
	const days = $derived.by(() => {
		const first = new Date(`${month}T12:00:00`);
		const offset = firstDay === 'sun' ? first.getDay() : (first.getDay() + 6) % 7;
		const start = addDays(month, -offset);
		return Array.from({ length: 42 }, (_, index) => addDays(start, index));
	});
	const atCurrentMonth = $derived(month >= monthStart(today));

	function goMonth(delta: number) {
		const next = shiftMonth(month, delta);
		if (next > monthStart(today)) return;
		month = next;
	}

	function choose(date: string) {
		if (date > today) return;
		pending = date;
		sheet?.close();
	}
</script>

<Sheet
	title="Escolher dia"
	closeLabel="Fechar"
	backdropGuardMs={450}
	bind:this={sheet}
	onclose={() => {
		const date = pending;
		pending = null;
		if (date) onpick(date);
		else onclose();
	}}
>
	<div class="hd">
		<button type="button" class="nav" aria-label="Mês anterior" onclick={() => goMonth(-1)}>
			<ChevronLeft size={18} />
		</button>
		<strong>{monthLabel(month)}</strong>
		<button type="button" class="nav" aria-label="Próximo mês" disabled={atCurrentMonth} onclick={() => goMonth(1)}>
			<ChevronRight size={18} />
		</button>
	</div>

	<div class="week" aria-hidden="true">
		{#each weekLabels as label}<span>{label}</span>{/each}
	</div>
	<div class="grid" role="grid" aria-label="Dias">
		{#each days as date}
			<button
				type="button"
				role="gridcell"
				class:out={date.slice(0, 7) !== month}
				class:today={date === today}
				class:selected={date === selected}
				disabled={date > today}
				aria-label={date}
				aria-selected={date === selected}
				onclick={() => choose(date)}
			>{Number(date.slice(8, 10))}</button>
		{/each}
	</div>

	<button type="button" class="today-btn" onclick={() => choose(today)}>Hoje</button>
</Sheet>

<style>
	.hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}
	.hd strong {
		font-size: 16px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.nav {
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
	}
	.nav:disabled {
		opacity: 0.35;
	}
	.week,
	.grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 4px;
	}
	.week {
		margin-bottom: 4px;
		color: var(--mu);
		font-size: 11px;
		font-weight: 700;
		text-align: center;
	}
	.grid button {
		height: 40px;
		border: 0;
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-weight: 700;
	}
	.grid button.out {
		color: var(--mu);
		opacity: 0.55;
	}
	.grid button.today {
		box-shadow: inset 0 0 0 2px var(--acc);
	}
	.grid button.selected {
		background: var(--acc);
		color: #141a0a;
	}
	.grid button:disabled {
		opacity: 0.25;
	}
	.today-btn {
		width: 100%;
		margin-top: 14px;
		padding: 13px;
		border: 0;
		border-radius: 12px;
		background: var(--s2);
		color: var(--tx);
		font: inherit;
		font-weight: 700;
	}
</style>
