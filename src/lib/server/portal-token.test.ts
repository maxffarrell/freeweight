import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPortalToken, readPortalToken } from './portal-token.ts';

const secret = 'test_not_real_portal_signing_key';
const id = '11111111-2222-4333-8444-555555555555';
const now = 1_800_000_000_000;
const ttl = 14 * 86400_000;
const signed = (payload: string) =>
	`${Buffer.from(payload).toString('base64url')}.${createHmac('sha256', secret).update(`portal:${payload}`).digest('base64url')}`;

describe('portal claim tokens', () => {
	it('retains the existing HMAC format and fourteen-day lifetime', () => {
		const token = createPortalToken(id, secret, now);
		expect(token).toBe(signed(`${id}.${now + ttl}`));
		expect(readPortalToken(token, secret, now)).toBe(id);
		expect(readPortalToken(token, secret, now + ttl - 1)).toBe(id);
		expect(readPortalToken(token, secret, now + ttl)).toBeNull();
	});

	it('rejects missing, malformed, oversized and tampered tokens before database access', () => {
		const token = createPortalToken(id, secret, now);
		for (const bad of [
			'',
			'invalid',
			'a'.repeat(10000),
			`${token}.extra`,
			`${token}=`,
			token.replace(/^./, '!')
		]) {
			expect(readPortalToken(bad, secret, now)).toBeNull();
		}
		expect(readPortalToken(token, 'test_not_real_wrong_key', now)).toBeNull();
	});

	it('rejects even authenticated payloads with invalid IDs, expiry or extra fields', () => {
		for (const payload of [
			`${id}.NaN`,
			`${id}.Infinity`,
			`${id}.${now}`,
			`${id}.${now - 1}`,
			`${id}.${now + ttl + 1}`,
			`${id}.${now + 1}.extra`,
			`123.${now + 1}`,
			`${id}.`,
			`${id}.999999999999999999999`
		]) {
			expect(readPortalToken(signed(payload), secret, now)).toBeNull();
		}
	});
});
