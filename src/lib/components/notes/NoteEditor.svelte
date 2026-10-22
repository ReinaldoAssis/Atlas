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
		noteTitle,
		normalizeTag,
		tagColor,
		type Note,
		type NoteFolder,
		type NoteMode
	} from '#lib/notes';
	import { saveNoteMarkdown } from '#lib/note-export';
	import { playTone, playTypingThock, prefersReducedMotion, pulseHaptic } from '#lib/feedback';
	import { decorateTempoRefs, insideCodeAt, tempoReference } from '#lib/tempo-ref';
	import { TimeBubble } from '#lib/bubble';
	import { formatMinutes, type TimeBlock } from '#lib/atlas';
	import { Clock, Download, MoreHorizontal } from '@lucide/svelte';
	import { m } from '#lib/paraglide/messages.js';
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
		onmode,
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
		initialMode: NoteMode;
		onmode?: (mode: NoteMode) => void;
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
	let mode = $state<NoteMode>(untrack(() => initialMode));
	let status = $state(m.editor_status_saved());
	let attachments = $state<string[]>([]);
	let paneEl = $state<HTMLElement | null>(null);
	let rootEl = $state<HTMLElement | null>(null);
	let morphing = $state(false);
	let slashOpen = $state(false);
	let slashStart = 0;
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

	/** Blocos oferecidos pelo `/tempo` (próximos da data da nota). */
	const slashOptions = $derived.by(() => {
		const blocks = [...timeBlocks]
			.filter((block) => block.status !== 'cancelled')
			.sort((a, b) => a.startAt.localeCompare(b.startAt));
		const noteDay = note.updatedAt.slice(0, 10);
		const upcoming = blocks.filter((block) => block.startAt.slice(0, 10) >= noteDay);
		return (upcoming.length ? upcoming : blocks).slice(0, 5);
	});

	function tone(frequency: number, duration = 0.08, type: OscillatorType = 'sine', volume = 0.05) {
		playTone(frequency, duration, type, volume, sound);
	}

	function typingClick() {
		playTypingThock(typingSound && sound);
	}

	/* ---------- persistência ---------- */
	function commit() {
		dirty = false;
		onpatch({ title: title.trim() || m.editor_untitled(), body, tags });
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
		status = m.editor_status_saving();
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = undefined;
			commit();
			status = m.editor_status_saved_check();
			tone(880, 0.06, 'sine', 0.03);
			if (!prefersReducedMotion()) {
				document.querySelector('.nt-status')?.animate?.([{ transform: 'scale(1.3)' }, { transform: 'none' }], { duration: 260 });
			}
		}, 800);
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = setTimeout(() => void renderPreview(), 220);
	}

	function setMode(next: NoteMode) {
		mode = next;
		onmode?.(next);
		tone(next === 'preview' ? 420 : 520, 0.06);
		pulseHaptic(haptics, 6);
		if (next !== 'preview') setTimeout(() => editorEl?.focus(), 120);
	}

	/* ---------- atalho /tempo ---------- */
	function detectSlash(value: string, cursor: number) {
		const match = /(?:^|\s)\/(tempo|time)$/i.exec(value.slice(0, cursor));
		if (!match) {
			slashOpen = false;
			return;
		}
		slashStart = cursor - (match[1].length + 1);
		slashOpen = true;
	}

	function openSlash() {
		if (!editorEl) return;
		slashStart = editorEl.selectionStart;
		slashOpen = true;
		editorEl.focus();
	}

	function insertTempo(block: TimeBlock) {
		const element = editorEl;
		if (!element) return;
		const caret = element.selectionStart;
		const start = Math.max(0, Math.min(slashStart, caret));
		const prefix = start > 0 && !/\s/.test(element.value[start - 1]) ? ' ' : '';
		const reference = tempoReference(block);
		const text = `${prefix}${insideCodeAt(element.value, start) ? reference : `\`${reference}\``}`;
		element.setRangeText(text, start, caret, 'end');
		body = element.value;
		slashOpen = false;
		markChange();
		element.focus();
		tone(660, 0.07, 'triangle', 0.05);
		pulseHaptic(haptics, 5);
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
			previewEl.innerHTML = `<p class="nt-empty">${m.editor_preview_error()}</p>`;
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
				ontoast(m.editor_attach_failed(), { warning: true });
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
			try {
				const result = await saveBytes(bytes, name);
				ontoast(result === 'saved' ? m.editor_attachment_exported() : m.editor_export_cancelled());
			} catch (error) {
				console.error('Falha ao exportar o anexo', error);
				ontoast(m.editor_attachment_export_failed(), { warning: true });
			}
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
			: `<div class="tbb-2">${m.editor_tempo_no_block()}</div>`;
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
		try {
			const result = await saveNoteMarkdown({ title, body, tags });
			ontoast(result === 'saved' ? m.editor_note_exported() : m.editor_export_cancelled());
			tone(560, 0.08, 'triangle', 0.05);
			pulseHaptic(haptics, 6);
		} catch (error) {
			console.error('Falha ao exportar a nota', error);
			ontoast(m.editor_export_failed(), { warning: true });
		}
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (slashOpen) {
			const target = event.target as HTMLElement | null;
			if (!target?.closest('.nt-slash') && target !== editorEl) slashOpen = false;
		}
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
		<button class="nt-ic" aria-label={m.editor_back()} onclick={onclose}>‹</button>
		<button class="nt-fc" style={`--cc:${folder?.color ?? '#454c45'}`} onclick={onopenfolder}>
			<FolderIcon color={folder?.color ?? '#454c45'} mini />{folder?.name ?? m.editor_folder_root()}
		</button>
		<div class="nt-actions">
			<button class="nt-ic" class:on={note.pinned} aria-label={note.pinned ? m.editor_unpin() : m.editor_pin()} onclick={(event) => onpin(event.currentTarget)}>{note.pinned ? '★' : '☆'}</button>
			<button class="nt-ic" aria-label={m.editor_delete()} onclick={ondeletenote}>⌫</button>
			<button class="nt-ic nt-export" aria-label={m.editor_export_markdown()} title={m.editor_export_markdown()} onclick={exportMarkdown}><Download size={17} /></button>
		</div>
		<div class="nt-more" bind:this={moreEl}>
			<button class="nt-ic" aria-label={m.editor_more()} aria-haspopup="menu" aria-expanded={moreOpen} onclick={toggleMore}><MoreHorizontal size={18} /></button>
			{#if moreOpen}
				<div class="nt-more-menu" role="menu" aria-label={m.editor_note_actions()}>
					<button
						role="menuitem"
						onclick={(event) => {
							const anchor = event.currentTarget;
							onpin(anchor);
							moreOpen = false;
						}}
					>
						{note.pinned ? m.editor_unpin() : m.editor_pin()}
					</button>
					<button role="menuitem" class="danger" onclick={() => { moreOpen = false; ondeletenote(); }}>{m.editor_delete()}</button>
					<button role="menuitem" onclick={() => { moreOpen = false; void exportMarkdown(); }}>{m.editor_export_md()}</button>
				</div>
			{/if}
		</div>
		<div class="nt-seg" data-m={mode}>
			<i></i>
			<button class:on={mode === 'write'} onclick={() => setMode('write')}>{m.editor_mode_write()}</button>
			<button class:on={mode === 'preview'} onclick={() => setMode('preview')}>{m.editor_mode_read()}</button>
			<button class:on={mode === 'split'} onclick={() => setMode('split')}>{m.editor_mode_split()}</button>
		</div>
	</div>

	<input class="nt-ti" placeholder={m.editor_title()} maxlength="60" aria-label={m.editor_title()} bind:value={title} oninput={() => { typingClick(); markChange(); }} />

	<div class="nt-pa" bind:this={paneEl} data-m={mode}>
		<textarea
			class="nt-bd"
			bind:this={editorEl}
			bind:value={body}
			spellcheck="false"
			aria-label={m.editor_body_label()}
			placeholder={m.editor_body_placeholder()}
			oninput={(event) => {
				typingClick();
				const element = event.currentTarget;
				detectSlash(element.value, element.selectionStart ?? 0);
			}}
			onkeydown={(event) => {
				if (!slashOpen) return;
				if (event.key === 'Escape') {
					slashOpen = false;
					event.preventDefault();
					return;
				}
				if (event.key === 'Enter' && slashOptions[0]) {
					event.preventDefault();
					insertTempo(slashOptions[0]);
				}
			}}
		></textarea>
		<div class="nt-pv markdown-body" bind:this={previewEl} aria-live="polite"></div>
	</div>

	{#if slashOpen}
		<div class="nt-slash" role="listbox" aria-label={m.editor_tempo_refs()}>
			<span class="nt-slash-lb">{m.editor_tempo_insert()}</span>
			{#if slashOptions.length}
				{#each slashOptions as block (block.id)}
					<button type="button" role="option" aria-selected="false" onclick={() => insertTempo(block)}>
						<b>{block.startAt.slice(8, 10)}/{block.startAt.slice(5, 7)}</b>
						<span>{block.startAt.slice(11, 16)}–{block.endAt.slice(11, 16)} · {formatMinutes(block.plannedMinutes)} · {block.title || m.editor_block_fallback()}</span>
					</button>
				{/each}
			{:else}
				<small>{m.editor_tempo_empty()}</small>
			{/if}
		</div>
	{/if}

	<div class="nt-tb">
		<button aria-label={m.editor_bold()} onclick={() => surround('**')}>B</button>
		<button aria-label={m.editor_italic()} onclick={() => surround('*')}>I</button>
		<button aria-label={m.editor_list()} onclick={() => linePrefix('- ')}>•</button>
		<button aria-label={m.editor_task()} onclick={() => linePrefix('- [ ] ')}>☐</button>
		<button aria-label={m.editor_note_link()} onclick={() => surround(['[[', ']]'])}>[[ ]]</button>
		<button aria-label={m.editor_heading()} onclick={() => linePrefix('# ')}>H</button>
		<button aria-label={m.editor_quote()} onclick={() => linePrefix('> ')}>❝</button>
		<button aria-label={m.editor_tempo_ref()} title={m.editor_tempo_ref()} onclick={openSlash}><Clock size={16} /></button>
		{#if attachmentsEnabled()}
			<label class="nt-tb-file" title={m.editor_attach_file()}>
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
						<button aria-label={m.editor_attachment_remove({ name })} onclick={() => removeAttachment(name)}>×</button>
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
				placeholder={m.editor_tag_placeholder()}
				aria-label={m.editor_tag_new()}
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
					{m.editor_backlinks()}
					{#each backlinks as link, index (link.id)}{index ? ', ' : ' '}<button onclick={() => onopenbacklink(link)}>{noteTitle(link)}</button>{/each}
				{/if}
			</small>
			<span class="nt-status" class:ok={status.includes('✓')}>{status}</span>
		</div>
	</div>
</div>
