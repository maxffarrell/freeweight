import { gzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	lookup: vi.fn(),
	request: vi.fn(),
	status: 200,
	body: '{"ok":true}' as string | Buffer,
	encoding: '',
	pinned: ''
}));
vi.mock('node:dns/promises', () => ({ lookup: state.lookup }));
vi.mock('node:http', () => ({ request: state.request }));
vi.mock('node:https', () => ({ request: state.request }));
import { isPublicAddress, outboundFetch } from './outbound-http.ts';

beforeEach(() => {
	vi.resetAllMocks();
	state.status = 200;
	state.body = '{"ok":true}';
	state.pinned = '';
	state.encoding = '';
	state.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
	state.request.mockImplementation((_url, options, onResponse) => {
		const req = new EventEmitter() as EventEmitter & {
			end: (body?: Buffer) => void;
			destroy: (error?: Error) => void;
		};
		req.destroy = (error) => {
			if (error) req.emit('error', error);
		};
		req.end = () =>
			queueMicrotask(() => {
				options.lookup(
					'example.com',
					{ all: true },
					(_err: unknown, addresses: { address: string }[]) => {
						state.pinned = addresses[0].address;
					}
				);
				const res = new EventEmitter() as EventEmitter & {
					statusCode: number;
					headers: object;
					destroy: () => void;
				};
				Object.assign(res, {
					statusCode: state.status,
					headers: {
						'content-type': 'application/json',
						...(state.encoding ? { 'content-encoding': state.encoding } : {})
					},
					destroy: () => {}
				});
				onResponse(res);
				res.emit('data', Buffer.from(state.body));
				res.emit('end');
			});
		return req;
	});
	vi.stubEnv('OUTBOUND_PRIVATE_ORIGINS', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('tenant outbound network boundary', () => {
	it.each([
		'0.0.0.0',
		'127.0.0.1',
		'10.0.0.1',
		'172.16.1.1',
		'169.254.169.254',
		'192.168.1.1',
		'100.64.0.1',
		'198.18.0.1',
		'224.0.0.1',
		'255.255.255.255',
		'::1',
		'::ffff:127.0.0.1',
		'fc00::1',
		'fe80::1',
		'2001:db8::1',
		'2002:7f00:1::1'
	])('rejects special-use address %s', (address) => {
		expect(isPublicAddress(address)).toBe(false);
	});
	it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])(
		'allows public address %s',
		(address) => {
			expect(isPublicAddress(address)).toBe(true);
		}
	);
	it.each([
		'http://2130706433',
		'http://0x7f000001',
		'http://127.1',
		'http://[::ffff:7f00:1]',
		'file:///etc/passwd',
		'https://user:secret@example.com'
	])('rejects alternate literal or unsupported URL %s', async (url) => {
		await expect(outboundFetch(url)).rejects.toThrow();
		expect(state.request).not.toHaveBeenCalled();
	});
	it('rejects mixed public/private DNS answers before connection', async () => {
		state.lookup.mockResolvedValue([
			{ address: '93.184.216.34', family: 4 },
			{ address: '10.0.0.1', family: 4 }
		]);
		await expect(outboundFetch('https://example.com/hook')).rejects.toThrow('public');
		expect(state.request).not.toHaveBeenCalled();
	});
	it('pins the single checked resolution and preserves signed POST and JSON responses', async () => {
		state.lookup
			.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
			.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
		const response = await outboundFetch('https://example.com/hook', {
			method: 'POST',
			headers: { 'x-signature': 'test', 'content-type': 'application/json' },
			body: '{"event":"created"}'
		});
		expect(await response.json()).toEqual({ ok: true });
		expect(state.lookup).toHaveBeenCalledTimes(1);
		expect(state.pinned).toBe('93.184.216.34');
		const [url, options] = state.request.mock.calls[0];
		expect(url.hostname).toBe('example.com');
		expect(options.agent).toBe(false);
		expect(options.headers['x-signature']).toBe('test');
	});
	it('never follows a redirect', async () => {
		state.status = 302;
		await expect(outboundFetch('https://example.com')).rejects.toThrow('redirect');
		expect(state.request).toHaveBeenCalledTimes(1);
	});
	it('requires exact operator-allowlisted origin for private destinations', async () => {
		vi.stubEnv('OUTBOUND_PRIVATE_ORIGINS', 'http://127.0.0.1:8080');
		expect((await outboundFetch('http://127.0.0.1:8080/hook')).status).toBe(200);
		await expect(outboundFetch('http://127.0.0.1:8081/hook')).rejects.toThrow('public');
	});
	it('cancels unresolved DNS without starting a request', async () => {
		state.lookup.mockReturnValue(new Promise(() => {}));
		const controller = new AbortController();
		const pending = outboundFetch('https://example.com', { signal: controller.signal });
		controller.abort(new Error('cancelled'));
		await expect(pending).rejects.toThrow('cancelled');
		expect(state.request).not.toHaveBeenCalled();
	});
	it('bounds response bytes', async () => {
		state.body = 'x'.repeat(16 * 1024 * 1024 + 1);
		await expect(outboundFetch('https://example.com')).rejects.toThrow('exceeds');
	});
});

it('decodes compressed JSON responses for integration consumers', async () => {
	state.encoding = 'gzip';
	state.body = gzipSync(Buffer.from('{"ok":true}'));
	expect(await (await outboundFetch('https://example.com')).json()).toEqual({ ok: true });
});
it('rejects invalid response status without escaping the request promise', async () => {
	state.status = 999;
	await expect(outboundFetch('https://example.com')).rejects.toThrow();
});
