/* @license Enterprise */

import { createHmac } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { activity, gymSettings } from '#lib/server/db/schema.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import { sendEmail } from '#lib/server/email.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { orgBrand } from '../org-brand.ts';
import { hasFeature } from '#lib/server/features.ts';

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
	if (a && a.lockedUntil > now) {
		await db.insert(activity).values({
			organizationId: orgId,
			entityType: 'security',
			entityId: 'kiosk-pin',
			action: 'pin_rejected_locked',
			summary: 'Kiosk PIN attempt rejected — pad locked',
			data: { reason: 'locked pad' }
		});
		return 'locked';
	}
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
	await db.insert(activity).values({
		organizationId: orgId,
		entityType: 'security',
		entityId: 'kiosk-pin',
		action: locked ? 'pin_locked' : 'pin_failed',
		summary: locked ? 'Kiosk PIN locked after 5 failed tries' : 'Wrong kiosk PIN entered',
		data: locked ? { fails } : { fails, max: MAX_FAILS }
	});
	if (locked) void notifyPinLocked(orgId);
	return locked ? 'locked' : 'wrong';
}

/** Owner/admin alert when the pad locks — a 5-fail lock means someone's guessing. */
async function notifyPinLocked(orgId: string) {
	try {
		const staff = await db
			.select({ email: user.email })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
		if (!staff.length) return;
		const brand = await orgBrand(orgId);
		for (const s of staff) {
			await sendEmail({
				to: s.email,
				subject: `${brand.orgName} — kiosk PIN locked`,
				...renderEmail({
					...brand,
					heading: 'Kiosk PIN locked',
					lines: [
						'The self-serve kiosk PIN was just locked after 5 failed attempts.',
						"If this wasn't your team, change the PIN from Settings → Kiosk PIN."
					]
				})
			});
		}
	} catch {
		// alert delivery must never block PIN verification
	}
}
