/**
 * Referências de tempo dentro de notas: `tempo DD/MM HHh-HHh` (alias `time`).
 *
 * A referência **não cria** nada: ela é parseada do texto e cruzada com os
 * blocos do módulo Tempo por interseção de intervalo. Regras de fallback:
 *
 * - sem mês → mês da última alteração da nota;
 * - sem dia → dia da última alteração da nota;
 * - sem hora → dia inteiro.
 *
 * Formato normalizado: `YYYY-MM-DDTHH:MM` (hora local), igual aos `startAt`/
 * `endAt` de `TimeBlock`, então a interseção é comparação de string.
 */

export interface TempoRef {
	/** Índice inicial no texto. */
	start: number;
	/** Índice final (exclusivo) no texto. */
	end: number;
	/** Texto original do match, ex.: `tempo 16/10 17h-20h`. */
	raw: string;
	/** `YYYY-MM-DDTHH:MM`. */
	from: string;
	/** `YYYY-MM-DDTHH:MM`. */
	to: string;
	allDay: boolean;
}

interface DateParts {
	year: number;
	month: number;
	day: number;
}

const KEYWORD = /(?<![\p{L}\p{N}_])(tempo|time)(?![\p{L}\p{N}_])/giu;
const DATE_WITH_MONTH = /^(\d{1,2})\/(\d{1,2})/;
const BARE_DAY = /^(\d{1,2})(?![\d/:hH])/;
const CLOCK = /^(\d{1,2})(?:h(\d{2})?|:(\d{2}))/;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function dateParts(source?: string): DateParts {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(source ?? '');
	if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
	const now = new Date();
	return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function readClock(text: string, pos: number): { minutes: number; length: number } | null {
	const match = CLOCK.exec(text.slice(pos));
	if (!match) return null;
	const hour = Number(match[1]);
	const minutes = match[2] !== undefined ? Number(match[2]) : match[3] !== undefined ? Number(match[3]) : 0;
	if (hour > 23 || minutes > 59) return null;
	return { minutes: hour * 60 + minutes, length: match[0].length };
}

interface Spec {
	length: number;
	day: number | null;
	month: number | null;
	from: number | null;
	to: number | null;
}

/** Lê o "spec" que segue a palavra-chave. `null` quando não há data nem hora. */
function readSpec(text: string, pos: number): Spec | null {
	if (!/\s/.test(text[pos] ?? '')) return null;
	let cursor = pos;
	while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

	let day: number | null = null;
	let month: number | null = null;
	const withMonth = DATE_WITH_MONTH.exec(text.slice(cursor));
	if (withMonth) {
		day = Number(withMonth[1]);
		month = Number(withMonth[2]);
		cursor += withMonth[0].length;
	} else {
		const bare = BARE_DAY.exec(text.slice(cursor));
		if (bare) {
			day = Number(bare[1]);
			cursor += bare[0].length;
		}
	}

	let from: number | null = null;
	let to: number | null = null;
	let clockPos = cursor;
	while (clockPos < text.length && /\s/.test(text[clockPos])) clockPos += 1;
	const clock = readClock(text, clockPos);
	if (clock) {
		from = clock.minutes;
		let end = clockPos + clock.length;
		let dash = end;
		while (dash < text.length && /\s/.test(text[dash])) dash += 1;
		if (text[dash] === '-' && text[dash + 1] && !/\s/.test(text[dash + 1])) {
			let second = dash + 1;
			while (second < text.length && /\s/.test(text[second])) second += 1;
			const secondClock = readClock(text, second);
			if (secondClock) {
				to = secondClock.minutes;
				end = second + secondClock.length;
			}
		}
		cursor = end;
	}

	if (day === null && month === null && from === null) return null;
	return { length: cursor - pos, day, month, from, to };
}

function buildRef(text: string, at: number, keywordLength: number, spec: Spec, base: DateParts): TempoRef {
	const raw = text.slice(at, at + keywordLength + spec.length);
	const month = spec.month ?? base.month;
	const day = spec.day ?? base.day;
	const date = `${String(base.year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
	if (spec.from === null) {
		return { start: at, end: at + raw.length, raw, from: `${date}T00:00`, to: `${date}T23:59`, allDay: true };
	}
	const end = Math.min(spec.to ?? spec.from + 60, 23 * 60 + 59);
	return {
		start: at,
		end: at + raw.length,
		raw,
		from: `${date}T${pad(Math.floor(spec.from / 60))}:${pad(spec.from % 60)}`,
		to: `${date}T${pad(Math.floor(end / 60))}:${pad(end % 60)}`,
		allDay: false
	};
}

/** Todas as referências de tempo de um texto. */
export function parseTempoRefs(text: string, noteDate?: string): TempoRef[] {
	const base = dateParts(noteDate);
	const refs: TempoRef[] = [];
	KEYWORD.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = KEYWORD.exec(text))) {
		const spec = readSpec(text, match.index + match[0].length);
		if (!spec) continue;
		refs.push(buildRef(text, match.index, match[0].length, spec, base));
	}
	return refs;
}

export interface BlockLike {
	startAt: string;
	endAt: string;
}

/** Interseção de intervalos (qualquer sobreposição). */
export function refOverlapsBlock(ref: TempoRef, block: BlockLike): boolean {
	return ref.from < block.endAt.slice(0, 16) && ref.to > block.startAt.slice(0, 16);
}

export function blocksForRef<T extends BlockLike>(ref: TempoRef, blocks: readonly T[]): T[] {
	return blocks.filter((block) => refOverlapsBlock(ref, block));
}

export interface NoteLike {
	id: string;
	title: string;
	body: string;
	updatedAt: string;
}

export interface NoteRef {
	note: NoteLike;
	ref: TempoRef;
}

/** Notas (ativas) cujas referências cruzam o bloco — mais recentes primeiro. */
export function notesForBlock<T extends NoteLike>(block: BlockLike, notes: readonly T[], limit = 8): NoteRef[] {
	const found: NoteRef[] = [];
	for (const note of notes) {
		for (const ref of parseTempoRefs(note.body, note.updatedAt)) {
			if (refOverlapsBlock(ref, block)) found.push({ note, ref });
		}
	}
	return found
		.sort((a, b) => (b.note.updatedAt ?? '').localeCompare(a.note.updatedAt ?? ''))
		.slice(0, limit);
}

/** Todos os blocos que uma nota referencia, indexados por bloco. */
export function blockIdsForNote<T extends BlockLike & { id: string }>(note: NoteLike, blocks: readonly T[]): Set<string> {
	const ids = new Set<string>();
	for (const ref of parseTempoRefs(note.body, note.updatedAt)) {
		for (const block of blocks) if (refOverlapsBlock(ref, block)) ids.add(block.id);
	}
	return ids;
}

const SKIP_PARENTS = new Set(['CODE', 'PRE', 'A', 'SCRIPT', 'STYLE', 'TEXTAREA']);

function isSkipped(node: Node): boolean {
	let parent: HTMLElement | null = node.parentElement;
	while (parent) {
		if (SKIP_PARENTS.has(parent.tagName)) return true;
		if (parent.classList.contains('atlas-artifact')) return true;
		parent = parent.parentElement;
	}
	return false;
}

/**
 * Marca as referências de tempo no DOM renderizado (pós-Carta), trocando o texto
 * por `<span class="tp-ref" data-tp-from data-tp-to data-tp-all-day>`.
 *
 * Devolve os spans criados, para o chamador decidir o estado "sem bloco".
 */
export function decorateTempoRefs(root: HTMLElement, noteDate?: string): HTMLElement[] {
	const targets: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let current = walker.nextNode();
	while (current) {
		const text = current as Text;
		if (text.data.trim() && !isSkipped(text)) targets.push(text);
		current = walker.nextNode();
	}

	const created: HTMLElement[] = [];
	for (const text of targets) {
		const refs = parseTempoRefs(text.data, noteDate);
		if (!refs.length) continue;
		const frag = document.createDocumentFragment();
		let cursor = 0;
		for (const ref of refs) {
			if (ref.start > cursor) frag.append(document.createTextNode(text.data.slice(cursor, ref.start)));
			const span = document.createElement('span');
			span.className = 'tp-ref';
			span.dataset.tpFrom = ref.from;
			span.dataset.tpTo = ref.to;
			if (ref.allDay) span.dataset.tpAllDay = '1';
			span.textContent = ref.raw;
			frag.append(span);
			created.push(span);
			cursor = ref.end;
		}
		if (cursor < text.data.length) frag.append(document.createTextNode(text.data.slice(cursor)));
		text.replaceWith(frag);
	}
	return created;
}
