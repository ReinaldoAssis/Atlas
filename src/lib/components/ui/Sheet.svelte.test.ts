import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Sheet from './Sheet.svelte';

function setup(onclose = vi.fn()) {
	const result = render(Sheet, { props: { title: 'Configurações', closeLabel: 'Fechar', onclose } });
	return { ...result, onclose };
}

describe('Sheet', () => {
	it('abre como diálogo modal com nome acessível', () => {
		setup();
		const dialog = screen.getByRole('dialog', { name: 'Configurações' });
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
	});

	it('fecha com Esc', async () => {
		const { onclose } = setup();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('fecha ao tocar o fundo, mas não ao tocar no conteúdo', async () => {
		const { onclose, container } = setup();
		const backdrop = container.querySelector('.backdrop') as HTMLElement;
		const sheet = container.querySelector('.sheet') as HTMLElement;

		await fireEvent.click(sheet);
		expect(onclose).not.toHaveBeenCalled();

		await fireEvent.click(backdrop);
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('move o foco para dentro do sheet e o devolve ao fechar', async () => {
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		outside.focus();

		const view = render(Sheet, {
			props: { title: 'Configurações', closeLabel: 'Fechar', onclose: vi.fn() }
		});
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar' }));

		view.unmount();
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});

	it('prende o Tab no último elemento focável', async () => {
		const { container } = setup();
		const close = screen.getByRole('button', { name: 'Fechar' });
		close.focus();

		await fireEvent.keyDown(container.querySelector('.sheet') as HTMLElement, { key: 'Tab' });

		expect(document.activeElement).toBe(close);
	});
});
