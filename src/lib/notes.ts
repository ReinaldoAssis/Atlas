/**
 * Módulo de Notas — tipos e helpers puros.
 *
 * Notas são independentes na Fase 1, mas o modelo já nasce preparado para
 * receber links grafo↔nota depois (`id` estável + `folderId`). Wiki-links
 * `[[Título]]` ligam notas entre si dentro do módulo.
 */

export interface Note {
	id: string;
	folderId: string | null;
	title: string;
	body: string;
	tags: string[];
	pinned: boolean;
	createdAt: string;
	updatedAt: string;
	/** Quando a nota foi para a lixeira (ISO) ou null se ativa. */
	trashedAt: string | null;
}

export interface NoteFolder {
	id: string;
	parentId: string | null;
	name: string;
	color: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}

export interface NotesState {
	notes: Note[];
	folders: NoteFolder[];
}

export type NoteSort = 'updated' | 'created' | 'title';

/** Paleta das pastas/tags, alinhada ao restante do Atlas. */
export const NOTE_COLORS = ['#d4f25a', '#9cc8ff', '#ffb347', '#c6a8ff', '#f1a5c5', '#7fe3c4'];

export function hashColor(seed: string): string {
	let sum = 0;
	for (const character of seed) sum += character.charCodeAt(0);
	return NOTE_COLORS[Math.abs(sum) % NOTE_COLORS.length];
}

export const tagColor = hashColor;

export function noteId(): string {
	return crypto.randomUUID();
}

export function createNote(folderIdValue: string | null = null, title = ''): Note {
	const now = new Date().toISOString();
	return {
		id: noteId(),
		folderId: folderIdValue,
		title,
		body: title ? `# ${title}\n\n` : '',
		tags: [],
		pinned: false,
		createdAt: now,
		updatedAt: now,
		trashedAt: null
	};
}

/** Dias que uma nota permanece na lixeira antes de ser apagada em definitivo. */
export const TRASH_RETENTION_DAYS = 30;

export function createFolder(
	parentId: string | null = null,
	name = 'Nova pasta',
	position = 0,
	color = NOTE_COLORS[0]
): NoteFolder {
	const now = new Date().toISOString();
	return { id: noteId(), parentId, name, color, position, createdAt: now, updatedAt: now };
}

export function emptyNotesState(): NotesState {
	return { notes: [], folders: [] };
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string');
}

export function normalizeNote(raw: unknown): Note {
	const source = (raw ?? {}) as Partial<Note>;
	const now = new Date().toISOString();
	return {
		id: asString(source.id) || noteId(),
		folderId: typeof source.folderId === 'string' ? source.folderId : null,
		title: asString(source.title),
		body: asString(source.body),
		tags: asStringArray(source.tags),
		pinned: Boolean(source.pinned),
		createdAt: asString(source.createdAt, now),
		updatedAt: asString(source.updatedAt, now),
		trashedAt: typeof source.trashedAt === 'string' ? source.trashedAt : null
	};
}

export function normalizeFolder(raw: unknown): NoteFolder {
	const source = (raw ?? {}) as Partial<NoteFolder>;
	const now = new Date().toISOString();
	const name = asString(source.name, 'Pasta');
	return {
		id: asString(source.id) || noteId(),
		parentId: typeof source.parentId === 'string' ? source.parentId : null,
		name,
		color: asString(source.color) || hashColor(name),
		position: typeof source.position === 'number' ? source.position : 0,
		createdAt: asString(source.createdAt, now),
		updatedAt: asString(source.updatedAt, now)
	};
}

export function normalizeNotesState(raw: unknown): NotesState {
	const source = (raw ?? {}) as Partial<NotesState>;
	return {
		notes: Array.isArray(source.notes) ? source.notes.map(normalizeNote) : [],
		folders: Array.isArray(source.folders) ? source.folders.map(normalizeFolder) : []
	};
}

