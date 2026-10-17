import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CardMenu from './CardMenu.svelte';

describe('CardMenu', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('executa a ação antes de fechar, para o chamador ainda ler seu estado', async () => {
		const action = vi.fn();
		const onclose = vi.fn();
		render(CardMenu, {
			props: { x: 10, y: 10, items: [{ label: 'Editar', action }], onclose }
		});

		await fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));

		expect(action).toHaveBeenCalledTimes(1);
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(action.mock.invocationCallOrder[0]).toBeLessThan(onclose.mock.invocationCallOrder[0]);
	});

	it('ignora o clique que solta o long-press e fecha em um toque posterior', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		const onclose = vi.fn();
		const { container } = render(CardMenu, {
			props: { x: 10, y: 10, items: [], onclose }
		});

		vi.setSystemTime(new Date(100));
		await fireEvent.click(container.querySelector('.cm-ov') as HTMLElement);
		expect(onclose).not.toHaveBeenCalled();

		vi.setSystemTime(new Date(500));
		await fireEvent.click(container.querySelector('.cm-ov') as HTMLElement);
		expect(onclose).toHaveBeenCalledTimes(1);
	});
});
