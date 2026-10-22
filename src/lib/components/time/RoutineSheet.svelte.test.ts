import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { defaultCategories } from '#lib/atlas';
import RoutineSheet from './RoutineSheet.svelte';

const CATEGORIES = defaultCategories().filter((category) => category.module === 'time');

function setup(overrides: Record<string, unknown> = {}) {
	const onsave = vi.fn();
	render(RoutineSheet, {
		props: {
			routine: { revision: '', blocks: [] },
			categories: CATEGORIES,
			windowStart: 7,
			windowEnd: 22,
			firstDay: 'mon',
			onclose: vi.fn(),
			onsave,
			...overrides
		}
	});
	return { onsave };
}

describe('RoutineSheet', () => {
	it('agrupa células vizinhas da mesma categoria num bloco', async () => {
		const { onsave } = setup();

		await fireEvent.click(screen.getByRole('button', { name: /Seg 09:00/ }));
		await fireEvent.click(screen.getByRole('button', { name: /Seg 09:30/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Salvar rotina' }));

		expect(onsave).toHaveBeenCalledTimes(1);
		expect(onsave.mock.calls[0][0]).toEqual([
			{
				id: expect.any(String),
				title: CATEGORIES.find((category) => category.id === 'deep-work')?.name,
				categoryId: 'deep-work',
				weekday: 1,
				startMinutes: 540,
				durationMinutes: 60
			}
		]);
	});

	it('remove o bloco ao tocar de novo e salva vazio', async () => {
		const { onsave } = setup();

		const cell = screen.getByRole('button', { name: /Seg 10:00/ });
		await fireEvent.click(cell);
		await fireEvent.click(screen.getByRole('button', { name: /Seg 10:00/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Salvar rotina' }));

		expect(onsave).toHaveBeenCalledWith([]);
	});

	it('mantém blocos fora da janela ao salvar', async () => {
		const { onsave } = setup({
			routine: {
				revision: 'r1',
				blocks: [
					{ id: 'a', title: 'Foco profundo', categoryId: 'deep-work', weekday: 1, startMinutes: 23 * 60, durationMinutes: 30 }
				]
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Salvar rotina' }));

		expect(onsave.mock.calls[0][0][0]).toMatchObject({ startMinutes: 23 * 60, durationMinutes: 30 });
	});
});
