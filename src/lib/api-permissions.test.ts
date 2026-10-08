import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { resources } from '#lib/server/api/resources.ts';
import {
	allows,
	API_RESOURCE_LABELS,
	API_RESOURCES,
	apiPermissionsSchema,
	describePermissions,
	everything,
	normalizePermissions,
	withLevel
} from './api-permissions.ts';

describe('api permissions', () => {
	it('treats write as implying read and drops unknown resources', () => {
		expect(normalizePermissions({ payments: ['write'], secrets: ['read'] })).toEqual({
			payments: ['read', 'write']
		});
	});

	it('denies by default', () => {
		expect(allows(null, 'members', 'read')).toBe(false);
		expect(allows({ members: ['read'] }, 'members', 'write')).toBe(false);
		expect(allows({ members: ['read'] }, 'sessions', 'read')).toBe(false);
		expect(allows({ members: ['read', 'write'] }, 'members', 'write')).toBe(true);
	});

	it('describes presets', () => {
		expect(describePermissions(everything('write'))).toBe('full');
		expect(describePermissions(everything('read'))).toBe('read');
		expect(describePermissions(null)).toBe('none');
		expect(describePermissions(withLevel(everything('read'), 'payments', 'none'))).toBe('custom');
	});

	it('rejects empty or invalid grants', () => {
		expect(v.safeParse(apiPermissionsSchema, {}).success).toBe(false);
		expect(v.safeParse(apiPermissionsSchema, { sessions: ['delete'] }).success).toBe(false);
		expect(v.parse(apiPermissionsSchema, { sessions: ['read'] })).toEqual({
			sessions: ['read']
		});
	});

	it('covers every REST resource — an unlisted one can never be granted to a key', () => {
		for (const name of Object.keys(resources)) {
			expect(API_RESOURCES, `resource "${name}" missing from API_RESOURCES`).toContain(name);
			expect(
				API_RESOURCE_LABELS[name as keyof typeof API_RESOURCE_LABELS],
				`resource "${name}" has no label`
			).toBeTruthy();
		}
	});
});
