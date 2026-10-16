import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Toggle from './Toggle.svelte';

describe('Toggle', () => {
	it('expõe um switch acessível com o rótulo recebido', () => {
		render(Toggle, { props: { label: 'Sons da interface', checked: false } });
		const toggle = screen.getByRole('switch', { name: 'Sons da interface' });
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	it('inverte o estado e avisa o chamador', async () => {
		const onchange = vi.fn();
		render(Toggle, { props: { label: 'Teste', checked: false, onchange } });

		await fireEvent.click(screen.getByRole('switch', { name: 'Teste' }));

		expect(onchange).toHaveBeenCalledWith(true);
		expect(screen.getByRole('switch', { name: 'Teste' }).getAttribute('aria-checked')).toBe('true');
	});

	it('respeita o estado ligado vindo do pai', () => {
		render(Toggle, { props: { label: 'Ligado', checked: true } });
		expect(screen.getByRole('switch', { name: 'Ligado' }).getAttribute('aria-checked')).toBe('true');
	});

	it('não reage quando desabilitado', async () => {
		const onchange = vi.fn();
		render(Toggle, { props: { label: 'Bloqueado', checked: false, disabled: true, onchange } });

		await fireEvent.click(screen.getByRole('switch', { name: 'Bloqueado' }));

		expect(onchange).not.toHaveBeenCalled();
		expect(screen.getByRole('switch', { name: 'Bloqueado' }).getAttribute('aria-checked')).toBe('false');
	});
});
