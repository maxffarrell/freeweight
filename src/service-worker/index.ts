/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { assets, immutable, prerendered } from '$app/manifest';
import { version } from '$app/env';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `fw-${version}`;
const ASSETS = [
	...immutable.map((i) => i.path),
	...assets.map((a) => a.path),
	...prerendered.map((p) => p.path),
	'/offline.html'
].map((p) => (p.startsWith('/') ? p : `/${p}`));

self.addEventListener('install', (e) => {
	e.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(ASSETS))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (e) => {
	const { request } = e;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	// Never cache app data or auth — remote functions, API and auth flows stay live.
	if (
		url.pathname.startsWith('/api/') ||
		url.pathname.startsWith('/_app/remote') ||
		url.pathname.includes('/auth')
	)
		return;

	// Precached build + static assets: cache-first.
	if (ASSETS.includes(url.pathname)) {
		e.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
		return;
	}

	// Navigations + everything else: network-first, fall back to cache, then the
	// offline page so the kiosk still shows something during a wifi blip.
	e.respondWith(
		fetch(request)
			.then((res) => {
				if (res.ok && request.mode === 'navigate') {
					const copy = res.clone();
					caches.open(CACHE).then((c) => c.put(request, copy));
				}
				return res;
			})
			.catch(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;
				if (request.mode === 'navigate') return (await caches.match('/offline.html'))!;
				throw new Error('offline');
			})
	);
});
