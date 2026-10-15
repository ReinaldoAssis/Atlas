/**
 * Store próprio das Notas.
 *
 * Separado do `saveSnapshot` (que apaga e reinsere o snapshot inteiro a cada
 * commit): aqui cada nota é gravada por upsert, o que mantém o autosave barato.
 * O mesmo arquivo SQLite (`atlas.db`) é compartilhado via `getDatabase`.
 */
import { isTauri } from '@tauri-apps/api/core';
import { BaseDirectory, mkdir, readDir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { getDatabase } from './storage';
import {
	normalizeFolder,
	normalizeNote,
	normalizeNotesState,
	searchTerms,
	type Note,
	type NoteFolder,
	type NotesState
} from './notes';

const PREVIEW_KEY = 'atlas-preview-notes-v1';
const ATTACHMENTS_ROOT = 'attachments';

let schemaReady: Promise<boolean> | undefined;

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

async function ensureSchema(): Promise<boolean> {
	if (!schemaReady) schemaReady = setupSchema().catch(() => false);
	return schemaReady;
}

async function setupSchema(): Promise<boolean> {
	const db = await getDatabase();
	await db.execute(`CREATE TABLE IF NOT EXISTS folders (
		id TEXT PRIMARY KEY,
		parent_id TEXT,
		name TEXT NOT NULL,
		position INTEGER NOT NULL DEFAULT 0,
		payload TEXT NOT NULL
	)`);
	await db.execute(`CREATE TABLE IF NOT EXISTS notes (
		id TEXT PRIMARY KEY,
		folder_id TEXT,
		title TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		pinned INTEGER NOT NULL DEFAULT 0,
		payload TEXT NOT NULL
	)`);
	await db.execute('CREATE INDEX IF NOT EXISTS notes_by_folder ON notes(folder_id)');
	await db.execute('CREATE INDEX IF NOT EXISTS notes_by_updated ON notes(updated_at)');
	let fts = false;
	try {
		// Smoke test: o FTS5 pode não estar compilado no SQLite empacotado.
		await db.execute(
			`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
				note_id UNINDEXED, title, body, tags, tokenize = 'unicode61 remove_diacritics 2'
			)`
		);
		fts = true;
	} catch {
		fts = false;
	}
	return fts;
}

/* ------------------------------------------------------------------ */
/* Preview (navegador, sem Tauri)                                      */
/* ------------------------------------------------------------------ */

function readPreview(): NotesState {
	const raw = localStorage.getItem(PREVIEW_KEY);
	if (!raw) return { notes: [], folders: [] };
	try {
		return normalizeNotesState(JSON.parse(raw));
	} catch {
		return { notes: [], folders: [] };
	}
}

function writePreview(state: NotesState): void {
	localStorage.setItem(PREVIEW_KEY, JSON.stringify(state));
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export async function loadNotes(): Promise<NotesState> {
	if (!isTauri()) return readPreview();
	const fts = await ensureSchema();
	void fts;
	const db = await getDatabase();
	const [noteRows, folderRows] = await Promise.all([
		db.select<Array<{ payload: string }>>('SELECT payload FROM notes ORDER BY pinned DESC, updated_at DESC'),
		db.select<Array<{ payload: string }>>('SELECT payload FROM folders ORDER BY position ASC')
	]);
	return {
		notes: noteRows.map((row) => normalizeNote(JSON.parse(row.payload))),
		folders: folderRows.map((row) => normalizeFolder(JSON.parse(row.payload)))
	};
}

/** Substitui todo o acervo de notas/pastas (import de backup). */
export async function replaceNotesState(state: NotesState): Promise<void> {
	if (!isTauri()) {
		writePreview(state);
		return;
	}
	const fts = await ensureSchema();
	const db = await getDatabase();
	await db.execute('DELETE FROM notes');
	await db.execute('DELETE FROM folders');
	if (fts) await db.execute('DELETE FROM notes_fts');
	for (const folder of state.folders) await upsertFolder(folder);
	for (const note of state.notes) await upsertNote(note);
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

export async function upsertNote(note: Note): Promise<void> {
	if (!isTauri()) {
		const state = readPreview();
		const index = state.notes.findIndex((item) => item.id === note.id);
		if (index >= 0) state.notes[index] = note;
		else state.notes.push(note);
		writePreview(state);
		return;
	}
	const fts = await ensureSchema();
	const db = await getDatabase();
	await db.execute(
		`INSERT INTO notes (id, folder_id, title, created_at, updated_at, pinned, payload)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT(id) DO UPDATE SET
			folder_id = excluded.folder_id,
			title = excluded.title,
			updated_at = excluded.updated_at,
			pinned = excluded.pinned,
			payload = excluded.payload`,
		[note.id, note.folderId, note.title, note.createdAt, note.updatedAt, note.pinned ? 1 : 0, JSON.stringify(note)]
	);
	if (fts) {
		await db.execute('DELETE FROM notes_fts WHERE note_id = $1', [note.id]);
		await db.execute('INSERT INTO notes_fts (note_id, title, body, tags) VALUES ($1, $2, $3, $4)', [
			note.id,
			note.title,
			note.body,
			note.tags.join(' ')
		]);
	}
}

export async function deleteNote(noteId: string): Promise<void> {
	if (!isTauri()) {
		const state = readPreview();
		state.notes = state.notes.filter((note) => note.id !== noteId);
		writePreview(state);
		return;
	}
	const fts = await ensureSchema();
	const db = await getDatabase();
	await db.execute('DELETE FROM notes WHERE id = $1', [noteId]);
	if (fts) await db.execute('DELETE FROM notes_fts WHERE note_id = $1', [noteId]);
	await deleteNoteAttachments(noteId);
}

export async function upsertFolder(folder: NoteFolder): Promise<void> {
	if (!isTauri()) {
		const state = readPreview();
		const index = state.folders.findIndex((item) => item.id === folder.id);
		if (index >= 0) state.folders[index] = folder;
		else state.folders.push(folder);
		writePreview(state);
		return;
	}
	await ensureSchema();
	const db = await getDatabase();
	await db.execute(
		`INSERT INTO folders (id, parent_id, name, position, payload)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT(id) DO UPDATE SET
			parent_id = excluded.parent_id,
			name = excluded.name,
			position = excluded.position,
			payload = excluded.payload`,
		[folder.id, folder.parentId, folder.name, folder.position, JSON.stringify(folder)]
	);
}

export async function deleteFolders(folderIds: string[]): Promise<void> {
	if (!folderIds.length) return;
	if (!isTauri()) {
		const state = readPreview();
		state.folders = state.folders.filter((folder) => !folderIds.includes(folder.id));
		state.notes = state.notes.filter((note) => !note.folderId || !folderIds.includes(note.folderId));
		writePreview(state);
		return;
	}
	await ensureSchema();
	const db = await getDatabase();
	for (const folderId of folderIds) {
		await db.execute('DELETE FROM folders WHERE id = $1', [folderId]);
	}
	// Remove em cascata as notas das pastas excluídas (e seus anexos).
	const state = await loadNotes();
	const doomed = state.notes.filter((note) => note.folderId && folderIds.includes(note.folderId));
	for (const note of doomed) await deleteNote(note.id);
}

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

/**
 * Busca por id. Retorna `null` quando o FTS5 não está disponível,
 * sinalizando ao chamador para filtrar em memória.
 */
export async function searchNotes(query: string): Promise<string[] | null> {
	const terms = searchTerms(query);
	if (!terms.length) return [];
	if (!isTauri()) return null;
	const fts = await ensureSchema();
	if (!fts) return null;
	const db = await getDatabase();
	const match = terms.map((term) => `"${term.replace(/["*]/g, '')}"*`).join(' ');
	try {
		const rows = await db.select<Array<{ note_id: string }>>(
			'SELECT note_id FROM notes_fts WHERE notes_fts MATCH $1',
			[match]
		);
		return rows.map((row) => row.note_id);
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ */
/* Anexos (somente Tauri)                                              */
/* ------------------------------------------------------------------ */

export const attachmentsEnabled = (): boolean => isTauri();

function attachmentDir(noteId: string): string {
	return `${ATTACHMENTS_ROOT}/${noteId}`;
}

function attachmentPath(noteId: string, name: string): string {
	return `${attachmentDir(noteId)}/${name}`;
}

function safeAttachmentName(name: string): string {
	return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(0, 120) || 'arquivo';
}

export async function saveAttachment(noteId: string, file: File): Promise<string> {
	if (!isTauri()) throw new Error('Anexos indisponíveis no navegador.');
	await mkdir(attachmentDir(noteId), { baseDir: BaseDirectory.AppData, recursive: true });
	const name = safeAttachmentName(file.name);
	const bytes = new Uint8Array(await file.arrayBuffer());
	await writeFile(attachmentPath(noteId, name), bytes, { baseDir: BaseDirectory.AppData });
	return `${ATTACHMENTS_ROOT}/${noteId}/${name}`;
}

export async function listAttachments(noteId: string): Promise<string[]> {
	if (!isTauri()) return [];
	try {
		const entries = await readDir(attachmentDir(noteId), { baseDir: BaseDirectory.AppData });
		return entries.filter((entry) => entry.isFile).map((entry) => entry.name);
	} catch {
		return [];
	}
}

export async function readAttachment(noteId: string, name: string): Promise<Uint8Array | null> {
	if (!isTauri()) return null;
	try {
		return await readFile(attachmentPath(noteId, name), { baseDir: BaseDirectory.AppData });
	} catch {
		return null;
	}
}

export async function deleteAttachment(noteId: string, name: string): Promise<void> {
	if (!isTauri()) return;
	try {
		await remove(attachmentPath(noteId, name), { baseDir: BaseDirectory.AppData });
	} catch {
		/* Já ausente. */
	}
}

export async function deleteNoteAttachments(noteId: string): Promise<void> {
	if (!isTauri()) return;
	try {
		await remove(attachmentDir(noteId), { baseDir: BaseDirectory.AppData, recursive: true });
	} catch {
		/* Não existir é um estado válido. */
	}
}

export interface BackupAttachment {
	noteId: string;
	name: string;
	bytes: Uint8Array;
}

/** Lê todos os anexos do disco para empacotar num backup. */
export async function collectAttachments(): Promise<BackupAttachment[]> {
	if (!isTauri()) return [];
	try {
		const folders = await readDir(ATTACHMENTS_ROOT, { baseDir: BaseDirectory.AppData });
		const result: BackupAttachment[] = [];
		for (const folder of folders) {
			if (!folder.isDirectory) continue;
			const names = await listAttachments(folder.name);
			for (const name of names) {
				const bytes = await readAttachment(folder.name, name);
				if (bytes) result.push({ noteId: folder.name, name, bytes });
			}
		}
		return result;
	} catch {
		return [];
	}
}

/** Restaura anexos a partir de um backup. */
export async function restoreAttachments(files: BackupAttachment[]): Promise<void> {
	if (!isTauri() || !files.length) return;
	for (const file of files) {
		await mkdir(attachmentDir(file.noteId), { baseDir: BaseDirectory.AppData, recursive: true });
		await writeFile(attachmentPath(file.noteId, file.name), file.bytes, { baseDir: BaseDirectory.AppData });
	}
}
