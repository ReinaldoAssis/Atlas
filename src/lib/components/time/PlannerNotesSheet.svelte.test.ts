import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '#lib/notes';
import PlannerNotesSheet from './PlannerNotesSheet.svelte';

function setup() {
	const first = createNote(null, 'Ideia');
	const second = createNote(null, 'Compras');
	const onopen = vi.fn();
	const onopenfull = vi.fn();
	render(PlannerNotesSheet, {
		props: {
			items: [
				{ note: first, label: '17/10 09:00', color: '#d4f25a' },
				{ note: second, label: '17/10 10:00', color: '#9cc8ff' }
			],
			onopen,
			onopenfull,
			onclose: vi.fn()
		}
	});
	return { first, second, onopen, onopenfull };
}

describe('PlannerNotesSheet', () => {
	it('agrega as notas visíveis e abre a escolhida', async () => {
		const { second, onopen } = setup();

		expect(screen.getByRole('dialog', { name: 'Notas do planejador' })).toBeTruthy();
		expect(screen.getByText('Ideia')).toBeTruthy();
		expect(screen.getByText('Compras')).toBeTruthy();

		await fireEvent.click(screen.getByText('Compras'));
		expect(onopen).toHaveBeenCalledWith(second);
	});

	it('swipe para cima abre a nota inteira e não dispara o preview', async () => {
		const { second, onopen, onopenfull } = setup();
		const row = screen.getByText('Compras').closest('button') as HTMLButtonElement;

		await fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 220 }] });
		await fireEvent.touchMove(row, { touches: [{ clientX: 22, clientY: 160 }] });
		await fireEvent.touchEnd(row, { changedTouches: [{ clientX: 22, clientY: 160 }] });
		await fireEvent.click(row);

		expect(onopenfull).toHaveBeenCalledWith(second);
		expect(onopen).not.toHaveBeenCalled();
	});

	it('swipe curto ou horizontal continua abrindo o preview', async () => {
		const { second, onopen, onopenfull } = setup();
		const row = screen.getByText('Compras').closest('button') as HTMLButtonElement;

		await fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 220 }] });
		await fireEvent.touchMove(row, { touches: [{ clientX: 20, clientY: 200 }] });
		await fireEvent.touchEnd(row, { changedTouches: [{ clientX: 20, clientY: 200 }] });
		await fireEvent.click(row);

		expect(onopenfull).not.toHaveBeenCalled();
		expect(onopen).toHaveBeenCalledWith(second);
	});
});
