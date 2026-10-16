import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import Button from './Button.svelte';

function text(value: string) {
	return createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));
}

describe('Button', () => {
	it('dispara a ação no toque', async () => {
		const onclick = vi.fn();
		render(Button, { props: { onclick, children: text('Salvar') } });

		await fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('usa o tipo pedido e respeita desabilitado', async () => {
		const onclick = vi.fn();
		render(Button, { props: { type: 'submit', disabled: true, onclick, children: text('Criar') } });
		const button = screen.getByRole('button', { name: 'Criar' });

		expect(button.getAttribute('type')).toBe('submit');
		await fireEvent.click(button);
		expect(onclick).not.toHaveBeenCalled();
	});

	it('aplica a variante de perigo', () => {
		render(Button, { props: { variant: 'danger', children: text('Excluir') } });
		expect(screen.getByRole('button', { name: 'Excluir' }).className).toContain('danger');
	});
});
