<script module lang="ts">
	/** Último token de criação tratado, compartilhado entre montagens. */
	let handledCreateToken = 0;
	/** Último token de abertura (deep-link do planejador) tratado. */
	let handledOpenToken = 0;
</script>

<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { RotateCcw, Trash2 } from '@lucide/svelte';
	import {
		allTags,
		backlinks,
		childFolders,
		createFolder,
		createNote,
		descendantFolderIds,
		deaccent,
		filterNotesLocally,
		findNoteByTitle,
		folderPath,
		folderTotalCount,
		formatNoteDate,
		highlightHtml,
		NOTE_COLORS,
		noteExcerpt,
		noteTitle,
		notesInFolder,
		sortNotes,
		tagColor,
		TRASH_RETENTION_DAYS,
		type Note,
		type NoteFolder,
		type NotesState
	} from '#lib/notes';
	import type { TimeBlock } from '#lib/atlas';
	import {
		deleteFolders,
		deleteNote as removeNote,
		loadNotes,
		searchNotes,
		upsertFolder,
		upsertNote
	} from '#lib/notes-store';
	import { burstAt, centerOf, playTone, prefersReducedMotion, pulseHaptic } from '#lib/feedback';
	import { m } from '#lib/paraglide/messages.js';
	import FolderIcon from './FolderIcon.svelte';
	import NoteEditor from './NoteEditor.svelte';

	let {
		sound = true,
		typingSound = true,
		haptics = true,
		createToken = 0,
		timeBlocks = [],
		openNoteId = '',
		openNoteToken = 0,
		reloadToken = 0,
		onchange,
		oncreate,
		ontoast
	}: {
		sound?: boolean;
		typingSound?: boolean;
		haptics?: boolean;
		createToken?: number;
		timeBlocks?: TimeBlock[];
		openNoteId?: string;
		openNoteToken?: number;
		/** Muda quando o merge de outro aparelho trouxe dados: relê sem perder rascunho. */
		reloadToken?: number;
		onchange: (state: NotesState) => void;
		oncreate: (note: Note) => void;
		ontoast: (message: string, options?: { warning?: boolean; undo?: () => void }) => void;
	} = $props();

	// "Nova nota" disparado pelo shell (menu rápido).
	$effect(() => {
		if (createToken !== handledCreateToken) {
			handledCreateToken = createToken;
			void newNote();
		}
	});

	// Deep-link: abrir uma nota específica (ex.: a partir do planejador).
	$effect(() => {
		if (openNoteToken === handledOpenToken || !ready) return;
		handledOpenToken = openNoteToken;
		const note = notes.find((item) => item.id === openNoteId);
		if (note) void openNote(note, 'preview');
	});

	let notes = $state<Note[]>([]);
	let folders = $state<NoteFolder[]>([]);
	/** Fila de gravações para o reload esperar o flush do editor. */
	let writes: Promise<void> = Promise.resolve();
	/** Sinaliza ao editor aberto que ele deve gravar o rascunho antes do reload. */
	let flushToken = $state(0);
	let handledReload = $state(untrack(() => reloadToken));
	let ready = $state(false);
	let trashedView = $state(false);
	let currentFolder = $state<string | null>(null);
	let query = $state('');
	let activeTags = $state<string[]>([]);
	let searchIds = $state<string[] | null>(null);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let listVersion = $state(0);

	let editorNote = $state<Note | null>(null);
	let editorOpen = $state(false);
	let editorIn = $state(false);
	let editorMode = $state<'write' | 'preview'>('preview');

	let sheetKind = $state<'none' | 'newfolder' | 'picker'>('none');
	let sheetIn = $state(false);
	let newFolderName = $state('');
	let newFolderColor = $state(NOTE_COLORS[1]);
	let pickerNote = $state<Note | null>(null);

	let confirmState = $state<{ message: string; label: string; action: () => void } | null>(null);
	let menuState = $state<{ note: Note; x: number; y: number } | null>(null);

	let suppressClick = false;
	let drag: { kind: 'note' | 'folder'; id: string; x: number; y: number; active: boolean; ghost?: HTMLElement } | null = null;
	let longPress: { note: Note; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
	let dropTarget: HTMLElement | null = null;

	const activeNotes = $derived(notes.filter((note) => !note.trashedAt));
	const trashedNotes = $derived(
		notes.filter((note) => note.trashedAt).sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
	);
	const tags = $derived(allTags(activeNotes));
	const searching = $derived(Boolean(query.trim()) || activeTags.length > 0);
	const children = $derived(childFolders(folders, currentFolder));
	const path = $derived(folderPath(folders, currentFolder));
	const folderCount = $derived(folders.length);

	const visibleNotes = $derived.by(() => {
		if (trashedView) {
			const q = query.trim();
			const list = q ? filterNotesLocally(trashedNotes, q) : trashedNotes;
			return [...list];
		}
		let list: Note[];
		if (searching) {
			list = activeNotes;
			const q = query.trim();
			if (activeTags.length) list = list.filter((note) => activeTags.every((tag) => note.tags.includes(tag)));
			if (q) list = searchIds === null ? filterNotesLocally(list, q) : list.filter((note) => searchIds?.includes(note.id));
			list = sortNotes(list, 'updated');
			if (q) {
				const needle = deaccent(q).toLowerCase();
				list = [...list].sort((a, b) => Number(deaccent(noteTitle(b)).toLowerCase().includes(needle)) - Number(deaccent(noteTitle(a)).toLowerCase().includes(needle)));
			}
		} else {
			list = sortNotes(notesInFolder(activeNotes, currentFolder), 'updated');
		}
		return list;
	});

	function publish() {
		onchange({ notes, folders });
	}

	function bump() {
		listVersion += 1;
	}

	function tone(frequency: number, duration = 0.08, type: OscillatorType = 'sine', volume = 0.05) {
		playTone(frequency, duration, type, volume, sound);
	}

	function haptic(pattern: number | number[]) {
		pulseHaptic(haptics, pattern);
	}

	function spark(element: Element | null, count: number, color?: string) {
		if (!element || prefersReducedMotion()) return;
		const [x, y] = centerOf(element as HTMLElement);
		burstAt(x, y, count, color ? { color } : {});
	}

	/* ---------- toast (global do app) ---------- */
	function notify(message: string, undo?: () => void) {
		ontoast(message, undo ? { undo } : {});
	}

	/* ---------- confirmação ---------- */
	function openConfirm(message: string, action: () => void, label = 'Excluir') {
		confirmState = { message, action, label };
	}

	function closeConfirm() {
		confirmState = null;
	}

	function runConfirm() {
		const action = confirmState?.action;
		confirmState = null;
		action?.();
	}

	/* ---------- menu de contexto ---------- */
	function openMenu(note: Note, x: number, y: number) {
		const width = 190;
		const height = 62;
		menuState = {
			note,
			x: Math.max(8, Math.min(x, window.innerWidth - width)),
			y: Math.max(8, Math.min(y, window.innerHeight - height))
		};
		tone(520, 0.05);
		haptic(8);
	}

	function closeMenu() {
		menuState = null;
	}

	function onWindowClick(event: MouseEvent) {
		if (menuState && !(event.target as HTMLElement | null)?.closest?.('.nt-menu')) closeMenu();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeMenu();
			closeConfirm();
		}
	}

	/* ---------- ciclo de vida ---------- */
	onMount(() => {
		void (async () => {
			try {
				const loaded = await loadNotes();
				const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
				const expired = loaded.notes.filter((note) => note.trashedAt && Date.parse(note.trashedAt) < cutoff);
				for (const note of expired) await removeNote(note.id);
				notes = loaded.notes.filter((note) => !expired.includes(note));
				folders = loaded.folders;
				publish();
			} catch (error) {
				console.error(error);
				ontoast('Não foi possível abrir as notas.', { warning: true });
			} finally {
				ready = true;
				bump();
			}
		})();
	});

	// Sync de outro aparelho: o shell incrementa `reloadToken`. O editor aberto
	// grava o rascunho primeiro (LWW mantém a edição local), só então relemos.
	$effect(() => {
		void ready; // espera a carga inicial
		if (!ready || reloadToken === handledReload) return;
		handledReload = reloadToken;
		void reloadFromDisk();
	});

	async function reloadFromDisk() {
		flushToken += 1;
		await tick();
		await writes;
		try {
			const loaded = await loadNotes();
			notes = loaded.notes;
			folders = loaded.folders;
			publish();
			if (editorOpen && editorNote) {
				const still = notes.find((note) => note.id === editorNote?.id);
				if (still) editorNote = still;
				else await closeEditor();
			}
			bump();
		} catch (error) {
			console.error(error);
		}
	}

	/* ---------- navegação ---------- */
	function openFolder(id: string | null) {
		trashedView = false;
		currentFolder = id;
		query = '';
		activeTags = [];
		searchIds = null;
		tone(520, 0.07);
		haptic(6);
		bump();
		if (!prefersReducedMotion()) window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function toggleTrash() {
		trashedView = !trashedView;
		query = '';
		activeTags = [];
		searchIds = null;
		tone(420, 0.06);
		haptic(6);
		bump();
	}

	function toggleTag(tag: string) {
		const active = activeTags.includes(tag);
		activeTags = active ? activeTags.filter((item) => item !== tag) : [...activeTags, tag];
		tone(active ? 440 : 620, 0.06);
		haptic(6);
		if (!active) spark(document.querySelector(`[data-tag="${CSS.escape(tag)}"]`), 6, tagColor(tag));
		bump();
	}

	function onQuery(value: string) {
		query = value;
		searchIds = null;
		if (typingSound) tone(950 + Math.random() * 250, 0.03, 'square', 0.03);
		haptic(2);
		if (searchTimer) clearTimeout(searchTimer);
		const target = value;
		if (!target.trim() || trashedView) return;
		searchTimer = setTimeout(async () => {
			if (query !== target) return;
			searchIds = await searchNotes(target);
		}, 180);
	}

	/* ---------- notas ---------- */
	function persist(note: Note) {
		writes = writes.then(() => upsertNote(note)).catch((error) => console.error(error));
	}

	function patchNote(note: Note, patch: Partial<Note>) {
		const updated: Note = { ...note, ...patch, updatedAt: new Date().toISOString() };
		notes = notes.map((item) => (item.id === note.id ? updated : item));
		persist(updated);
		publish();
	}

	async function newNote() {
		const folderId = searching || trashedView ? null : currentFolder;
		const note = createNote(folderId, 'Nova nota');
		notes = [note, ...notes];
		await persist(note);
		trashedView = false;
		publish();
		bump();
		spark(document.querySelector('[data-nt-new]'), 14);
		tone(520, 0.1, 'triangle', 0.06);
		setTimeout(() => tone(780, 0.14, 'triangle', 0.06), 70);
		haptic([10, 30, 10]);
		oncreate(note);
		await openNote(note, 'write');
	}

	async function openNote(note: Note, mode: 'write' | 'preview' = 'preview') {
		editorNote = note;
		editorMode = mode;
		editorOpen = true;
		await tick();
		requestAnimationFrame(() => (editorIn = true));
		tone(420, 0.14, 'triangle', 0.05);
		setTimeout(() => tone(700, 0.1, 'triangle', 0.04), 60);
		haptic(8);
	}

	async function closeEditor() {
		editorIn = false;
		tone(380, 0.1, 'triangle', 0.04);
		haptic(6);
		await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : 380));
		editorOpen = false;
		editorNote = null;
	}

	function requestDelete(note: Note) {
		closeMenu();
		openConfirm(`Excluir "${noteTitle(note)}"? A nota vai para a lixeira e pode ser restaurada.`, () => {
			void trashNote(note);
		});
	}

	async function trashNote(note: Note) {
		const folderId = note.folderId;
		patchNote(note, { trashedAt: new Date().toISOString() });
		if (editorNote?.id === note.id) {
			editorIn = false;
			editorOpen = false;
			editorNote = null;
		}
		tone(200, 0.16);
		haptic(14);
		bump();
		notify('Nota movida para a lixeira', () => {
			patchNote(note, { trashedAt: null, folderId });
			bump();
		});
	}

	function requestRestore(note: Note) {
		patchNote(note, { trashedAt: null });
		tone(660, 0.1, 'triangle', 0.05);
		haptic([8, 20, 8]);
		bump();
		notify('Nota restaurada');
	}

	function requestPurge(note: Note) {
		openConfirm(`Excluir "${noteTitle(note)}" em definitivo? Esta ação remove a nota e seus anexos.`, () => {
			void purgeNote(note);
		});
	}

	async function purgeNote(note: Note) {
		notes = notes.filter((item) => item.id !== note.id);
		await removeNote(note.id);
		publish();
		tone(200, 0.16);
		haptic(14);
		bump();
		notify('Nota excluída');
	}

	function requestEmptyTrash() {
		if (!trashedNotes.length) return;
		openConfirm(`Esvaziar a lixeira? ${trashedNotes.length} nota(s) serão excluídas em definitivo.`, () => {
			void emptyTrash();
		}, 'Esvaziar');
	}

	async function emptyTrash() {
		const ids = trashedNotes.map((note) => note.id);
		notes = notes.filter((note) => !note.trashedAt);
		for (const id of ids) await removeNote(id);
		publish();
		tone(200, 0.16);
		haptic(14);
		bump();
		notify('Lixeira esvaziada');
	}

	function togglePin(note: Note, element?: Element | null) {
		const pinned = !note.pinned;
		patchNote(note, { pinned });
		if (pinned) {
			spark(element ?? document.querySelector(`[data-note="${note.id}"]`), 10);
			tone(784, 0.12, 'triangle', 0.06);
			haptic([8, 20, 8]);
		} else {
			tone(300, 0.08);
			haptic(5);
		}
	}

	async function moveNote(note: Note, folderId: string | null) {
		const from = note.folderId;
		if (from === folderId) return;
		patchNote(note, { folderId });
		const target = document.querySelector(`[data-folder="${folderId ?? 'root'}"]`);
		spark(target, 16, folderId ? folders.find((f) => f.id === folderId)?.color : undefined);
		tone(220, 0.14, 'sine', 0.08);
		setTimeout(() => tone(660, 0.14, 'triangle', 0.05), 80);
		haptic([12, 30, 12]);
		bump();
		notify(`Movida para ${folderId ? folders.find((f) => f.id === folderId)?.name ?? 'pasta' : 'Notas'}`, () => {
			patchNote(note, { folderId: from });
			bump();
		});
	}

	async function moveFolder(folder: NoteFolder, parentId: string | null) {
		const from = folder.parentId ?? null;
		if (from === parentId) return;
		if (parentId && (parentId === folder.id || descendantFolderIds(folders, folder.id).includes(parentId))) {
			tone(260, 0.1);
			haptic(20);
			notify('Uma pasta não pode ir para dentro dela mesma.');
			return;
		}
		const updated: NoteFolder = { ...folder, parentId, updatedAt: new Date().toISOString() };
		folders = folders.map((item) => (item.id === folder.id ? updated : item));
		await upsertFolder(updated);
		publish();
		bump();
		const destination = document.querySelector(`[data-folder="${parentId ?? 'root'}"]`);
		spark(destination, 16, parentId ? folders.find((f) => f.id === parentId)?.color : undefined);
		tone(220, 0.14, 'sine', 0.08);
		setTimeout(() => tone(660, 0.14, 'triangle', 0.05), 80);
		haptic([12, 30, 12]);
		notify(`Pasta movida para ${parentId ? folders.find((f) => f.id === parentId)?.name ?? 'pasta' : 'Notas'}`, () => {
			folders = folders.map((item) => (item.id === folder.id ? folder : item));
			void upsertFolder(folder);
			publish();
			bump();
		});
	}

	/* ---------- pastas ---------- */
	async function focusSheetInput() {
		await tick();
		requestAnimationFrame(() => {
			document.querySelector<HTMLInputElement>('.nt-sh .nt-inp')?.focus();
		});
	}

	async function openNewFolder() {
		newFolderName = '';
		newFolderColor = NOTE_COLORS[folderCount % NOTE_COLORS.length];
		tone(380, 0.1);
		haptic(6);
		await openSheet('newfolder');
		void focusSheetInput();
	}

	async function createFolderConfirm() {
		const name = newFolderName.trim();
		if (!name) {
			const input = document.querySelector<HTMLInputElement>('.nt-sh .nt-inp');
			input?.focus();
			input?.animate?.([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 200 });
			haptic(20);
			return;
		}
		const position = children.length;
		const folder = createFolder(currentFolder, name, position, newFolderColor);
		folders = [...folders, folder];
		await upsertFolder(folder);
		publish();
		await closeSheet();
		bump();
		const tile = document.querySelector(`[data-folder="${folder.id}"]`);
		spark(tile, 16, newFolderColor);
		tile?.animate?.([{ transform: 'scale(.7)' }, { transform: 'scale(1.08)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)' });
		tone(660, 0.15, 'triangle', 0.06);
		setTimeout(() => tone(880, 0.18, 'triangle', 0.06), 90);
		haptic([10, 30, 10]);
	}

	async function deleteFolder(folder: NoteFolder) {
		const ids = descendantFolderIds(folders, folder.id);
		const count = activeNotes.filter((note) => note.folderId && ids.includes(note.folderId)).length;
		openConfirm(`Excluir "${folder.name}"? ${count ? `Isto remove ${count} nota(s) e suas subpastas.` : 'Isto remove também suas subpastas.'}`, () => {
			void performDeleteFolder(folder, ids);
		});
	}

	async function performDeleteFolder(folder: NoteFolder, ids: string[]) {
		const folderBackup = folders;
		const noteBackup = notes;
		folders = folders.filter((item) => !ids.includes(item.id));
		notes = notes.filter((note) => !(note.folderId && ids.includes(note.folderId)));
		if (currentFolder && ids.includes(currentFolder)) currentFolder = null;
		await deleteFolders(ids);
		publish();
		tone(200, 0.16);
		haptic(14);
		bump();
		notify('Pasta excluída', () => {
			folders = folderBackup;
			notes = noteBackup;
			publish();
			bump();
		});
	}

	/* ---------- sheet ---------- */
	async function openSheet(kind: 'newfolder' | 'picker') {
		sheetKind = kind;
		sheetIn = false;
		await tick();
		requestAnimationFrame(() => (sheetIn = true));
	}

	async function closeSheet() {
		sheetIn = false;
		await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : 320));
		sheetKind = 'none';
		pickerNote = null;
	}

	function openPicker(note: Note) {
		pickerNote = note;
		tone(380, 0.1);
		haptic(6);
		void openSheet('picker');
	}

	function pickFolder(folderId: string | null) {
		if (!pickerNote) return;
		void moveNote(pickerNote, folderId);
		void closeSheet();
	}

	/* ---------- wiki-link ---------- */
	async function openWikiLink(title: string) {
		const existing = findNoteByTitle(activeNotes, title);
		if (existing) {
			tone(560, 0.08);
			haptic(6);
			await openNote(existing, 'preview');
			return;
		}
		const note = createNote(editorNote?.folderId ?? (trashedView ? null : currentFolder), title);
		notes = [...notes, note];
		await persist(note);
		publish();
		bump();
		tone(660, 0.12, 'triangle', 0.06);
		haptic([10, 30, 10]);
		oncreate(note);
		await openNote(note, 'write');
	}

	/* ---------- ponteiro: arrastar (mouse) / contexto (toque) ---------- */
	function rowPointerDown(event: PointerEvent, note: Note) {
		if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('.nt-pin')) return;
		if (event.pointerType === 'mouse') {
			drag = { kind: 'note', id: note.id, x: event.clientX, y: event.clientY, active: false };
			return;
		}
		clearLongPress();
		const { clientX: x, clientY: y } = event;
		longPress = {
			note,
			x,
			y,
			timer: setTimeout(() => {
				suppressClick = true;
				setTimeout(() => (suppressClick = false), 800);
				openMenu(note, x, y);
				longPress = null;
			}, 480)
		};
	}

	function folderPointerDown(event: PointerEvent, folder: NoteFolder) {
		if (event.button !== 0) return;
		if (event.pointerType !== 'mouse') return;
		drag = { kind: 'folder', id: folder.id, x: event.clientX, y: event.clientY, active: false };
	}

	function clearLongPress() {
		if (longPress) {
			clearTimeout(longPress.timer);
			longPress = null;
		}
	}

	function startDrag() {
		if (!drag || drag.active) return;
		drag.active = true;
		const label = drag.kind === 'note'
			? (() => { const note = notes.find((item) => item.id === drag?.id); return note ? noteTitle(note) : ''; })()
			: (folders.find((item) => item.id === drag?.id)?.name ?? '');
		const ghost = document.createElement('div');
		ghost.className = 'nt-gh';
		ghost.textContent = label;
		document.body.appendChild(ghost);
		drag.ghost = ghost;
		haptic(16);
		tone(300, 0.1, 'triangle', 0.05);
		moveGhost(drag.x, drag.y);
	}

	function moveGhost(x: number, y: number) {
		if (!drag?.ghost) return;
		drag.ghost.style.left = `${x}px`;
		drag.ghost.style.top = `${y}px`;
		const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-folder]') ?? null;
		if (target !== dropTarget) {
			dropTarget?.classList.remove('nt-drop');
			dropTarget = target;
			if (target) {
				target.classList.add('nt-drop');
				tone(700, 0.05);
				haptic(6);
			}
		}
	}

	function onPointerMove(event: PointerEvent) {
		if (longPress) {
			if (Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > 9) clearLongPress();
			return;
		}
		if (!drag) return;
		const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
		if (!drag.active) {
			if (distance > 8) startDrag();
			else return;
		}
		moveGhost(event.clientX, event.clientY);
	}

	function onPointerUp(event: PointerEvent) {
		clearLongPress();
		const current = drag;
		drag = null;
		if (!current || !current.active) return;
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 60);
		const target = dropTarget;
		dropTarget?.classList.remove('nt-drop');
		dropTarget = null;
		current.ghost?.remove();
		if (event.type === 'pointerup' && target) {
			const folderId = target.dataset.folder && target.dataset.folder !== 'root' ? target.dataset.folder : null;
			if (current.kind === 'note') {
				const note = notes.find((item) => item.id === current.id);
				if (note) void moveNote(note, folderId);
			} else {
				const folder = folders.find((item) => item.id === current.id);
				if (folder) void moveFolder(folder, folderId);
			}
		} else {
			tone(260, 0.1);
		}
	}

	const backlinkList = $derived(editorNote ? backlinks(activeNotes, editorNote) : []);

	function buildPickerRows(list: NoteFolder[], parentId: string | null, depth: number): { folder: NoteFolder; depth: number }[] {
		const rows: { folder: NoteFolder; depth: number }[] = [];
		for (const folder of childFolders(list, parentId)) {
			rows.push({ folder, depth });
			rows.push(...buildPickerRows(list, folder.id, depth + 1));
		}
		return rows;
	}
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp} onclick={onWindowClick} onkeydown={onKeyDown} />

