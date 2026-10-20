<script module lang="ts">
	/** Último token de criação tratado, compartilhado entre montagens. */
	let handledCreateToken = 0;
	/** Último token de abertura (deep-link do planejador) tratado. */
	let handledOpenToken = 0;
</script>

<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { Copy, Download, Link2, Pencil, RotateCcw, Trash2 } from '@lucide/svelte';
	import {
		allTags,
		backlinks,
		childFolders,
		createFolder,
		createNote,
		descendantFolderIds,
		deaccent,
		duplicateNote,
		filterNotesLocally,
		findNoteByTitle,
		folderPath,
		folderTotalCount,
		formatNoteDate,
		highlightHtml,
		NOTE_COLORS,
		noteExcerpt,
		noteLink,
		noteTitle,
		notesInFolder,
		sortNotes,
		tagColor,
		TRASH_RETENTION_DAYS,
		type Note,
		type NoteFolder,
		type NoteMode,
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
	import { burstAt, centerOf, playTone, playTypingThock, prefersReducedMotion, pulseHaptic } from '#lib/feedback';
	import { m } from '#lib/paraglide/messages.js';
	import { saveNoteMarkdown } from '#lib/note-export';
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
		if (note) void openNote(note);
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
	let editorMode = $state<NoteMode>('preview');

	let sheetKind = $state<'none' | 'newfolder' | 'picker'>('none');
	let sheetIn = $state(false);
	let newFolderName = $state('');
	let newFolderColor = $state(NOTE_COLORS[1]);
	let pickerNote = $state<Note | null>(null);

	let confirmState = $state<{ message: string; label: string; action: () => void } | null>(null);
	let renameState = $state<{ note: Note; value: string } | null>(null);
	let menuState = $state<{ note: Note; x: number; y: number; mobile: boolean } | null>(null);

	let suppressClick = false;
	let drag: { kind: 'note' | 'folder'; id: string; x: number; y: number; active: boolean; ghost?: HTMLElement } | null = null;
	let longPress: {
		kind: 'note' | 'folder';
		id: string;
		note?: Note;
		x: number;
		y: number;
		armed: boolean;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;
	/** Card que já "armou" o arrasto (escala + háptico) enquanto o dedo segura. */
	let armedKey = $state<string | null>(null);
	let scrollTimer: ReturnType<typeof setInterval> | undefined;
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
	let menuOpenedAt = 0;

	function openMenu(note: Note, x: number, y: number) {
		const mobile = window.matchMedia('(max-width: 560px)').matches;
		const width = 210;
		const height = mobile ? 0 : 250;
		menuOpenedAt = Date.now();
		menuState = {
			note,
			mobile,
			x: Math.max(8, Math.min(x, window.innerWidth - width)),
			y: mobile ? 0 : Math.max(8, Math.min(y, window.innerHeight - height))
		};
		tone(520, 0.05);
		haptic(8);
	}

	function closeMenu() {
		menuState = null;
	}

	function closeMenuFromBackdrop() {
		// O clique que solta o long-press chega logo depois de abrir: ignora.
		if (Date.now() - menuOpenedAt < 320) return;
		closeMenu();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeMenu();
			closeConfirm();
			closeRename();
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
		if (typingSound) playTypingThock(sound);
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

	async function openNote(note: Note, mode?: NoteMode) {
		if (!trashedView && note.folderId !== currentFolder) {
			// A nota pode ter sido aberta por deep-link/backlink de outra pasta.
			currentFolder = note.folderId;
			query = '';
			activeTags = [];
			searchIds = null;
		}
		editorNote = note;
		editorMode = mode ?? note.lastMode ?? 'preview';
		const wasOpen = editorOpen;
		if (!wasOpen) editorIn = false;
		editorOpen = true;
		await tick();
		if (!wasOpen) {
			// Dois frames: garante que o navegador pinte o estado fora da tela
			// antes de aplicar `.on`, senão a transição de entrada não roda.
			await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		}
		editorIn = true;
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

	/* ---------- ações do menu ---------- */
	async function openRename(note: Note) {
		closeMenu();
		renameState = { note, value: noteTitle(note) };
		await tick();
		requestAnimationFrame(() => {
			const input = document.querySelector<HTMLInputElement>('.nt-rename .nt-inp');
			input?.focus();
			input?.select();
		});
	}

	function closeRename() {
		renameState = null;
	}

	function confirmRename() {
		if (!renameState) return;
		const value = renameState.value.trim();
		if (!value) {
			const input = document.querySelector<HTMLInputElement>('.nt-rename .nt-inp');
			input?.focus();
			input?.animate?.([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 200 });
			haptic(20);
			return;
		}
		const note = renameState.note;
		renameState = null;
		patchNote(note, { title: value });
		notify('Nota renomeada');
		tone(660, 0.08, 'triangle', 0.05);
	}

	function duplicate(note: Note) {
		closeMenu();
		const copy = duplicateNote(note);
		notes = [copy, ...notes];
		void persist(copy);
		publish();
		bump();
		spark(document.querySelector(`[data-note="${note.id}"]`), 10);
		tone(560, 0.1, 'triangle', 0.05);
		notify('Nota duplicada');
	}

	async function exportNote(note: Note) {
		closeMenu();
		try {
			const result = await saveNoteMarkdown(note);
			notify(result === 'saved' ? 'Nota exportada.' : 'Exportação cancelada.');
		} catch (error) {
			console.error('Falha ao exportar a nota', error);
			ontoast('Não foi possível exportar a nota.', { warning: true });
		}
	}

	async function copyLink(note: Note) {
		closeMenu();
		const text = noteLink(note);
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const field = document.createElement('textarea');
			field.value = text;
			field.style.position = 'fixed';
			field.style.opacity = '0';
			document.body.appendChild(field);
			field.select();
			document.execCommand('copy');
			field.remove();
		}
		notify('Link copiado');
		haptic(8);
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
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		sheetIn = true;
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
			await openNote(existing);
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

	/* ---------- ponteiro: arrastar / menu de contexto ---------- */
	function armKey(kind: 'note' | 'folder', id: string): string {
		return `${kind}:${id}`;
	}

	function rowPointerDown(event: PointerEvent, note: Note) {
		if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('.nt-pin')) return;
		if (event.pointerType === 'mouse') {
			drag = { kind: 'note', id: note.id, x: event.clientX, y: event.clientY, active: false };
			return;
		}
		clearLongPress();
		const { clientX: x, clientY: y } = event;
		longPress = {
			kind: 'note',
			id: note.id,
			note,
			x,
			y,
			armed: false,
			timer: setTimeout(() => {
				if (!longPress) return;
				longPress.armed = true;
				armedKey = armKey('note', note.id);
				haptic(12);
			}, 480)
		};
	}

	function folderPointerDown(event: PointerEvent, folder: NoteFolder) {
		if (event.button !== 0) return;
		if (event.pointerType === 'mouse') {
			drag = { kind: 'folder', id: folder.id, x: event.clientX, y: event.clientY, active: false };
			return;
		}
		clearLongPress();
		const { clientX: x, clientY: y } = event;
		longPress = {
			kind: 'folder',
			id: folder.id,
			x,
			y,
			armed: false,
			timer: setTimeout(() => {
				if (!longPress) return;
				longPress.armed = true;
				armedKey = armKey('folder', folder.id);
				haptic(12);
			}, 480)
		};
	}

	function clearLongPress() {
		if (longPress) {
			clearTimeout(longPress.timer);
			longPress = null;
		}
		armedKey = null;
	}

	function startDrag() {
		if (!drag || drag.active) return;
		drag.active = true;
		armedKey = null;
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

	/** Rola a página quando o ghost chega perto do topo/rodapé. */
	function updateAutoScroll(y: number) {
		const edge = 76;
		const speed = y < edge ? -10 : y > window.innerHeight - edge ? 10 : 0;
		if (!speed) {
			stopAutoScroll();
			return;
		}
		if (scrollTimer !== undefined) return;
		scrollTimer = setInterval(() => window.scrollBy(0, speed), 16);
	}

	function stopAutoScroll() {
		if (scrollTimer === undefined) return;
		clearInterval(scrollTimer);
		scrollTimer = undefined;
	}

	function onPointerMove(event: PointerEvent) {
		if (longPress) {
			const distance = Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y);
			if (!longPress.armed) {
				if (distance > 9) clearLongPress();
				return;
			}
			if (distance <= 8) return;
			const pending = longPress;
			clearLongPress();
			drag = {
				kind: pending.kind,
				id: pending.id,
				x: event.clientX,
				y: event.clientY,
				active: false
			};
			startDrag();
			if (event.cancelable) event.preventDefault();
			return;
		}
		if (!drag) return;
		if (drag.active) {
			moveGhost(event.clientX, event.clientY);
			updateAutoScroll(event.clientY);
			if (event.pointerType !== 'mouse' && event.cancelable) event.preventDefault();
			return;
		}
		const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
		if (distance > 8) startDrag();
	}

	function onPointerUp(event: PointerEvent) {
		const pending = longPress;
		clearLongPress();
		stopAutoScroll();
		if (pending?.armed && event.type === 'pointerup') {
			// O clique que segue o pointerup não pode abrir a nota/pasta.
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 800);
			if (pending.kind === 'note' && pending.note) {
				openMenu(pending.note, pending.x, pending.y);
			}
		}
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

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp} onkeydown={onKeyDown} />

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
						<button class="nt-fo" class:nt-armed={armedKey === armKey('folder', folder.id)} data-folder={folder.id} style={`--cc:${folder.color}`} onpointerdown={(event) => folderPointerDown(event, folder)} onclick={() => { if (suppressClick) return; openFolder(folder.id); }}>
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
						class:nt-armed={armedKey === armKey('note', note.id)}
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
	{@const target = menuState.note}
	<div class="nt-menu-ov" role="presentation" onclick={closeMenuFromBackdrop}></div>
	{#if menuState.mobile}
		<div
			class="nt-sh on nt-mmenu nt-sh-fly"
			role="menu"
			aria-label="Ações da nota"
			style="--nt-tint:#8d968a"
			in:fly={{ y: 120, duration: prefersReducedMotion() ? 0 : 300 }}
			out:fly={{ y: 120, duration: prefersReducedMotion() ? 0 : 180 }}
		>
			<div class="nt-grip"></div>
			<div class="nt-mmenu-head">
				<b>{noteTitle(target)}</b>
				<small>{formatNoteDate(target.updatedAt)}</small>
			</div>
			<button role="menuitem" class="nt-mrow" onclick={() => void openRename(target)}><Pencil size={17} /> Renomear</button>
			<button role="menuitem" class="nt-mrow" onclick={() => duplicate(target)}><Copy size={17} /> Duplicar</button>
			<button role="menuitem" class="nt-mrow" onclick={() => void exportNote(target)}><Download size={17} /> Exportar .md</button>
			<button role="menuitem" class="nt-mrow" onclick={() => void copyLink(target)}><Link2 size={17} /> Copiar link</button>
			<button role="menuitem" class="nt-mrow danger" onclick={() => requestDelete(target)}><Trash2 size={17} /> Excluir nota</button>
		</div>
	{:else}
		<div
			class="nt-menu"
			role="menu"
			style={`left:${menuState.x}px; top:${menuState.y}px; --nt-tint:${(target.folderId && folders.find((f) => f.id === target.folderId)?.color) || '#8d968a'}`}
		>
			<button role="menuitem" onclick={() => void openRename(target)}><Pencil size={15} /> Renomear</button>
			<button role="menuitem" onclick={() => duplicate(target)}><Copy size={15} /> Duplicar</button>
			<button role="menuitem" onclick={() => void exportNote(target)}><Download size={15} /> Exportar .md</button>
			<button role="menuitem" onclick={() => void copyLink(target)}><Link2 size={15} /> Copiar link</button>
			<button class="danger" role="menuitem" onclick={() => requestDelete(target)}><Trash2 size={15} /> Excluir nota</button>
		</div>
	{/if}
{/if}

{#if renameState}
	<div class="nt-ov on nt-ov-fly" role="presentation" transition:fade={{ duration: prefersReducedMotion() ? 0 : 150 }} onclick={closeRename}></div>
	<div
		class="nt-sh on nt-rename nt-sh-fly"
		role="dialog"
		aria-modal="true"
		aria-label="Renomear nota"
		in:fly={{ y: 120, duration: prefersReducedMotion() ? 0 : 300 }}
		out:fly={{ y: 120, duration: prefersReducedMotion() ? 0 : 180 }}
	>
		<div class="nt-grip"></div>
		<input
			class="nt-inp"
			aria-label="Novo título"
			maxlength="60"
			bind:value={renameState.value}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					confirmRename();
				}
			}}
		/>
		<button class="nt-btn" onclick={confirmRename}>Salvar</button>
		<button class="nt-btn ghost" onclick={closeRename}>Cancelar</button>
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
			onmode={(mode) => {
				if (!editorNote) return;
				editorMode = mode;
				const updated = { ...editorNote, lastMode: mode };
				editorNote = updated;
				notes = notes.map((item) => (item.id === updated.id ? updated : item));
				void persist(updated);
				publish();
			}}
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
			onopenbacklink={(note) => openNote(note)}
			{ontoast}
		/>
	{/key}
{/if}

{#if confirmState}
	<div class="nt-ov on nt-ov-fly" role="presentation" transition:fade={{ duration: prefersReducedMotion() ? 0 : 150 }} onclick={closeConfirm}></div>
	<div
		class="nt-sh on nt-sh-fly"
		role="dialog"
		aria-modal="true"
		aria-label="Confirmação"
		in:fly={{ y: 120, duration: prefersReducedMotion() ? 0 : 300 }}
		out:fly={{ y: 120, duration: prefersReducedMotion() ? 0 : 180 }}
	>
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
