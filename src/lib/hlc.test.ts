import { describe, expect, it } from 'vitest';
import { nextStamp, observeStamp } from './hlc';

describe('nextStamp', () => {
	it('usa o relógio local quando ele está à frente', () => {
		expect(nextStamp(1_700_000_000_000, 0)).toBe(1_700_000_000_000);
	});

	it('fica acima do maior carimbo visto (relógio local atrasado)', () => {
		// Aparelho 1h atrás: o carimbo local nunca vence o que já chegou.
		expect(nextStamp(1_700_000_000_000, 1_700_003_600_000)).toBe(1_700_003_600_001);
	});

	it('é estritamente crescente entre escritas no mesmo milissegundo', () => {
		const first = nextStamp(1_700_000_000_000, 0);
		const second = nextStamp(1_700_000_000_000, first);
		expect(second).toBe(first + 1);
	});

	it('ignora entradas inválidas', () => {
		expect(nextStamp(Number.NaN, Number.NaN)).toBe(1);
		expect(nextStamp(1_700_000_000_000.7, 0)).toBe(1_700_000_000_000);
	});
});

describe('observeStamp', () => {
	it('nunca regride', () => {
		expect(observeStamp(500, 100)).toBe(500);
		expect(observeStamp(500, 900)).toBe(900);
	});
});
