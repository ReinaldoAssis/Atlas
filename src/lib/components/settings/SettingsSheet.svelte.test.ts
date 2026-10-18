import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '#lib/fixtures';
import SettingsSheet from './SettingsSheet.svelte';

function setup(overrides: Record<string, unknown> = {}) {
	const props = {
		snapshot: demoSnapshot(),
		testMode: false,
		syncAvailable: false,
		sync: null,
		syncBusy: false,
		updaterAvailable: true,
		updaterBusy: false,
		updaterStatus: '',
		onclose: vi.fn(),
		onnotifications: vi.fn(),
		onpreference: vi.fn(),
		oncurrency: vi.fn(async () => true),
		ontestmode: vi.fn(),
		onpause: vi.fn(),
		onexport: vi.fn(),
		onimport: vi.fn(),
		oncheckupdates: vi.fn(),
		onsynctoggle: vi.fn(),
		onsyncnow: vi.fn(),
		onsyncdiscoveryrestart: vi.fn(),
		onsyncauto: vi.fn(),
		onsyncinterval: vi.fn(),
		onpair: vi.fn(),
		onunpair: vi.fn(),
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

	it('mostra a seção de sincronização quando o app tem suporte', () => {
		setup({
			syncAvailable: true,
			sync: { enabled: false, running: false, endpointId: null, peers: [], pendingPairs: [], autoSync: true, intervalSecs: 2, discovery: { state: 'off', found: 0, message: null } }
		});
		expect(screen.getByText('Sincronização')).toBeTruthy();
		expect(screen.getByRole('switch', { name: 'Sincronizar aparelhos' })).toBeTruthy();
	});

	it('mostra o estado da descoberta e reinicia só ela', async () => {
		const props = setup({
			syncAvailable: true,
			sync: {
				enabled: true,
				running: true,
				endpointId: 'abc',
				peers: [],
				pendingPairs: [],
				autoSync: true,
				intervalSecs: 2,
				discovery: { state: 'browsing', found: 2, message: null }
			}
		});
		expect(screen.getByText('Descoberta')).toBeTruthy();
		expect(screen.getByText('2 na rede')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }));
		expect(props.onsyncdiscoveryrestart).toHaveBeenCalledTimes(1);
	});

	it('configura o auto-sync na seção Avançado', async () => {
		const props = setup({
			syncAvailable: true,
			sync: {
				enabled: true,
				running: true,
				endpointId: 'abc',
				peers: [],
				pendingPairs: [],
				autoSync: true,
				intervalSecs: 2,
				discovery: { state: 'browsing', found: 0, message: null }
			}
		});
		expect(screen.getByText('Avançado')).toBeTruthy();
		await fireEvent.click(
			screen.getByRole('switch', { name: 'Sincronizar automaticamente' })
		);
		expect(props.onsyncauto).toHaveBeenCalledWith(false);
		const input = screen.getByLabelText('Intervalo') as HTMLInputElement;
		expect(input.value).toBe('2');
		await fireEvent.change(input, { target: { value: '5' } });
		expect(props.onsyncinterval).toHaveBeenCalledWith(5);
	});

	it('esconde o avançado atrás de um spoiler recolhido', () => {
		setup({
			syncAvailable: true,
			sync: {
				enabled: true,
				running: true,
				endpointId: 'abc',
				peers: [],
				pendingPairs: [],
				autoSync: true,
				intervalSecs: 2,
				discovery: { state: 'browsing', found: 0, message: null }
			}
		});
		expect(screen.getByText('Avançado')).toBeTruthy();
		const spoiler = document.querySelector('details.advanced') as HTMLDetailsElement;
		expect(spoiler).toBeTruthy();
		expect(spoiler.open).toBe(false);
	});

	it('explica a permissão de Rede Local negada', () => {
		setup({
			syncAvailable: true,
			sync: {
				enabled: true,
				running: true,
				endpointId: 'abc',
				peers: [],
				pendingPairs: [],
				autoSync: true,
				intervalSecs: 2,
				discovery: {
					state: 'permission',
					found: 0,
					message: 'Rede Local negada pelo iOS. Ative em Ajustes › Apps › Atlas › Rede Local.'
				}
			}
		});
		expect(screen.getByText(/Rede Local negada/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Abrir Ajustes' })).toBeTruthy();
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
