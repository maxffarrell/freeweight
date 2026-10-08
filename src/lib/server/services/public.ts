import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, getTableColumns, gte, isNull, ne, sql, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	gymMember,
	gymSettings,
	memberNote,
	memberTag,
	membership,
	waiver,
	location,
	member,
	organization,
	plan,
	outer,
	user
} from '#lib/server/db/schema.ts';
import { localDate } from '#lib/tz.ts';
import { emit } from './events.ts';
import {
	createMembership,
	getPlan,
	markPromoUsed,
	promoApply,
	promoState,
	redeemablePromo
} from './billing.ts';
import { notifyReferralJoin } from './notifications.ts';
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
		.select({
			...getTableColumns(plan),
			packClassName: classType.name,
			activeMembers:
				sql<number>`(select count(*) from ${membership} m where m.plan_id = ${outer(plan.id)} and m.status = 'active')`.mapWith(
					Number
				)
		})
		.from(plan)
		.leftJoin(classType, eq(plan.classTypeId, classType.id))
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
			instructorName: user.name,
			dropInPrice: classType.dropInPrice,
			booked:
				sql<number>`(select count(*) + coalesce(sum(b.guest_count), 0) from ${booking} b where b.session_id = ${outer(classSession.id)} and b.status = 'booked')`.mapWith(
					Number
				)
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
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

