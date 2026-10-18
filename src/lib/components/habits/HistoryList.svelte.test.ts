import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { localDate, dateOffset } from '#lib/atlas';
import HistoryList from './HistoryList.svelte';

describe('HistoryList', () => {
	it('agrupa por dia e mostra a contagem', () => {
		const today = localDate();
		render(HistoryList, {
			props: {
				groups: [
					{ date: today, rows: [{ id: 'a', value: '30 min' }, { id: 'b', value: '45 min' }] },
					{ date: dateOffset(today, -1), rows: [{ id: 'c', value: '20 min' }] }
				],
				onopen: vi.fn()
			}
		});

		expect(screen.getByText('Hoje')).toBeTruthy();
		expect(screen.getByText('Ontem')).toBeTruthy();
		expect(screen.getByText('2 registros')).toBeTruthy();
		expect(screen.getByText('1 registro')).toBeTruthy();
	});

	it('mostra hora/nota e abre a linha pelo id', async () => {
		const onopen = vi.fn();
		render(HistoryList, {
			props: {
				groups: [
					{
						date: localDate(),
						rows: [{ id: 'entry-1', value: '72,4 kg', meta: '07:30', note: 'em jejum' }]
					}
				],
				onopen
			}
		});

		expect(screen.getByText('07:30')).toBeTruthy();
		expect(screen.getByText('em jejum')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /72,4 kg/ }));
		expect(onopen).toHaveBeenCalledWith('entry-1');
	});

	it('mostra vazio quando não há grupos', () => {
		render(HistoryList, { props: { groups: [], onopen: vi.fn() } });
		expect(screen.getByText('Nenhum registro no período.')).toBeTruthy();
	});
});
