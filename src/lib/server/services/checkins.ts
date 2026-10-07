import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, desc, eq, gte } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { checkIn, gymMember, location } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

function sign(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`checkin:${payload}`).digest('base64url');
}

/** The token inside a member's portal QR code: `fw1.<memberId>.<sig>`. Stateless, revocable only by rotating the secret. */
export function checkInToken(memberId: string) {
	return `fw1.${memberId}.${sign(memberId)}`;
}

export function verifyCheckInToken(token: string) {
	const m = /^fw1\.([0-9a-f-]{36})\.([\w-]+)$/.exec(token.trim());
	if (!m) return null;
	const [, memberId, sig] = m;
	const expected = Buffer.from(sign(memberId));
	const given = Buffer.from(sig);
	return expected.length === given.length && timingSafeEqual(expected, given) ? memberId : null;
}

/** Records a check-in from a QR token or a member id typed by staff. */
export async function recordCheckIn(ctx: OrgContext, input: v.InferOutput<typeof s.checkInInput>) {
	const memberId = verifyCheckInToken(input.code) ?? input.code;
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'No member for that code — check the QR or search by name');
	const [row] = await db
		.insert(checkIn)
		.values({
			organizationId: ctx.orgId,
			memberId,
			locationId: input.locationId ?? m.locationId,
			method: verifyCheckInToken(input.code) ? 'qr' : 'manual'
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'check_in',
		entityId: row!.id,
		action: 'recorded',
		summary: `${m.name} checked in`
	});
	return { checkIn: row!, member: m };
}

export async function listTodayCheckIns(orgId: string, since: Date) {
	return db
		.select({ checkIn, memberName: gymMember.name, locationName: location.name })
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.leftJoin(location, eq(checkIn.locationId, location.id))
		.where(and(eq(checkIn.organizationId, orgId), gte(checkIn.checkedAt, since)))
		.orderBy(desc(checkIn.checkedAt));
}
