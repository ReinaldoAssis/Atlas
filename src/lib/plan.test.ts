import { describe, expect, it } from 'vitest';
import { historyFloor, parsePlanLimitError, wouldExceed, type PlanStatus } from './plan';

const free: PlanStatus = {
	pro: false,
	source: 'free',
	checked_at: 0,
	limits: {
		notes: 7,
		attachments: 5,
		habits: 3,
		trackers: 2,
		finance_categories: 4,
		time_categories: 5,
		graph_nodes: 5,
		history_days: 7
	}
};

const pro: PlanStatus = { pro: true, source: 'play', checked_at: 0, limits: free.limits };

describe('plan gating', () => {
	it('never blocks desktop (limits null)', () => {
		const desktop: PlanStatus = { pro: true, source: 'desktop', checked_at: null, limits: null };
		expect(wouldExceed(desktop, 'notes', 999)).toBe(false);
	});

	it('blocks at the exact limit, not after it', () => {
		expect(wouldExceed(free, 'notes', 6)).toBe(false);
		expect(wouldExceed(free, 'notes', 7)).toBe(true);
		expect(wouldExceed(free, 'graph_nodes', 5)).toBe(true);
		expect(wouldExceed(pro, 'notes', 999)).toBe(false);
	});

	it('parses the Rust backstop error', () => {
		expect(parsePlanLimitError('plan-limit:notes:7')).toEqual({ key: 'notes', limit: 7 });
		expect(parsePlanLimitError('plan-limit:graph_nodes:5')).toEqual({ key: 'graph_nodes', limit: 5 });
		expect(parsePlanLimitError('outro erro')).toBeNull();
		expect(parsePlanLimitError('plan-limit:desconhecido:1')).toBeNull();
	});

	it('hides history before the free window', () => {
		expect(historyFloor('2026-10-21', free)).toBe('2026-10-15');
		expect(historyFloor('2026-10-21', pro)).toBeNull();
	});
});