/** Título exibido: título explícito ou primeira linha não vazia do corpo. */
export function noteTitle(note: Note): string {
	const titled = note.title.trim();
	if (titled) return titled;
	const firstLine = note.body.split('\n').find((line) => line.trim().length > 0) ?? '';
	const cleaned = firstLine.replace(/^#{1,6}\s*/, '').replace(/[*_`>#-]/g, ' ').trim();
	return cleaned || 'Sem título';
}

/** Trecho do corpo: primeira linha que não é título, sem marcações. */
export function noteExcerpt(note: Note): string {
	const line = note.body
		.split('\n')
		.map((item) => item.trim())
		.find((item) => item && !item.startsWith('#')) ?? '';
	return line.replace(/[*`>\[\]]/g, '').replace(/^\s*\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
}

export function sortNotes(notes: Note[], sort: NoteSort = 'updated'): Note[] {
	const sorted = [...notes];
	sorted.sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		if (sort === 'title') return noteTitle(a).localeCompare(noteTitle(b), 'pt-BR');
		if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
		return b.updatedAt.localeCompare(a.updatedAt);
	});
	return sorted;
}

/** Filhos diretos de uma pasta (ou raiz quando `parentId` é null). */
export function childFolders(folders: NoteFolder[], parentId: string | null): NoteFolder[] {
	return folders
		.filter((folder) => (folder.parentId ?? null) === parentId)
		.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
}

export const foldersByParent = childFolders;

/** Notas diretamente em uma pasta (ou raiz). */
export function notesInFolder(notes: Note[], folderId: string | null): Note[] {
	return notes.filter((note) => (note.folderId ?? null) === folderId);
}

/** IDs de uma pasta e de todas as subpastas (para contagem/exclusão em cascata). */
export function descendantFolderIds(folders: NoteFolder[], rootId: string): string[] {
	const result: string[] = [];
	const queue = [rootId];
	while (queue.length) {
		const current = queue.shift() as string;
		result.push(current);
		for (const folder of folders) {
			if (folder.parentId === current) queue.push(folder.id);
		}
	}
	return result;
}

/** Quantas notas existem na pasta e nas subpastas. */
export function folderTotalCount(notes: Note[], folders: NoteFolder[], folderId: string): number {
	const ids = descendantFolderIds(folders, folderId);
	return notes.filter((note) => note.folderId && ids.includes(note.folderId)).length;
}

export function isDescendant(folders: NoteFolder[], candidateId: string, ancestorId: string): boolean {
	return descendantFolderIds(folders, ancestorId).includes(candidateId);
}

/** Caminho legível de uma pasta (raiz → pasta). */
export function folderPath(folders: NoteFolder[], id: string | null): NoteFolder[] {
	if (!id) return [];
	const path: NoteFolder[] = [];
	let cursor = folders.find((folder) => folder.id === id);
	let guard = 0;
	while (cursor && guard < 64) {
		path.unshift(cursor);
		cursor = cursor.parentId ? folders.find((folder) => folder.id === cursor?.parentId) : undefined;
		guard += 1;
	}
	return path;
}

export function allTags(notes: Note[]): { tag: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const note of notes) for (const tag of note.tags) if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR'));
}

export function normalizeTag(value: string): string {
	return value
		.trim()
		.replace(/^#+/, '')
		.replace(/\s+/g, '-')
		.toLowerCase();
}

export function normalizeTags(values: string[]): string[] {
	const set = new Set<string>();
	for (const value of values) {
		const tag = normalizeTag(value);
		if (tag) set.add(tag);
	}
	return [...set];
}

/** Notas que citam `[[Título]]` desta nota. */
export function backlinks(notes: Note[], note: Note): Note[] {
	const target = deaccent(noteTitle(note)).toLowerCase();
	const needle = `[[${target}]]`;
	return notes.filter((item) => item.id !== note.id && deaccent(item.body).toLowerCase().includes(needle));
}

export function findNoteByTitle(notes: Note[], title: string): Note | undefined {
	const target = deaccent(title).toLowerCase();
	return notes.find((note) => {
		if (deaccent(noteTitle(note)).toLowerCase() === target) return true;
		return deaccent(note.body)
			.split('\n')
			.some((line) => deaccent(line).toLowerCase().trim() === `# ${target}`);
	});
}

/** Data relativa curta, no padrão do protótipo (hoje/ontem/dd-mm). */
export function formatNoteDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	const days = Math.floor((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
	if (days <= 0) return 'hoje';
	if (days === 1) return 'ontem';
	return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function deaccent(value: string): string {
	return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function searchTerms(query: string): string[] {
	return deaccent(query)
		.toLowerCase()
		.split(/\s+/)
		.map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ''))
		.filter((term) => term.length > 0);
}

/** Busca local em memória (fallback quando o FTS5 não está disponível). */
export function filterNotesLocally(notes: Note[], query: string): Note[] {
	const terms = searchTerms(query);
	if (!terms.length) return notes;
	return notes.filter((note) => {
		const haystack = deaccent(`${noteTitle(note)} ${note.body} ${note.tags.join(' ')}`).toLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
}

/** Escapa texto para inserção segura em HTML. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"]/g, (character) =>
		character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&quot;'
	);
}

/** Realça os termos da busca no texto (usa `<mark>`). */
export function highlightHtml(text: string, query: string): string {
	const escaped = escapeHtml(text);
	const terms = searchTerms(query);
	if (!terms.length) return escaped;
	const pattern = terms
		.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|');
	try {
		return escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
	} catch {
		return escaped;
	}
}
