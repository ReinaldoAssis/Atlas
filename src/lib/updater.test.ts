import { describe, expect, it } from 'vitest';
import { downloadPercent, updaterSupported } from './updater';

const WINDOWS_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36';
const IOS_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('updaterSupported', () => {
	it('oferece atualização no app Tauri do Windows', () => {
		expect(updaterSupported(true, WINDOWS_UA)).toBe(true);
	});

	it('não oferece no preview web, mesmo fingindo Windows', () => {
		expect(updaterSupported(false, WINDOWS_UA)).toBe(false);
	});

	it('não oferece no iOS (renovação é pelo SideStore)', () => {
		expect(updaterSupported(true, IOS_UA)).toBe(false);
	});

	it('não oferece sem user agent', () => {
		expect(updaterSupported(true, '')).toBe(false);
	});
});

describe('downloadPercent', () => {
	it('arredonda a fração baixada', () => {
		expect(downloadPercent(250, 1000)).toBe(25);
		expect(downloadPercent(1, 3)).toBe(33);
	});

	it('sem tamanho conhecido não dá para estimar', () => {
		expect(downloadPercent(0, 0)).toBeNull();
		expect(downloadPercent(42, 0)).toBeNull();
	});

	it('fica no intervalo de 0 a 100', () => {
		expect(downloadPercent(0, 1000)).toBe(0);
		expect(downloadPercent(1000, 1000)).toBe(100);
		expect(downloadPercent(2000, 1000)).toBe(100);
	});
});
