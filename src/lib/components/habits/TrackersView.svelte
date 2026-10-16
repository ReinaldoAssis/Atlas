<script lang="ts">
	import { Archive, ArchiveRestore, Check, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import Segmented from '../ui/Segmented.svelte';
	import Sheet from '../ui/Sheet.svelte';
	import Button from '../ui/Button.svelte';
	import Field from '../ui/Field.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import Chip from '../ui/Chip.svelte';
	import { playTone, pulseHaptic } from '#lib/feedback';
	import { dateOffset, id as newId, localDate, type Tracker, type TrackerEntry, type TrackerMetric } from '#lib/atlas';

	/**
	 * Trackers — acompanhamento sem recorrência (ex.: peso corporal).
	 *
	 * Mesmos tipos de medida dos hábitos (`sim/não`, `tempo`, `contagem`), mas
	 * sem dias programados, streak ou meta diária. Vários registros por dia;
	 * a meta é uma referência (com direção) e a tendência é a média dos
	 * últimos 3 registros.
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
	let sheet = $state<'detail' | 'tracker' | 'entry' | 'time' | null>(null);
	let detailId = $state<string | null>(null);
	let editingTracker = $state<Tracker | null>(null);
	let editingEntry = $state<TrackerEntry | null>(null);
	let chartRange = $state<'7' | '30' | 'all'>('30');
	let formError = $state('');

	let trackerForm = $state({
		name: '',
		metric: 'count' as TrackerMetric,
		unit: '',
		target: '',
		direction: 'down' as 'up' | 'down',
		askTime: false
	});
	let entryForm = $state({ value: '', date: today, time: '', note: '' });
	/** Lançamento de sim/não aguardando a hora (opção "perguntar hora"). */
	let pendingBoolean = $state<{ trackerId: string; next: 'sim' | 'nao' | 'remove' } | null>(null);
	let booleanTime = $state('');
	/** O sheet atual de formulário veio do sheet de detalhe (volta pra ele). */
	let fromDetail = $state(false);

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

	function nowTime(): string {
		const now = new Date();
		return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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

	function todayEntry(trackerId: string): TrackerEntry | null {
		return entries.find((entry) => entry.trackerId === trackerId && entry.date === today) ?? null;
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

	function goalMet(tracker: Tracker, value: number): boolean {
		if (tracker.metric === 'boolean') return value > 0;
		if (tracker.target == null) return false;
		return tracker.targetDirection === 'down' ? value <= tracker.target : value >= tracker.target;
	}

	/** Progresso do card: último valor vs meta (peso: 72,5 de 70). */
	function progressOf(tracker: Tracker, last: TrackerEntry | null): number {
		if (!last) return 0;
		if (tracker.metric === 'boolean') return last.value > 0 ? 1 : 0;
		if (tracker.target == null || tracker.target === 0) return 0;
		if (tracker.targetDirection === 'up') return Math.min(1, Math.max(0, last.value / tracker.target));
		return last.value <= 0 ? 0 : Math.min(1, tracker.target / last.value);
	}

	/** Tendência: média dos últimos 3 registros vs meta. */
	function trendOf(tracker: Tracker, list: TrackerEntry[]) {
		if (tracker.metric === 'boolean' || tracker.target == null || !list.length) return null;
		const values = list.slice(0, 3).map((entry) => entry.value);
		const average = values.reduce((total, value) => total + value, 0) / values.length;
		const diff = average - tracker.target;
		const equal = Math.abs(diff) < 0.000001;
		return {
			average,
			arrow: equal ? '→' : diff > 0 ? '↑' : '↓',
			good: equal || (tracker.targetDirection === 'up' ? diff > 0 : diff < 0)
		};
	}

	/* ---------- gráfico (SVG próprio, sem lib) ---------- */	function chartData(tracker: Tracker, list: TrackerEntry[]) {
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
		return { width, height, line, area, coords, targetY: tracker.target == null ? null : y(tracker.target) };
	}

	const chart = $derived(detailTracker && detailTracker.metric !== 'boolean' ? chartData(detailTracker, detailEntries) : null);

	/* ---------- ações ---------- */
	function openNewTracker() {
		editingTracker = null;
		trackerForm = { name: '', metric: 'count', unit: '', target: '', direction: 'down', askTime: false };
		formError = '';
		sheet = 'tracker';
	}

	function openDetail(tracker: Tracker) {
		detailId = tracker.id;
		chartRange = '30';
		fromDetail = true;
		sheet = 'detail';
		tone(520, 0.06);
		haptic(6);
	}

	function openEditTracker(tracker: Tracker) {
		editingTracker = tracker;
		trackerForm = {
			name: tracker.name,
			metric: tracker.metric,
			unit: tracker.unit,
			target: tracker.target == null ? '' : formatNumber(tracker.target),
			direction: tracker.targetDirection,
			askTime: tracker.askTime
		};
		formError = '';
		sheet = 'tracker';
	}

	function presets(tracker: Tracker): number[] {
		if (tracker.metric === 'duration') return [15, 30, 45, 60];
		if (tracker.target && tracker.unit.toLowerCase() === 'ml') return [250, 500, 1000];
		if (tracker.target) return [Math.max(1, Math.round(tracker.target / 2)), tracker.target, Math.round(tracker.target * 1.5)];
		return [];
	}

	function openNewEntry() {
		editingEntry = null;
		entryForm = {
			value: detailTracker?.metric === 'boolean' ? 'sim' : '',
			date: today,
			time: nowTime(),
			note: ''
		};
		formError = '';
		sheet = 'entry';
	}

	function openEntry(entry: TrackerEntry) {
		editingEntry = entry;
		fromDetail = true;
		entryForm = {
			value: detailTracker?.metric === 'boolean' ? (entry.value > 0 ? 'sim' : 'nao') : formatNumber(entry.value),
			date: entry.date,
			time: entry.time ?? '',
			note: entry.note ?? ''
		};
		formError = '';
		sheet = 'entry';
	}

	function backFromForm() {
		sheet = fromDetail && detailId ? 'detail' : null;
	}

	function closeForm() {
		formError = '';
		pendingBoolean = null;
		backFromForm();
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
		const numeric = trackerForm.metric !== 'boolean';
		const target = !numeric || trackerForm.target.trim() === '' ? null : Number(trackerForm.target.replace(',', '.'));
		if (target != null && !Number.isFinite(target)) {
			formError = 'Meta inválida.';
			return;
		}
		const unit = trackerForm.metric === 'duration' ? 'min' : trackerForm.metric === 'count' ? trackerForm.unit.trim() : '';
		const tracker: Tracker = editingTracker
			? { ...editingTracker, name, metric: trackerForm.metric, unit, target, targetDirection: trackerForm.direction, askTime: trackerForm.askTime }
			: {
					id: newId(),
					name,
					metric: trackerForm.metric,
					unit,
					target,
					targetDirection: trackerForm.direction,
					askTime: trackerForm.askTime,
					active: true,
					createdAt: new Date().toISOString()
				};
		const isNew = !editingTracker;
		if (isNew) detailId = tracker.id;
		fromDetail = true;
		sheet = 'detail';
		editingTracker = null;
		tone(660, 0.12, 'triangle', 0.06);
		haptic([10, 26, 10]);
		await (isNew ? oncreatetracker(tracker) : onupdatetracker(tracker));
	}

	async function saveEntry(event: SubmitEvent) {
		event.preventDefault();
		if (!detailTracker) return;
		const value = detailTracker.metric === 'boolean' ? entryForm.value === 'sim' ? 1 : 0 : Number(entryForm.value.replace(',', '.'));
		if (detailTracker.metric !== 'boolean' && !Number.isFinite(value)) {
			formError = 'Informe um valor numérico.';
			return;
		}
		const entry: TrackerEntry = {
			id: editingEntry?.id ?? newId(),
			trackerId: detailTracker.id,
			date: entryForm.date || today,
			time: entryForm.time || undefined,
			value,
			note: entryForm.note.trim() || undefined
		};
		const isNew = !editingEntry;
		backFromForm();
		editingEntry = null;
		tone(720, 0.1, 'triangle', 0.06);
		haptic(8);
		await (isNew ? oncreateentry(entry) : onupdateentry(entry));
	}

	async function removeEntry() {
		if (!editingEntry) return;
		const target = editingEntry;
		backFromForm();
		editingEntry = null;
		tone(300, 0.1);
		await ondeleteentry(target);
	}

	/** Toque no card: sim/não alterna o dia; valor abre o sheet de registro. */
	async function tapCard(tracker: Tracker) {
		detailId = tracker.id;
		fromDetail = false;
		if (tracker.metric !== 'boolean') {
			openNewEntry();
			return;
		}
		const current = todayEntry(tracker.id);
		const next = !current ? 'sim' : current.value > 0 ? 'nao' : 'remove';
		if (tracker.askTime) {
			pendingBoolean = { trackerId: tracker.id, next };
			booleanTime = nowTime();
			tone(520, 0.06);
			sheet = 'time';
			return;
		}
		await applyBoolean(tracker, next, nowTime());
	}

	async function applyBoolean(tracker: Tracker, next: 'sim' | 'nao' | 'remove', time: string) {
		const current = todayEntry(tracker.id);
		pendingBoolean = null;
		if (next === 'remove') {
			tone(300, 0.1);
			haptic(8);
			if (current) await ondeleteentry(current);
			return;
		}
		const entry: TrackerEntry = {
			id: current?.id ?? newId(),
			trackerId: tracker.id,
			date: today,
			time,
			value: next === 'sim' ? 1 : 0,
			note: current?.note
		};
		tone(next === 'sim' ? 720 : 320, 0.12, 'triangle', 0.06);
		haptic(next === 'sim' ? [12, 26, 12] : 8);
		if (current) await onupdateentry(entry);
		else await oncreateentry(entry);
	}

	async function confirmBooleanTime(event: SubmitEvent) {
		event.preventDefault();
		const pending = pendingBoolean;
		if (!pending) return;
		const tracker = trackers.find((item) => item.id === pending.trackerId);
		backFromForm();
		if (tracker) await applyBoolean(tracker, pending.next, booleanTime || nowTime());
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
	<div class="habit-prototype-grid habit-prototype-habits">
		<button class="habit-prototype-card habit-prototype-wide habit-prototype-empty tk-new" onclick={openNewTracker}><Plus size={20} /> Tracker</button>
		{#each visibleTrackers as tracker (tracker.id)}
			{@const last = lastEntry(tracker.id)}
			{@const current = tracker.metric === 'boolean' ? todayEntry(tracker.id) : null}
			{@const trend = trendOf(tracker, entriesOf(tracker.id))}
			{@const done = tracker.metric === 'boolean' ? Boolean(current && current.value > 0) : goalMet(tracker, last?.value ?? 0)}
			<button
				class:done
				class:archived={!tracker.active}
				class="habit-prototype-card habit-prototype-habit tk-card"
				style={`--habit-progress:${progressOf(tracker, last)}`}
				onclick={() => tapCard(tracker)}
			>
				<b>{tracker.name}</b>
				<span>
					<span class="habit-prototype-value" class:idle={tracker.metric === 'boolean' && !current}>
						{#if tracker.metric === 'boolean'}
							{#if current}
								{current.value > 0 ? 'Feito' : 'Não'}
							{:else if last}
								{last.value > 0 ? 'Feito' : 'Não'}
							{:else}
								Hoje
							{/if}
						{:else}
							{last ? formatValue(tracker, last.value) : '—'}
						{/if}
					</span>
					<br />
					<small>
						{#if tracker.metric === 'boolean'}
							{#if current}
								Registrado {current.time ?? formatWhen(current)}
							{:else if last}
								último {formatWhen(last)} · toque para registrar
							{:else}
								Toque para registrar
							{/if}
						{:else}
							{tracker.target == null ? 'sem meta' : `meta ${formatValue(tracker, tracker.target)}`}{#if trend} · <em class:good={trend.good} class:bad={!trend.good}>{trend.arrow} {formatNumber(trend.average)}</em>{/if}
						{/if}
					</small>
				</span>
				{#if done}<i class="habit-prototype-check"><Check size={15} /></i>{/if}
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
					<b>{tracker.metric === 'boolean' ? (detailEntries[0].value > 0 ? 'Sim' : 'Não') : formatValue(tracker, detailEntries[0].value)}</b><small>{formatWhen(detailEntries[0])}</small>
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
		{/if}

		<Button onclick={openNewEntry}><Plus size={16} /> Registrar</Button>

		{#if detailEntries.length}
			<ul class="tk-entries">
				{#each detailEntries as entry (entry.id)}
					<li>
						<button onclick={() => openEntry(entry)}>
							<span class="tk-e-when">{dateLabel(entry.date)}{entry.time ? ` · ${entry.time}` : ''}</span>
							<b>{tracker.metric === 'boolean' ? (entry.value > 0 ? 'Sim' : 'Não') : formatValue(tracker, entry.value)}</b>
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

{#if sheet === 'time'}
	<Sheet title="Que horas?" closeLabel="Fechar" onclose={closeForm}>
		<form class="sheet-form" onsubmit={confirmBooleanTime}>
			<Field label="Hora do registro">
				<input data-autofocus type="time" bind:value={booleanTime} required />
			</Field>
			<div class="sheet-actions">
				<Button variant="secondary" onclick={closeForm}>Cancelar</Button>
				<Button type="submit">Registrar</Button>
			</div>
		</form>
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
			<Field label="Tipo de medida">
				<select bind:value={trackerForm.metric}>
					<option value="boolean">Feito ou não feito</option>
					<option value="duration">Duração</option>
					<option value="count">Contagem</option>
				</select>
			</Field>
			{#if trackerForm.metric !== 'boolean'}
				<div class="sheet-row">
					<Field label="Meta" hint="opcional">
						<input bind:value={trackerForm.target} inputmode="decimal" placeholder="0" />
					</Field>
					<Field label="Unidade">
						{#if trackerForm.metric === 'count'}
							<input bind:value={trackerForm.unit} placeholder="kg, h, mmHg…" maxlength="12" />
						{:else}
							<span class="static">minutos</span>
						{/if}
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
			{/if}
			<div class="tk-toggle-row">
				<span>Perguntar a hora ao registrar<small>{trackerForm.metric === 'boolean' ? 'no lançamento rápido' : 'o registro já pede a hora'}</small></span>
				<Toggle label="Perguntar a hora ao registrar" bind:checked={trackerForm.askTime} />
			</div>
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
			{#if tracker.metric === 'boolean'}
				<Segmented
					label="Registro"
					options={[
						{ value: 'sim', label: 'Sim' },
						{ value: 'nao', label: 'Não' }
					]}
					value={entryForm.value === 'sim' ? 'sim' : 'nao'}
					onchange={(value) => (entryForm.value = value)}
				/>
			{:else}
				<div class="sheet-row">
					<Field label={`Valor${tracker.unit ? ` (${tracker.unit})` : ''}`}>
						<input data-autofocus bind:value={entryForm.value} inputmode="decimal" placeholder="0" required />
					</Field>
					<Field label="Data">
						<input type="date" bind:value={entryForm.date} max={today} required />
					</Field>
				</div>
				{#if presets(tracker).length}
					<div class="tk-presets">
						{#each presets(tracker) as preset}
							<Chip selected={Number(entryForm.value.replace(',', '.')) === preset} onselect={() => (entryForm.value = formatNumber(preset))}>{formatValue(tracker, preset)}</Chip>
						{/each}
					</div>
				{/if}
			{/if}
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
	.tk {
		--hp-s: var(--panel-2);
		--hp-s2: #272b27;
		--hp-line: #2e332e;
		--hp-text: #ecefe6;
		--hp-muted: #8d968a;
		--hp-accent: var(--lime);
		--hp-accent-dim: color-mix(in srgb, var(--lime) 14%, transparent);
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		display: grid;
		gap: 14px;
		color: var(--hp-text);
		font: 15px/1.4 'Bricolage Grotesque', system-ui, sans-serif;
	}
	.tk * { box-sizing: border-box; }
	.tk button { border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
	.tk-card b { color: inherit; }
	.tk-card .idle { color: var(--hp-muted); }
	.tk-card em { font-style: normal; font-weight: 700; }
	.tk-card em.good { color: var(--hp-accent); }
	.tk-card em.bad { color: var(--hp-flame, #ffb347); }
	.tk-card.done em.good, .tk-card.done em.bad { color: #141a0a; }
	.tk-card.archived { opacity: 0.55; }
	.tk-new { border: 2px dashed var(--hp-line); background: none; }

	.tk-hint { margin: 0; color: var(--hp-muted); font-size: 13px; }
	.tk-arch-toggle { justify-self: start; padding: 6px 12px; border-radius: 16px; background: var(--hp-s2); color: var(--hp-muted); font-size: 12px; font-weight: 600; }

	.tk-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.tk-toggle-row > span { display: grid; gap: 2px; color: var(--tx); font-size: 14px; font-weight: 600; }
	.tk-toggle-row small { color: var(--mu); font-size: 11px; font-weight: 400; }
	.tk-presets { display: flex; flex-wrap: wrap; gap: 8px; }

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
	.tk-entries button { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; width: 100%; padding: 10px 12px; border-radius: 10px; background: var(--s2); color: var(--tx); }
	.tk-entries b { font-weight: 700; }
	.tk-entries small { grid-column: 1 / -1; color: var(--mu); font-size: 12px; }
	.tk-e-when { color: var(--mu); font-size: 12px; font-weight: 600; align-self: center; }
	.tk-actions { display: flex; flex-wrap: wrap; gap: 8px; }

	@media (min-width: 900px) {
		.tk { max-width: none; }
	}
</style>
