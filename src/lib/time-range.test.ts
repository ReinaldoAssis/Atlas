import { describe, expect, it } from 'vitest';
import {
	addDays,
	clampRange,
	defaultRange,
	monthLabel,
	monthStart,
	rangeLabel,
	rangeLength,
	shiftMonth
} from './time-range';

describe('time range', () => {
	it('conta os dias incluindo as duas pontas', () => {
		expect(rangeLength('2026-10-05', '2026-10-11')).toBe(7);
		expect(rangeLength('2026-10-11', '2026-10-05')).toBe(-5);
	});

	it('normaliza a ordem e limita a 14 dias', () => {
		expect(clampRange('2026-10-11', '2026-10-05')).toMatchObject({
			start: '2026-10-05',
			end: '2026-10-11',
			days: 7,
			clamped: false
		});
		expect(clampRange('2026-10-01', '2026-10-31')).toMatchObject({
			start: '2026-10-01',
			end: '2026-10-14',
			days: 14,
			clamped: true
		});
	});

	it('cria o range padrão de 7 dias centrado em hoje', () => {
		expect(defaultRange('2026-10-17')).toEqual({ start: '2026-10-14', end: '2026-10-20' });
	});

	it('atravessa a virada do mês', () => {
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(rangeLength('2026-10-28', '2026-11-03')).toBe(7);
	});

	it('formata rótulos curtos', () => {
		expect(rangeLabel('2026-10-05', '2026-10-11')).toBe('5–11 out');
		expect(rangeLabel('2026-10-28', '2026-11-03')).toBe('28 out–3 nov');
		expect(rangeLabel('2026-12-28', '2027-01-03')).toBe('28/12/2026–3/1/2027');
		expect(rangeLabel('2026-10-17', '2026-10-17')).toBe('17 out');
	});

	it('navega meses', () => {
		expect(monthStart('2026-10-17')).toBe('2026-10-01');
		expect(shiftMonth('2026-10-01', 1)).toBe('2026-11-01');
		expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
		expect(monthLabel('2026-10-01')).toBe('Outubro de 2026');
	});
});
