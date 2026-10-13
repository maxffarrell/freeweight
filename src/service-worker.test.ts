import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function worker() {
	const handlers = new Map<string, (event: unknown) => void>();
	const match = vi.fn().mockResolvedValue(new Response('Offline'));
	const remove = vi.fn().mockResolvedValue(true);
	const addAll = vi.fn().mockResolvedValue(undefined);
	const open = vi.fn().mockResolvedValue({ addAll });
	const fetch = vi.fn().mockResolvedValue(new Response('Private tenant data'));
	const source = readFileSync(new URL('./service-worker/index.ts', import.meta.url), 'utf8');
	const script = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
	}).outputText;
	runInNewContext(script, {
		exports: {},
		URL,
		Response,
		fetch,
		require: (id: string) => {
			if (id === '$app/manifest')
				return {
					assets: [{ path: '/offline.html' }],
					immutable: [{ path: '/_app/app.js' }],
					prerendered: []
				};
			if (id === '$app/env') return { version: 'new' };
			if (id === '$app/paths') return { asset: (path: string) => path };
			throw new Error(id);
		},
		self: {
			addEventListener: (name: string, handler: (event: unknown) => void) =>
				handlers.set(name, handler),
			location: { origin: 'https://example.test' },
			clients: { claim: vi.fn() },
			skipWaiting: vi.fn()
		},
		caches: {
			open,
			match,
			keys: async () => ['fw-old', 'fw-new', 'fw-static-v2-new', 'other-app'],
			delete: remove
		}
	});
	return { handlers, match, remove, addAll, open, fetch };
}

describe('service-worker private navigation isolation', () => {
	it('never stores a successful authenticated navigation response', async () => {
		const w = worker();
		let response!: Promise<Response>;
		w.handlers.get('fetch')!({
			request: { method: 'GET', mode: 'navigate', url: 'https://example.test/tenants' },
			respondWith: (r: Promise<Response>) => {
				response = r;
			}
		});
		expect(await (await response).text()).toBe('Private tenant data');
		expect(w.open).not.toHaveBeenCalled();
		expect(w.match).not.toHaveBeenCalled();
	});
	it('returns only the generic offline page for a previous user’s navigation', async () => {
		const w = worker();
		w.fetch.mockRejectedValue(new Error('offline'));
		let response!: Promise<Response>;
		w.handlers.get('fetch')!({
			request: { method: 'GET', mode: 'navigate', url: 'https://example.test/w/secret-token' },
			respondWith: (r: Promise<Response>) => {
				response = r;
			}
		});
		expect(await (await response).text()).toBe('Offline');
		expect(w.match).toHaveBeenCalledExactlyOnceWith('/offline.html');
	});
	it('deletes legacy private navigation caches without deleting another application’s cache', async () => {
		const w = worker();
		let pending!: Promise<void>;
		w.handlers.get('activate')!({
			waitUntil: (p: Promise<void>) => {
				pending = p;
			}
		});
		await pending;
		expect(w.remove.mock.calls.map((c) => c[0])).toEqual(['fw-old', 'fw-new']);
	});
	it('keeps static assets available offline', async () => {
		const w = worker();
		w.match.mockResolvedValue(new Response('script'));
		let response!: Promise<Response>;
		w.handlers.get('fetch')!({
			request: { method: 'GET', mode: 'cors', url: 'https://example.test/_app/app.js' },
			respondWith: (r: Promise<Response>) => {
				response = r;
			}
		});
		expect(await (await response).text()).toBe('script');
		expect(w.fetch).not.toHaveBeenCalled();
	});
});
