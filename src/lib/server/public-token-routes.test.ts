import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const rows: Record<string, unknown>[][] = [];
	const query = {
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		leftJoin: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		then: (resolve: (value: Record<string, unknown>[]) => unknown) =>
			Promise.resolve(rows.shift() ?? []).then(resolve)
	};
	return {
		rows,
		select: vi.fn<(fields: Record<string, unknown>) => typeof query>(() => query),
		update: vi.fn(() => query)
	};
});

vi.mock('#lib/server/db/index.ts', () => ({ db: mocks }));
vi.mock(
	'$app/env/private',
	() =>
		new Proxy({ BETTER_AUTH_SECRET: 'test_not_real_public_route_key' } as Record<string, unknown>, {
			get: (target, key) => target[String(key)],
			has: () => true
		})
);

import { GET as calendar } from '../../routes/portal/feed.ics/+server.ts';
import { GET as unsubscribe } from '../../routes/unsubscribe/+server.ts';
import { GET as pixel } from '../../routes/api/email-open/+server.ts';
import { calendarToken, unsubscribeToken, openToken } from './services/notifications.ts';

const id = '11111111-2222-4333-8444-555555555555';
const event = (query: string) => ({ url: new URL(`https://example.test/?${query}`) }) as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.rows.length = 0;
});

describe('public member token routes', () => {
	it('rejects missing, malformed and authenticated invalid IDs without querying', async () => {
		for (const query of ['', `m=${id}`, `m=${id}&t=invalid`, `m=123&t=${calendarToken('123')}`]) {
			expect((await calendar(event(query))).status).toBe(404);
		}
		for (const query of [
			'',
			`m=${id}`,
			`m=${id}&t=invalid`,
			`m=123&t=${unsubscribeToken('123')}`
		]) {
			expect((await unsubscribe(event(query))).status).toBe(404);
		}
		expect((await pixel(event(`i=123&t=${openToken('123')}`))).status).toBe(200);
		expect(mocks.select).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('uses generic not-found responses for deleted members without mutation', async () => {
		expect((await calendar(event(`m=${id}&t=${calendarToken(id)}`))).status).toBe(404);
		expect((await unsubscribe(event(`m=${id}&t=${unsubscribeToken(id)}`))).status).toBe(404);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('projects only recipient calendar fields and escapes every line-break form', async () => {
		mocks.rows.push(
			[{ orgId: 'test-org' }],
			[
				{
					bookingId: id,
					status: 'booked',
					className: 'Yoga\rBEGIN:VEVENT\nEND:VCALENDAR',
					locationName: 'Studio\r\nA',
					startsAt: new Date('2026-10-20T12:00:00Z'),
					endsAt: new Date('2026-10-20T13:00:00Z'),
					notes: 'test_private_notes',
					checkinCode: 'test_private_code'
				}
			]
		);
		const response = await calendar(event(`m=${id}&t=${calendarToken(id)}`));
		const body = await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual(['orgId']);
		expect(Object.keys(mocks.select.mock.calls[1][0])).toEqual([
			'bookingId',
			'status',
			'className',
			'locationName',
			'startsAt',
			'endsAt'
		]);
		expect(body).toContain('SUMMARY:Yoga\\nBEGIN:VEVENT\\nEND:VCALENDAR\r\n');
		expect(body).toContain('LOCATION:Studio\\nA\r\n');
		expect(body).not.toContain('test_private');
		expect(body.split('\r\nBEGIN:VEVENT')).toHaveLength(2);
	});

	it('escapes unsubscribe organization names and mutates only after token validation', async () => {
		mocks.rows.push([{ id, orgName: '<img src=x onerror=alert(1)>' }]);
		const response = await unsubscribe(event(`m=${id}&t=${unsubscribeToken(id)}`));
		const body = await response.text();
		expect(response.status).toBe(200);
		expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(body).not.toContain('<img src=x');
		expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual(['id', 'orgName']);
		expect(mocks.update).toHaveBeenCalledOnce();
	});
});
