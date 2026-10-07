import { describe, expect, it } from 'vitest';
import { addDays, addYears, monthLabel, nextMonth } from './format.ts';

describe('date helpers', () => {
	it('adds days across month and year boundaries', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('adds years', () => {
		expect(addYears('2026-10-01', 1)).toBe('2027-10-01');
		expect(addYears('2028-02-29', 1)).toBe('2029-03-01');
	});

	it('steps months', () => {
		expect(nextMonth('2026-11')).toBe('2026-12');
		expect(nextMonth('2026-12')).toBe('2027-01');
		expect(monthLabel('2026-10')).toBe('October 2026');
	});
});
