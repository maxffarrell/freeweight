import type { IncomingMessage } from 'node:http';

/** Forwarded client addresses are trusted only from explicitly configured socket peers. */
export function setClientAddress(
	req: Pick<IncomingMessage, 'headers' | 'socket'>,
	configuredPeers = ''
) {
	const trustedPeers = configuredPeers
		.split(',')
		.map((ip) => ip.trim())
		.filter(Boolean);
	if (!trustedPeers.includes(req.socket.remoteAddress ?? '') || !req.headers['x-forwarded-for'])
		req.headers['x-forwarded-for'] = req.socket.remoteAddress;
}
