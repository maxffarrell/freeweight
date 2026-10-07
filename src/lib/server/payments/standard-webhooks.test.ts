import { describe, expect, it } from 'vitest';
import { secretList, signStandardWebhook, verifyStandardWebhook } from './standard-webhooks.ts';

const secret = `whsec_${Buffer.from('test-signing-key-0123456789').toString('base64')}`;
const other = `whsec_${Buffer.from('another-signing-key').toString('base64')}`;
const body = '{"type":"checkout.session.completed"}';
const now = 1_800_000_000_000;
const ts = now / 1000;

const headers = (signature: string, timestamp = ts) =>
	new Headers({
		'webhook-id': 'msg_1',
		'webhook-timestamp': String(timestamp),
		'webhook-signature': signature
	});

describe('verifyStandardWebhook', () => {
	const sig = signStandardWebhook(body, 'msg_1', ts, secret);

	it('accepts a valid signature', () => {
		expect(verifyStandardWebhook(body, headers(sig), [secret], now)).toBe(true);
	});

	it('accepts any matching signature or secret during rotation', () => {
		expect(verifyStandardWebhook(body, headers(`v1,AAAA ${sig}`), [secret], now)).toBe(true);
		expect(verifyStandardWebhook(body, headers(sig), [other, secret], now)).toBe(true);
	});

	it('rejects a tampered body, wrong secret or missing headers', () => {
		expect(verifyStandardWebhook(`${body} `, headers(sig), [secret], now)).toBe(false);
		expect(verifyStandardWebhook(body, headers(sig), [other], now)).toBe(false);
		expect(verifyStandardWebhook(body, new Headers(), [secret], now)).toBe(false);
	});

	it('rejects stale timestamps', () => {
		const old = ts - 600;
		const stale = signStandardWebhook(body, 'msg_1', old, secret);
		expect(verifyStandardWebhook(body, headers(stale, old), [secret], now)).toBe(false);
	});

	it('parses secret lists', () => {
		expect(secretList(' a, b ,,')).toEqual(['a', 'b']);
		expect(secretList(undefined)).toEqual([]);
	});
});
