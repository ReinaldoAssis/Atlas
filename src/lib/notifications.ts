// Agenda rolante das notificações locais do iOS.
//
// O repeat semanal do plugin não disparava no device; em vez de depender dele,
// cada ocorrência é agendada com `Schedule.at`. Este módulo monta a lista pura
// (sem tocar no plugin) para poder ser testado.
import { dateOffset, localDate, type AtlasSnapshot } from './atlas';

/** Dias de lembretes agendados de antemão. */
export const NOTIFICATION_HORIZON_DAYS = 14;
/** O iOS aceita 64 pendentes; deixamos margem para o teste manual. */
export const NOTIFICATION_CAP = 60;

export interface ReminderItem {
	id: number;
	at: Date;
	title: string;
	body: string;
}

/** Componentes locais para o trigger de calendário do iOS (evita o bug de fuso do `Schedule.at`). */
export interface ReminderComponents {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

export function localComponents(date: Date): ReminderComponents {
	return {
		year: date.getFullYear(),
		month: date.getMonth() + 1,
		day: date.getDate(),
		hour: date.getHours(),
		minute: date.getMinutes()
	};
}

/** Id numérico estável (o plugin exige 32 bits) derivado de uma chave. */
export function numericNotificationId(key: string): number {
	let hash = 0;
	for (const character of key) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
	return Math.abs(hash) || 1;
}

export interface ReminderOptions {
	now?: Date;
	today?: string;
	horizonDays?: number;
	cap?: number;
}

/**
 * Próximos lembretes (hábitos semanais + blocos planejados), do mais próximo
 * para o mais distante, cortados no teto de pendentes.
 */
export function buildReminderSchedule(
	data: Pick<AtlasSnapshot, 'habits' | 'timeBlocks'>,
	options: ReminderOptions = {}
): ReminderItem[] {
	const now = options.now ?? new Date();
	const today = options.today ?? localDate(now);
	const horizonDays = options.horizonDays ?? NOTIFICATION_HORIZON_DAYS;
	const cap = options.cap ?? NOTIFICATION_CAP;
	const horizonEnd = new Date(`${dateOffset(today, horizonDays)}T23:59:59`);
	const items: ReminderItem[] = [];

	for (const habit of data.habits) {
		if (!habit.active || !habit.reminder) continue;
		const [hour, minute] = habit.reminder.split(':').map(Number);
		if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
		for (let offset = 0; offset < horizonDays; offset += 1) {
			const date = dateOffset(today, offset);
			const weekday = new Date(`${date}T12:00:00`).getDay();
			if (!habit.scheduledDays.includes(weekday)) continue;
			const at = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
			if (at.getTime() <= now.getTime()) continue;
			items.push({
				id: numericNotificationId(`habit:${habit.id}:${date}`),
				at,
				title: 'Atlas · hábito',
				body: habit.name
			});
		}
	}

	for (const block of data.timeBlocks) {
		if (!block.reminder || block.status !== 'planned') continue;
		const at = new Date(`${block.startAt.slice(0, 10)}T${block.reminder}:00`);
		if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime() || at > horizonEnd) continue;
		items.push({ id: numericNotificationId(`time:${block.id}`), at, title: 'Atlas · tempo', body: block.title });
	}

	return items.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, cap);
}
