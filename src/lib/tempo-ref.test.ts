import { describe, expect, it } from 'vitest';
import { blockIdsForNote, blocksForRef, notesForBlock, parseTempoRefs, refOverlapsBlock } from './tempo-ref';

const NOTE_DATE = '2026-11-03T10:00:00.000Z';

describe('parseTempoRefs', () => {
	it('lê data e intervalo de horas', () => {
		const refs = parseTempoRefs('tempo 16/10 17h-20h', NOTE_DATE);
		expect(refs).toHaveLength(1);
		expect(refs[0]).toMatchObject({
			raw: 'tempo 16/10 17h-20h',
			from: '2026-10-16T17:00',
			to: '2026-10-16T20:00',
			allDay: false
		});
	});

	it('aceita o alias `time`', () => {
		const refs = parseTempoRefs('time 17h', '2026-10-16T09:00:00');
		expect(refs[0]).toMatchObject({ from: '2026-10-16T17:00', to: '2026-10-16T18:00' });
	});

	it('usa o mês da nota quando falta o mês', () => {
		const refs = parseTempoRefs('tempo 20 9h', '2026-10-16T09:00:00');
		expect(refs[0]).toMatchObject({ from: '2026-10-20T09:00', to: '2026-10-20T10:00' });
	});

	it('usa o dia da nota quando falta o dia', () => {
		const refs = parseTempoRefs('tempo 17:30', '2026-10-16T09:00:00');
		expect(refs[0]).toMatchObject({ from: '2026-10-16T17:30', to: '2026-10-16T18:30' });
	});

	it('sem hora, vale o dia inteiro', () => {
		const refs = parseTempoRefs('tempo 16/10', NOTE_DATE);
		expect(refs[0]).toMatchObject({ from: '2026-10-16T00:00', to: '2026-10-16T23:59', allDay: true });
	});

	it('lê hora com minutos (`17h30` e `17:30`)', () => {
		expect(parseTempoRefs('tempo 17h30-19h', '2026-10-16T09:00:00')[0]).toMatchObject({ from: '2026-10-16T17:30', to: '2026-10-16T19:00' });
		expect(parseTempoRefs('tempo 17:30', '2026-10-16T09:00:00')[0]).toMatchObject({ from: '2026-10-16T17:30' });
	});

	it('limita o fim ao dia (23:59)', () => {
		expect(parseTempoRefs('tempo 23h', '2026-10-16T09:00:00')[0]).toMatchObject({ from: '2026-10-16T23:00', to: '2026-10-16T23:59' });
	});

	it('ignora a palavra sem spec', () => {
		expect(parseTempoRefs('tempo de qualidade', NOTE_DATE)).toEqual([]);
		expect(parseTempoRefs('temporal 17h', NOTE_DATE)).toEqual([]);
	});

	it('acha várias referências e preserva os índices', () => {
		const text = 'treino tempo 16/10 17h-20h e depois time 18/10';
		const refs = parseTempoRefs(text, NOTE_DATE);
		expect(refs).toHaveLength(2);
		expect(text.slice(refs[0].start, refs[0].end)).toBe('tempo 16/10 17h-20h');
		expect(text.slice(refs[1].start, refs[1].end)).toBe('time 18/10');
	});
});

describe('cruzamento com os blocos', () => {
	const blocks = [
		{ id: 'a', title: 'Foco', startAt: '2026-10-16T17:00:00', endAt: '2026-10-16T18:00:00' },
		{ id: 'b', title: 'Leitura', startAt: '2026-10-16T19:00:00', endAt: '2026-10-16T20:00:00' },
		{ id: 'c', title: 'Outro dia', startAt: '2026-10-17T17:00:00', endAt: '2026-10-17T18:00:00' }
	];

	it('casa por interseção de intervalo', () => {
		const ref = parseTempoRefs('tempo 16/10 17h-20h', NOTE_DATE)[0];
		expect(blocksForRef(ref, blocks).map((block) => block.id)).toEqual(['a', 'b']);
	});

	it('dia inteiro casa todos os blocos do dia', () => {
		const ref = parseTempoRefs('tempo 16/10', NOTE_DATE)[0];
		expect(blocksForRef(ref, blocks).map((block) => block.id)).toEqual(['a', 'b']);
	});

	it('não casa o que só encosta no fim do intervalo', () => {
		const ref = parseTempoRefs('tempo 16/10 18h-19h', NOTE_DATE)[0];
		expect(refOverlapsBlock(ref, blocks[0])).toBe(false);
		expect(refOverlapsBlock(ref, blocks[1])).toBe(false);
	});

	it('lista as notas de um bloco, mais recentes primeiro', () => {
		const notes = [
			{ id: 'n1', title: 'Antiga', body: 'tempo 16/10 17h-20h', updatedAt: '2026-10-10T10:00:00.000Z' },
			{ id: 'n2', title: 'Nova', body: 'treino time 16/10 17h30', updatedAt: '2026-10-15T10:00:00.000Z' },
			{ id: 'n3', title: 'Fora', body: 'tempo 12/10 09h-10h', updatedAt: '2026-10-16T10:00:00.000Z' }
		];
		const found = notesForBlock(blocks[0], notes);
		expect(found.map((item) => item.note.id)).toEqual(['n2', 'n1']);
	});

	it('indexa os blocos de uma nota', () => {
		const ids = blockIdsForNote({ id: 'n1', title: 'T', body: 'tempo 16/10 17h-20h', updatedAt: NOTE_DATE }, blocks);
		expect([...ids].sort()).toEqual(['a', 'b']);
	});
});
