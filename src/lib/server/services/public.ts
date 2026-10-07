import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, isNull, sql, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	organization,
	plan,
	outer
} from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import { createMembership, getPlan } from './billing.ts';
import { providers } from '../payments/index.ts';
import { providerRow } from '../payments/settings.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

/** Public gym page at /j/[slug]: identity, listed plans, and the week's schedule. */
export async function getPublicGym(slug: string) {
	const [org] = await db.select().from(organization).where(eq(organization.slug, slug));
	if (!org) error(404, 'Not found');
	const [settings] = await db
		.select()
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, org.id));
	if (!settings?.publicPage) error(404, 'Not found');

	const plans = await db
		.select()
		.from(plan)
		.where(and(eq(plan.organizationId, org.id), eq(plan.active, true), eq(plan.listed, true)))
		.orderBy(asc(plan.amount));

	const now = new Date();
	const week = new Date(now.getTime() + 7 * 86400_000);
	const sessions = await db
		.select({
			session: classSession,
			className: classType.name,
			color: classType.color,
			locationName: location.name,
			booked:
				sql<number>`(select count(*) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'booked')`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(classSession.organizationId, org.id),
				gte(classSession.startsAt, now),
				lt(classSession.startsAt, week),
				isNull(classSession.cancelledAt)
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(60);

	return { org, settings, plans, sessions };
}

const joinRate = new Map<string, number[]>();

/**
 * Public join form → member record (+ optional membership). Rate-limited per IP and
 * honeypot-guarded; staff see the new member on the dashboard.
 */
export async function joinGym(slug: string, ip: string, input: v.InferOutput<typeof s.joinInput>) {
	if (input.website) error(400, 'Invalid form'); // honeypot
	const now = Date.now();
	const hits = (joinRate.get(ip) ?? []).filter((t) => now - t < 3600_000);
	if (hits.length >= 10) error(429, 'Too many attempts — try again later');
	joinRate.set(ip, [...hits, now]);

	const { org, settings } = await getPublicGym(slug);

	// Reuse an existing member with the same email rather than duplicating.
	const [existing] = input.email
		? await db
				.select()
				.from(gymMember)
				.where(and(eq(gymMember.organizationId, org.id), eq(gymMember.email, input.email)))
				.limit(1)
		: [];
	if (existing) return { member: existing, existing: true };

	const [m] = await db
		.insert(gymMember)
		.values({
			organizationId: org.id,
			name: input.name,
			email: input.email,
			phone: input.phone ?? null,
			joinedAt: new Date().toISOString().slice(0, 10)
		})
		.returning();
	let checkoutUrl: string | null = null;
	if (input.planId) {
		const p = await getPlan(org.id, input.planId);
		if (p.listed && p.active) {
			await createMembership({ orgId: org.id }, { memberId: m!.id, planId: input.planId });
			checkoutUrl = await signupCheckout(org.id, slug, settings, p, m!.id, input.email);
		}
	}
	await emit({
		orgId: org.id,
		entityType: 'member',
		entityId: m!.id,
		action: 'joined',
		summary: `${input.name} joined from the public page`
	});
	return { member: m!, existing: false, checkoutUrl };
}

/**
 * When the chosen plan has a signup fee and an online provider is live for the workspace,
 * returns a checkout URL so the new member can pay it right on the join page.
 */
async function signupCheckout(
	orgId: string,
	slug: string,
	settings: { currency: string } | undefined,
	p: { name: string; signupFee: number },
	memberId: string,
	email: string | null
) {
	if (p.signupFee <= 0) return null;
	const currency = settings?.currency ?? 'usd';
	for (const provider of providers) {
		if (!provider.configured() || !provider.supportsCurrency(currency)) continue;
		const row = await providerRow(orgId, provider.id);
		if (!provider.ready(row)) continue;
		return provider.checkout({
			orgId,
			memberId,
			email,
			amount: p.signupFee,
			currency,
			description: `Signup fee — ${p.name}`,
			paths: { success: `/j/${slug}?paid=1`, cancel: `/j/${slug}` },
			row
		});
	}
	return null;
}
