/**
 * Integração com o Carta (editor/visualizador Markdown).
 *
 * - Instância única e preguiçosa (o highlighter Shiki é caro de montar).
 * - Sanitização com DOMPurify: allowlist ampla, mas com piso de segurança
 *   (sem script, atributos on*, object, embed, form, iframe, javascript:).
 * - Fence `artifact` convertida num host que o `ArtifactFrame` monta por cima,
 *   dentro de um iframe sandbox (conteúdo não sanitizado por design).
 */
import { Carta, type Plugin } from 'carta-md';
import { emoji } from '@cartamd/plugin-emoji';
import { math } from '@cartamd/plugin-math';
import { code } from '@cartamd/plugin-code';
import { slash } from '@cartamd/plugin-slash';
import { anchor } from '@cartamd/plugin-anchor';
import DOMPurify from 'dompurify';
import { SKIP, visit } from 'unist-util-visit';
import type { Element, Properties, Root, Text } from 'hast';

const ARTIFACT_LANG = 'artifact';

function encodeArtifact(codeValue: string): string {
	const bytes = new TextEncoder().encode(codeValue);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function decodeArtifact(encoded: string): string {
	try {
		const binary = atob(encoded);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return '';
	}
}

function textOf(node: Element): string {
	return node.children
		.map((child) => (child.type === 'text' ? child.value : ''))
		.join('');
}

function classNameOf(node: Element): string[] {
	const value = node.properties?.className as unknown;
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === 'string') return value.split(/\s+/);
	return [];
}

/** Troca a fence `artifact` por um host `div[data-atlas-artifact]` antes do Shiki rodar. */
const artifactPlugin: Plugin = {
	transformers: [
		{
			execution: 'sync',
			type: 'rehype',
			transform({ processor }) {
				processor.use(() => (tree: Root) => {
					visit(tree, 'element', (node, index, parent) => {
						if (node.type !== 'element' || node.tagName !== 'pre') return;
						const child = node.children.find((item): item is Element => item.type === 'element' && item.tagName === 'code');
						if (!child || !classNameOf(child).includes(`language-${ARTIFACT_LANG}`)) return;
						if (index === undefined || !parent) return;
						const host: Element = {
							type: 'element',
							tagName: 'div',
							properties: { className: ['atlas-artifact'], dataAtlasArtifact: encodeArtifact(textOf(child)) },
							children: []
						};
						parent.children[index] = host;
					});
				});
			}
		}
	]
};

const WIKI_RE = /\[\[([^\]]+)\]\]/g;
const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function textNode(value: string): Text {
	return { type: 'text', value };
}

function element(tagName: string, properties: Properties, value: string): Element {
	return { type: 'element', tagName, properties, children: [textNode(value)] };
}

function inlineChildren(value: string): Array<Element | Text> {
	const matches: { index: number; length: number; node: Element }[] = [];
	let match: RegExpExecArray | null;
	WIKI_RE.lastIndex = 0;
	while ((match = WIKI_RE.exec(value))) {
		matches.push({
			index: match.index,
			length: match[0].length,
			node: element('a', { className: ['wl'], href: '#', dataWl: match[1] }, match[1])
		});
	}
	TAG_RE.lastIndex = 0;
	while ((match = TAG_RE.exec(value))) {
		if (match.index > 0 && WORD_CHAR.test(value[match.index - 1])) continue;
		matches.push({
			index: match.index,
			length: match[0].length,
			node: element('span', { className: ['tg2'] }, match[0])
		});
	}
	matches.sort((a, b) => a.index - b.index);
	const nodes: Array<Element | Text> = [];
	let last = 0;
	for (const item of matches) {
		if (item.index < last) continue;
		if (item.index > last) nodes.push(textNode(value.slice(last, item.index)));
		nodes.push(item.node);
		last = item.index + item.length;
	}
	if (last < value.length) nodes.push(textNode(value.slice(last)));
	return nodes;
}

/** Converte `[[Wiki-link]]` em âncora e `#tag` em destaque, fora de código. */
const wikiPlugin: Plugin = {
	transformers: [
		{
			execution: 'sync',
			type: 'rehype',
			transform({ processor }) {
				processor.use(() => (tree: Root) => {
					visit(tree, 'text', (node, index, parent) => {
						if (!parent || index === undefined) return;
						if (parent.type === 'element' && ['code', 'pre', 'a', 'script', 'style'].includes(parent.tagName)) return;
						const nodes = inlineChildren(node.value);
						if (nodes.length <= 1) return;
						parent.children.splice(index, 1, ...nodes);
						return [SKIP, index + nodes.length];
					});
				});
			}
		}
	]
};

export function sanitizeHtml(html: string): string {
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true, svg: true, mathMl: true },
		FORBID_TAGS: ['script', 'object', 'embed', 'form', 'iframe', 'link', 'meta', 'base', 'style'],
		FORBID_ATTR: ['ping', 'srcset'],
		ALLOW_DATA_ATTR: true,
		ADD_ATTR: ['target', 'rel']
	});
}

let instance: Carta | undefined;

export function getCarta(): Carta {
	if (!instance) {
		instance = new Carta({
			sanitizer: sanitizeHtml,
			rehypeOptions: { allowDangerousHtml: true },
			rendererDebounce: 250,
			theme: 'github-dark',
			extensions: [artifactPlugin, wikiPlugin, emoji(), math(), slash(), anchor(), code()]
		});
	}
	return instance;
}
