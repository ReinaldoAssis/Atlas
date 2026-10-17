/**
 * Duração em minutos ↔ relógio `HH:MM`.
 *
 * O armazenamento continua em minutos inteiros (`Habit.target`,
 * `Tracker.target`, `HabitLog.value`, `TrackerEntry.value`); o relógio é só a
 * forma de digitar e exibir. A máscara é "da direita": 1–2 dígitos são
 * minutos, 3 são `H:MM` e 4 são `HH:MM`.
 */

export const MAX_DURATION_MINUTES = 99 * 60 + 59;

export function formatClock(minutes: number | null | undefined): string {
	if (minutes == null || !Number.isFinite(minutes)) return '';
	const total = Math.max(0, Math.min(MAX_DURATION_MINUTES, Math.round(minutes)));
	const hours = Math.floor(total / 60);
	const rest = total % 60;
	return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Converte os dígitos digitados (sem `:`) na máscara da direita. */
export function parseClockDigits(raw: string): number {
	const digits = raw.replace(/\D/g, '').slice(0, 4);
	if (!digits) return 0;
	let hours = 0;
	let minutes = 0;
	if (digits.length <= 2) {
		// `5` = 5 min; `90` = 1h30 (carrega o excedente em vez de rejeitar).
		const total = Number(digits);
		hours = Math.floor(total / 60);
		minutes = total % 60;
	} else if (digits.length === 3) {
		hours = Number(digits[0]);
		minutes = Number(digits.slice(1));
	} else {
		hours = Number(digits.slice(0, 2));
		minutes = Number(digits.slice(2));
	}
	hours = Math.min(99, Math.max(0, hours));
	minutes = Math.min(59, Math.max(0, minutes));
	return hours * 60 + minutes;
}
