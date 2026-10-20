/** Exportação de uma nota em Markdown pelo save/picker do sistema. */
import { saveBytes, type SaveResult } from './backup-io';
import { noteExportFileName, noteMarkdown, type Note } from './notes';

export function noteMarkdownBytes(note: Pick<Note, 'title' | 'body' | 'tags'>): Uint8Array {
	return new TextEncoder().encode(noteMarkdown(note.title, note.body, note.tags));
}

export function saveNoteMarkdown(note: Pick<Note, 'title' | 'body' | 'tags'>): Promise<SaveResult> {
	return saveBytes(noteMarkdownBytes(note), noteExportFileName(note.title), [
		{ name: 'Nota do Atlas', extensions: ['md'] }
	]);
}
