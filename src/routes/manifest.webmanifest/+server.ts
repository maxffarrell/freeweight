import type { RequestHandler } from './$types';

/** PWA manifest — keeps the kiosk/portal installable on desk tablets and phones. */
export const GET: RequestHandler = () =>
	new Response(
		JSON.stringify({
			name: 'Freeweight',
			short_name: 'Freeweight',
			description: 'Gym management — schedule, members, billing, kiosk check-in',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			orientation: 'any',
			background_color: '#09090b',
			theme_color: '#18181b',
			icons: [
				{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
				{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
				{ src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
			]
		}),
		{ headers: { 'content-type': 'application/manifest+json' } }
	);
