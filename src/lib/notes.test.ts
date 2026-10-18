import { describe, expect, it } from 'vitest';
import { noteExportFileName, noteMarkdown } from './notes';

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
