<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import DurationField from './DurationField.svelte';

	/**
	 * Kit Atlas — sheet de valor (hábito e tracker de número/tempo).
	 *
	 * O número grande é **editável**: dá para digitar direto, sem arrastar o
	 * slider (que continua ali e acompanha). Presets opcionais e um slot
	 * `extra` para campos específicos (data/hora/nota do tracker).
	 */
	let {
		title,
		value,
		max,
		step = 1,
		min = 0,
		unit = '',
		hint = '',
		duration = false,
		caption,
		accentAt = null,
		saveLabel = 'Salvar',
		presets = [],
		onchange,
		onsave,
		ondelete,
		onclose,
		extra
	}: {
		title: string;
		value: number;
		max: number;
		step?: number;
		min?: number;
		unit?: string;
		hint?: string;
		/** Usa a máscara HH:MM no número grande (valor segue em minutos). */
		duration?: boolean;
		caption?: (value: number) => string;
		accentAt?: number | null;
		saveLabel?: string;
		presets?: { value: number; label: string; additive?: boolean }[];
		onchange: (value: number) => void;
		onsave: (value: number) => void;
		ondelete?: () => void;
		onclose: () => void;
		extra?: Snippet;
	} = $props();

	function formatNumber(input: number): string {
		return Math.abs(input % 1) < 0.005 ? String(Math.round(input)) : String(Math.round(input * 100) / 100).replace('.', ',');
	}

	function clamp(input: number): number {
		if (!Number.isFinite(input)) return min;
		return Math.min(max, Math.max(min, input));
	}

	let draft = $state(untrack(() => formatNumber(value)));

	$effect(() => {
		const current = value;
		if (Number(draft.replace(',', '.')) !== current) draft = formatNumber(current);
	});

	function onDraft(event: Event & { currentTarget: HTMLInputElement }) {
		const raw = event.currentTarget.value;
		draft = raw;
		const parsed = Number(raw.replace(',', '.'));
		if (raw.trim() !== '' && Number.isFinite(parsed)) onchange(clamp(parsed));
	}

	function applyPreset(preset: { value: number; additive?: boolean }) {
		const next = preset.additive ? value + preset.value : preset.value;
		onchange(clamp(next));
	}

	function commit() {
		if (duration) {
			const final = clamp(value);
			onchange(final);
			onsave(final);
			return;
		}
		const final = normalizeDraft();
		onsave(final);
	}

	function normalizeDraft(): number {
		const parsed = Number(draft.replace(',', '.'));
		const final = clamp(Number.isFinite(parsed) && draft.trim() !== '' ? parsed : value);
		draft = formatNumber(final);
		onchange(final);
		return final;
	}

	const hit = $derived(accentAt !== null && value >= accentAt);
</script>

<div
	class="habit-prototype-overlay"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onclose();
	}}
>
	<div class="habit-prototype-sheet" role="dialog" aria-modal="true" aria-label={title}>
		<div class="habit-prototype-grip"></div>
		<p>{title}</p>
		<div class="vs-value">
			{#if duration}
				<DurationField
					class={`vs-input${hit ? ' hit' : ''}`}
					value={value}
					ariaLabel={title}
					onchange={(minutes) => onchange(clamp(minutes ?? 0))}
				/>
			{:else}
				<input
					class="vs-input"
					class:hit
					inputmode="decimal"
					aria-label={title}
					value={draft}
					oninput={onDraft}
					onblur={normalizeDraft}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							commit();
						}
					}}
				/>
			{/if}
			{#if unit && !duration}<span class="vs-unit">{unit}</span>{/if}
		</div>
		{#if caption}<div class="vs-caption">{caption(value)}</div>{/if}
		{#if hint}<small class="vs-hint">{hint}</small>{/if}
		<input
			aria-label={`Slider de ${title}`}
			type="range"
			{min}
			{max}
			{step}
			value={value}
			style={`--sheet-progress:${max > min ? ((value - min) / (max - min)) * 100 : 0}%`}
			oninput={(event) => onchange(clamp(Number(event.currentTarget.value)))}
		/>
		{#if presets.length}
			<div class="habit-prototype-chips">
				{#each presets as preset, index (index)}
					<button onclick={() => applyPreset(preset)}>{preset.label}</button>
				{/each}
			</div>
		{/if}
		{#if extra}{@render extra()}{/if}
		<div class="vs-actions">
			{#if ondelete}
				<button class="vs-delete" onclick={ondelete}>Excluir</button>
			{/if}
			<button class="vs-cancel" onclick={onclose}>Cancelar</button>
			<button class="habit-prototype-save vs-save" onclick={commit}>{saveLabel}</button>
		</div>
	</div>
</div>

<style>
	.vs-value {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 6px;
		margin: 6px 0 0;
	}
	.vs-input {
		width: min(260px, 100%);
		border: 0;
		background: none;
		color: var(--hp-text, #ecefe6);
		font: inherit;
		font-size: 64px;
		font-weight: 800;
		letter-spacing: -0.05em;
		line-height: 1.1;
		text-align: center;
		transition: color 0.2s;
	}
	.vs-input:focus {
		outline: none;
		color: var(--hp-accent, #d4f25a);
	}
	.vs-input.hit {
		color: var(--hp-accent, #d4f25a);
	}
	/* DurationField vive no próprio componente: o CSS scoped não o alcança. */
	.vs-value :global(.vs-input) {
		width: min(260px, 100%);
		border: 0;
		background: none;
		color: var(--hp-text, #ecefe6);
		font: inherit;
		font-size: 64px;
		font-weight: 800;
		letter-spacing: -0.05em;
		line-height: 1.1;
		text-align: center;
		transition: color 0.2s;
	}
	.vs-value :global(.vs-input:focus) {
		outline: none;
		color: var(--hp-accent, #d4f25a);
	}
	.vs-value :global(.vs-input.hit) {
		color: var(--hp-accent, #d4f25a);
	}
	.vs-unit {
		color: var(--hp-muted, #8d968a);
		font-size: 20px;
		font-weight: 600;
	}
	.vs-caption {
		margin-bottom: 6px;
		color: var(--hp-muted, #8d968a);
		font-size: 13px;
		text-align: center;
	}
	.vs-hint {
		display: block;
		margin-bottom: 22px;
		color: var(--hp-muted, #8d968a);
		font-size: 13px;
		text-align: center;
	}
	.vs-actions {
		display: flex;
		gap: 10px;
		margin-top: 18px;
	}
	.vs-actions > button {
		flex: 1;
		padding: 14px;
		border: 0;
		border-radius: 12px;
		font-family: 'Bricolage Grotesque', system-ui, sans-serif;
		font-size: 16px;
		font-weight: 800;
		text-align: center;
		cursor: pointer;
	}
	.vs-cancel {
		background: var(--hp-s2, #272b27);
		color: var(--hp-text, #ecefe6);
	}
	.vs-delete {
		background: var(--hp-s2, #272b27);
		color: #e58f83;
	}
	.vs-save {
		width: auto;
	}
</style>
