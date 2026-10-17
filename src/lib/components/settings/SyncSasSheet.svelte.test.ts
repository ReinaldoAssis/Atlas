import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SyncSasSheet from './SyncSasSheet.svelte';

describe('SyncSasSheet', () => {
	it('mostra o código e confirma nos dois botões', async () => {
		const onconfirm = vi.fn();
		const oncancel = vi.fn();
		render(SyncSasSheet, {
			props: { peerName: 'iPhone', sas: '123456', onconfirm, oncancel }
		});

		expect(screen.getByText('123456')).toBeTruthy();
		expect(screen.getByText('iPhone')).toBeTruthy();
		expect(screen.getByText('O mesmo código precisa aparecer no outro aparelho.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
		expect(onconfirm).toHaveBeenCalledTimes(1);
		await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
		expect(oncancel).toHaveBeenCalledTimes(1);
	});
});
