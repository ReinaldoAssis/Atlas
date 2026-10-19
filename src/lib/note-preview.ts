/**
 * Texto curto de uma nota para a bolha do Tempo.
 *
 * A referência `tempo …`/`time …` é só um link para o planejador: no preview
 * ela some. Quebras de linha são preservadas (a bolha usa `white-space:
 * pre-line`), em vez de virar um parágrafo único.
 */
import { parseTempoRefs } from './tempo-ref';

export function stripTempoRefs(body: string, noteDate?: string): string {
	const refs = parseTempoRefs(body, noteDate);
	let text = body;
	for (let index = refs.length - 1; index >= 0; index -= 1) {
		const ref = refs[index];
		text = `${text.slice(0, ref.start)}${text.slice(ref.end)}`;
	}
	return text;
}

export function notePreview(
	body: string,
	noteDate?: string,
	options: { maxLines?: number; maxChars?: number } = {}
): string {
	const maxLines = options.maxLines ?? 3;
	const maxChars = options.maxChars ?? 120;
	return stripTempoRefs(body, noteDate)
		.replace(/[#*_>`[\]]/g, '')
		.split(/\r?\n/)
		.map((line) => line.trim().replace(/^[-+]\s+/, ''))
		.filter(Boolean)
		.slice(0, maxLines)
		.join('\n')
		.slice(0, maxChars);
}
