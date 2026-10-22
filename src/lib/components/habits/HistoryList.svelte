<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { intlLocale } from '#lib/i18n/intl';
	import { dateOffset, localDate } from '#lib/atlas';
	import type { HistoryGroup } from '#lib/history-list';

	/**
	 * Lista de lançamentos compartilhada por hábito e tracker.
	 *
	 * Sem cartões e sem outline: grupos por dia, valor à esquerda e hora/nota
	 * como apoio. A linha inteira abre a edição.
	 */
	let {
		groups,
		onopen,
		floorDate = null,
		onupgrade
	}: {
		groups: HistoryGroup[];
		onopen: (id: string) => void;
		/** Free no mobile: só mostra de `floorDate` para frente. */
		floorDate?: string | null;
		onupgrade?: () => void;
	} = $props();

	const today = localDate();
	const visible = $derived(floorDate ? groups.filter((group) => group.date >= floorDate) : groups);
	const hidden = $derived(groups.length - visible.length);

	function dayLabel(date: string): string {
		if (date === today) return m.habit_today();
		if (date === dateOffset(today, -1)) return m.habit_yesterday();
		const weekday = new Date(`${date}T12:00:00`)
			.toLocaleDateString(intlLocale(), { weekday: 'short' })
			.replace('.', '');
		const [year, month, day] = date.split('-');
		return `${weekday}, ${day}/${month}${year !== today.slice(0, 4) ? `/${year}` : ''}`;
	}
</script>

{#if visible.length}
	<ul class="hl">
		{#each visible as group (group.date)}
			<li class="hl-group">
				<header>
					<span>{dayLabel(group.date)}</span>
					<small>{group.rows.length === 1 ? m.common_record_count_one() : m.common_record_count_many({ count: group.rows.length })}</small>
				</header>
				<div class="hl-rows">
					{#each group.rows as row (row.id)}
						<button type="button" class="hl-row" onclick={() => onopen(row.id)}>
							<span class="hl-main">
								<b class:ok={row.tone === 'ok'} class:bad={row.tone === 'bad'}>{row.value}</b>
								{#if row.note}<small>{row.note}</small>{/if}
							</span>
							{#if row.meta}<span class="hl-meta">{row.meta}</span>{/if}
						</button>
					{/each}
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<p class="hl-empty">{m.common_empty_period()}</p>
{/if}
{#if hidden > 0 && onupgrade}
	<button type="button" class="hl-locked" onclick={onupgrade}>{m.history_locked()}</button>
{/if}

<style>
	.hl {
		display: grid;
		gap: 18px;
		margin: 16px 0 0;
		padding: 0;
		list-style: none;
	}
	.hl-group > header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 0 2px 6px;
		color: var(--mu);
		font-size: 12px;
		font-weight: 600;
	}
	.hl-group > header small {
		font-size: 11px;
		font-weight: 500;
	}
	.hl-rows {
		display: grid;
	}
	.hl-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 11px 2px;
		border: 0;
		border-bottom: 1px solid var(--ln);
		background: none;
		color: var(--tx);
		font: inherit;
		text-align: left;
		outline: none;
	}
	.hl-row:last-child {
		border-bottom: 0;
	}
	.hl-row:active,
	.hl-row:focus-visible {
		border-radius: 8px;
		background: var(--s2);
		outline: none;
	}
	.hl-main {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.hl-main b {
		font-size: 16px;
		font-weight: 700;
	}
	.hl-main b.ok {
		color: var(--acc);
	}
	.hl-main b.bad {
		color: var(--flame);
	}
	.hl-main small {
		color: var(--mu);
		font-size: 12px;
		line-height: 1.4;
	}
	.hl-meta {
		flex: none;
		color: var(--mu);
		font-size: 12px;
		font-weight: 600;
	}
	.hl-locked {
		width: 100%;
		margin: 14px 0 2px;
		padding: 11px;
		border: 1px dashed var(--ln);
		border-radius: 12px;
		background: none;
		color: var(--acc);
		font-size: 13px;
		font-weight: 600;
	}
	.hl-empty {
		margin: 18px 0 4px;
		color: var(--mu);
		font-size: 13px;
		text-align: center;
	}
	@media (prefers-reduced-motion: reduce) {
		.hl-row {
			transition: none;
		}
	}
</style>