/** First name of the member behind a ?ref= link, for the "Invited by X" line. Public-safe. */
export async function referrerName(slug: string, ref: string) {
	const { org } = await getPublicGym(slug);
	const [r] = await db
		.select({ name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.id, ref), eq(gymMember.organizationId, org.id)))
		.limit(1);
	return r?.name.split(' ')[0] ?? null;
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

	// ?ref=<memberId> referral link — only counts when the referrer is a member of this gym.
	let referrer: { id: string; name: string; email: string | null } | undefined;
	if (input.referredById) {
		[referrer] = await db
			.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
			.from(gymMember)
			.where(and(eq(gymMember.id, input.referredById), eq(gymMember.organizationId, org.id)))
			.limit(1);
	}

	const [m] = await db
		.insert(gymMember)
		.values({
			organizationId: org.id,
			name: input.name,
			email: input.email,
			phone: input.phone ?? null,
			referralSource: input.referralSource ?? (referrer ? 'Friend or family' : null),
			referredByMemberId: referrer?.id ?? null,
			joinedAt: new Date().toISOString().slice(0, 10)
		})
		.returning();
	// Promo code — validated before the membership is created so a bad code fails the join.
	const promo = input.promoCode?.trim() ? await redeemablePromo(org.id, input.promoCode) : null;

	let checkoutUrl: string | null = null;
	if (input.planId) {
		const p = await getPlan(org.id, input.planId);
		if (p.listed && p.active) {
			await createMembership(
				{ orgId: org.id },
				{ memberId: m!.id, planId: input.planId },
				promo ?? undefined
			);
			if (promo) await markPromoUsed(org.id, promo.id);
			checkoutUrl = await signupCheckout(org.id, slug, settings, p, m!.id, input.email, promo);
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
	if (referrer) {
		await emit({
			orgId: org.id,
			entityType: 'member',
			entityId: referrer.id,
			action: 'referred',
			summary: `${referrer.name} referred ${input.name}`,
			data: { newMemberId: m!.id }
		});
		notifyReferralJoin(org.id, referrer.id, m!.id).catch(() => {});
	}
	return { member: m!, existing: false, checkoutUrl };
}

const leadRate = new Map<string, number[]>();

/**
 * Public lead form → member tagged `lead` (+ a staff note with their interest).
 * Same unauthenticated + rate-limited + honeypot treatment as joinGym; staff find
 * leads via the members list's "No plan" filter or the `lead` tag.
 */
export async function captureLead(
	slug: string,
	ip: string,
	input: v.InferOutput<typeof s.leadInput>
) {
	if (input.website) error(400, 'Invalid form'); // honeypot
	const now = Date.now();
	const hits = (leadRate.get(ip) ?? []).filter((t) => now - t < 3600_000);
	if (hits.length >= 10) error(429, 'Too many attempts — try again later');
	leadRate.set(ip, [...hits, now]);

	const { org } = await getPublicGym(slug);

	const [existing] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, org.id), eq(gymMember.email, input.email)))
		.limit(1);
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
	await db.insert(memberTag).values({ organizationId: org.id, memberId: m!.id, tag: 'lead' });
	if (input.interest) {
		await db.insert(memberNote).values({
			organizationId: org.id,
			memberId: m!.id,
			body: `Lead form: ${input.interest}`
		});
	}
	await emit({
		orgId: org.id,
		entityType: 'member',
		entityId: m!.id,
		action: 'lead',
		summary: `${input.name} left their info on the public page`
	});
	return { member: m!, existing: false };
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
	email: string | null,
	promo?: { code: string; percentOff: number | null; amountOff: number | null } | null
) {
	// A pack's whole price is paid up front alongside any signup fee; a promo
	// discounts the same total the membership charges were reduced by.
	const state = promo ? promoState(promo) : null;
	const amount = promo
		? promoApply(promo, state!, p.signupFee) + (p.isPack ? promoApply(promo, state!, p.amount) : 0)
		: p.signupFee + (p.isPack ? p.amount : 0);
	return onlineCheckout(
		orgId,
		settings,
		{
			amount,
			description: `${p.isPack ? 'Class pack' : 'Signup fee'} — ${p.name}${promo ? ` (${promo.code})` : ''}`,
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
			.select({
				count: sql<number>`count(*) + coalesce(sum(${booking.guestCount}), 0)`.mapWith(Number)
			})
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

/**
 * Visitor buying a day pass on the public page — creates the member (tagged `day-pass`),
 * posts a "Day pass" charge due today, and returns an online checkout URL when a
 * provider is live (otherwise staff collect at the desk).
 */
export async function buyDayPass(
	slug: string,
	ip: string,
	input: v.InferOutput<typeof s.dayPassInput>
) {
	const now = Date.now();
	const hits = (dropInRate.get(ip) ?? []).filter((t) => now - t < 3600_000);
	if (hits.length >= 10) error(429, 'Too many attempts — try again later');
	dropInRate.set(ip, [...hits, now]);

	const { org, settings } = await getPublicGym(slug);
	if (!settings?.dayPassPrice) error(404, 'Not sold online');
	if (settings?.waiver && !input.agreedWaiver) error(400, 'Please agree to the waiver');
	const email = input.email.toLowerCase();
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
	if (!m) {
		await db
			.insert(memberTag)
			.values({ organizationId: org.id, memberId: member.id, tag: 'day-pass' });
	}
	if (settings?.waiver) await recordWaiver(org.id, member.id, settings.waiver);

	const today = localDate(new Date(), settings.timezone);
	const [dup] = await db
		.select({ id: charge.id })
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, org.id),
				eq(charge.memberId, member.id),
				eq(charge.kind, 'dropin'),
				eq(charge.dueDate, today),
				ne(charge.status, 'void')
			)
		)
		.limit(1);
	if (dup) error(409, "You already have a pass for today — you're all set");

	const [c] = await db
		.insert(charge)
		.values({
			organizationId: org.id,
			memberId: member.id,
			kind: 'dropin',
			description: `Day pass — ${today}`,
			dueDate: today,
			amount: settings.dayPassPrice
		})
		.returning();

	const checkoutUrl = await onlineCheckout(
		org.id,
		settings,
		{
			amount: settings.dayPassPrice,
			description: `Day pass — ${org.name}`,
			memberId: member.id,
			email
		},
		{ success: `/j/${slug}?daypass=paid`, cancel: `/j/${slug}` }
	);

	await emit({
		orgId: org.id,
		entityType: 'charge',
		entityId: c.id,
		action: 'daypass',
		summary: `${input.name} bought a day pass for ${today}`
	});
	return { member, chargeId: c.id, checkoutUrl };
}
