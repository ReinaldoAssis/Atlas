import { describe, expect, it } from 'vitest';
import {
	booleanLabelOf,
	createEmptySnapshot,
	currentStreak,
	dateOffset,
	didMeetTarget,
	experienceProgress,
	HABIT_BOOLEAN_LABELS,
	habitLogId,
	localDate,
	money,
	normalizeDailyGoal,
	normalizeFirstDayOfWeek,
	nextBooleanLog,
	positiveValueOf,
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

describe('habitLogId', () => {
	it('deriva o id da chave de negócio (hábito + data)', () => {
		expect(habitLogId('h1', '2026-05-01')).toBe('hlog:h1:2026-05-01');
	});

	it('é estável entre aparelhos: mesmo hábito e data, mesmo id', () => {
		// É o que evita duas linhas para o mesmo dia (UNIQUE habit_id + occurred_on)
		// quando os dois aparelhos criam o log offline.
		expect(habitLogId('demo-meditar', '2026-05-01')).toBe(habitLogId('demo-meditar', '2026-05-01'));
	});

	it('separa hábitos e dias diferentes', () => {
		expect(habitLogId('h1', '2026-05-01')).not.toBe(habitLogId('h1', '2026-05-02'));
		expect(habitLogId('h1', '2026-05-01')).not.toBe(habitLogId('h2', '2026-05-01'));
	});
});

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

	it('respeita domingo como primeiro dia', () => {
		// 2026-10-15 é quinta; o domingo anterior é 2026-10-11.
		expect(weekStartDate('2026-10-15', 'sun')).toBe('2026-10-11');
		expect(weekStartDate('2026-10-11', 'sun')).toBe('2026-10-11');
	});

	it('normaliza o primeiro dia para mon/sun', () => {
		expect(normalizeFirstDayOfWeek('sun')).toBe('sun');
		expect(normalizeFirstDayOfWeek('mon')).toBe('mon');
		expect(normalizeFirstDayOfWeek('segunda')).toBe('mon');
		expect(normalizeFirstDayOfWeek(undefined)).toBe('mon');
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

	it('com "menos é melhor", a meta vira teto', () => {
		const habit = dailyBooleanHabit({ metric: 'duration', unit: 'min', target: 60, targetDirection: 'down' });
		expect(didMeetTarget(habit, 61)).toBe(false);
		expect(didMeetTarget(habit, 60)).toBe(true);
		expect(didMeetTarget(habit, 0)).toBe(true);
	});
});

describe('sim/não com direção e rótulos', () => {
	it('positiveValueOf assume 1 e respeita o 0', () => {
		expect(positiveValueOf({})).toBe(1);
		expect(positiveValueOf(null)).toBe(1);
		expect(positiveValueOf({ positiveValue: 0 })).toBe(0);
	});

	it('didMeetTarget usa o estado positivo escolhido', () => {
		const negative = dailyBooleanHabit({ positiveValue: 0 });
		expect(didMeetTarget(negative, 0)).toBe(true);
		expect(didMeetTarget(negative, 1)).toBe(false);
	});

	it('booleanLabelOf cai no padrão e aceita rótulos customizados', () => {
		const plain = dailyBooleanHabit();
		expect(booleanLabelOf(plain, 1, HABIT_BOOLEAN_LABELS)).toBe('Feito');
		expect(booleanLabelOf(plain, 0, HABIT_BOOLEAN_LABELS)).toBe('Não feito');
		const custom = dailyBooleanHabit({ positiveLabel: 'Bom', negativeLabel: 'Ruim' });
		expect(booleanLabelOf(custom, 1, HABIT_BOOLEAN_LABELS)).toBe('Bom');
		expect(booleanLabelOf(custom, 0, HABIT_BOOLEAN_LABELS)).toBe('Ruim');
	});

	it('nextBooleanLog cicla positivo → negativo → remove', () => {
		expect(nextBooleanLog(false, 0, 1)).toBe(1);
		expect(nextBooleanLog(true, 1, 1)).toBe(0);
		expect(nextBooleanLog(true, 0, 1)).toBe('remove');
		// Com o positivo valendo 0, o ciclo começa pelo 0.
		expect(nextBooleanLog(false, 0, 0)).toBe(0);
		expect(nextBooleanLog(true, 0, 0)).toBe(1);
		expect(nextBooleanLog(true, 1, 0)).toBe('remove');
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

	it('conta semanas consecutivas para hábito semanal', () => {
		const habit = dailyBooleanHabit({ metric: 'weekly', target: 3, scheduledDays: [] });
		const logs = [
			log(habit.id, '2026-10-12', 3),
			log(habit.id, '2026-10-05', 4),
			log(habit.id, '2026-09-28', 3)
		];
		expect(currentStreak(habit, logs, today)).toBe(3);
	});

	it('semana atual em aberto não quebra a sequência', () => {
		const habit = dailyBooleanHabit({ metric: 'weekly', target: 3, scheduledDays: [] });
		const logs = [log(habit.id, '2026-10-05', 3), log(habit.id, '2026-09-28', 3)];
		expect(currentStreak(habit, logs, today)).toBe(2);
	});

	it('semana atual abaixo da meta ainda não quebra', () => {
		const habit = dailyBooleanHabit({ metric: 'weekly', target: 3, scheduledDays: [] });
		const logs = [log(habit.id, '2026-10-12', 1), log(habit.id, '2026-10-05', 3)];
		expect(currentStreak(habit, logs, today)).toBe(1);
	});

	it('pula semanas em pausa no hábito semanal', () => {
		const habit = dailyBooleanHabit({ metric: 'weekly', target: 3, scheduledDays: [] });
		const logs = [log(habit.id, '2026-10-05', 3), log(habit.id, '2026-09-21', 3)];
		expect(currentStreak(habit, logs, today, [{ start: '2026-09-28', end: '2026-10-04' }])).toBe(2);
	});

	it('respeita domingo como início da semana no semanal', () => {
		const habit = dailyBooleanHabit({ metric: 'weekly', target: 3, scheduledDays: [] });
		const logs = [log(habit.id, '2026-10-11', 3), log(habit.id, '2026-10-04', 3)];
		expect(currentStreak(habit, logs, today, [], 'sun')).toBe(2);
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

	it('meta do dia nasce em 3 e é limitada a 1–12', () => {
		expect(createEmptySnapshot().dailyGoal).toBe(3);
		expect(normalizeDailyGoal(undefined)).toBe(3);
		expect(normalizeDailyGoal(0)).toBe(1);
		expect(normalizeDailyGoal(7.6)).toBe(8);
		expect(normalizeDailyGoal(99)).toBe(12);
		expect(normalizeDailyGoal('5')).toBe(5);
	});

	it('a semana começa na segunda por padrão', () => {
		expect(createEmptySnapshot().preferences.firstDayOfWeek).toBe('mon');
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
