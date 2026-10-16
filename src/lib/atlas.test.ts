import { describe, expect, it } from 'vitest';
import {
	createEmptySnapshot,
	currentStreak,
	dateOffset,
	didMeetTarget,
	experienceProgress,
	localDate,
	money,
	weekStartDate,
	xpNeededForLevel,
	type Habit,
	type HabitLog
} from './atlas';
import { demoSnapshot } from './fixtures';

function dailyBooleanHabit(overrides: Partial<Habit> = {}): Habit {
	return {
		id: 'h1',
		name: 'Meditar',
		metric: 'boolean',
		unit: '',
		target: 1,
		scheduledDays: [0, 1, 2, 3, 4, 5, 6],
		active: true,
		bestStreak: 0,
		...overrides
	};
}

function log(habitId: string, date: string, value = 1): HabitLog {
	return { id: `${habitId}-${date}`, habitId, date, value, completed: value > 0 };
}

describe('dateOffset', () => {
	it('anda para trás dentro do mesmo mês', () => {
		expect(dateOffset('2026-10-15', -3)).toBe('2026-10-12');
	});

	it('atravessa a virada de mês', () => {
		expect(dateOffset('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('atravessa a virada de ano', () => {
		expect(dateOffset('2026-01-01', -1)).toBe('2025-12-31');
	});
});

describe('weekStartDate', () => {
	it('retorna a segunda-feira da semana', () => {
		// 2026-10-15 é quinta (a "segunda" da semana é 2026-10-12).
		expect(weekStartDate('2026-10-15')).toBe('2026-10-12');
	});

	it('mantém a própria segunda-feira', () => {
		expect(weekStartDate('2026-10-12')).toBe('2026-10-12');
	});
});

describe('localDate', () => {
	it('formata como YYYY-MM-DD', () => {
		expect(localDate(new Date(2026, 9, 5))).toBe('2026-10-05');
	});
});

describe('xpNeededForLevel / experienceProgress', () => {
	it('cresce 50 de XP por nível', () => {
		expect(xpNeededForLevel(1)).toBe(100);
		expect(xpNeededForLevel(2)).toBe(150);
	});

	it('começa no nível 1 com 0 de XP', () => {
		expect(experienceProgress(0)).toEqual({ level: 1, currentXp: 0, nextLevelXp: 100 });
	});

	it('sobe de nível ao cruzar exatamente o limite', () => {
		expect(experienceProgress(100)).toEqual({ level: 2, currentXp: 0, nextLevelXp: 150 });
	});

	it('acumula XP dentro do nível', () => {
		expect(experienceProgress(249)).toEqual({ level: 2, currentXp: 149, nextLevelXp: 150 });
	});
});

describe('didMeetTarget', () => {
	it('binário exige valor > 0', () => {
		expect(didMeetTarget(dailyBooleanHabit(), 1)).toBe(true);
		expect(didMeetTarget(dailyBooleanHabit(), 0)).toBe(false);
	});

	it('contagem/duração exige atingir a meta', () => {
		const habit = dailyBooleanHabit({ metric: 'count', unit: 'ml', target: 2000 });
		expect(didMeetTarget(habit, 1999)).toBe(false);
		expect(didMeetTarget(habit, 2000)).toBe(true);
	});
});

describe('currentStreak', () => {
	const today = '2026-10-15';

	it('conta dias programados consecutivos com meta batida', () => {
		const habit = dailyBooleanHabit();
		const logs = [log(habit.id, today), log(habit.id, '2026-10-14')];
		expect(currentStreak(habit, logs, today)).toBe(2);
	});

	it('zera quando o dia programado de hoje não foi cumprido', () => {
		const habit = dailyBooleanHabit();
		const logs = [log(habit.id, today, 0), log(habit.id, '2026-10-14')];
		expect(currentStreak(habit, logs, today)).toBe(0);
	});

	it('ignora dias não programados', () => {
		// Só segundas-feiras: 2026-10-12 e 2026-10-05.
		const habit = dailyBooleanHabit({ scheduledDays: [1] });
		const logs = [log(habit.id, '2026-10-12'), log(habit.id, '2026-10-05')];
		expect(currentStreak(habit, logs, today)).toBe(2);
	});

	it('pula dias em pausa sem quebrar a sequência', () => {
		const habit = dailyBooleanHabit();
		const logs = [log(habit.id, '2026-10-13'), log(habit.id, '2026-10-12')];
		expect(currentStreak(habit, logs, today, [{ start: '2026-10-14', end: today }])).toBe(2);
	});

	it('retorna 0 para hábito inativo', () => {
		const habit = dailyBooleanHabit({ active: false });
		expect(currentStreak(habit, [log(habit.id, today)], today)).toBe(0);
	});
});

describe('money', () => {
	it('formata em BRL via Intl', () => {
		const expected = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(1234.56);
		expect(money(123456, 'BRL')).toBe(expected);
	});
});

describe('createEmptySnapshot', () => {
	it('abre vazio, mantendo só as categorias padrão', () => {
		const snapshot = createEmptySnapshot();
		expect(snapshot.categories.length).toBeGreaterThan(0);
		expect(snapshot.transactions).toEqual([]);
		expect(snapshot.habits).toEqual([]);
		expect(snapshot.habitLogs).toEqual([]);
		expect(snapshot.trackers).toEqual([]);
		expect(snapshot.trackerEntries).toEqual([]);
		expect(snapshot.timeBlocks).toEqual([]);
		expect(snapshot.experience.totalXp).toBe(0);
		expect(snapshot.finance.streak).toBe(0);
	});

	it('tem grafo mínimo (só o nó de origem)', () => {
		const snapshot = createEmptySnapshot();
		expect(snapshot.graph.nodes).toHaveLength(1);
		expect(snapshot.graph.nodes[0].origin).toBe(true);
		expect(snapshot.graph.edges).toEqual([]);
	});
});

describe('demoSnapshot (modo de teste)', () => {
	it('vem populado em todos os módulos', () => {
		const snapshot = demoSnapshot();
		expect(snapshot.transactions.length).toBeGreaterThan(0);
		expect(snapshot.habits.length).toBeGreaterThan(0);
		expect(snapshot.trackers.length).toBeGreaterThan(0);
		expect(snapshot.trackerEntries.length).toBeGreaterThan(0);
		expect(snapshot.trackers.every((tracker) => ['boolean', 'duration', 'count'].includes(tracker.metric))).toBe(true);
		expect(snapshot.trackers[0].askTime).toBe(true);
		expect(snapshot.timeBlocks.length).toBeGreaterThan(0);
		expect(snapshot.experience.totalXp).toBeGreaterThan(0);
		expect(snapshot.graph.nodes.length).toBeGreaterThan(1);
	});
});
