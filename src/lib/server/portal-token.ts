import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 14 * 86400_000;
const PAYLOAD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{13})$/;

const sign = (payload: string, secret: string) =>
	createHmac('sha256', secret).update(`portal:${payload}`).digest('base64url');

export function createPortalToken(memberId: string, secret: string, now = Date.now()) {
	const payload = `${memberId}.${now + TTL_MS}`;
	return `${Buffer.from(payload).toString('base64url')}.${sign(payload, secret)}`;
}

/** Accept the existing signed format, but only canonical, bounded, unexpired payloads. */
export function readPortalToken(token: string, secret: string, now = Date.now()) {
	if (!/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const [encoded, signature] = token.split('.');
	const payload = Buffer.from(encoded, 'base64url').toString('utf8');
	if (Buffer.from(payload).toString('base64url') !== encoded) return null;
	const match = PAYLOAD.exec(payload);
	if (!match) return null;
	const expires = Number(match[2]);
	if (!Number.isSafeInteger(expires) || expires <= now || expires > now + TTL_MS) return null;
	const expected = Buffer.from(sign(payload, secret));
	const given = Buffer.from(signature);
	return timingSafeEqual(expected, given) ? match[1] : null;
}
