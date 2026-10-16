import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '#lib/fixtures';
import SettingsSheet from './SettingsSheet.svelte';

function setup(overrides: Record<string, unknown> = {}) {
	const props = {
		snapshot: demoSnapshot(),
		testMode: false,
		updaterAvailable: true,
		updaterBusy: false,
		updaterStatus: '',
		onclose: vi.fn(),
		onnotifications: vi.fn(),
		onpreference: vi.fn(),
		oncurrency: vi.fn(async () => true),
		ontestmode: vi.fn(),
		onaddcategory: vi.fn(),
		onrenamecategory: vi.fn(),
		onpause: vi.fn(),
		onexport: vi.fn(),
		onimport: vi.fn(),
		oncheckupdates: vi.fn(),
		...overrides
	};
	render(SettingsSheet, { props });
	return props;
}

describe('SettingsSheet', () => {
	it('mostra as seções em pt-BR, sem eyebrow', () => {
		setup();
		expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeTruthy();
		expect(screen.getByText('Modo de teste')).toBeTruthy();
		expect(screen.getByText('Backup local')).toBeTruthy();
		expect(screen.queryByText('ATLAS · SEU ESPAÇO')).toBeNull();
	});

	it('inverte o interruptor de som e avisa o pai', async () => {
		const base = demoSnapshot();
		const props = setup({
			snapshot: { ...base, preferences: { ...base.preferences, soundEnabled: true } }
		});

		await fireEvent.click(screen.getByRole('switch', { name: 'Sons da interface' }));

		expect(props.onpreference).toHaveBeenCalledWith('soundEnabled', false);
	});

	it('segue o estado de modo de teste vindo do pai', async () => {
		const props = setup({ testMode: true });
		const toggle = screen.getByRole('switch', { name: 'Modo de teste' });
		expect(toggle.getAttribute('aria-checked')).toBe('true');

		await fireEvent.click(toggle);
		expect(props.ontestmode).toHaveBeenCalledWith(false);
	});

	it('cria categoria com módulo, nome e cor da paleta', async () => {
		const props = setup();

		await fireEvent.click(screen.getByRole('radio', { name: 'Tempo' }));
		await fireEvent.input(screen.getByLabelText('Nova categoria'), { target: { value: 'Estudo' } });
		await fireEvent.click(screen.getByRole('button', { name: '#c6a8ff' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Adicionar categoria' }));

		expect(props.onaddcategory).toHaveBeenCalledWith({
			module: 'time',
			name: 'Estudo',
			color: '#c6a8ff'
		});
	});

	it('manda pausar o Atlas', async () => {
		const props = setup();
		await fireEvent.click(screen.getByRole('button', { name: /Pausar Atlas/ }));
		expect(props.onpause).toHaveBeenCalledTimes(1);
	});

	it('esconde a linha de atualizações quando o updater não vale', () => {
		setup({ updaterAvailable: false });
		expect(screen.queryByText('Atualizações')).toBeNull();
	});

	it('mostra o estado do updater e pede a verificação ao pai', async () => {
		const props = setup({ updaterStatus: 'Atlas está na versão mais recente' });
		expect(screen.getByText('Atlas está na versão mais recente')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));
		expect(props.oncheckupdates).toHaveBeenCalledTimes(1);
	});
});
