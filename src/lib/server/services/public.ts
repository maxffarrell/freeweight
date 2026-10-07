import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, isNull, sql, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	gymMember,
	gymSettings,
	waiver,
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
			dropInPrice: classType.dropInPrice,
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
	if (settings?.waiver && !input.agreedWaiver) error(400, 'Please agree to the waiver');
	if (existing) {
		await recordWaiver(org.id, existing.id, settings!.waiver);
		return { member: existing, existing: true };
	}

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
	if (settings?.waiver) await recordWaiver(org.id, m!.id, settings.waiver);
	await emit({
		orgId: org.id,
		entityType: 'member',
		entityId: m!.id,
		action: 'joined',
		summary: `${input.name} joined from the public page`
	});
	return { member: m!, existing: false, checkoutUrl };
}

/** First live online provider's checkout URL for a one-off amount, or null when none is ready. */
async function onlineCheckout(
	orgId: string,
	settings: { currency: string } | undefined,
	item: { amount: number; description: string; memberId: string; email: string | null },
	paths: { success: string; cancel: string }
) {
	if (item.amount <= 0) return null;
	const currency = settings?.currency ?? 'usd';
	for (const provider of providers) {
		if (!provider.configured() || !provider.supportsCurrency(currency)) continue;
		const row = await providerRow(orgId, provider.id);
		if (!provider.ready(row)) continue;
		return provider.checkout({
			orgId,
			memberId: item.memberId,
			email: item.email,
			amount: item.amount,
			currency,
			description: item.description,
			paths,
			row
		});
	}
	return null;
}

/**
 * When the chosen plan has a signup fee and an online provider is live for the workspace,
 * returns a checkout URL so the new member can pay it right on the join page.
 */
async function signupCheckout(
	orgId: string,
	slug: string,
	settings: { currency: string } | undefined,
	p: { name: string; signupFee: number; isPack: boolean; amount: number },
	memberId: string,
	email: string | null
) {
	// A pack's whole price is paid up front alongside any signup fee.
	const amount = p.signupFee + (p.isPack ? p.amount : 0);
	return onlineCheckout(
		orgId,
		settings,
		{
			amount,
			description: `${p.isPack ? 'Class pack' : 'Signup fee'} — ${p.name}`,
			memberId,
			email
		},
		{ success: `/j/${slug}?paid=1`, cancel: `/j/${slug}` }
	);
}

/** Stores the exact waiver text the member agreed to. */
async function recordWaiver(orgId: string, memberId: string, text: string) {
	const [signed] = await db
		.select({ text: waiver.text })
		.from(waiver)
		.where(eq(waiver.memberId, memberId))
		.orderBy(desc(waiver.signedAt))
		.limit(1);
	// Re-sign only when the gym's waiver text changed.
	if (signed?.text === text) return;
	await db.insert(waiver).values({ organizationId: orgId, memberId, text });
}

const dropInRate = new Map<string, number[]>();

/**
 * Visitor books one class on the public page: member (reused by email), `dropin` charge,
 * `booked` row, and — when a provider is live — a checkout link to pay for it now.
 * Without a provider the booking still lands; the member pays at the desk.
 */
export async function bookDropIn(
	slug: string,
	ip: string,
	input: v.InferOutput<typeof s.dropInInput>
) {
	const now = Date.now();
	const hits = (dropInRate.get(ip) ?? []).filter((t) => now - t < 3600_000);
	if (hits.length >= 10) error(429, 'Too many attempts — try again later');
	dropInRate.set(ip, [...hits, now]);

	const { org, settings } = await getPublicGym(slug);
	if (settings?.waiver && !input.agreedWaiver) error(400, 'Please agree to the waiver');
	const email = input.email!.toLowerCase();
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, org.id), eq(gymMember.email, email)))
		.limit(1);
	const member =
		m ??
		(
			await db
				.insert(gymMember)
				.values({
					organizationId: org.id,
					name: input.name,
					email,
					phone: input.phone ?? null,
					joinedAt: new Date().toISOString().slice(0, 10)
				})
				.returning()
		)[0];
	if (settings?.waiver) await recordWaiver(org.id, member.id, settings.waiver);

	const { b, className, price } = await db.transaction(async (tx) => {
		const [sess] = await tx
			.select({
				id: classSession.id,
				capacity: classSession.capacity,
				startsAt: classSession.startsAt,
				cancelledAt: classSession.cancelledAt,
				price: classType.dropInPrice,
				className: classType.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(classSession.organizationId, org.id), eq(classSession.id, input.sessionId)))
			.for('update');
		if (!sess) error(404, 'Class not found');
		if (sess.cancelledAt || sess.startsAt.getTime() <= Date.now())
			error(409, 'This class is not open for drop-ins');
		if (sess.price == null || sess.price <= 0) error(409, 'This class is not sold online');

		const [existing] = await tx
			.select()
			.from(booking)
			.where(and(eq(booking.sessionId, sess.id), eq(booking.memberId, member.id)));
		if (existing && existing.status !== 'cancelled') error(409, 'Already booked into this class');

		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(booking)
			.where(and(eq(booking.sessionId, sess.id), eq(booking.status, 'booked')));
		if (count >= sess.capacity) error(409, 'This class is full');

		let row;
		if (existing) {
			[row] = await tx
				.update(booking)
				.set({ status: 'booked', cancelledAt: null, createdAt: new Date() })
				.where(eq(booking.id, existing.id))
				.returning();
		} else {
			[row] = await tx
				.insert(booking)
				.values({
					organizationId: org.id,
					sessionId: sess.id,
					memberId: member.id,
					status: 'booked'
				})
				.returning();
		}
		await tx.insert(charge).values({
			organizationId: org.id,
			memberId: member.id,
			kind: 'dropin',
			description: `Drop-in — ${sess.className} ${sess.startsAt.toISOString().slice(0, 10)}`,
			dueDate: sess.startsAt.toISOString().slice(0, 10),
			amount: sess.price
		});
		return { b: row, className: sess.className, price: sess.price };
	});

	const checkoutUrl = await onlineCheckout(
		org.id,
		settings,
		{
			amount: price ?? 0,
			description: `Drop-in — ${className}`,
			memberId: member.id,
			email
		},
		{ success: `/j/${slug}?dropin=paid`, cancel: `/j/${slug}` }
	);

	await emit({
		orgId: org.id,
		entityType: 'booking',
		entityId: b.id,
		action: 'dropin',
		summary: `${input.name} booked a drop-in for ${className}`
	});
	return { member, bookingId: b.id, checkoutUrl };
}
