import { describe, expect, it } from 'vitest';
import { setClientAddress } from '../../../scripts/proxy-headers.ts';

describe('forwarded IP trust boundary', () => {
	const request = (peer: string, forwarded = '203.0.113.44') => ({
		headers: { 'x-forwarded-for': forwarded },
		socket: { remoteAddress: peer }
	});
	it('overwrites attacker supplied direct addresses, including lists', () => {
		const req = request('198.51.100.2', '127.0.0.1, 203.0.113.44');
		setClientAddress(req);
		expect(req.headers['x-forwarded-for']).toBe('198.51.100.2');
	});
	it('preserves proxy addresses only from exact configured peers', () => {
		const trusted = request('::ffff:10.0.0.1');
		setClientAddress(trusted, ' ::ffff:10.0.0.1 , 10.0.0.2 ');
		expect(trusted.headers['x-forwarded-for']).toBe('203.0.113.44');
		const direct = request('10.0.0.10');
		setClientAddress(direct, '10.0.0.1');
		expect(direct.headers['x-forwarded-for']).toBe('10.0.0.10');
	});
});
