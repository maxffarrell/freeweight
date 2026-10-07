import { describe, expect, it } from 'vitest';
import { allocate } from './allocation.ts';

describe('allocate', () => {
	const charges = [
		{ id: 'a', open: 100 },
		{ id: 'paid', open: 0 },
		{ id: 'b', open: 250 }
	];

	it('pays charges oldest-first and skips settled ones', () => {
		expect(allocate(300, charges)).toEqual([
			{ chargeId: 'a', amount: 100 },
			{ chargeId: 'b', amount: 200 }
		]);
	});

	it('keeps overpayment as unapplied credit', () => {
		expect(allocate(400, charges)).toEqual([
			{ chargeId: 'a', amount: 100 },
			{ chargeId: 'b', amount: 250 },
			{ chargeId: null, amount: 50 }
		]);
	});

	it('handles no open charges', () => {
		expect(allocate(75, [])).toEqual([{ chargeId: null, amount: 75 }]);
	});
});
