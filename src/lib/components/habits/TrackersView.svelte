<script lang="ts">
	import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import Segmented from '../ui/Segmented.svelte';
	import Sheet from '../ui/Sheet.svelte';
	import Button from '../ui/Button.svelte';
	import Field from '../ui/Field.svelte';
	import { playTone, pulseHaptic } from '#lib/feedback';
	import { dateOffset, id as newId, localDate, type Tracker, type TrackerEntry } from '#lib/atlas';

	/**
	 * Trackers — acompanhamento sem recorrência (ex.: peso corporal).
	 *
	 * Guarda vários registros por dia. Não tem streak, dias programados nem
	 * meta diária: a meta (opcional) é só uma linha de referência no gráfico.
	 */
	let {
		trackers,
		entries,
		oncreatetracker,
		onupdatetracker,
		onarchive,
		ondeletetracker,
		oncreateentry,
		onupdateentry,
		ondeleteentry,
		sound = true,
		haptics = true
	}: {
		trackers: Tracker[];
		entries: TrackerEntry[];
		oncreatetracker: (tracker: Tracker) => void | Promise<void>;
		onupdatetracker: (tracker: Tracker) => void | Promise<void>;
		onarchive: (tracker: Tracker, active: boolean) => void | Promise<void>;
		ondeletetracker: (tracker: Tracker) => void | Promise<void>;
		oncreateentry: (entry: TrackerEntry) => void | Promise<void>;
		onupdateentry: (entry: TrackerEntry) => void | Promise<void>;
		ondeleteentry: (entry: TrackerEntry) => void | Promise<void>;
		sound?: boolean;
		haptics?: boolean;
	} = $props();

	const today = localDate();

	let showArchived = $state(false);
	let sheet = $state<'detail' | 'tracker' | 'entry' | null>(null);
	let detailId = $state<string | null>(null);
	let editingTracker = $state<Tracker | null>(null);
	let editingEntry = $state<TrackerEntry | null>(null);
	let chartRange = $state<'7' | '30' | 'all'>('30');
	let formError = $state('');

	let trackerForm = $state({ name: '', unit: '', target: '', direction: 'down' as 'up' | 'down' });
	let entryForm = $state({ value: '', date: today, time: '', note: '' });

	const activeTrackers = $derived(trackers.filter((tracker) => tracker.active));
	const archivedTrackers = $derived(trackers.filter((tracker) => !tracker.active));
	const visibleTrackers = $derived(showArchived ? trackers : activeTrackers);
	const detailTracker = $derived(detailId ? trackers.find((tracker) => tracker.id === detailId) ?? null : null);
	const detailEntries = $derived(detailId ? entriesOf(detailId) : []);

	function tone(frequency: number, duration = 0.08, type: OscillatorType = 'sine', volume = 0.05) {
		playTone(frequency, duration, type, volume, sound);
	}

	function haptic(pattern: number | number[]) {
		pulseHaptic(haptics, pattern);
	}

	/* ---------- leitura ---------- */
	function sortKey(entry: TrackerEntry): string {
		return `${entry.date}${entry.time ?? '99:99'}`;
	}

	function entriesOf(trackerId: string): TrackerEntry[] {
		return entries.filter((entry) => entry.trackerId === trackerId).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
	}

	function lastEntry(trackerId: string): TrackerEntry | null {
		return entriesOf(trackerId)[0] ?? null;
	}

	function formatNumber(value: number): string {
		return Math.abs(value % 1) < 0.005 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
	}

	function formatValue(tracker: Tracker, value: number): string {
		const text = formatNumber(value);
		return tracker.unit ? `${text} ${tracker.unit}` : text;
	}

	function formatWhen(entry: TrackerEntry): string {
		const [, month, day] = entry.date.split('-');
		return entry.time ? `${day}/${month} · ${entry.time}` : `${day}/${month}`;
	}

	function dateLabel(date: string): string {
		if (date === today) return 'Hoje';
		if (date === dateOffset(today, -1)) return 'Ontem';
		const [year, month, day] = date.split('-');
		return `${day}/${month}${year !== today.slice(0, 4) ? `/${year}` : ''}`;
	}

	function goalMet(tracker: Tracker, value: number): boolean | null {
		if (tracker.target == null) return null;
		return tracker.targetDirection === 'down' ? value <= tracker.target : value >= tracker.target;
	}

	/* ---------- gráfico (SVG próprio, sem lib) ---------- */
	function chartData(tracker: Tracker, list: TrackerEntry[]) {
		const cutoff = chartRange === 'all' ? '' : dateOffset(today, chartRange === '7' ? -6 : -29);
		const points = list
			.filter((entry) => !cutoff || entry.date >= cutoff)
			.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
		if (!points.length) return null;
		const width = 320;
		const height = 120;
		const pad = 12;
		const scale = tracker.target == null ? points.map((entry) => entry.value) : [...points.map((entry) => entry.value), tracker.target];
		const min = Math.min(...scale);
		const max = Math.max(...scale);
		const span = max - min || 1;
		const x = (index: number) => (points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2));
		const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
		const coords = points.map((entry, index) => [x(index), y(entry.value)] as const);
		const line = coords.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
		const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${height} L${coords[0][0].toFixed(1)} ${height} Z`;
		return {
			width,
			height,
			line,
			area,
			coords,
			min,
			max,
			targetY: tracker.target == null ? null : y(tracker.target)
		};
	}

	const chart = $derived(detailTracker ? chartData(detailTracker, detailEntries) : null);

	/* ---------- ações ---------- */
	function openNewTracker() {
		editingTracker = null;
		trackerForm = { name: '', unit: '', target: '', direction: 'down' };
		formError = '';
		sheet = 'tracker';
	}

	function openDetail(tracker: Tracker) {
		detailId = tracker.id;
		chartRange = '30';
		sheet = 'detail';
		tone(520, 0.06);
		haptic(6);
	}

	function openEditTracker(tracker: Tracker) {
		editingTracker = tracker;
		trackerForm = {
			name: tracker.name,
			unit: tracker.unit,
			target: tracker.target == null ? '' : formatNumber(tracker.target),
			direction: tracker.targetDirection
		};
		formError = '';
		sheet = 'tracker';
	}

	function openNewEntry() {
		editingEntry = null;
		entryForm = { value: '', date: today, time: '', note: '' };
		formError = '';
		sheet = 'entry';
	}

	function openEntry(entry: TrackerEntry) {
		editingEntry = entry;
		entryForm = {
			value: formatNumber(entry.value),
			date: entry.date,
			time: entry.time ?? '',
			note: entry.note ?? ''
		};
		formError = '';
		sheet = 'entry';
	}

	function closeForm() {
		formError = '';
		sheet = detailId ? 'detail' : null;
		editingTracker = null;
		editingEntry = null;
	}

	async function saveTracker(event: SubmitEvent) {
		event.preventDefault();
		const name = trackerForm.name.trim();
		if (!name) {
			formError = 'Informe um nome.';
			return;
		}
		const target = trackerForm.target.trim() === '' ? null : Number(trackerForm.target.replace(',', '.'));
		if (target != null && !Number.isFinite(target)) {
			formError = 'Meta inválida.';
			return;
		}
		const tracker: Tracker = editingTracker
			? { ...editingTracker, name, unit: trackerForm.unit.trim(), target, targetDirection: trackerForm.direction }
			: {
					id: newId(),
					name,
					unit: trackerForm.unit.trim(),
					target,
					targetDirection: trackerForm.direction,
					active: true,
					createdAt: new Date().toISOString()
				};
		const isNew = !editingTracker;
		if (isNew) detailId = tracker.id;
		sheet = 'detail';
		editingTracker = null;
		tone(660, 0.12, 'triangle', 0.06);
		haptic([10, 26, 10]);
		await (isNew ? oncreatetracker(tracker) : onupdatetracker(tracker));
	}

	async function saveEntry(event: SubmitEvent) {
		event.preventDefault();
		if (!detailId) return;
		const value = Number(entryForm.value.replace(',', '.'));
		if (!Number.isFinite(value)) {
			formError = 'Informe um valor numérico.';
			return;
		}
		const entry: TrackerEntry = {
			id: editingEntry?.id ?? newId(),
			trackerId: detailId,
			date: entryForm.date || today,
			time: entryForm.time || undefined,
			value,
			note: entryForm.note.trim() || undefined
		};
		const isNew = !editingEntry;
		sheet = 'detail';
		editingEntry = null;
		tone(720, 0.1, 'triangle', 0.06);
		haptic(8);
		await (isNew ? oncreateentry(entry) : onupdateentry(entry));
	}

	async function removeEntry() {
		if (!editingEntry) return;
		const target = editingEntry;
		sheet = 'detail';
		editingEntry = null;
		tone(300, 0.1);
		await ondeleteentry(target);
	}

	async function toggleArchive(tracker: Tracker) {
		tone(420, 0.08);
		haptic(8);
		await onarchive(tracker, !tracker.active);
	}

	async function removeTracker(tracker: Tracker) {
		detailId = null;
		sheet = null;
		tone(300, 0.12);
		await ondeletetracker(tracker);
	}
</script>

<div class="tk">
	<div class="tk-grid">
		<button class="tk-tile new" onclick={openNewTracker}><Plus size={18} /> Tracker</button>
		{#each visibleTrackers as tracker (tracker.id)}
			{@const last = lastEntry(tracker.id)}
			{@const met = last ? goalMet(tracker, last.value) : null}
			<button class="tk-tile" class:archived={!tracker.active} class:met={met === true} onclick={() => openDetail(tracker)}>
				<b>{tracker.name}</b>
				{#if last}
					<span class="tk-value">{formatValue(tracker, last.value)}</span>
					<small>{formatWhen(last)}</small>
				{:else}
					<span class="tk-value">—</span>
					<small>Sem registros</small>
				{/if}
				{#if tracker.target != null}
					<em class="tk-goal">meta {formatValue(tracker, tracker.target)} {tracker.targetDirection === 'down' ? '↓' : '↑'}</em>
				{/if}
			</button>
		{/each}
	</div>

	{#if !activeTrackers.length && !archivedTrackers.length}
		<p class="tk-hint">Acompanhe o que não é hábito: peso, humor, sono, medidas. Vários registros por dia.</p>
	{/if}

	{#if archivedTrackers.length}
		<button class="tk-arch-toggle" onclick={() => { showArchived = !showArchived; tone(440, 0.05); }}>
			{showArchived ? 'Ocultar arquivados' : `Arquivados (${archivedTrackers.length})`}
		</button>
	{/if}
</div>

{#if sheet === 'detail' && detailTracker}
	{@const tracker = detailTracker}
	<Sheet title={tracker.name} closeLabel="Fechar" onclose={() => { sheet = null; detailId = null; }}>
		<div class="tk-head">
			<span class="tk-head-value">
				{#if detailEntries[0]}
					<b>{formatValue(tracker, detailEntries[0].value)}</b><small>{formatWhen(detailEntries[0])}</small>
				{:else}
					<b>—</b><small>Sem registros</small>
				{/if}
			</span>
			{#if tracker.target != null}
				<span class="tk-head-goal">Meta {formatValue(tracker, tracker.target)} {tracker.targetDirection === 'down' ? '↓' : '↑'}</span>
			{/if}
		</div>

		{#if chart}
			<svg class="tk-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Histórico de ${tracker.name}`}>
				<path class="tk-area" d={chart.area} />
				<path class="tk-line" d={chart.line} />
				{#if chart.targetY != null}
					<line class="tk-target" x1="0" x2={chart.width} y1={chart.targetY} y2={chart.targetY} />
				{/if}
				{#each chart.coords as [cx, cy], index (index)}
					<circle class="tk-dot" cx={cx} cy={cy} r="2.6" />
				{/each}
			</svg>
			<Segmented
				label="Período do gráfico"
				options={[
					{ value: '7', label: '7 dias' },
					{ value: '30', label: '30 dias' },
					{ value: 'all', label: 'Tudo' }
				]}
				bind:value={chartRange}
			/>
		{:else}
			<p class="tk-hint">Nenhum registro nesse período.</p>
		{/if}

		<Button onclick={openNewEntry}><Plus size={16} /> Registrar</Button>

		{#if detailEntries.length}
			<ul class="tk-entries">
				{#each detailEntries as entry (entry.id)}
					<li>
						<button onclick={() => openEntry(entry)}>
							<span class="tk-e-when">{dateLabel(entry.date)}{entry.time ? ` · ${entry.time}` : ''}</span>
							<b>{formatValue(tracker, entry.value)}</b>
							{#if entry.note}<small>{entry.note}</small>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="tk-actions">
			<Button variant="secondary" onclick={() => openEditTracker(tracker)}><Pencil size={15} /> Editar</Button>
			<Button variant="secondary" onclick={() => toggleArchive(tracker)}>
				{#if tracker.active}<Archive size={15} /> Arquivar{:else}<ArchiveRestore size={15} /> Reativar{/if}
			</Button>
			<Button variant="danger" onclick={() => removeTracker(tracker)}><Trash2 size={15} /> Excluir</Button>
		</div>
	</Sheet>
{/if}

{#if sheet === 'tracker'}
	<Sheet
		title={editingTracker ? 'Editar tracker' : 'Novo tracker'}
		closeLabel="Fechar"
		onclose={closeForm}
	>
		{#if formError}<p class="form-error">{formError}</p>{/if}
		<form class="sheet-form" onsubmit={saveTracker}>
			<Field label="Nome">
				<input bind:value={trackerForm.name} placeholder="Ex.: peso, humor, sono…" maxlength="40" required />
			</Field>
			<div class="sheet-row">
				<Field label="Unidade" hint="opcional">
					<input bind:value={trackerForm.unit} placeholder="kg, h, mmHg…" maxlength="12" />
				</Field>
				<Field label="Meta" hint="opcional">
					<input bind:value={trackerForm.target} inputmode="decimal" placeholder="0" />
				</Field>
			</div>
			{#if trackerForm.target.trim()}
				<div class="sheet-days">
					<span class="sheet-days-label">Como atingir a meta</span>
					<Segmented
						label="Direção da meta"
						options={[
							{ value: 'down', label: 'Menor é melhor' },
							{ value: 'up', label: 'Maior é melhor' }
						]}
						bind:value={trackerForm.direction}
					/>
				</div>
			{/if}
			<div class="sheet-actions">
				<Button variant="secondary" onclick={closeForm}>Cancelar</Button>
				<Button type="submit">{editingTracker ? 'Salvar' : 'Criar tracker'}</Button>
			</div>
		</form>
	</Sheet>
{/if}

{#if sheet === 'entry' && detailTracker}
	{@const tracker = detailTracker}
	<Sheet
		title={editingEntry ? 'Editar registro' : `Registrar em ${tracker.name}`}
		closeLabel="Fechar"
		onclose={closeForm}
	>
		{#if formError}<p class="form-error">{formError}</p>{/if}
		<form class="sheet-form" onsubmit={saveEntry}>
			<div class="sheet-row">
				<Field label={`Valor${tracker.unit ? ` (${tracker.unit})` : ''}`}>
					<input bind:value={entryForm.value} inputmode="decimal" placeholder="0" required />
				</Field>
				<Field label="Data">
					<input type="date" bind:value={entryForm.date} max={today} required />
				</Field>
			</div>
			<Field label="Hora" hint="opcional">
				<input type="time" bind:value={entryForm.time} />
			</Field>
			<Field label="Nota" hint="opcional">
				<input bind:value={entryForm.note} placeholder="Ex.: em jejum" maxlength="80" />
			</Field>
			<div class="sheet-actions">
				{#if editingEntry}
					<Button variant="danger" onclick={removeEntry}><Trash2 size={16} /> Excluir</Button>
				{/if}
				<Button variant="secondary" onclick={closeForm}>Cancelar</Button>
				<Button type="submit">{editingEntry ? 'Salvar' : 'Registrar'}</Button>
			</div>
		</form>
	</Sheet>
{/if}

<style>
	.tk { display: grid; gap: 14px; }
	.tk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
	.tk-tile {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 132px;
		padding: 14px;
		border: 0;
		border-radius: 12px;
		background: var(--s2);
		color: var(--tx);
		text-align: left;
		cursor: pointer;
		transition: transform 0.15s var(--ease-spring, ease), background 0.15s;
	}
	.tk-tile:active { transform: scale(0.97); }
	.tk-tile b { font-size: 15px; font-weight: 600; }
	.tk-value { margin-top: auto; font-size: 28px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; }
	.tk-tile small { color: var(--mu); font-size: 12px; }
	.tk-goal { color: var(--mu); font-size: 11px; font-style: normal; font-weight: 600; }
	.tk-tile.met .tk-value { color: var(--acc); }
	.tk-tile.archived { opacity: 0.55; }
	.tk-tile.new {
		align-items: center;
		justify-content: center;
		flex-direction: row;
		gap: 8px;
		border: 2px dashed var(--ln);
		background: none;
		color: var(--mu);
		font-weight: 600;
	}

	.tk-hint { margin: 0; color: var(--mu); font-size: 13px; }
	.tk-arch-toggle {
		justify-self: start;
		padding: 6px 12px;
		border: 0;
		border-radius: 16px;
		background: var(--s2);
		color: var(--mu);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.tk-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
	.tk-head-value { display: flex; align-items: baseline; gap: 8px; }
	.tk-head-value b { font-size: 30px; font-weight: 800; letter-spacing: -0.04em; }
	.tk-head-value small, .tk-head-goal { color: var(--mu); font-size: 12px; }
	.tk-chart { width: 100%; height: auto; }
	.tk-line { fill: none; stroke: var(--acc); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
	.tk-area { fill: color-mix(in srgb, var(--acc) 18%, transparent); stroke: none; }
	.tk-dot { fill: var(--acc); }
	.tk-target { stroke: var(--mu); stroke-width: 1.4; stroke-dasharray: 5 4; }

	.tk-entries { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.tk-entries button {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 10px;
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
		text-align: left;
		cursor: pointer;
	}
	.tk-entries b { font-weight: 700; }
	.tk-entries small { grid-column: 1 / -1; color: var(--mu); font-size: 12px; }
	.tk-e-when { color: var(--mu); font-size: 12px; font-weight: 600; align-self: center; }
	.tk-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
