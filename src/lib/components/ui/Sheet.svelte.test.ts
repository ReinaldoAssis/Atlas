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

	it('dispara onpullup ao arrastar a alça para cima', async () => {
		const onpullup = vi.fn();
		const { container } = render(Sheet, {
			props: { title: 'Nota', closeLabel: 'Fechar', onclose: vi.fn(), onpullup }
		});
		const grip = container.querySelector('.grip') as HTMLElement;
		await fireEvent.touchStart(grip, { touches: [{ clientY: 300 }] });
		await fireEvent.touchMove(grip, { touches: [{ clientY: 240 }] });
		await fireEvent.touchEnd(grip, { changedTouches: [{ clientY: 240 }] });
		expect(onpullup).toHaveBeenCalledTimes(1);
	});

	it('dispara onpullup ao arrastar o conteúdo para cima', async () => {
		const onpullup = vi.fn();
		const { container } = render(Sheet, {
			props: { title: 'Nota', closeLabel: 'Fechar', onclose: vi.fn(), onpullup }
		});
		const body = container.querySelector('.body') as HTMLElement;
		await fireEvent.touchStart(body, { touches: [{ clientX: 180, clientY: 500 }] });
		await fireEvent.touchMove(body, { touches: [{ clientX: 180, clientY: 440 }] });
		await fireEvent.touchEnd(body, { changedTouches: [{ clientX: 180, clientY: 440 }] });
		expect(onpullup).toHaveBeenCalledTimes(1);
	});

	it('acompanha o dedo durante o arrasto', async () => {
		const { container } = render(Sheet, {
			props: { title: 'Nota', closeLabel: 'Fechar', onclose: vi.fn(), onpullup: vi.fn() }
		});
		const sheet = container.querySelector('.sheet') as HTMLElement;
		const body = container.querySelector('.body') as HTMLElement;
		await fireEvent.touchStart(body, { touches: [{ clientX: 180, clientY: 500 }] });
		await fireEvent.touchMove(body, { touches: [{ clientX: 180, clientY: 400 }] });
		expect(sheet.style.transform).toContain('translateY(');
	});

	it('não dispara onpullup ao começar num botão', async () => {
		const onpullup = vi.fn();
		render(Sheet, {
			props: { title: 'Nota', closeLabel: 'Fechar', onclose: vi.fn(), onpullup }
		});
		const close = screen.getByRole('button', { name: 'Fechar' });
		await fireEvent.touchStart(close, { touches: [{ clientX: 320, clientY: 60 }] });
		await fireEvent.touchMove(close, { touches: [{ clientX: 320, clientY: 10 }] });
		await fireEvent.touchEnd(close, { changedTouches: [{ clientX: 320, clientY: 10 }] });
		expect(onpullup).not.toHaveBeenCalled();
	});

	it('não dispara onpullup em arrasto curto', async () => {
		const onpullup = vi.fn();
		const { container } = render(Sheet, {
			props: { title: 'Nota', closeLabel: 'Fechar', onclose: vi.fn(), onpullup }
		});
		const grip = container.querySelector('.grip') as HTMLElement;
		await fireEvent.touchStart(grip, { touches: [{ clientY: 300 }] });
		await fireEvent.touchMove(grip, { touches: [{ clientY: 280 }] });
		await fireEvent.touchEnd(grip, { changedTouches: [{ clientY: 280 }] });
		expect(onpullup).not.toHaveBeenCalled();
	});
});
