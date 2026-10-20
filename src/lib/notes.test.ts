import { describe, expect, it } from 'vitest';
import {
	TRASH_RETENTION_DAYS,
	createNote,
	duplicateNote,
	noteExportFileName,
	noteLink,
	noteMarkdown,
	normalizeNote
} from './notes';

describe('noteMarkdown', () => {
	it('inclui título, corpo e tags', () => {
		const markdown = noteMarkdown('Compras', 'Leite e pão', ['casa', 'mercado']);
		expect(markdown).toContain('# Compras');
		expect(markdown).toContain('Leite e pão');
		expect(markdown).toContain('#casa #mercado');
	});

	it('não duplica o heading quando o corpo já começa com o título', () => {
		const markdown = noteMarkdown('Compras', '# Compras\n\nLeite', []);
		expect(markdown.match(/# Compras/g)).toHaveLength(1);
		expect(markdown).toContain('Leite');
	});

	it('usa "Sem título" quando o título está vazio', () => {
		expect(noteMarkdown('   ', 'Corpo', [])).toContain('# Sem título');
	});

	it('termina com newline', () => {
		expect(noteMarkdown('Nota', 'Corpo', []).endsWith('\n')).toBe(true);
	});
});

describe('noteExportFileName', () => {
	it('gera slug sem acentos e com extensão .md', () => {
		expect(noteExportFileName('Reunião de segunda!')).toBe('reuniao-de-segunda.md');
	});

	it('cai para "nota.md" quando não sobra nada', () => {
		expect(noteExportFileName('...')).toBe('nota.md');
		expect(noteExportFileName('')).toBe('nota.md');
	});

	it('limita o tamanho do nome', () => {
		expect(noteExportFileName('a'.repeat(120)).length).toBeLessThanOrEqual(63);
	});
});

describe('modo e retenção da nota', () => {
	it('nota nova nasce em Editar', () => {
		expect(createNote(null, 'Nova').lastMode).toBe('write');
	});

	it('normaliza nota antiga para Ler', () => {
		expect(normalizeNote({ id: 'n1', title: 'Antiga' }).lastMode).toBe('preview');
		expect(normalizeNote({ id: 'n2', lastMode: 'split' }).lastMode).toBe('split');
	});

	it('lixeira de notas guarda 7 dias', () => {
		expect(TRASH_RETENTION_DAYS).toBe(7);
	});

	it('duplica com id novo, sem lixeira e sem vínculo de conflito', () => {
		const original = { ...createNote('f1', 'Ideia'), trashedAt: '2026-10-01', conflictOf: 'x' };
		const copy = duplicateNote(original);
		expect(copy.id).not.toBe(original.id);
		expect(copy.title).toBe('Ideia (cópia)');
		expect(copy.folderId).toBe('f1');
		expect(copy.trashedAt).toBeNull();
		expect(copy.conflictOf).toBeUndefined();
		expect(copy.body).toBe(original.body);
	});

	it('gera o link wiki pelo título exibido', () => {
		const note = createNote(null, 'Reunião');
		expect(noteLink(note)).toBe('[[Reunião]]');
	});
});
