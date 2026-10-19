<script lang="ts">
	import { mount, onMount, untrack } from 'svelte';
	import { getCarta, decodeArtifact } from '#lib/carta';
	import {
		attachmentAbsolutePath,
		attachmentsEnabled,
		deleteAttachment,
		listAttachments,
		readAttachment,
		saveAttachment
	} from '#lib/notes-store';
	import { isIOSWebView, isTauriApp, saveBytes } from '#lib/backup-io';
	import { isTauri } from '@tauri-apps/api/core';
	import {
		findNoteByTitle,
		noteExportFileName,
		noteMarkdown,
		noteTitle,
		normalizeTag,
		tagColor,
		type Note,
		type NoteFolder
	} from '#lib/notes';
	import { playTone, playTypingThock, prefersReducedMotion, pulseHaptic } from '#lib/feedback';
	import { decorateTempoRefs } from '#lib/tempo-ref';
	import { TimeBubble } from '#lib/bubble';
	import type { TimeBlock } from '#lib/atlas';
	import { Download, MoreHorizontal } from '@lucide/svelte';
	import FolderIcon from './FolderIcon.svelte';
	import ArtifactFrame from './ArtifactFrame.svelte';

	let {
		note,
		notesList,
		folders,
		timeBlocks = [],
		open,
		initialMode,
		flushToken = 0,
		morphFrom = null,
		sound,
		typingSound,
		haptics,
		backlinks,
		onpatch,
		onpin,
		ondeletenote,
		onopenfolder,
		onclose,
		onwikilink,
		onopenbacklink,
		ontoast
	}: {
		note: Note;
		notesList: Note[];
		folders: NoteFolder[];
		timeBlocks?: TimeBlock[];
		open: boolean;
		initialMode: 'write' | 'preview';
		sound: boolean;
		typingSound: boolean;
		haptics: boolean;
		/** Muda quando o pai precisa que o rascunho seja gravado antes do reload. */
		flushToken?: number;
		/** Retângulo de origem para o morph da bolha de tempo até o editor. */
		morphFrom?: DOMRect | null;
		backlinks: Note[];
		onpatch: (patch: Partial<Note>) => void;
		onpin: (element?: Element | null) => void;
		ondeletenote: () => void;
		onopenfolder: () => void;
		onclose: () => void;
		onwikilink: (title: string) => void;
		onopenbacklink: (note: Note) => void;
		ontoast: (message: string, options?: { warning?: boolean }) => void;
	} = $props();

	const carta = getCarta();

	let title = $state(untrack(() => note.title));
	let body = $state(untrack(() => note.body));
	let tags = $state<string[]>(untrack(() => [...note.tags]));
	let tagDraft = $state('');
	let mode = $state<'write' | 'preview' | 'split'>(untrack(() => initialMode));
	let status = $state('Salvo');
	let attachments = $state<string[]>([]);
	let paneEl = $state<HTMLElement | null>(null);
	let rootEl = $state<HTMLElement | null>(null);
	let morphing = $state(false);
	let editorEl = $state<HTMLTextAreaElement | null>(null);
	let previewEl = $state<HTMLElement | null>(null);
	let moreEl = $state<HTMLElement | null>(null);
	let moreOpen = $state(false);
	/** Bolha de preview do bloco de tempo correspondente a uma referência `tempo`. */
	let bubble: TimeBubble | null = null;
	let dirty = false;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	let lastSaved = untrack(() => note.body);
	const objectUrls: string[] = [];

	const folder = $derived(note.folderId ? folders.find((item) => item.id === note.folderId) ?? null : null);

	function tone(frequency: number, duration = 0.08, type: OscillatorType = 'sine', volume = 0.05) {
		playTone(frequency, duration, type, volume, sound);
	}

	function typingClick() {
		playTypingThock(typingSound && sound);
	}

	/* ---------- persistência ---------- */
	function commit() {
		dirty = false;
		onpatch({ title: title.trim() || 'Sem título', body, tags });
	}

	function flush() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = undefined;
		}
		if (dirty) commit();
	}

	let handledFlush = $state(untrack(() => flushToken));
	$effect(() => {
		if (flushToken === handledFlush) return;
		handledFlush = flushToken;
		flush();
	});

	function markChange() {
		dirty = true;
		status = 'Salvando…';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = undefined;
			commit();
			status = 'Salvo ✓';
			tone(880, 0.06, 'sine', 0.03);
			if (!prefersReducedMotion()) {
				document.querySelector('.nt-status')?.animate?.([{ transform: 'scale(1.3)' }, { transform: 'none' }], { duration: 260 });
			}
		}, 800);
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = setTimeout(() => void renderPreview(), 220);
	}

	function setMode(next: 'write' | 'preview' | 'split') {
		mode = next;
		tone(next === 'preview' ? 420 : 520, 0.06);
		pulseHaptic(haptics, 6);
		if (next !== 'preview') setTimeout(() => editorEl?.focus(), 120);
	}

	/* ---------- preview (pipeline Carta) ---------- */
	async function renderPreview() {
		if (!previewEl) return;
		bubble?.hide(true);
		try {
			const html = await carta.render(body);
			previewEl.innerHTML = html;
		} catch (error) {
			console.error('Falha ao renderizar a pré-visualização', error);
			previewEl.innerHTML = '<p class="nt-empty">Não foi possível renderizar a pré-visualização.</p>';
			return;
		}
		mountArtifacts();
		await decoratePreview();
	}

	function mountArtifacts() {
		if (!previewEl) return;
		for (const host of previewEl.querySelectorAll<HTMLElement>('[data-atlas-artifact]')) {
			if (host.dataset.atlasMounted === '1') continue;
			host.dataset.atlasMounted = '1';
			mount(ArtifactFrame, { target: host, props: { code: decodeArtifact(host.dataset.atlasArtifact ?? '') } });
		}
	}

	async function decoratePreview() {
		if (!previewEl) return;
		for (const link of previewEl.querySelectorAll<HTMLElement>('a.wl[data-wl]')) {
			if (!findNoteByTitle(notesList, link.dataset.wl ?? '')) link.classList.add('ms');
		}
		// Referências `tempo DD/MM HHh-HHh`: chip clicável + cruzamento com os blocos.
		for (const span of decorateTempoRefs(previewEl, note.updatedAt)) {
			const from = span.dataset.tpFrom ?? '';
			const to = span.dataset.tpTo ?? '';
			const matched = timeBlocks.some(
				(block) => block.status !== 'cancelled' && from < block.endAt.slice(0, 16) && to > block.startAt.slice(0, 16)
			);
			if (!matched) span.classList.add('ms');
		}
		if (!isTauri()) return;
		for (const image of previewEl.querySelectorAll<HTMLImageElement>('img[src^="attachments/"]')) {
			if (image.dataset.ntResolved === '1') continue;
			const match = /^attachments\/([^/]+)\/(.+)$/.exec(image.getAttribute('src') ?? '');
			if (!match) continue;
			image.dataset.ntResolved = '1';
			const bytes = await readAttachment(match[1], match[2]);
			if (!bytes) continue;
			const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
			objectUrls.push(url);
			image.src = url;
		}
	}

	/* ---------- toolbar ---------- */
	function surround(delimiter: string | [string, string]) {
		const el = editorEl;
		if (!el) return;
		const [open, close] = Array.isArray(delimiter) ? delimiter : [delimiter, delimiter];
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const selected = el.value.slice(start, end);
		el.setRangeText(`${open}${selected}${close}`, start, end, 'end');
		if (!selected) el.selectionStart = el.selectionEnd = start + open.length;
		el.focus();
		body = el.value;
		tone(700, 0.04, 'triangle', 0.04);
		pulseHaptic(haptics, 5);
	}

	function linePrefix(prefix: string) {
		const el = editorEl;
		if (!el) return;
		const start = el.selectionStart;
		const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
		const nextBreak = el.value.indexOf('\n', start);
		const lineEnd = nextBreak === -1 ? el.value.length : nextBreak;
		const lineText = el.value.slice(lineStart, lineEnd);
		const updated = lineText.startsWith(prefix) ? lineText.slice(prefix.length) : `${prefix}${lineText}`;
		el.setRangeText(updated, lineStart, lineEnd, 'end');
		el.focus();
		body = el.value;
		tone(700, 0.04, 'triangle', 0.04);
		pulseHaptic(haptics, 5);
	}

	/* ---------- tags ---------- */
	function addTag(value: string) {
		const tag = normalizeTag(value);
		tagDraft = '';
		if (!tag || tags.includes(tag)) return;
		tags = [...tags, tag];
		markChange();
		tone(700, 0.1, 'triangle', 0.05);
		pulseHaptic(haptics, [8, 20, 8]);
	}

	function removeTag(tag: string) {
		tags = tags.filter((item) => item !== tag);
		markChange();
		tone(300, 0.06);
		pulseHaptic(haptics, 5);
	}

	/* ---------- anexos ---------- */
	async function refreshAttachments() {
		attachments = await listAttachments(note.id);
	}

	async function onAttach(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		for (const file of files) {
			try {
				const path = await saveAttachment(note.id, file);
				const insert = file.type.startsWith('image/')
					? `\n\n![${file.name}](${path})\n`
					: `\n\n[${file.name}](${path})\n`;
				body = `${body}${insert}`;
				lastSaved = '';
			} catch (error) {
				console.error(error);
				ontoast('Não foi possível anexar o arquivo.', { warning: true });
			}
		}
		await refreshAttachments();
	}

	async function removeAttachment(name: string) {
		await deleteAttachment(note.id, name);
		await refreshAttachments();
	}

	/**
	 * Abrir anexo.
	 *
	 * - Desktop (Tauri): abre no app padrão do sistema (`openPath`).
	 * - iOS: `<a download>` com blob não funciona no WKWebView, então usamos o
	 *   picker do iOS para exportar o arquivo para onde o usuário escolher.
	 * - Navegador: download por blob, como antes.
	 */
	async function openAttachment(name: string) {
		const bytes = await readAttachment(note.id, name);
		if (!bytes) return;
		if (!isTauriApp() || isIOSWebView()) {
			const result = await saveBytes(bytes, name);
			ontoast(result === 'saved' ? 'Anexo exportado.' : 'Exportação cancelada.');
			return;
		}
		const { openPath } = await import('@tauri-apps/plugin-opener');
		await openPath(await attachmentAbsolutePath(note.id, name));
	}

	function onPreviewClick(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		const ref = target?.closest<HTMLElement>('.tp-ref');
		if (ref) {
			event.preventDefault();
			const same = bubble?.isOpen && bubble.currentAnchor === ref;
			if (same) bubble?.hide();
			else showRefBubble(ref);
			return;
		}
		const link = target?.closest<HTMLElement>('a.wl[data-wl]');
		if (!link) return;
		event.preventDefault();
		onwikilink(link.dataset.wl ?? '');
	}

	function matchingBlocks(from: string, to: string): TimeBlock[] {
		if (!from || !to) return [];
		return timeBlocks
			.filter(
				(block) =>
					block.status !== 'cancelled' &&
					from < block.endAt.slice(0, 16) &&
					to > block.startAt.slice(0, 16)
			)
			.sort((a, b) => a.startAt.localeCompare(b.startAt));
	}

	function escapeHtml(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function showRefBubble(element: HTMLElement) {
		const blocks = matchingBlocks(element.dataset.tpFrom ?? '', element.dataset.tpTo ?? '');
		const html = blocks.length
			? blocks
					.map((block) => `<div class="tbb-1">${escapeHtml(block.title || '—')}</div><div class="tbb-2">${blockLabel(block)}</div>`)
					.join('')
			: '<div class="tbb-2">Sem bloco no planejador.</div>';
		bubble?.show(element, html, blocks.length ? '#d4f25a' : '#8d968a');
	}

	function onPreviewPointerOver(event: PointerEvent) {
		const ref = (event.target as HTMLElement | null)?.closest<HTMLElement>('.tp-ref');
		if (ref) showRefBubble(ref);
		else bubble?.hide();
	}

	function blockLabel(block: TimeBlock): string {
		const [, month, day] = block.startAt.slice(0, 10).split('-');
		return `${day}/${month} · ${block.startAt.slice(11, 16)}–${block.endAt.slice(11, 16)}`;
	}

	/**
	 * Exporta a nota como Markdown (`.md`) pelo save/picker do sistema.
	 * PDF fica para uma implementação nativa futura: `window.print()` não
	 * funciona no WKWebView do Tauri.
	 */
	async function exportMarkdown() {
		flush();
		const bytes = new TextEncoder().encode(noteMarkdown(title, body, tags));
		const result = await saveBytes(bytes, noteExportFileName(title), [
			{ name: 'Nota do Atlas', extensions: ['md'] }
		]);
		ontoast(result === 'saved' ? 'Nota exportada.' : 'Exportação cancelada.');
		tone(560, 0.08, 'triangle', 0.05);
		pulseHaptic(haptics, 6);
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (!moreOpen) return;
		if (!moreEl?.contains(event.target as Node)) moreOpen = false;
	}

	function toggleMore() {
		moreOpen = !moreOpen;
		if (moreOpen) tone(520, 0.05, 'triangle', 0.04);
	}

	onMount(() => {
		void refreshAttachments();
		bubble = new TimeBubble({
			anchorMiddle: true,
			offset: 10,
			touch: typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches,
			sound,
			haptics
		});
		paneEl?.addEventListener('click', onPreviewClick);
		paneEl?.addEventListener('pointerover', onPreviewPointerOver);
		paneEl?.addEventListener('pointerleave', () => bubble?.later());
		paneEl?.addEventListener('scroll', () => bubble?.hide(true), true);
		void renderPreview();
		// iOS suspende timers ao ir para segundo plano: grava o rascunho
		// pendente antes que o debounce de 800ms se perca.
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') flush();
		};
		document.addEventListener('visibilitychange', onVisibility);
		document.addEventListener('pointerdown', onDocumentPointerDown, true);
		window.addEventListener('pagehide', flush);
		if (initialMode === 'write') setTimeout(() => editorEl?.focus(), 350);
		return () => {
			paneEl?.removeEventListener('click', onPreviewClick);
			paneEl?.removeEventListener('pointerover', onPreviewPointerOver);
			bubble?.destroy();
			bubble = null;
			document.removeEventListener('visibilitychange', onVisibility);
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
			window.removeEventListener('pagehide', flush);
			for (const url of objectUrls) URL.revokeObjectURL(url);
			objectUrls.length = 0;
		};
	});

	$effect(() => {
		const current = body;
		if (current === lastSaved) return;
		lastSaved = current;
		markChange();
	});

	$effect(() => () => flush());

	// Morph da bolha de tempo até o editor: revela o overlay a partir do
	// retângulo clicado. O CSS pula a transição de slide enquanto isso.
	$effect(() => {
		const element = rootEl;
		if (!element || !open || !morphFrom || prefersReducedMotion()) return;
		morphing = true;
		element.style.transition = 'none';
		// Garante que o navegador aplicou o estado final antes de medir.
		void element.offsetHeight;
		const rect = element.getBoundingClientRect();
		const top = Math.max(0, morphFrom.top - rect.top);
		const left = Math.max(0, morphFrom.left - rect.left);
		const right = Math.max(0, rect.right - (morphFrom.left + morphFrom.width));
		const bottom = Math.max(0, rect.bottom - (morphFrom.top + morphFrom.height));
		const animation = element.animate(
			[
				{ clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round 14px)`, opacity: 0.7 },
				{ clipPath: 'inset(0px round 0px)', opacity: 1 }
			],
			{ duration: 340, easing: 'cubic-bezier(.2,.9,.2,1)' }
		);
		animation.onfinish = () => {
			morphing = false;
			element.style.transition = '';
		};
		return () => {
			animation.cancel();
			morphing = false;
			element.style.transition = '';
		};
	});
</script>

<div class="nt-ed" class:on={open} class:morphing bind:this={rootEl}>
	<div class="nt-eh">
		<button class="nt-ic" aria-label="Voltar" onclick={onclose}>‹</button>
		<button class="nt-fc" style={`--cc:${folder?.color ?? '#454c45'}`} onclick={onopenfolder}>
			<FolderIcon color={folder?.color ?? '#454c45'} mini />{folder?.name ?? 'Notas'}
		</button>
		<div class="nt-actions">
			<button class="nt-ic" class:on={note.pinned} aria-label={note.pinned ? 'Desafixar' : 'Fixar'} onclick={(event) => onpin(event.currentTarget)}>{note.pinned ? '★' : '☆'}</button>
			<button class="nt-ic" aria-label="Excluir" onclick={ondeletenote}>⌫</button>
			<button class="nt-ic nt-export" aria-label="Exportar Markdown" title="Exportar Markdown" onclick={exportMarkdown}><Download size={17} /></button>
		</div>
		<div class="nt-more" bind:this={moreEl}>
			<button class="nt-ic" aria-label="Mais ações" aria-haspopup="menu" aria-expanded={moreOpen} onclick={toggleMore}><MoreHorizontal size={18} /></button>
			{#if moreOpen}
				<div class="nt-more-menu" role="menu" aria-label="Ações da nota">
					<button
						role="menuitem"
						onclick={(event) => {
							const anchor = event.currentTarget;
							onpin(anchor);
							moreOpen = false;
						}}
					>
						{note.pinned ? 'Desafixar' : 'Fixar'}
					</button>
					<button role="menuitem" class="danger" onclick={() => { moreOpen = false; ondeletenote(); }}>Excluir</button>
					<button role="menuitem" onclick={() => { moreOpen = false; void exportMarkdown(); }}>Exportar .md</button>
				</div>
			{/if}
		</div>
		<div class="nt-seg" data-m={mode}>
			<i></i>
			<button class:on={mode === 'write'} onclick={() => setMode('write')}>Editar</button>
			<button class:on={mode === 'preview'} onclick={() => setMode('preview')}>Ler</button>
			<button class:on={mode === 'split'} onclick={() => setMode('split')}>Split</button>
		</div>
	</div>

	<input class="nt-ti" placeholder="Título" maxlength="60" aria-label="Título" bind:value={title} oninput={() => { typingClick(); markChange(); }} />

	<div class="nt-pa" bind:this={paneEl} data-m={mode}>
		<textarea
			class="nt-bd"
			bind:this={editorEl}
			bind:value={body}
			spellcheck="false"
			aria-label="Markdown"
			placeholder="Escreva em Markdown…  [[outra nota]]  #tag"
			oninput={typingClick}
		></textarea>
		<div class="nt-pv markdown-body" bind:this={previewEl} aria-live="polite"></div>
	</div>

	<div class="nt-tb">
		<button aria-label="Negrito" onclick={() => surround('**')}>B</button>
		<button aria-label="Itálico" onclick={() => surround('*')}>I</button>
		<button aria-label="Lista" onclick={() => linePrefix('- ')}>•</button>
		<button aria-label="Tarefa" onclick={() => linePrefix('- [ ] ')}>☐</button>
		<button aria-label="Link de nota" onclick={() => surround(['[[', ']]'])}>[[ ]]</button>
		<button aria-label="Título" onclick={() => linePrefix('# ')}>H</button>
		<button aria-label="Citação" onclick={() => linePrefix('> ')}>❝</button>
		{#if attachmentsEnabled()}
			<label class="nt-tb-file" title="Anexar arquivo">
				＋
				<input type="file" multiple onchange={onAttach} />
			</label>
		{/if}
	</div>

	<div class="nt-ef">
		{#if attachments.length}
			<div class="r">
				{#each attachments as name (name)}
					<span class="nt-attach">
						<button onclick={() => openAttachment(name)}>{name}</button>
						<button aria-label={`Remover ${name}`} onclick={() => removeAttachment(name)}>×</button>
					</span>
				{/each}
			</div>
		{/if}
		<div class="r">
			{#each tags as tag (tag)}
				<button class="nt-chip x" style={`--cc:${tagColor(tag)}`} onclick={() => removeTag(tag)}>#{tag}</button>
			{/each}
			<input
				value={tagDraft}
				placeholder="+ tag"
				aria-label="Nova tag"
				maxlength="20"
				oninput={(event) => (tagDraft = event.currentTarget.value)}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ',') {
						event.preventDefault();
						addTag(tagDraft);
					}
				}}
			/>
		</div>
		<div class="r">
			<small class="nt-backlinks">
				{#if backlinks.length}
					Referenciada por
					{#each backlinks as link, index (link.id)}{index ? ', ' : ' '}<button onclick={() => onopenbacklink(link)}>{noteTitle(link)}</button>{/each}
				{/if}
			</small>
			<span class="nt-status" class:ok={status.includes('✓')}>{status}</span>
		</div>
	</div>
</div>
