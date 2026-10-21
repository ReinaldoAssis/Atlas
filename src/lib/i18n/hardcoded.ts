/**
 * Detector de copy hardcoded — o guard do i18n.
 *
 * Regra: texto visível (nó de texto em Svelte, `placeholder`, `aria-label`,
 * `title`, `alt`) precisa vir de `m.*()`. Strings em `<script>` e em `.ts`
 * entram numa segunda fase (mensagens de erro/toast).
 *
 * Arquivos ainda não migrados ficam em `hardcoded-allowlist.json`; o teste
 * falha quando um arquivo fora da lista tem copy solta — e a lista só encolhe.
 */

export interface Finding {
	file: string;
	line: number;
	text: string;
	kind: 'text' | 'attribute';
}

const ATTRIBUTE = /(?:placeholder|aria-label|title|alt)="([^"]*)"/g;
const TEXT_NODE = />([^<>{}]+)</g;
const HAS_WORDS = /\p{L}{2}/u;

/** O nome do produto não é copy traduzível. */
const BRAND = new Set(['atlas']);

function isCopy(value: string): boolean {
	const text = value.trim();
	if (!HAS_WORDS.test(text)) return false;
	if (BRAND.has(text.toLowerCase())) return false;
	// Expressão Svelte (`{...}`) que o regex pegou de carona: `= 1 && value`.
	if (/[=;]|&&|\|\||=>/.test(text)) return false;
	return true;
}

function lineAt(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
	return line;
}

/** Remove `<script>` e `<style>` para não pegar dados/estilos como copy. */
function markupOnly(source: string): string {
	return source
		.replace(/<script[\s\S]*?<\/script>/g, (block) => block.replace(/[^\n]/g, ' '))
		.replace(/<style[\s\S]*?<\/style>/g, (block) => block.replace(/[^\n]/g, ' '));
}

export function findHardcoded(source: string, file: string, kind: 'svelte' | 'ts' = 'svelte'): Finding[] {
	if (kind === 'ts') return [];
	const markup = markupOnly(source);
	const findings: Finding[] = [];

	for (const match of markup.matchAll(TEXT_NODE)) {
		if (!isCopy(match[1])) continue;
		findings.push({
			file,
			line: lineAt(markup, match.index ?? 0),
			text: match[1].trim().replace(/\s+/g, ' '),
			kind: 'text'
		});
	}

	for (const match of markup.matchAll(ATTRIBUTE)) {
		const value = match[1];
		if (value.includes('{') || !isCopy(value)) continue;
		findings.push({
			file,
			line: lineAt(markup, match.index ?? 0),
			text: `${match[0].split('=')[0]}="${value.trim()}"`,
			kind: 'attribute'
		});
	}

	return findings;
}
