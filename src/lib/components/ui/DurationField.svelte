<script lang="ts">
	import { untrack } from 'svelte';
	import { formatClock, parseClockDigits } from '#lib/duration';

	/**
	 * Campo de duração com máscara `HH:MM`.
	 *
	 * Guarda os dígitos numa buffer própria (não lê o texto formatado), então
	 * backspace remove um dígito de cada vez e a heurística da direita continua
	 * valendo: `5` → `00:05`, `90` → `01:30`, `130` → `01:30`, `1230` → `12:30`.
	 * O valor emitido é sempre minutos inteiros; vazio vira `null`.
	 */
	let {
		value = null,
		onchange,
		ariaLabel = 'Duração',
		class: className = '',
		placeholder = '00:00',
		disabled = false
	}: {
		value?: number | null;
		onchange: (minutes: number | null) => void;
		ariaLabel?: string;
		class?: string;
		placeholder?: string;
		disabled?: boolean;
	} = $props();

	function seedDigits(minutes: number | null): string {
		if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '';
		// Buffer mínima que volta ao mesmo total (backspace não "gasta" zeros):
		// 90 → "90"; 130 → "210"; 600 → "1000".
		if (minutes <= 99) return String(Math.round(minutes));
		return formatClock(minutes).replace(':', '').replace(/^0+/, '');
	}

	let digits = $state(untrack(() => seedDigits(value)));
	let focused = $state(false);
	let input = $state<HTMLInputElement>();

	const text = $derived(digits ? formatClock(parseClockDigits(digits)) : '');

	$effect(() => {
		const current = value;
		const isFocused = focused;
		if (isFocused) return;
		const next = seedDigits(current);
		untrack(() => {
			if (next !== digits) digits = next;
		});
	});

	function emit(next: string) {
		digits = next;
		onchange(next ? parseClockDigits(next) : null);
	}

	function caretToEnd() {
		const element = input;
		if (!element) return;
		requestAnimationFrame(() => {
			const end = element.value.length;
			element.setSelectionRange(end, end);
		});
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'Backspace') {
			event.preventDefault();
			emit(digits.slice(0, -1));
			return;
		}
		if (event.key === 'Delete') {
			event.preventDefault();
			emit('');
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
			return;
		}
		if (/^\d$/.test(event.key)) {
			event.preventDefault();
			// 4 dígitos já formam HH:MM; dígito extra é ignorado (backspace corrige).
			if (digits.length < 4) emit(digits + event.key);
		}
	}

	function onpaste(event: ClipboardEvent) {
		event.preventDefault();
		const pasted = event.clipboardData?.getData('text') ?? '';
		const next = pasted.replace(/\D/g, '').slice(0, 4);
		if (next) emit(next);
	}

	/** Fallback para teclados virtuais que não mandam `keydown`. */
	function onbeforeinput(event: InputEvent) {
		if (event.inputType === 'insertText' && event.data) {
			const digit = event.data.match(/\d/)?.[0];
			event.preventDefault();
			if (digit && digits.length < 4) emit(digits + digit);
			return;
		}
		if (event.inputType === 'deleteContentBackward') {
			event.preventDefault();
			emit(digits.slice(0, -1));
		}
	}
</script>

<input
	bind:this={input}
	{disabled}
	type="text"
	inputmode="numeric"
	autocomplete="off"
	aria-label={ariaLabel}
	class={className}
	{placeholder}
	value={text}
	onkeydown={onkeydown}
	onbeforeinput={onbeforeinput}
	onpaste={onpaste}
	onfocus={() => {
		focused = true;
		caretToEnd();
	}}
	onblur={() => {
		focused = false;
		if (!digits) onchange(null);
	}}
/>
