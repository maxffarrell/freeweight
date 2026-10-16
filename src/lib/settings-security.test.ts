import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { settingsInput } from './schemas.ts';

describe('timezone settings boundary', () => {
	it('accepts real IANA zones, aliases and an omitted timezone', () => {
		for (const timezone of [
			'UTC',
			'America/Chicago',
			'Europe/London',
			'Asia/Kathmandu',
			'Etc/GMT+5'
		]) {
			expect(v.safeParse(settingsInput, { timezone }).success).toBe(true);
		}
		expect(v.safeParse(settingsInput, {}).success).toBe(true);
	});
	it('rejects invalid zones and SQL metacharacters before saving tenant settings', () => {
		for (const timezone of ['', 'not-a-zone', "UTC'; select 1; --", 'UTC\\', 'UTC\u0000']) {
			expect(v.safeParse(settingsInput, { timezone }).success).toBe(false);
		}
	});
});
