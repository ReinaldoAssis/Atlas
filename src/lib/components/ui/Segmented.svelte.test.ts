import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Segmented from './Segmented.svelte';

const OPTIONS = [
	{ value: 'finance', label: 'Finanças' },
	{ value: 'time', label: 'Tempo' }
];

describe('Segmented', () => {
	it('marca apenas a opção ativa como checada', () => {
		render(Segmented, { props: { label: 'Módulo', options: OPTIONS, value: 'time' } });

		expect(screen.getByRole('radio', { name: 'Finanças' }).getAttribute('aria-checked')).toBe('false');
		expect(screen.getByRole('radio', { name: 'Tempo' }).getAttribute('aria-checked')).toBe('true');
	});

	it('troca de opção e avisa o chamador', async () => {
		const onchange = vi.fn();
		render(Segmented, { props: { label: 'Módulo', options: OPTIONS, value: 'finance', onchange } });

		await fireEvent.click(screen.getByRole('radio', { name: 'Tempo' }));

		expect(onchange).toHaveBeenCalledWith('time');
		expect(screen.getByRole('radio', { name: 'Tempo' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('radio', { name: 'Finanças' }).getAttribute('aria-checked')).toBe('false');
	});

	it('posiciona a pílula no índice da opção ativa', () => {
		const { container } = render(Segmented, {
			props: { label: 'Módulo', options: OPTIONS, value: 'time' }
		});

		expect(container.querySelector('.segmented')?.getAttribute('style')).toMatch(/--i:\s*1/);
	});

	it('não dispara de novo ao tocar na opção já ativa', async () => {
		const onchange = vi.fn();
		render(Segmented, { props: { label: 'Módulo', options: OPTIONS, value: 'finance', onchange } });

		await fireEvent.click(screen.getByRole('radio', { name: 'Finanças' }));

		expect(onchange).not.toHaveBeenCalled();
	});
});
