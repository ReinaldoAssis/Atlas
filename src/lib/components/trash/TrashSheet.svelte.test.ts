import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { buildTrashEvent } from '#lib/trash';
import TrashSheet from './TrashSheet.svelte';

function event(overrides: { label: string; module: 'finance' | 'habits'; entityId: string }) {
	return buildTrashEvent(
		{
			module: overrides.module,
			kind: overrides.module === 'finance' ? 'transaction' : 'habit',
			entityId: overrides.entityId,
			label: overrides.label,
			tables: []
		},
		Date.now(),
		'dev-1'
	);
}

describe('TrashSheet', () => {
	it('lista, filtra e restaura um item', async () => {
		const onrestore = vi.fn();
		render(TrashSheet, {
			props: {
				events: [
					event({ label: 'Mercado', module: 'finance', entityId: 't1' }),
					event({ label: 'Ler', module: 'habits', entityId: 'h1' })
				],
				onclose: vi.fn(),
				onrestore,
				onforget: vi.fn()
			}
		});

		expect(screen.getByRole('dialog', { name: 'Lixeira' })).toBeTruthy();
		expect(screen.getByText('Mercado')).toBeTruthy();
		expect(screen.getByText('Ler')).toBeTruthy();

		await fireEvent.click(screen.getByRole('tab', { name: 'Finanças' }));
		expect(screen.queryByText('Ler')).toBeNull();
		expect(screen.getByText('Mercado')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Restaurar Mercado' }));
		expect(onrestore).toHaveBeenCalledTimes(1);
	});

	it('exige um segundo toque para excluir de vez', async () => {
		const onforget = vi.fn();
		render(TrashSheet, {
			props: {
				events: [event({ label: 'Mercado', module: 'finance', entityId: 't1' })],
				onclose: vi.fn(),
				onrestore: vi.fn(),
				onforget
			}
		});

		const forget = screen.getByRole('button', { name: 'Excluir Mercado de vez' });
		await fireEvent.click(forget);
		expect(onforget).not.toHaveBeenCalled();
		expect(screen.getByText('Confirmar')).toBeTruthy();
		await fireEvent.click(forget);
		expect(onforget).toHaveBeenCalledTimes(1);
	});

	it('mostra estado vazio', () => {
		render(TrashSheet, { props: { events: [], onclose: vi.fn(), onrestore: vi.fn(), onforget: vi.fn() } });
		expect(screen.getByText('Lixeira vazia')).toBeTruthy();
	});
});
