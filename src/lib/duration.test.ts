import { describe, expect, it } from 'vitest';
import { MAX_DURATION_MINUTES, formatClock, parseClockDigits } from './duration';

describe('duration clock', () => {
	it('formata minutos como HH:MM', () => {
		expect(formatClock(null)).toBe('');
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(5)).toBe('00:05');
		expect(formatClock(90)).toBe('01:30');
		expect(formatClock(MAX_DURATION_MINUTES)).toBe('99:59');
		expect(formatClock(MAX_DURATION_MINUTES + 60)).toBe('99:59');
	});

	it('interpreta os dígitos da direita', () => {
		expect(parseClockDigits('')).toBe(0);
		expect(parseClockDigits('5')).toBe(5);
		expect(parseClockDigits('30')).toBe(30);
		expect(parseClockDigits('90')).toBe(90);
		expect(parseClockDigits('130')).toBe(90);
		expect(parseClockDigits('1230')).toBe(750);
		expect(parseClockDigits('999')).toBe(599);
		expect(parseClockDigits('9999')).toBe(MAX_DURATION_MINUTES);
	});

	it('faz roundtrip formatar → dígitos → formatar', () => {
		for (const minutes of [1, 5, 30, 59, 60, 90, 599, 750, MAX_DURATION_MINUTES]) {
			expect(parseClockDigits(formatClock(minutes).replace(':', ''))).toBe(minutes);
		}
	});
});
