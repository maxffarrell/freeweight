import { createHmac, timingSafeEqual } from 'node:crypto';

type Purpose = 'unsub' | 'ical' | 'open';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Subscription and opt-out URLs deliberately survive old emails and calendar polling.
export function memberLinkToken(purpose: Purpose, id: string, secret: string) {
	return createHmac('sha256', secret).update(`${purpose}:${id}`).digest('hex').slice(0, 32);
}

export function validMemberLinkToken(purpose: Purpose, id: string, token: string, secret: string) {
	if (!UUID.test(id) || !/^[0-9a-f]{32}$/.test(token)) return false;
	return timingSafeEqual(Buffer.from(memberLinkToken(purpose, id, secret)), Buffer.from(token));
}
