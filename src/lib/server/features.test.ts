import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ FREEWEIGHT_CLOUD: false, FREEWEIGHT_ENTERPRISE_KEY: '' }));
vi.mock('$app/env/private', () => env);

import { hasFeature, isEnterpriseEnabled, type Feature } from './features.ts';

beforeEach(() => {
	env.FREEWEIGHT_CLOUD = false;
	env.FREEWEIGHT_ENTERPRISE_KEY = '';
});

describe('self-hosted core features', () => {
	it.each(['sso', 'passkeys', 'ai'] as const)('%s needs no subscription', (feature) => {
		expect(isEnterpriseEnabled()).toBe(false);
		expect(hasFeature(feature)).toBe(true);
	});

	it.each([
		'custom-fields',
		'white-label',
		'audit-export',
		'health-forms',
		'kiosk-pin',
		'payroll-export',
		'data-retention',
		'door-access',
		'report-digests'
	] as Feature[])('%s stays paid', (feature) => {
		expect(hasFeature(feature)).toBe(false);
		env.FREEWEIGHT_ENTERPRISE_KEY = 'existing-entitlement';
		expect(hasFeature(feature)).toBe(true);
		env.FREEWEIGHT_ENTERPRISE_KEY = '';
		env.FREEWEIGHT_CLOUD = true;
		expect(hasFeature(feature)).toBe(true);
	});
});
