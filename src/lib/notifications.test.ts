import { describe, expect, it } from 'vitest';
import type { Habit, TimeBlock } from './atlas';
import { buildReminderSchedule, numericNotificationId } from './notifications';

function habit(overrides: Partial<Habit> = {}): Habit {
	return {
		id: 'h1',
		name: 'Meditar',
		metric: 'boolean',
		unit: '',
		target: 1,
		scheduledDays: [1, 4],
		active: true,
		reminder: '09:00',
		bestStreak: 0,
		...overrides
	};
}

function block(overrides: Partial<TimeBlock> = {}): TimeBlock {
	return {
		id: 'b1',
		title: 'Foco',
		categoryId: 'deep-work',
		startAt: '2026-10-21T14:00:00',
		endAt: '2026-10-21T15:00:00',
		plannedMinutes: 60,
		actualMinutes: null,
		status: 'planned',
		reminder: '13:30',
		...overrides
	};
}

const options = { now: new Date('2026-10-20T10:00:00'), today: '2026-10-20' };

function localDay(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

describe('buildReminderSchedule', () => {
	it('agenda cada ocorrência semanal dos próximos 14 dias', () => {
		const items = buildReminderSchedule({ habits: [habit()], timeBlocks: [] }, options);
		expect(items.map((item) => localDay(item.at))).toEqual([
			'2026-10-22',
			'2026-10-26',
			'2026-10-29',
			'2026-11-02'
		]);
		expect(items.every((item) => item.title === 'Atlas · hábito')).toBe(true);
	});

	it('ignora a ocorrência de hoje que já passou e agenda a próxima', () => {
		const items = buildReminderSchedule({ habits: [habit({ scheduledDays: [2] })], timeBlocks: [] }, options);
		expect(items).toHaveLength(1);
		expect(localDay(items[0].at)).toBe('2026-10-27');
	});

	it('ignora hábito inativo ou sem lembrete', () => {
		const schedules = buildReminderSchedule(
			{ habits: [habit({ active: false }), habit({ id: 'h2', reminder: undefined })], timeBlocks: [] },
			options
		);
		expect(schedules).toHaveLength(0);
	});

	it('inclui bloco planejado com lembrete dentro do horizonte', () => {
		const items = buildReminderSchedule({ habits: [], timeBlocks: [block()] }, options);
		expect(items).toHaveLength(1);
		expect(items[0].body).toBe('Foco');
		expect(localDay(items[0].at)).toBe('2026-10-21');
		expect(items[0].at.getHours()).toBe(13);
		expect(items[0].at.getMinutes()).toBe(30);
	});

	it('ignora bloco cancelado ou fora do horizonte', () => {
		const items = buildReminderSchedule(
			{
				habits: [],
				timeBlocks: [block({ status: 'cancelled' }), block({ id: 'b2', startAt: '2026-11-10T14:00:00' })]
			},
			options
		);
		expect(items).toHaveLength(0);
	});

	it('ordena do mais próximo e respeita o teto', () => {
		const items = buildReminderSchedule({ habits: [habit()], timeBlocks: [block()] }, { ...options, cap: 2 });
		expect(items).toHaveLength(2);
		expect(items[0].body).toBe('Foco');
		expect(localDay(items[1].at)).toBe('2026-10-22');
	});
});

describe('numericNotificationId', () => {
	it('é estável e positivo', () => {
		expect(numericNotificationId('habit:h1:2026-10-22')).toBe(numericNotificationId('habit:h1:2026-10-22'));
		expect(numericNotificationId('habit:h1:2026-10-22')).toBeGreaterThan(0);
	});

	it('separa chaves diferentes', () => {
		expect(numericNotificationId('habit:h1:2026-10-22')).not.toBe(numericNotificationId('habit:h1:2026-10-23'));
	});
});
