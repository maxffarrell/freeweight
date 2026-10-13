/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
/**
 * Freeweight PWA service worker.
 * - Precaches the built client assets + static files at install.
 * - Navigations: network-only, falling back to /offline.html.
 * - Precached assets: cache-first.
 * - Everything else (remote functions, API calls, mutations) goes straight to
 *   the network — never cache non-GET or dynamic app data.
 */
import { assets, immutable, prerendered } from '$app/manifest';
import { version } from '$app/env';
import { asset } from '$app/paths';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `fw-static-v2-${version}`;
const OFFLINE = asset('/offline.html');

// Manifest paths may lack a leading '/', so normalize before matching
// against url.pathname (which always has one).
const slash = (p: string) => (p.startsWith('/') ? p : `/${p}`);
const ASSETS = new Set([
	...immutable.map((f) => slash(f.path)),
	...prerendered.map((f) => slash(f.path)),
	...assets.map((f) => asset(f.path)),
	OFFLINE
]);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...ASSETS]))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k.startsWith('fw-') && k !== CACHE).map((k) => caches.delete(k))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Precached build/static asset: cache-first.
	if (ASSETS.has(url.pathname)) {
		event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
		return;
	}

	// Authenticated HTML and bearer-link pages must never enter a shared URL cache.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(
				async () => (await caches.match(OFFLINE)) ?? new Response('Offline', { status: 503 })
			)
		);
		return;
	}

	// Everything else — remote functions, __data.json, REST, uploads — is
	// dynamic app data and goes straight to the network. Caching it would
	// serve stale (and potentially cross-user) responses.
});
