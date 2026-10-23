/** Janela de datas do planejador: padrão de 7 dias, máximo de 14. */
import { intlLocale } from './i18n/intl';

export const TIME_RANGE_MAX_DAYS = 14;

/** Data ISO no meio-dia local — evita o dia anterior em fusos negativos. */
function noon(date: string): Date {
	return new Date(`${date}T12:00:00`);
}

function iso(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
	const value = noon(date);
	value.setDate(value.getDate() + days);
	return iso(value);
}

/** Quantos dias o range cobre (inclusive as duas pontas). */
export function rangeLength(start: string, end: string): number {
	return Math.round((noon(end).getTime() - noon(start).getTime()) / 86_400_000) + 1;
}

/** Normaliza a ordem e limita o range ao máximo de dias. */
export function clampRange(
	start: string,
	end: string,
	maxDays = TIME_RANGE_MAX_DAYS
): { start: string; end: string; days: number; clamped: boolean } {
	const [first, last] = start <= end ? [start, end] : [end, start];
	const length = rangeLength(first, last);
	if (length <= maxDays) return { start: first, end: last, days: length, clamped: false };
	return {
		start: first,
		end: addDays(first, maxDays - 1),
		days: maxDays,
		clamped: true
	};
}

/** 7 dias móveis com hoje na coluna central. */
export function defaultRange(today: string): { start: string; end: string } {
	return { start: addDays(today, -3), end: addDays(today, 3) };
}

/** Início do mês de uma data ISO. */
export function monthStart(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

export function shiftMonth(month: string, delta: number): string {
	const value = noon(month);
	value.setMonth(value.getMonth() + delta);
	value.setDate(1);
	return iso(value);
}

export function monthLabel(month: string): string {
	return noon(month)
		.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' })
		.replace(/^./, (letter) => letter.toUpperCase());
}

function shortMonth(month: number): string {
	return new Date(2026, month - 1, 1)
		.toLocaleDateString(intlLocale(), { month: 'short' })
		.replace(/\.$/, '');
}

/** Rótulo curto do range: `5–11 out`, `28 out–3 nov`, `28/12/2026–3/1/2027`. */
export function rangeLabel(start: string, end: string): string {
	const [year, month, day] = start.split('-');
	const [endYear, endMonth, endDay] = end.split('-');
	const startMonth = shortMonth(Number(month));
	const endMonthName = shortMonth(Number(endMonth));
	if (start === end) return `${Number(day)} ${startMonth}`;
	if (year === endYear && month === endMonth) return `${Number(day)}–${Number(endDay)} ${startMonth}`;
	if (year === endYear) return `${Number(day)} ${startMonth}–${Number(endDay)} ${endMonthName}`;
	return `${Number(day)}/${Number(month)}/${year}–${Number(endDay)}/${Number(endMonth)}/${endYear}`;
}
