import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import Chip from './Chip.svelte';
import Field from './Field.svelte';

function text(value: string) {
	return createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));
}

describe('Chip', () => {
	it('marca o estado de seleção', () => {
		render(Chip, { props: { selected: true, children: text('Finanças') } });
		expect(screen.getByRole('button', { name: 'Finanças' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('avisa o chamador ao ser tocado', async () => {
		const onselect = vi.fn();
		render(Chip, { props: { children: text('Tempo'), onselect } });

		await fireEvent.click(screen.getByRole('button', { name: 'Tempo' }));

		expect(onselect).toHaveBeenCalledTimes(1);
	});
});

describe('Field', () => {
	it('mostra rótulo, dica opcional e o controle recebido', () => {
		const control = createRawSnippet(() => ({ render: () => '<input placeholder="Ex.: leitura" />' }));
		const { container } = render(Field, { props: { label: 'Nome do hábito', hint: 'opcional', children: control } });

		expect(screen.getByText('Nome do hábito')).toBeTruthy();
		expect(screen.getByText('opcional')).toBeTruthy();
		expect(container.querySelector('label input')).toBeTruthy();
	});
});
