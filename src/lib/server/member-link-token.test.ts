import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memberLinkToken, validMemberLinkToken } from './member-link-token.ts';

const secret = 'test_not_real_member_link_key';
const id = '11111111-2222-4333-8444-555555555555';

describe('persistent member link tokens', () => {
	it('keeps legacy 128-bit HMAC links compatible and purpose-separated', () => {
		for (const purpose of ['unsub', 'ical', 'open'] as const) {
			const token = memberLinkToken(purpose, id, secret);
			expect(token).toBe(
				createHmac('sha256', secret).update(`${purpose}:${id}`).digest('hex').slice(0, 32)
			);
			expect(validMemberLinkToken(purpose, id, token, secret)).toBe(true);
			expect(validMemberLinkToken(purpose, id, token, 'test_not_real_rotated_key')).toBe(false);
		}
		expect(validMemberLinkToken('ical', id, memberLinkToken('unsub', id, secret), secret)).toBe(
			false
		);
	});
	it('rejects missing, malformed, oversized and changed tokens or IDs', () => {
		const token = memberLinkToken('ical', id, secret);
		for (const bad of [
			'',
			'x'.repeat(32),
			'a'.repeat(10000),
			`${token}.extra`,
			token.toUpperCase()
		]) {
			expect(validMemberLinkToken('ical', id, bad, secret)).toBe(false);
		}
		for (const badId of ['', '123', `${id}.extra`, 'a'.repeat(10000), id.replace(/^1/, '2')]) {
			expect(validMemberLinkToken('ical', badId, token, secret)).toBe(false);
		}
		expect(
			validMemberLinkToken('ical', '123', memberLinkToken('ical', '123', secret), secret)
		).toBe(false);
	});
});
