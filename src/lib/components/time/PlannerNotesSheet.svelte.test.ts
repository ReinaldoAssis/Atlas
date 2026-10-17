import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '#lib/notes';
import PlannerNotesSheet from './PlannerNotesSheet.svelte';

describe('PlannerNotesSheet', () => {
	it('agrega as notas visíveis e abre a escolhida', async () => {
		const first = createNote(null, 'Ideia');
		const second = createNote(null, 'Compras');
		const onopen = vi.fn();
		render(PlannerNotesSheet, {
			props: {
				items: [
					{ note: first, label: '17/10 09:00', color: '#d4f25a' },
					{ note: second, label: '17/10 10:00', color: '#9cc8ff' }
				],
				onopen,
				onclose: vi.fn()
			}
		});

		expect(screen.getByRole('dialog', { name: 'Notas do planejador' })).toBeTruthy();
		expect(screen.getByText('Ideia')).toBeTruthy();
		expect(screen.getByText('Compras')).toBeTruthy();

		await fireEvent.click(screen.getByText('Compras'));
		expect(onopen).toHaveBeenCalledWith(second);
	});
});
