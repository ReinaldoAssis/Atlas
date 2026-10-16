// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decorateTempoRefs } from './tempo-ref';

describe('decorateTempoRefs', () => {
	it('marca a referência e preserva o texto ao redor', () => {
		const root = document.createElement('div');
		root.innerHTML = '<p>treino tempo 16/10 17h-20h e pronto</p>';
		const created = decorateTempoRefs(root, '2026-11-03T10:00:00');
		expect(created).toHaveLength(1);
		expect(created[0].className).toBe('tp-ref');
		expect(created[0].textContent).toBe('tempo 16/10 17h-20h');
		expect(created[0].dataset.tpFrom).toBe('2026-10-16T17:00');
		expect(created[0].dataset.tpTo).toBe('2026-10-16T20:00');
		expect(root.textContent).toBe('treino tempo 16/10 17h-20h e pronto');
	});

	it('marca o dia inteiro', () => {
		const root = document.createElement('div');
		root.innerHTML = '<p>tempo 16/10</p>';
		const created = decorateTempoRefs(root, '2026-11-03T10:00:00');
		expect(created[0].dataset.tpAllDay).toBe('1');
	});

	it('não mexe em código nem em links', () => {
		const root = document.createElement('div');
		root.innerHTML =
			'<pre><code>tempo 16/10</code></pre><p><a href="#">tempo 16/10</a></p><p>texto tempo 16/10</p>';
		const created = decorateTempoRefs(root, '2026-11-03T10:00:00');
		expect(created).toHaveLength(1);
		expect(root.querySelector('code')?.textContent).toBe('tempo 16/10');
		expect(root.querySelector('a')?.textContent).toBe('tempo 16/10');
	});

	it('marca várias referências no mesmo texto', () => {
		const root = document.createElement('div');
		root.innerHTML = '<p>tempo 16/10 17h-20h, time 18/10 09h</p>';
		const created = decorateTempoRefs(root, '2026-11-03T10:00:00');
		expect(created).toHaveLength(2);
		expect(created.map((span) => span.textContent)).toEqual(['tempo 16/10 17h-20h', 'time 18/10 09h']);
	});
});
