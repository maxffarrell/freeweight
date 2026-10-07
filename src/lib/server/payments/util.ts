import { createHmac, timingSafeEqual } from 'node:crypto';

/** Minor units → provider decimal string (`123456` → `"1234.56"`). Freeweight stores 2-decimal amounts. */
export const toDecimal = (minor: number) => (minor / 100).toFixed(2);

/** Provider decimal string → minor units. Returns 0 for anything malformed. */
export function fromDecimal(value: string | null | undefined) {
	if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) return 0;
	const [whole, frac = ''] = value.split('.');
	return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Org and member, packed into one provider reference field (`<orgId>:<memberId>`). */
export const memberRef = (orgId: string, memberId: string) => `${orgId}:${memberId}`;

export function parseMemberRef(ref: unknown) {
	if (typeof ref !== 'string') return null;
	const m = /^([\w-]{1,64}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
		ref
	);
	return m ? { orgId: m[1], memberId: m[2] } : null;
}

/** HMAC-SHA256 of `prefix + body`, compared in constant time against any of `secrets`. */
export function hmacValid(
	body: string,
	signature: string | null,
	secrets: string[],
	encoding: 'hex' | 'base64',
	prefix = ''
) {
	if (!signature) return false;
	const got = Buffer.from(signature.trim(), encoding);
	return secrets.some((secret) => {
		const want = createHmac('sha256', secret)
			.update(prefix + body)
			.digest();
		return want.length === got.length && timingSafeEqual(want, got);
	});
}
