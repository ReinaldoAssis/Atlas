import { describe, expect, it } from 'vitest';
import { lastSyncLabel, shortId } from './sync';

describe('lastSyncLabel', () => {
	const now = Date.UTC(2026, 9, 17, 12, 0, 0);

	it('mostra "nunca" quando não sincronizou', () => {
		expect(lastSyncLabel(0, now)).toBe('nunca sincronizado');
	});

	it('mostra "agora" no último minuto', () => {
		expect(lastSyncLabel(now - 30_000, now)).toBe('sincronizado agora');
	});

	it('conta minutos, horas e dias', () => {
		expect(lastSyncLabel(now - 5 * 60_000, now)).toBe('sincronizado há 5 min');
		expect(lastSyncLabel(now - 3 * 3_600_000, now)).toBe('sincronizado há 3 h');
		expect(lastSyncLabel(now - 2 * 86_400_000, now)).toBe('sincronizado há 2 d');
	});
});

describe('shortId', () => {
	it('encurta apenas ids longos', () => {
		expect(shortId('2fed9afd')).toBe('2fed9afd');
		expect(shortId('2fed9afdd0328e028e5d815e520a97e8')).toBe('2fed9afd…');
	});
});
