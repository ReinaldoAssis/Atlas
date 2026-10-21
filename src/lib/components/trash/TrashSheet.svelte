<script lang="ts">
	import { ArchiveRestore, CalendarDays, Route, Target, Trash2, Wallet } from '@lucide/svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { intlLocale } from '#lib/i18n/intl';
	import { TRASH_RETENTION_DAYS, type TrashEvent, type TrashModule } from '#lib/trash';

	let {
		events,
		onclose,
		onrestore,
		onforget
	}: {
		events: TrashEvent[];
		onclose: () => void;
		onrestore: (event: TrashEvent) => void | Promise<void>;
		onforget: (event: TrashEvent) => void | Promise<void>;
	} = $props();

	type Filter = 'all' | TrashModule;
	const FILTERS: { id: Filter; label: () => string }[] = [
		{ id: 'all', label: () => m.trash_filter_all() },
		{ id: 'finance', label: () => m.settings_module_finance() },
		{ id: 'habits', label: () => m.trash_module_habits() },
		{ id: 'time', label: () => m.settings_module_time() },
		{ id: 'graph', label: () => m.trash_module_planning() }
	];

	const MODULE_LABEL: Record<TrashModule, () => string> = {
		finance: () => m.settings_module_finance(),
		habits: () => m.trash_module_habits(),
		time: () => m.settings_module_time(),
		graph: () => m.trash_module_planning(),
		notes: () => m.trash_module_notes()
	};

	const KIND_LABEL: Record<string, () => string> = {
		transaction: () => m.trash_kind_transaction(),
		category: () => m.trash_kind_category(),
		habit: () => m.trash_kind_habit(),
		habitLog: () => m.trash_kind_habit_log(),
		tracker: () => m.trash_kind_tracker(),
		trackerEntry: () => m.trash_kind_tracker_entry(),
		timeBlock: () => m.trash_kind_time_block(),
		graphNode: () => m.trash_kind_graph_node(),
		graphEdge: () => m.trash_kind_graph_edge(),
		graphDomain: () => m.trash_kind_graph_domain(),
		note: () => m.trash_kind_note(),
		folder: () => m.trash_kind_folder()
	};

	const now = Date.now();
	let filter = $state<Filter>('all');
	let busy = $state('');
	let confirmId = $state('');

	const filtered = $derived(filter === 'all' ? events : events.filter((event) => event.module === filter));

	const groups = $derived.by(() => {
		const map = new Map<string, TrashEvent[]>();
		for (const event of filtered) {
			const key = dayKey(event.deletedAt);
			const list = map.get(key) ?? [];
			list.push(event);
			map.set(key, list);
		}
		return [...map.entries()].map(([label, items]) => ({ label, items }));
	});

	function dayKey(timestamp: number): string {
		const date = new Date(timestamp);
		const today = new Date();
		const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
		const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		const diff = Math.round((start - day) / 86_400_000);
		if (diff === 0) return m.trash_day_today();
		if (diff === 1) return m.trash_day_yesterday();
		return date.toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' });
	}

	function remaining(event: TrashEvent): number {
		const expires = event.deletedAt + TRASH_RETENTION_DAYS * 86_400_000;
		return Math.max(0, Math.ceil((expires - now) / 86_400_000));
	}

	function iconOf(module: TrashModule) {
		if (module === 'finance') return Wallet;
		if (module === 'habits') return Target;
		if (module === 'time') return CalendarDays;
		if (module === 'graph') return Route;
		return Trash2;
	}

	async function restore(event: TrashEvent) {
		if (busy) return;
		busy = event.id;
		try {
			await onrestore(event);
		} finally {
			busy = '';
		}
	}

	async function forget(event: TrashEvent) {
		if (busy) return;
		if (confirmId !== event.id) {
			confirmId = event.id;
			return;
		}
		busy = event.id;
		try {
			await onforget(event);
			confirmId = '';
		} finally {
			busy = '';
		}
	}
</script>

