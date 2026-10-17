import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DurationField from './DurationField.svelte';

function setup(value: number | null = null) {
	const onchange = vi.fn();
	render(DurationField, { props: { value, onchange, ariaLabel: 'Duração' } });
	const input = screen.getByLabelText('Duração') as HTMLInputElement;
	return { input, onchange };
}

describe('DurationField', () => {
	it('mostra o valor em HH:MM', () => {
		const { input } = setup(90);
		expect(input.value).toBe('01:30');
	});

	it('aplica a máscara da direita enquanto digita', async () => {
		const { input, onchange } = setup(null);
		await fireEvent.keyDown(input, { key: '9' });
		expect(input.value).toBe('00:09');
		expect(onchange).toHaveBeenLastCalledWith(9);
		await fireEvent.keyDown(input, { key: '0' });
		expect(input.value).toBe('01:30');
		expect(onchange).toHaveBeenLastCalledWith(90);
	});

	it('quatro dígitos viram HH:MM', async () => {
		const { input, onchange } = setup(null);
		for (const key of ['1', '2', '3']) await fireEvent.keyDown(input, { key });
		expect(input.value).toBe('01:23');
		await fireEvent.keyDown(input, { key: '0' });
		expect(input.value).toBe('12:30');
		expect(onchange).toHaveBeenLastCalledWith(750);
	});

	it('backspace remove dígito e vazio emite null', async () => {
		const { input, onchange } = setup(5);
		expect(input.value).toBe('00:05');
		await fireEvent.keyDown(input, { key: 'Backspace' });
		expect(input.value).toBe('');
		expect(onchange).toHaveBeenLastCalledWith(null);
	});
});
