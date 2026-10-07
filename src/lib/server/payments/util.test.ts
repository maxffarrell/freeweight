import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromDecimal, hmacValid, memberRef, parseMemberRef, toDecimal } from './util.ts';

const member = '0c63a834-455b-4da0-99b1-1ca0b8ff28d0';

describe('money', () => {
	it('round-trips minor units', () => {
		expect(toDecimal(145000)).toBe('1450.00');
		expect(toDecimal(5)).toBe('0.05');
		expect(fromDecimal('1450.00')).toBe(145000);
		expect(fromDecimal('12.5')).toBe(1250);
		expect(fromDecimal('7')).toBe(700);
	});
	it('rejects malformed amounts', () => {
		for (const v of ['', '-1.00', '1.234', 'abc', null, undefined]) expect(fromDecimal(v)).toBe(0);
	});
});

describe('member refs', () => {
	it('round-trips', () => {
		expect(parseMemberRef(memberRef('org_AbC-12', member))).toEqual({
			orgId: 'org_AbC-12',
			memberId: member
		});
	});
	it('rejects anything else', () => {
		for (const v of [undefined, 42, 'org', `org:${member}:x`, `a b:${member}`, 'org:not-a-uuid'])
			expect(parseMemberRef(v)).toBeNull();
	});
});

describe('hmacValid', () => {
	const body = '{"type":"payment.updated"}';
	it('checks hex signatures', () => {
		const sig = createHmac('sha256', 'wh_secret').update(body).digest('hex');
		expect(hmacValid(body, sig, ['old', 'wh_secret'], 'hex')).toBe(true);
		expect(hmacValid(body + ' ', sig, ['wh_secret'], 'hex')).toBe(false);
		expect(hmacValid(body, sig, ['wrong'], 'hex')).toBe(false);
		expect(hmacValid(body, null, ['wh_secret'], 'hex')).toBe(false);
		expect(hmacValid(body, 'zz', ['wh_secret'], 'hex')).toBe(false);
	});
	it('checks base64 signatures over a prefix + body', () => {
		const url = 'https://pm.example.com/api/payments/stripe/webhook';
		const sig = createHmac('sha256', 'sk_key')
			.update(url + body)
			.digest('base64');
		expect(hmacValid(body, sig, ['sk_key'], 'base64', url)).toBe(true);
		expect(hmacValid(body, sig, ['sk_key'], 'base64', 'https://evil.example.com/x')).toBe(false);
	});
});
