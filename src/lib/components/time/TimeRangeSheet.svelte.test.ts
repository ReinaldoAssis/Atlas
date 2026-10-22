import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TimeRangeSheet from './TimeRangeSheet.svelte';

describe('TimeRangeSheet', () => {
	function day(number: number, month = 'outubro'): HTMLElement {
		const button = screen
			.getAllByRole('button')
			.find((item) => item.getAttribute('aria-label')?.includes(`, ${number} de ${month} de 2026`));
		if (!button) throw new Error(`dia ${number} de ${month} não encontrado`);
		return button;
	}

	it('aplica no segundo toque', async () => {
		const onapply = vi.fn();
		render(TimeRangeSheet, {
			props: { start: '2026-10-14', end: '2026-10-20', onapply, onclose: vi.fn() }
		});

		await fireEvent.click(day(5));
		await fireEvent.click(day(11));

		expect(onapply).toHaveBeenCalledWith('2026-10-05', '2026-10-11');
	});

	it('corta em 14 dias e pede confirmação', async () => {
		const onapply = vi.fn();
		render(TimeRangeSheet, {
			props: { start: '2026-10-14', end: '2026-10-20', onapply, onclose: vi.fn() }
		});

		await fireEvent.click(day(1));
		await fireEvent.click(day(31));

		expect(onapply).not.toHaveBeenCalled();
		expect(screen.getByText(/Máximo de 14 dias/)).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
		expect(onapply).toHaveBeenCalledWith('2026-10-01', '2026-10-14');
	});

	it('atalho de 7 dias centrados aplica na hora', async () => {
		const onapply = vi.fn();
		render(TimeRangeSheet, {
			props: { start: '2026-10-14', end: '2026-10-20', onapply, onclose: vi.fn() }
		});
		await fireEvent.click(screen.getByRole('button', { name: '7 dias centrados' }));
		expect(onapply).toHaveBeenCalledTimes(1);
		const [start, end] = onapply.mock.calls[0];
		expect(start < end).toBe(true);
	});

	it('configura a janela de horas e mantém o mínimo de 4 horas', async () => {
		const onwindow = vi.fn();
		render(TimeRangeSheet, {
			props: {
				start: '2026-10-14',
				end: '2026-10-20',
				windowStart: 7,
				windowEnd: 22,
				onwindow,
				onapply: vi.fn(),
				onclose: vi.fn()
			}
		});

		const [startSelect, endSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
		await fireEvent.change(startSelect, { target: { value: '20' } });
		expect(onwindow).toHaveBeenLastCalledWith(20, 23);

		await fireEvent.change(endSelect, { target: { value: '8' } });
		expect(onwindow).toHaveBeenLastCalledWith(5, 8);
	});
});
