import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { dateOffset, localDate, type Habit, type HabitLog } from '#lib/atlas';
import HabitHistorySheet from './HabitHistorySheet.svelte';

const habit: Habit = {
	id: 'h1',
	name: 'Ler',
	metric: 'count',
	unit: 'páginas',
	target: 10,
	scheduledDays: [0, 1, 2, 3, 4, 5, 6],
	active: true,
	bestStreak: 0
};

function log(date: string, value: number): HabitLog {
	return { id: `log-${date}`, habitId: 'h1', date, value, completed: value >= 10 };
}

describe('HabitHistorySheet', () => {
	it('lista os registros do período e abre o escolhido', async () => {
		const today = localDate();
		const older = log(dateOffset(today, -2), 5);
		const onopen = vi.fn();
		render(HabitHistorySheet, { props: { habit, logs: [log(today, 12), older], onopen, onclose: vi.fn() } });

		expect(screen.getByRole('dialog', { name: 'Ler' })).toBeTruthy();
		expect(screen.getAllByText('Hoje').length).toBeGreaterThan(0);
		await fireEvent.click(screen.getByText('5 páginas'));
		expect(onopen).toHaveBeenCalledWith(older);
	});

	it('não mostra ações de edição no drawer', () => {
		render(HabitHistorySheet, {
			props: { habit, logs: [log(localDate(), 12)], onopen: vi.fn(), onclose: vi.fn() }
		});
		expect(screen.queryByText('Registrar')).toBeNull();
		expect(screen.queryByText('Excluir')).toBeNull();
		expect(screen.queryByText('Editar')).toBeNull();
	});
});