<Sheet title={m.trash_title()} closeLabel={m.trash_close()} {onclose}>
	<div class="trash">
		<p class="hint">{m.trash_hint({ days: TRASH_RETENTION_DAYS })}</p>

		<div class="filters" role="tablist" aria-label={m.trash_filter_aria()}>
			{#each FILTERS as item}
				<button class:on={filter === item.id} role="tab" aria-selected={filter === item.id} onclick={() => (filter = item.id)}>
					{item.label()}
				</button>
			{/each}
		</div>

		{#if groups.length === 0}
			<div class="empty">
				<Trash2 size={28} />
				<strong>{m.trash_empty_title()}</strong>
				<p>{filter === 'all' ? m.trash_empty_all() : m.trash_empty_filtered()}</p>
			</div>
		{:else}
			{#each groups as group}
				<div class="group">
					<span class="group-label">{group.label}</span>
					{#each group.items as event (event.id)}
						{@const Icon = iconOf(event.module)}
						<div class="item" class:busy={busy === event.id}>
							<div class="meta">
								<span class="kind"><Icon size={14} />{KIND_LABEL[event.kind]?.() ?? event.kind}</span>
								<strong title={event.label}>{event.label}</strong>
								<small>{MODULE_LABEL[event.module]()} · {remaining(event) === 1 ? m.trash_day_left({ count: remaining(event) }) : m.trash_days_left({ count: remaining(event) })}</small>
							</div>
							<div class="actions">
								<button class="restore" aria-label={m.trash_restore_item({ label: event.label })} disabled={busy === event.id} onclick={() => void restore(event)}>
									<ArchiveRestore size={16} /> {m.trash_restore()}
								</button>
								<button class:armed={confirmId === event.id} class="forget" aria-label={m.trash_forget_item({ label: event.label })} disabled={busy === event.id} onclick={() => void forget(event)}>
									<Trash2 size={16} /> {confirmId === event.id ? m.trash_confirm() : m.trash_delete()}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</Sheet>

<style>
	.trash {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-bottom: 8px;
	}
	.hint {
		margin: 0;
		color: var(--mu);
		font-size: 12px;
		line-height: 1.45;
	}
	.filters {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding: 2px 0 4px;
		scrollbar-width: none;
	}
	.filters::-webkit-scrollbar {
		display: none;
	}
	.filters button {
		flex: none;
		padding: 6px 11px;
		border: 1px solid var(--ln);
		border-radius: 999px;
		background: transparent;
		color: var(--mu);
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
	}
	.filters button.on {
		border-color: var(--acc);
		background: color-mix(in srgb, var(--acc) 16%, transparent);
		color: var(--acc);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.group-label {
		color: var(--mu);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 11px 12px;
		border: 1px solid var(--ln);
		border-radius: 12px;
		background: var(--s2);
	}
	.item.busy {
		opacity: 0.55;
	}
	.meta {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 2px;
	}
	.meta strong {
		overflow: hidden;
		font-size: 14px;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta small {
		color: var(--mu);
		font-size: 11px;
	}
	.kind {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--mu);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.actions {
		display: flex;
		flex: none;
		gap: 6px;
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 7px 9px;
		border: 1px solid var(--ln);
		border-radius: 9px;
		background: transparent;
		color: var(--mu);
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
	}
	.actions button:hover {
		color: var(--tx);
	}
	.actions .restore {
		border-color: color-mix(in srgb, var(--acc) 40%, var(--ln));
		color: var(--acc);
	}
	.actions .forget.armed {
		border-color: var(--danger);
		color: var(--danger);
	}
	.actions button:disabled {
		cursor: wait;
		opacity: 0.5;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 34px 12px;
		color: var(--mu);
		text-align: center;
	}
	.empty strong {
		color: var(--tx);
		font-size: 15px;
	}
	.empty p {
		margin: 0;
		font-size: 12px;
	}
	@media (max-width: 520px) {
		.item {
			align-items: flex-start;
			flex-direction: column;
		}
		.actions {
			width: 100%;
		}
		.actions button {
			flex: 1;
			justify-content: center;
		}
	}
</style>
