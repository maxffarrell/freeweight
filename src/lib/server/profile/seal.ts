import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const keyFor = (secret: string) =>
	Buffer.from(hkdfSync('sha256', secret, 'freeweight-profile', 'oauth-tokens', 32));

/** Encrypts a token with AES-256-GCM under a key derived from the server secret. */
export function seal(secret: string, plain: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return ['v1', iv, cipher.getAuthTag(), ct]
		.map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
		.join('.');
}

export function unseal(secret: string, sealed: string) {
	const [v, iv, tag, ct, extra] = sealed.split('.');
	if (v !== 'v1' || !iv || !tag || ct === undefined || extra !== undefined)
		throw new Error('Unreadable token');
	const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(iv, 'base64url'), {
		authTagLength: 16
	});
	decipher.setAuthTag(Buffer.from(tag, 'base64url'));
	return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
		'utf8'
	);
}
