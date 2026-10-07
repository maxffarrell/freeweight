import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

/** Splits a comma-separated list of signing secrets. */
export const secretList = (value: string | undefined) =>
	(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

/**
 * Verifies a delivery signed per the Standard Webhooks spec
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64> …`).
 */
export function verifyStandardWebhook(
	body: string,
	headers: Headers,
	secrets: string[],
	now = Date.now()
) {
	const id = headers.get('webhook-id');
	const timestamp = headers.get('webhook-timestamp');
	const signatures = headers.get('webhook-signature');
	if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
	if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

	const provided = signatures
		.split(' ')
		.map((s) => s.split(','))
		.filter(([version, sig]) => version === 'v1' && sig)
		.map(([, sig]) => Buffer.from(sig!, 'base64'));
	const content = `${id}.${timestamp}.${body}`;
	return secrets.some((secret) => {
		const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
		const expected = createHmac('sha256', key).update(content).digest();
		return provided.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
	});
}

/** Signs a payload the way a Standard Webhooks sender does. Used in tests. */
export function signStandardWebhook(body: string, id: string, timestamp: number, secret: string) {
	const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
	return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}