<section class="nt-prototype nt-anim">
	<div class="nt-top">
		<div>
			<h1>Notas</h1>
			<small>{activeNotes.length} notas · {folderCount} pastas</small>
		</div>
		<div class="nt-top-actions">
			<button class="nt-ic trash" class:on={trashedView} aria-label="Lixeira" onclick={toggleTrash}>
				<Trash2 size={17} />
				{#if trashedNotes.length}<span class="nt-badge">{trashedNotes.length}</span>{/if}
			</button>
		</div>
	</div>

	<div class="nt-sb" class:has={Boolean(query)}>
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
			<circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
		</svg>
		<input
			value={query}
			placeholder={trashedView ? 'Pesquisar na lixeira' : 'Pesquisar'}
			aria-label="Pesquisar"
			autocomplete="off"
			oninput={(event) => onQuery(event.currentTarget.value)}
		/>
		<button class="nt-qx" aria-label="Limpar" onclick={() => { query = ''; searchIds = null; tone(420, 0.05); haptic(5); }}>×</button>
	</div>

	{#if tags.length && !trashedView}
		<div class="nt-tags">
			{#each tags as item (item.tag)}
				<button
					class="nt-tg"
					class:on={activeTags.includes(item.tag)}
					data-tag={item.tag}
					style={`--cc:${tagColor(item.tag)}`}
					onclick={() => toggleTag(item.tag)}
				>
					<i>#</i>{item.tag} <small>{item.count}</small>
				</button>
			{/each}
		</div>
	{/if}

	<div class="nt-cr">
		{#if trashedView}
			<button onclick={toggleTrash}>Notas</button>
			<span>›</span>
			<span style="color:var(--acc);font-weight:600">Lixeira ({trashedNotes.length})</span>
		{:else if searching}
			<button onclick={() => { query = ''; searchIds = null; activeTags = []; }}>Notas</button>
			<span>›</span>
			<span style="color:var(--acc);font-weight:600">{visibleNotes.length} {visibleNotes.length === 1 ? 'resultado' : 'resultados'}</span>
		{:else}
			<button data-folder="root" onclick={() => openFolder(null)}>Notas</button>
			{#each path as folder (folder.id)}
				<span>›</span>
				<button data-folder={folder.id} style={`--cc:${folder.color}`} onclick={() => openFolder(folder.id)}>{folder.name}</button>
			{/each}
		{/if}
	</div>

	{#key listVersion}
		{#if trashedView}
			{#if trashedNotes.length}
				<div class="nt-trash-actions">
					<button class="nt-trash-empty" onclick={requestEmptyTrash}>Esvaziar lixeira</button>
				</div>
			{/if}
			<div class="nt-rows">
				{#each visibleNotes as note (note.id)}
					<div class="nt-row" role="listitem" style={`--cc:${(note.folderId && folders.find((f) => f.id === note.folderId)?.color) || '#454c45'}`}>
						<div class="nt-row-main">
							<div class="tt">{noteTitle(note)}</div>
							<div class="sn">{noteExcerpt(note)}</div>
							<div class="mt"><span>Na lixeira {formatNoteDate(note.trashedAt ?? note.updatedAt)}</span></div>
						</div>
						<div class="nt-row-actions">
							<button aria-label="Restaurar" title="Restaurar" onclick={() => requestRestore(note)}><RotateCcw size={15} /></button>
							<button aria-label="Excluir definitivamente" title="Excluir" onclick={() => requestPurge(note)}><Trash2 size={15} /></button>
						</div>
					</div>
				{:else}
					<div class="nt-empty">{query ? 'Nada encontrado na lixeira' : 'Lixeira vazia'}</div>
				{/each}
			</div>
		{:else}
			{#if !searching}
				<div class="nt-g">
					<button class="nt-fo new" data-nt-new onclick={newNote}>+ Nota</button>
					<button class="nt-fo new" onclick={openNewFolder}>+ Pasta</button>
					{#each children as folder (folder.id)}
						<button class="nt-fo" data-folder={folder.id} style={`--cc:${folder.color}`} onpointerdown={(event) => folderPointerDown(event, folder)} onclick={() => { if (suppressClick) return; openFolder(folder.id); }}>
							<FolderIcon color={folder.color} />
							<span class="nt-fo-name">{folder.name}</span>
							<span class="nt-fo-tip" role="tooltip">{folderTotalCount(activeNotes, folders, folder.id)} notas</span>
						</button>
					{/each}
				</div>
			{/if}

			<div class="nt-rows" role="list">
				{#each visibleNotes as note (note.id)}
					<div
						class="nt-row"
						role="listitem"
						data-note={note.id}
						style={`--cc:${(note.folderId && folders.find((f) => f.id === note.folderId)?.color) || '#454c45'}`}
						onpointerdown={(event) => rowPointerDown(event, note)}
						oncontextmenu={(event) => { event.preventDefault(); openMenu(note, event.clientX, event.clientY); }}
					>
						<button class="nt-row-main" onclick={() => { if (suppressClick) return; void openNote(note); }}>
							<div class="tt">{@html highlightHtml(noteTitle(note), query)}</div>
							<div class="sn">{@html highlightHtml(noteExcerpt(note), query)}</div>
							<div class="mt">
								{#if searching && note.folderId}
									<span>{folderPath(folders, note.folderId).map((f) => f.name).join(' › ')}</span>
								{/if}
								{#if note.conflictOf}
									<span class="t conflict">{m.notes_conflict()}</span>
								{/if}
								{#each note.tags as tag (tag)}
									<span class="t" style={`--cc:${tagColor(tag)}`}>#{tag}</span>
								{/each}
								<span>{formatNoteDate(note.updatedAt)}</span>
							</div>
						</button>
						<button
							class="nt-pin"
							class:on={note.pinned}
							aria-label={note.pinned ? 'Desafixar' : 'Fixar'}
							onclick={(event) => { event.stopPropagation(); togglePin(note, event.currentTarget); }}
						>{note.pinned ? '★' : '☆'}</button>
					</div>
				{:else}
					<div class="nt-empty">{searching ? 'Nada encontrado' : 'Pasta vazia'}</div>
				{/each}
			</div>
		{/if}
	{/key}
</section>

{#if menuState}
	<div class="nt-menu" role="menu" style={`left:${menuState.x}px; top:${menuState.y}px`}>
		<button class="danger" role="menuitem" onclick={() => requestDelete(menuState!.note)}>
			<Trash2 size={15} /> Excluir nota
		</button>
	</div>
{/if}

{#if editorOpen && editorNote}
	{#key editorNote.id}
		<NoteEditor
			note={editorNote}
			notesList={activeNotes}
			{folders}
			{timeBlocks}
			open={editorIn}
			initialMode={editorMode}
			{flushToken}
			{sound}
			{typingSound}
			{haptics}
			backlinks={backlinkList}
			onpatch={(patch) => patchNote(editorNote as Note, patch)}
			onpin={(element) => togglePin(editorNote as Note, element)}
			ondeletenote={() => requestDelete(editorNote as Note)}
			onopenfolder={() => openPicker(editorNote as Note)}
			onclose={closeEditor}
			onwikilink={openWikiLink}
			onopenbacklink={(note) => openNote(note, 'preview')}
			{ontoast}
		/>
	{/key}
{/if}

{#if confirmState}
	<div class="nt-ov on" role="presentation" onclick={closeConfirm}></div>
	<div class="nt-sh on" role="dialog" aria-modal="true" aria-label="Confirmação">
		<div class="nt-grip"></div>
		<p class="nt-confirm-text">{confirmState.message}</p>
		<button class="nt-btn danger" onclick={runConfirm}>{confirmState.label}</button>
		<button class="nt-btn ghost" onclick={closeConfirm}>Cancelar</button>
	</div>
{/if}

{#if sheetKind !== 'none'}
	<div class="nt-ov" class:on={sheetIn} role="presentation" onclick={closeSheet}></div>
	<div class="nt-sh" class:on={sheetIn} role="dialog" aria-modal="true" aria-label={sheetKind === 'newfolder' ? 'Nova pasta' : 'Mover nota'}>
		<div class="nt-grip"></div>
		{#if sheetKind === 'newfolder'}
			<input
				class="nt-inp"
				placeholder="Nome da pasta"
				maxlength="22"
				aria-label="Nome da pasta"
				bind:value={newFolderName}
			/>
			<div class="nt-sw">
				{#each NOTE_COLORS as color (color)}
					<button class:on={newFolderColor === color} style={`--cc:${color}`} aria-label="Cor" onclick={() => { newFolderColor = color; tone(600, 0.06); haptic(5); }}></button>
				{/each}
			</div>
			<button class="nt-btn" onclick={createFolderConfirm}>Criar pasta</button>
		{:else}
			<button class="nt-pk" style="--cc:#8d968a" onclick={() => pickFolder(null)}><i></i>Notas (raiz)</button>
			{#each buildPickerRows(folders, null, 0) as row (row.folder.id)}
				<button class="nt-pk" style={`--cc:${row.folder.color};padding-left:${10 + row.depth * 22}px`} onclick={() => pickFolder(row.folder.id)}>
					<FolderIcon color={row.folder.color} mini />{row.folder.name}
					<span class="cnt">{folderTotalCount(activeNotes, folders, row.folder.id)}</span>
				</button>
			{/each}
		{/if}
	</div>
{/if}
