/* @license Enterprise */

import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { gymSettings } from '#lib/server/db/schema.ts';
import { hasFeature } from '#lib/server/ee/license.ts';

/**
 * The PIN is stored HMAC'd — the plaintext never leaves the settings writer
 * and is never sent to the kiosk page (unlike the original client-compare).
 * Legacy plaintext rows self-upgrade on the first successful verify.
 */
export function hashKioskPin(pin: string): string {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`kiosk-pin:${pin}`).digest('hex');
}

/** Per-org brute-force guard: 5 wrong entries locks the pad for a minute. */
const attempts = new Map<string, { fails: number; lockedUntil: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

export type PinResult = 'ok' | 'wrong' | 'locked' | 'disabled';

export async function verifyKioskPin(orgId: string, pin: string): Promise<PinResult> {
	if (!hasFeature('kiosk-pin')) return 'disabled';
	const now = Date.now();
	const a = attempts.get(orgId);
	if (a && a.lockedUntil > now) return 'locked';
	const [s] = await db
		.select({ pin: gymSettings.kioskPin })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.pin) return 'disabled';
	let ok = hashKioskPin(pin) === s.pin;
	const legacy = !ok && s.pin.length !== 64 && pin === s.pin;
	ok = ok || legacy;
	if (ok) {
		attempts.delete(orgId);
		if (legacy)
			await db
				.update(gymSettings)
				.set({ kioskPin: hashKioskPin(pin), kioskPinLen: pin.length })
				.where(eq(gymSettings.organizationId, orgId));
		return 'ok';
	}
	const fails = (a?.fails ?? 0) + 1;
	const locked = fails >= MAX_FAILS;
	attempts.set(orgId, { fails: locked ? 0 : fails, lockedUntil: locked ? now + LOCK_MS : 0 });
	return locked ? 'locked' : 'wrong';
}
