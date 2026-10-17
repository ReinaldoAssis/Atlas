<script lang="ts">
	import { Archive, ArchiveRestore, Check, MoreHorizontal, Pencil, Plus, History } from '@lucide/svelte';
	import Segmented from '../ui/Segmented.svelte';
	import Sheet from '../ui/Sheet.svelte';
	import Button from '../ui/Button.svelte';
	import Field from '../ui/Field.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import CardMenu from '../ui/CardMenu.svelte';
	import ValueSheet from '../ui/ValueSheet.svelte';
	import { playTone, pulseHaptic } from '#lib/feedback';
	import {
		TRACKER_BOOLEAN_LABELS,
		booleanLabelOf,
		dateOffset,
		id as newId,
		localDate,
		nextBooleanLog,
		positiveValueOf,
		type Tracker,
		type TrackerEntry,
		type TrackerMetric
	} from '#lib/atlas';

	/**
	 * Trackers — acompanhamento sem recorrência (ex.: peso corporal).
	 *
	 * Mesmos tipos de medida dos hábitos (`sim/não`, `tempo`, `contagem`), sem
	 * dias programados nem streak. Vários registros por dia; a meta é uma
	 * referência (com direção) e a tendência é a média dos últimos 3 registros.
	 * O toque no card lança; detalhes/edição ficam no menu (segurar/direito/⋯).
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
	let sheet = $state<'detail' | 'tracker' | 'value' | 'entry' | 'time' | null>(null);
	let detailId = $state<string | null>(null);
	let editingTracker = $state<Tracker | null>(null);
	let editingEntry = $state<TrackerEntry | null>(null);
	let chartRange = $state<'7' | '30' | 'all'>('30');
	let formError = $state('');
	let entryValue = $state(0);
	/** Menu do card (segurar/botão direito/⋯). */
	let menu = $state<{ tracker: Tracker; x: number; y: number } | null>(null);
	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	let pressOrigin = { x: 0, y: 0 };

	let trackerForm = $state({
		name: '',
		metric: 'count' as TrackerMetric,
		unit: '',
		target: '',
		direction: 'down' as 'up' | 'down',
		askTime: false,
		positiveLabel: TRACKER_BOOLEAN_LABELS.positive,
		negativeLabel: TRACKER_BOOLEAN_LABELS.negative,
		positiveValue: 1 as 0 | 1
	});
	let entryForm = $state({ date: today, time: '', note: '' });
	let booleanEntry = $state<'sim' | 'nao'>('sim');
	let pendingBoolean = $state<{ trackerId: string; next: 0 | 1 | 'remove' } | null>(null);
	let booleanTime = $state('');
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

	function isPositive(tracker: Tracker, value: number): boolean {
		return value === positiveValueOf(tracker);
	}

	function goalMet(tracker: Tracker, value: number): boolean {
		if (tracker.metric === 'boolean') return isPositive(tracker, value);
		if (tracker.target == null) return false;
		return tracker.targetDirection === 'down' ? value <= tracker.target : value >= tracker.target;
	}

	/**
	 * Enchimento do card numérico: do **pior lançamento** até a meta.
	 * Maior-é-melhor vai do menor lançamento; menor-é-melhor, do maior.
	 */
	function progressOf(tracker: Tracker, last: TrackerEntry | null): number {
		if (!last) return 0;
		if (tracker.metric === 'boolean') return isPositive(tracker, last.value) ? 1 : 0;
		if (tracker.target == null) return 0;
		const values = entriesOf(tracker.id).map((entry) => entry.value);
		if (!values.length) return 0;
		if (tracker.targetDirection === 'up') {
			const low = Math.min(...values, tracker.target);
			const span = tracker.target - low;
			return span <= 0 ? 1 : Math.min(1, Math.max(0, (last.value - low) / span));
		}
		const high = Math.max(...values, tracker.target);
		const span = high - tracker.target;
		return span <= 0 ? 1 : Math.min(1, Math.max(0, (high - last.value) / span));
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

	function sheetMax(tracker: Tracker): number {
		const base = Math.max(tracker.target ?? 0, ...entriesOf(tracker.id).map((entry) => entry.value), 1);
		return tracker.metric === 'duration' ? Math.max(180, base * 3) : Math.max(base * 2, base + 1);
	}

	function sheetStep(tracker: Tracker): number {
		if (tracker.metric === 'duration') return 5;
		return tracker.unit.toLowerCase() === 'ml' ? 50 : 1;
	}

	function presets(tracker: Tracker): { value: number; label: string; additive?: boolean }[] {
		if (tracker.metric === 'duration') return [15, 30, 45, 60].map((value) => ({ value, label: `${value} min` }));
		if (tracker.unit.toLowerCase() === 'ml') return [250, 500, 1000].map((value) => ({ value, label: `+${value} ml`, additive: true }));
		if (tracker.target) {
			return [Math.max(1, Math.round(tracker.target / 2)), tracker.target, Math.round(tracker.target * 1.5)].map((value) => ({
				value,
				label: formatValue(tracker, value)
			}));
		}
		return [];
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
		return { width, height, line, area, coords, targetY: tracker.target == null ? null : y(tracker.target) };
	}

	const chart = $derived(detailTracker && detailTracker.metric !== 'boolean' ? chartData(detailTracker, detailEntries) : null);

	/* ---------- menu do card ---------- */
	function openMenu(tracker: Tracker, x: number, y: number) {
		menu = { tracker, x: Math.min(x, window.innerWidth - 200), y: Math.min(y, window.innerHeight - 190) };
	}

	function startPress(event: PointerEvent, tracker: Tracker) {
		if (event.button !== 0) return;
		if (event.pointerType === 'mouse') return;
		pressOrigin = { x: event.clientX, y: event.clientY };
		clearTimeout(pressTimer);
		pressTimer = setTimeout(() => openMenu(tracker, event.clientX, event.clientY), 460);
	}

	function cancelPress() {
		clearTimeout(pressTimer);
	}

	/* ---------- ações ---------- */
	function openNewTracker() {
		editingTracker = null;
		trackerForm = {
			name: '',
			metric: 'count',
			unit: '',
			target: '',
			direction: 'down',
			askTime: false,
			positiveLabel: TRACKER_BOOLEAN_LABELS.positive,
			negativeLabel: TRACKER_BOOLEAN_LABELS.negative,
			positiveValue: 1
		};
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
			askTime: tracker.askTime,
			positiveLabel: tracker.positiveLabel?.trim() || TRACKER_BOOLEAN_LABELS.positive,
			negativeLabel: tracker.negativeLabel?.trim() || TRACKER_BOOLEAN_LABELS.negative,
			positiveValue: positiveValueOf(tracker)
		};
		formError = '';
		sheet = 'tracker';
	}

	function openNewEntry() {
		editingEntry = null;
		entryValue = lastEntry(detailId ?? '')?.value ?? detailTracker?.target ?? 0;
		booleanEntry = 'sim';
		entryForm = { date: today, time: nowTime(), note: '' };
		formError = '';
		sheet = detailTracker?.metric === 'boolean' ? 'entry' : 'value';
	}

	function openEntry(entry: TrackerEntry) {
		editingEntry = entry;
		entryValue = entry.value;
		booleanEntry = entry.value > 0 ? 'sim' : 'nao';
		entryForm = { date: entry.date, time: entry.time ?? '', note: entry.note ?? '' };
		formError = '';
		sheet = detailTracker?.metric === 'boolean' ? 'entry' : 'value';
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
		const labels = numeric
			? {}
			: {
					positiveLabel: trackerForm.positiveLabel.trim() || TRACKER_BOOLEAN_LABELS.positive,
					negativeLabel: trackerForm.negativeLabel.trim() || TRACKER_BOOLEAN_LABELS.negative,
					positiveValue: trackerForm.positiveValue
				};
		const tracker: Tracker = editingTracker
			? {
					...editingTracker,
					name,
					metric: trackerForm.metric,
					unit,
					target,
					targetDirection: trackerForm.direction,
					askTime: trackerForm.askTime,
					...labels
				}
			: {
					id: newId(),
					name,
					metric: trackerForm.metric,
					unit,
					target,
					targetDirection: trackerForm.direction,
					askTime: trackerForm.askTime,
					...labels,
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

	function buildEntry(value: number): TrackerEntry | null {
		if (!detailTracker) return null;
		return {
			id: editingEntry?.id ?? newId(),
			trackerId: detailTracker.id,
			date: entryForm.date || today,
			time: entryForm.time || undefined,
			value,
			note: entryForm.note.trim() || undefined
		};
	}

	async function saveValue(value: number) {
		const entry = buildEntry(value);
		if (!entry) return;
		const isNew = !editingEntry;
		backFromForm();
		editingEntry = null;
		tone(720, 0.1, 'triangle', 0.06);
		haptic(8);
		await (isNew ? oncreateentry(entry) : onupdateentry(entry));
	}

	async function saveBooleanEntry(event: SubmitEvent) {
		event.preventDefault();
		const entry = buildEntry(booleanEntry === 'sim' ? 1 : 0);
		if (!entry) return;
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

	/** Toque no card: valor abre o sheet; sim/não alterna o dia. */
	async function tapCard(tracker: Tracker) {
		detailId = tracker.id;
		fromDetail = false;
		if (tracker.metric !== 'boolean') {
			openNewEntry();
			return;
		}
		const current = todayEntry(tracker.id);
		const next = nextBooleanLog(Boolean(current), current?.value ?? 0, positiveValueOf(tracker));
		if (tracker.askTime) {
			pendingBoolean = { trackerId: tracker.id, next };
			booleanTime = nowTime();
			tone(520, 0.06);
			sheet = 'time';
			return;
		}
		await applyBoolean(tracker, next, nowTime());
	}

	async function applyBoolean(tracker: Tracker, next: 0 | 1 | 'remove', time: string) {
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
			value: next,
			note: current?.note
		};
		const good = isPositive(tracker, next);
		tone(good ? 720 : 320, 0.12, 'triangle', 0.06);
		haptic(good ? [12, 26, 12] : 8);
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

<svelte:window
	onpointermove={(event) => {
		if (pressTimer === undefined) return;
		if (Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > 9) cancelPress();
	}}
	onpointerup={cancelPress}
	onpointercancel={cancelPress}
/>

<div class="tk">
	<div class="habit-prototype-grid habit-prototype-habits">
		<button class="habit-prototype-card habit-prototype-wide habit-prototype-empty tk-new" onclick={openNewTracker}><Plus size={20} /> Tracker</button>
		{#each visibleTrackers as tracker (tracker.id)}
			{@const last = lastEntry(tracker.id)}
			{@const current = tracker.metric === 'boolean' ? todayEntry(tracker.id) : null}
			{@const trend = trendOf(tracker, entriesOf(tracker.id))}
			{@const done = tracker.metric === 'boolean' ? Boolean(current && isPositive(tracker, current.value)) : goalMet(tracker, last?.value ?? 0)}
			<div class="hcard">
				<button
					class:done
					class:archived={!tracker.active}
					class="habit-prototype-card habit-prototype-habit tk-card"
					style={`--habit-progress:${progressOf(tracker, last)}`}
					onclick={() => tapCard(tracker)}
					oncontextmenu={(event) => {
						event.preventDefault();
						openMenu(tracker, event.clientX, event.clientY);
					}}
					onpointerdown={(event) => startPress(event, tracker)}
				>
					<b>{tracker.name}</b>
					<span>
						<span class="habit-prototype-value" class:idle={tracker.metric === 'boolean' && !current}>
							{#if tracker.metric === 'boolean'}
								{#if current}
									{booleanLabelOf(tracker, current.value, TRACKER_BOOLEAN_LABELS)}
								{:else if last}
									{booleanLabelOf(tracker, last.value, TRACKER_BOOLEAN_LABELS)}
								{:else}
									—
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
				<button
					class="hcard-more"
					aria-label={`Opções de ${tracker.name}`}
					onclick={(event) => {
						event.stopPropagation();
						const rect = event.currentTarget.getBoundingClientRect();
						openMenu(tracker, rect.left, rect.bottom + 6);
					}}
				>
					<MoreHorizontal size={16} />
				</button>
			</div>
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

{#if menu}
	<CardMenu
		x={menu.x}
		y={menu.y}
		onclose={() => (menu = null)}
		items={[
			{ label: 'Histórico', icon: History, action: () => openDetail(menu!.tracker) },
			{ label: 'Editar', icon: Pencil, action: () => openEditTracker(menu!.tracker) },
			{
				label: menu.tracker.active ? 'Arquivar' : 'Reativar',
				icon: menu.tracker.active ? Archive : ArchiveRestore,
				action: () => toggleArchive(menu!.tracker)
			},
			{ label: 'Excluir', danger: true, action: () => removeTracker(menu!.tracker) }
		]}
	/>
{/if}

{#if sheet === 'detail' && detailTracker}
	{@const tracker = detailTracker}
	<Sheet title={tracker.name} closeLabel="Fechar" onclose={() => { sheet = null; detailId = null; }}>
		<div class="tk-head">
			<span class="tk-head-value">
				{#if detailEntries[0]}
					<b>{tracker.metric === 'boolean' ? booleanLabelOf(tracker, detailEntries[0].value, TRACKER_BOOLEAN_LABELS) : formatValue(tracker, detailEntries[0].value)}</b><small>{formatWhen(detailEntries[0])}</small>
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
							<b>{tracker.metric === 'boolean' ? booleanLabelOf(tracker, entry.value, TRACKER_BOOLEAN_LABELS) : formatValue(tracker, entry.value)}</b>
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
			<Button variant="danger" onclick={() => removeTracker(tracker)}>Excluir</Button>
		</div>
	</Sheet>
{/if}

{#if sheet === 'value' && detailTracker}
	{@const tracker = detailTracker}
	<ValueSheet
		title={`Registrar em ${tracker.name}`}
		value={entryValue}
		max={sheetMax(tracker)}
		step={sheetStep(tracker)}
		unit={tracker.unit}
		hint={tracker.target == null ? '' : `Meta ${formatValue(tracker, tracker.target)}`}
		presets={presets(tracker)}
		saveLabel={editingEntry ? 'Salvar' : 'Registrar'}
		onchange={(value) => (entryValue = value)}
		onsave={saveValue}
		ondelete={editingEntry ? removeEntry : undefined}
		onclose={closeForm}
	>
		{#snippet extra()}
			<div class="sheet-row">
				<Field label="Data">
					<input type="date" bind:value={entryForm.date} max={today} required />
				</Field>
				<Field label="Hora" hint="opcional">
					<input type="time" bind:value={entryForm.time} />
				</Field>
			</div>
			<Field label="Nota" hint="opcional">
				<input bind:value={entryForm.note} placeholder="Ex.: em jejum" maxlength="80" />
			</Field>
		{/snippet}
	</ValueSheet>
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
			{#if trackerForm.metric === 'boolean'}
				<div class="sheet-row">
					<Field label="Rótulo do positivo">
						<input bind:value={trackerForm.positiveLabel} placeholder="Sim" maxlength="14" required />
					</Field>
					<Field label="Rótulo do negativo">
						<input bind:value={trackerForm.negativeLabel} placeholder="Não" maxlength="14" required />
					</Field>
				</div>
				<div class="sheet-days">
					<span class="sheet-days-label">Qual conta como positivo?</span>
					<Segmented
						label="Qual conta como positivo"
						options={[
							{ value: '1', label: trackerForm.positiveLabel.trim() || TRACKER_BOOLEAN_LABELS.positive },
							{ value: '0', label: trackerForm.negativeLabel.trim() || TRACKER_BOOLEAN_LABELS.negative }
						]}
						value={String(trackerForm.positiveValue)}
						onchange={(value) => (trackerForm.positiveValue = value === '0' ? 0 : 1)}
					/>
				</div>
			{:else}
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
			{#if trackerForm.metric === 'boolean'}
				<div class="tk-toggle-row">
					<span>Perguntar a hora ao registrar<small>no lançamento rápido</small></span>
					<Toggle label="Perguntar a hora ao registrar" bind:checked={trackerForm.askTime} />
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
		<form class="sheet-form" onsubmit={saveBooleanEntry}>
			<Segmented
				label="Registro"
				options={[
					{ value: 'sim', label: booleanLabelOf(tracker, 1, TRACKER_BOOLEAN_LABELS) },
					{ value: 'nao', label: booleanLabelOf(tracker, 0, TRACKER_BOOLEAN_LABELS) }
				]}
				value={booleanEntry}
				onchange={(value) => (booleanEntry = value === 'nao' ? 'nao' : 'sim')}
			/>
			<Field label="Hora" hint="opcional">
				<input type="time" bind:value={entryForm.time} />
			</Field>
			<Field label="Nota" hint="opcional">
				<input bind:value={entryForm.note} placeholder="Ex.: em jejum" maxlength="80" />
			</Field>
			<div class="sheet-actions">
				{#if editingEntry}
					<Button variant="danger" onclick={removeEntry}>Excluir</Button>
				{/if}
				<Button variant="secondary" onclick={closeForm}>Cancelar</Button>
				<Button type="submit">Salvar</Button>
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
	.tk-new { border: 2px dashed var(--hp-line); background: var(--hp-s); }

	.tk-hint { margin: 0; color: var(--hp-muted); font-size: 13px; }
	.tk-arch-toggle { justify-self: start; padding: 6px 12px; border-radius: 16px; background: var(--hp-s2); color: var(--hp-muted); font-size: 12px; font-weight: 600; }

	.tk-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.tk-toggle-row > span { display: grid; gap: 2px; color: var(--tx); font-size: 14px; font-weight: 600; }
	.tk-toggle-row small { color: var(--mu); font-size: 11px; font-weight: 400; }

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
