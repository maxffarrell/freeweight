import type { IncomingMessage } from 'node:http';

/** Forwarded client addresses are trusted only from explicitly configured socket peers. */
export function setClientAddress(
	req: { headers: IncomingMessage['headers']; socket: { remoteAddress?: string } },
	configuredPeers = ''
) {
	const trustedPeers = configuredPeers
		.split(',')
		.map((ip) => ip.trim())
		.filter(Boolean);
	if (!trustedPeers.includes(req.socket.remoteAddress ?? '') || !req.headers['x-forwarded-for'])
		req.headers['x-forwarded-for'] = req.socket.remoteAddress;
}
