import { describe, expect, it } from 'vitest';
import { notePreview, stripTempoRefs } from './note-preview';

describe('stripTempoRefs', () => {
	it('remove a referência tempo/time do texto', () => {
		expect(stripTempoRefs('Foco tempo 16/10 17h-20h e depois descanso')).toBe('Foco  e depois descanso');
		expect(stripTempoRefs('Reunião time 17/10 09:00-10:00')).toBe('Reunião ');
	});
});

describe('notePreview', () => {
	it('não mostra a tag tempo', () => {
		expect(notePreview('# Foco\n\ntempo 16/10 17h-20h\nRever o plano')).toBe('Foco\nRever o plano');
	});

	it('preserva quebras de linha entre as primeiras linhas úteis', () => {
		expect(notePreview('Linha um\nLinha dois\nLinha três\nLinha quatro')).toBe('Linha um\nLinha dois\nLinha três');
	});

	it('remove markdown e linhas vazias', () => {
		expect(notePreview('## Título\n\n- item\n> citação')).toBe('Título\nitem\ncitação');
	});

	it('limita a quantidade de linhas e caracteres', () => {
		expect(notePreview('a\nb\nc\nd', undefined, { maxLines: 2 })).toBe('a\nb');
		expect(notePreview('a'.repeat(200), undefined, { maxChars: 10 })).toHaveLength(10);
	});
});
