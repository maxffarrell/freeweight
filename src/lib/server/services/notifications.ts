import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	notInArray,
	or,
	sql
} from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	booking,
	challenge,
	charge,
	checkIn,
	classSession,
	classTemplate,
	classType,
	course,
	courseEnrollment,
	eventRegistration,
	facilityResource,
	gymEvent,
	gymMember,
	gymSettings,
	location,
	member,
	membership,
	memberTag,
	notificationLog,
	organization,
	payment,
	plan,
	recurringAnnouncement,
	announcementTemplate,
	resourceBooking,
	rota,
	sessionFeedback,
	shopItem,
	signRequest,
	user,
	waiver
} from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import { appOrigin, emailProvider, sendEmail } from '#lib/server/email.ts';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import type { Email } from '#lib/server/email.ts';
import { formatDate, formatMoney } from '#lib/format.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { addDays, localDate, localMinutes, localTime, localWeekday, zonedToUtc } from '#lib/tz.ts';
import { entryProgress } from './challenges.ts';

async function orgBrand(orgId: string) {
	const [o, s] = await Promise.all([
		db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, orgId))
			.limit(1),
		db
			.select({ logoDocumentId: gymSettings.logoDocumentId })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1)
	]);
	return {
		orgName: o[0]?.name ?? 'your gym',
		logoUrl: s[0]?.logoDocumentId ? `${appOrigin()}/api/logo/${s[0].logoDocumentId}` : undefined
	};
}

async function orgTimezone(orgId: string) {
	const [s] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	return s?.timezone ?? 'UTC';
}

// ---------- Member opt-out ----------

/** Signed token behind the Unsubscribe footer link in member-facing emails. */
export function unsubscribeToken(memberId: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET)
		.update(`unsub:${memberId}`)
		.digest('hex')
		.slice(0, 32);
}

export function validUnsubscribeToken(memberId: string, token: string) {
	const a = Buffer.from(unsubscribeToken(memberId));
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

const unsubscribeUrl = (memberId: string) =>
	`${appOrigin()}/unsubscribe?m=${memberId}&t=${unsubscribeToken(memberId)}`;

/** Signed token behind the portal's "Sync to calendar" .ics feed URL. */
export function calendarToken(memberId: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET)
		.update(`ical:${memberId}`)
		.digest('hex')
		.slice(0, 32);
}

export function validCalendarToken(memberId: string, token: string) {
	const a = Buffer.from(calendarToken(memberId));
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * sendEmail for member-facing mail: skips members who unsubscribed and appends
 * the signed Unsubscribe footer every marketing/notification email needs.
 */
async function sendMemberEmail(memberId: string | null | undefined, args: Email) {
	if (memberId) {
		const [m] = await db
			.select({ unsubscribedAt: gymMember.unsubscribedAt })
			.from(gymMember)
			.where(eq(gymMember.id, memberId));
		if (m?.unsubscribedAt) return;
	}
	if (memberId) {
		const url = unsubscribeUrl(memberId);
		args = {
			...args,
			text: `${args.text}\n\nUnsubscribe: ${url}`,
			html: args.html.replace(
				'Sent by ',
				`<a href="${url}" style="color:#a1a1aa">Unsubscribe</a> · Sent by `
			)
		};
	}
	await sendEmail(args);
}

/** Writes one notification_log row per (kind, entity, recipient), so repeats are no-ops. */
async function logOnce(orgId: string, kind: string, entityId: string, recipient: string) {
	const [row] = await db
		.insert(notificationLog)
		.values({ organizationId: orgId, kind, entityId, recipient })
		.onConflictDoNothing()
		.returning();
	return !!row;
}

/** "You're in" when a waitlisted member gets promoted into a booked spot. */
export async function notifyWaitlistPromoted(orgId: string, bookingId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(eq(booking.id, bookingId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'waitlist_promoted', bookingId, row.email))) return;
	const [name, settings] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const date = localDate(row.startsAt, settings);
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `You're in: ${row.className} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `You're off the waitlist, ${row.memberName}`,
			lines: [
				`A spot opened up in ${row.className} on ${date} at ${localTime(row.startsAt, settings)}.`,
				'Your booking is confirmed — see you there.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "You're booked" (or waitlisted) right after bookSession lands. One email per booking. */
export async function notifyBookingConfirmed(orgId: string, bookingId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt,
			status: booking.status
		})
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(eq(booking.id, bookingId));
	if (!row?.email) return;
	const waitlisted = row.status === 'waitlisted';
	if (!(await logOnce(orgId, 'booking_confirmed', bookingId, row.email))) return;
	const [name, settings] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, settings)} at ${localTime(row.startsAt, settings)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: waitlisted
			? `Waitlisted: ${row.className} at ${name.orgName}`
			: `Booked: ${row.className} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: waitlisted
				? `You're on the waitlist, ${row.memberName}`
				: `You're booked, ${row.memberName}`,
			lines: waitlisted
				? [
						`${row.className} on ${when} is full — you're on the waitlist.`,
						"We'll email you the moment a spot opens."
					]
				: [`${row.className} on ${when}.`, 'You can cancel any time from your member portal.'],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "Slot reserved" right after an amenity booking lands. One email per reservation. */
export async function notifyResourceBooked(orgId: string, resourceBookingId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			resourceName: facilityResource.name,
			startsAt: resourceBooking.startsAt,
			locationName: location.name
		})
		.from(resourceBooking)
		.innerJoin(gymMember, eq(resourceBooking.memberId, gymMember.id))
		.innerJoin(facilityResource, eq(resourceBooking.resourceId, facilityResource.id))
		.leftJoin(location, eq(facilityResource.locationId, location.id))
		.where(eq(resourceBooking.id, resourceBookingId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'resource_booked', resourceBookingId, row.email))) return;
	const [name, settings] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, settings)} at ${localTime(row.startsAt, settings)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Reserved: ${row.resourceName} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `You're in, ${row.memberName}`,
			lines: [
				`${row.resourceName} on ${when}${row.locationName ? ` at ${row.locationName}` : ''}.`,
				'You can cancel any time from your member portal.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "You're registered" right after an event signup lands. One email per registration. */
export async function notifyEventRegistered(orgId: string, registrationId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			eventName: gymEvent.name,
			startsAt: gymEvent.startsAt,
			locationName: location.name,
			price: gymEvent.price
		})
		.from(eventRegistration)
		.innerJoin(gymMember, eq(eventRegistration.memberId, gymMember.id))
		.innerJoin(gymEvent, eq(eventRegistration.eventId, gymEvent.id))
		.leftJoin(location, eq(gymEvent.locationId, location.id))
		.where(eq(eventRegistration.id, registrationId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'event_registered', registrationId, row.email))) return;
	const [name, st] = await Promise.all([
		orgBrand(orgId),
		db
			.select({ timezone: gymSettings.timezone, currency: gymSettings.currency })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.then((r) => r[0])
	]);
	const tz = st?.timezone ?? 'UTC';
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Registered: ${row.eventName} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `You're registered, ${row.memberName}`,
			lines: [
				`${row.eventName} on ${when}${row.locationName ? ` at ${row.locationName}` : ''}.`,
				row.price
					? `A ${formatMoney(row.price, st?.currency ?? 'usd')} signup charge was added to your balance.`
					: 'See you there.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "You're on the waitlist" when a member registers for a full event. */
export async function notifyEventWaitlisted(orgId: string, registrationId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			eventName: gymEvent.name,
			startsAt: gymEvent.startsAt
		})
		.from(eventRegistration)
		.innerJoin(gymMember, eq(eventRegistration.memberId, gymMember.id))
		.innerJoin(gymEvent, eq(eventRegistration.eventId, gymEvent.id))
		.where(eq(eventRegistration.id, registrationId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'event_waitlisted', registrationId, row.email))) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Waitlist: ${row.eventName} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `You're on the waitlist, ${row.memberName}`,
			lines: [
				`${row.eventName} on ${when} is full — you're on the waitlist.`,
				"We'll email you the moment a spot opens up."
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "Event cancelled" to every registrant when staff cancels an event. */
export async function notifyEventCancelled(orgId: string, registrationId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			eventName: gymEvent.name,
			startsAt: gymEvent.startsAt,
			price: gymEvent.price
		})
		.from(eventRegistration)
		.innerJoin(gymMember, eq(eventRegistration.memberId, gymMember.id))
		.innerJoin(gymEvent, eq(eventRegistration.eventId, gymEvent.id))
		.where(eq(eventRegistration.id, registrationId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'event_cancelled', registrationId, row.email))) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Cancelled: ${row.eventName} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `${row.eventName} is cancelled`,
			lines: [
				`Hi ${row.memberName} — ${row.eventName} on ${when} has been cancelled.`,
				row.price
					? "Any unpaid signup charge was voided; if you already paid, we'll sort a refund."
					: 'Sorry for the change — hope to see you at the next one.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * One summary email when staff book a member into a recurring series — the
 * per-session confirmation emails are suppressed, this replaces them.
 */
export async function notifySeriesBooked(
	orgId: string,
	memberId: string,
	className: string,
	counts: { booked: number; waitlisted: number },
	weeks: number
) {
	const [row, name] = await Promise.all([
		db
			.select({ email: gymMember.email, memberName: gymMember.name })
			.from(gymMember)
			.where(eq(gymMember.id, memberId))
			.limit(1),
		orgBrand(orgId)
	]);
	const m = row[0];
	if (!m?.email || (!counts.booked && !counts.waitlisted)) return;
	const parts = counts.booked
		? [
				`We booked you into ${counts.booked} ${className} class${counts.booked === 1 ? '' : 'es'} over the next ${weeks} weeks.`
			]
		: [`All the upcoming ${className} classes are full — you're on the waitlist.`];
	if (counts.booked && counts.waitlisted)
		parts[0] += ` ${counts.waitlisted} more ${counts.waitlisted === 1 ? 'is' : 'are'} full — you're on the waitlist.`;
	parts.push('See times and cancel any of them from your member portal.');
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `You're in: ${className} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `You're booked in, ${m.memberName}`,
			lines: parts,
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * Price-change notice — emailed to active members on a plan whose amount just
 * changed (and who have no custom price override). Required billing notice,
 * not marketing.
 */
export async function notifyPlanPriceChange(
	orgId: string,
	planName: string,
	memberIds: string[],
	oldAmount: number,
	newAmount: number,
	interval: string
) {
	if (!memberIds.length) return;
	const [name, st] = await Promise.all([
		orgBrand(orgId),
		db
			.select({ currency: gymSettings.currency })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1)
	]);
	const currency = st[0]?.currency ?? 'usd';
	const rows = await db
		.select({ id: gymMember.id, email: gymMember.email, memberName: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), inArray(gymMember.id, memberIds)));
	const each = ` per ${interval}`;
	for (const m of rows) {
		if (!m.email) continue;
		await sendMemberEmail(m.id, {
			to: m.email,
			subject: `Your ${planName} rate is changing at ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `Heads up, ${m.memberName}`,
				lines: [
					`Your ${planName} membership changes from ${formatMoney(oldAmount, currency)}${each} to ${formatMoney(newAmount, currency)}${each} on your next billing date.`,
					'Questions? Reply to this email or see us at the front desk.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
	}
}

/**
 * Receipt for a recorded payment — one email per recordPayment call.
 * `paymentIds` covers the split rows a payment can allocate across; dedup on the first.
 */
export async function notifyPaymentReceived(
	orgId: string,
	paymentIds: string[],
	amount: number,
	method: string
) {
	if (paymentIds.length === 0) return;
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			balanceMemberId: payment.memberId
		})
		.from(payment)
		.innerJoin(gymMember, eq(payment.memberId, gymMember.id))
		.where(eq(payment.id, paymentIds[0]!));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'payment_received', paymentIds[0]!, row.email))) return;
	const [name, st] = await Promise.all([
		orgBrand(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const money = formatMoney(amount, st[0]?.currency ?? 'usd');
	await sendMemberEmail(row.balanceMemberId, {
		to: row.email,
		subject: `Payment received: ${money} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `Thanks, ${row.memberName} — ${money} received`,
			lines: [
				`${name.orgName} received your ${money} payment (${method}).`,
				'Any remaining balance shows in your member portal.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "Your payment was refunded" — one email per refundPayment call. */
export async function notifyPaymentRefunded(orgId: string, paymentId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			amount: payment.amount
		})
		.from(payment)
		.innerJoin(gymMember, eq(payment.memberId, gymMember.id))
		.where(eq(payment.id, paymentId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'payment_refunded', paymentId, row.email))) return;
	const [name, st] = await Promise.all([
		orgBrand(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const money = formatMoney(row.amount, st[0]?.currency ?? 'usd');
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Refund issued: ${money} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `Hi ${row.memberName} — ${money} refunded`,
			lines: [
				`${name.orgName} issued a ${money} refund to you.`,
				'If a charge was reopened it will show in your member portal.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * Daily past-due notice: one email per member with open charges older than today (org tz),
 * summarizing the total overdue. Dedup key includes the newest overdue dueDate, so a member
 * is re-notified when another charge goes overdue but not re-pinged daily for the same set.
 */
export async function sendPastDueNotices(orgId: string) {
	const tz = await orgTimezone(orgId);
	const today = localDate(new Date(), tz);
	const rows = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			amount: charge.amount,
			dueDate: charge.dueDate
		})
		.from(charge)
		.innerJoin(gymMember, eq(charge.memberId, gymMember.id))
		.where(
			and(eq(charge.organizationId, orgId), eq(charge.status, 'open'), lt(charge.dueDate, today))
		);
	if (!rows.length) return 0;
	const byMember = new Map<
		string,
		{ email: string | null; memberName: string; total: number; count: number; newest: string }
	>();
	for (const r of rows) {
		const g = byMember.get(r.memberId) ?? {
			email: r.email,
			memberName: r.memberName,
			total: 0,
			count: 0,
			newest: r.dueDate
		};
		g.total += r.amount;
		g.count++;
		if (r.dueDate > g.newest) g.newest = r.dueDate;
		byMember.set(r.memberId, g);
	}
	const [name, st] = await Promise.all([
		orgBrand(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const currency = st[0]?.currency ?? 'usd';
	let sent = 0;
	for (const [memberId, g] of byMember) {
		if (!g.email) continue;
		if (!(await logOnce(orgId, 'past_due', `${memberId}:${g.newest}`, g.email))) continue;
		const total = formatMoney(g.total, currency);
		await sendMemberEmail(memberId, {
			to: g.email,
			subject: `Payment due: ${total} at ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `${total} is past due`,
				lines: [
					`Hi ${g.memberName} — you have ${g.count} overdue ${g.count === 1 ? 'charge' : 'charges'} totaling ${total} at ${name.orgName}.`,
					'You can pay online from the member portal.'
				],
				action: { label: 'Pay in the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * "Your trial ends soon" to members whose first billing is within 2 days —
 * a still-trialing membership has a trialDays plan and no charge posted yet.
 * One email per membership (logOnce 'trial_ending').
 */
export async function sendTrialEndingNotices(orgId: string) {
	const soon = new Date(Date.now() + 2 * 86400_000);
	const rows = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			planName: plan.name,
			amount: plan.amount,
			interval: plan.interval,
			nextChargeAt: membership.nextChargeAt,
			membershipId: membership.id
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				gt(plan.trialDays, 0),
				lte(membership.nextChargeAt, soon),
				sql`not exists (select 1 from ${charge} c where c.membership_id = ${membership.id})`
			)
		);
	if (!rows.length) return 0;
	const [name, tz, st] = await Promise.all([
		orgBrand(orgId),
		orgTimezone(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const currency = st[0]?.currency ?? 'usd';
	let sent = 0;
	for (const r of rows) {
		if (!r.email || !r.nextChargeAt) continue;
		if (!(await logOnce(orgId, 'trial_ending', r.membershipId, r.email))) continue;
		const amount = formatMoney(r.amount, currency);
		const date = localDate(r.nextChargeAt, tz);
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `Your free trial at ${name.orgName} ends ${date}`,
			...renderEmail({
				...name,
				heading: 'Your trial is almost up',
				lines: [
					`Hi ${r.memberName} — your free trial of ${r.planName} at ${name.orgName} ends ${date}.`,
					`Your first payment of ${amount}/${r.interval} posts that day. Questions about your plan? Just reply to this email or stop by the front desk.`
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * "Happy birthday" to members whose birthday is today in the gym's timezone.
 * One email per member per year (logOnce 'birthday', memberId:year).
 */
export async function sendBirthdayGreetings(orgId: string) {
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);
	const mmdd = today.slice(5);
	const year = today.slice(0, 4);
	const rows = await db
		.select({ memberId: gymMember.id, email: gymMember.email, memberName: gymMember.name })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				sql`to_char(${gymMember.birthday}, 'MM-DD') = ${mmdd}`
			)
		);
	if (!rows.length) return 0;
	let sent = 0;
	for (const r of rows) {
		if (!r.email) continue;
		if (!(await logOnce(orgId, 'birthday', `${r.memberId}:${year}`, r.email))) continue;
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `Happy birthday, ${r.memberName.split(' ')[0]}!`,
			...renderEmail({
				...name,
				heading: 'Happy birthday!',
				lines: [
					`Hi ${r.memberName} — everyone at ${name.orgName} is wishing you a great birthday.`,
					'See you at the gym — first workout of the year is on you.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Daily cron: "N years at the gym" on each member's join-date anniversary
 * (skipped on the join day itself — years >= 1 only). Once per year per member.
 */
export async function sendAnniversaryGreetings(orgId: string) {
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);
	const mmdd = today.slice(5);
	const year = Number(today.slice(0, 4));
	const rows = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			joinYear: sql<number>`to_char(${gymMember.joinedAt}, 'YYYY')`.mapWith(Number)
		})
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				sql`to_char(${gymMember.joinedAt}, 'MM-DD') = ${mmdd}`,
				sql`to_char(${gymMember.joinedAt}, 'YYYY-MM-DD') < ${today}`
			)
		);
	if (!rows.length) return 0;
	let sent = 0;
	for (const r of rows) {
		if (!r.email) continue;
		if (!(await logOnce(orgId, 'anniversary', `${r.memberId}:${year}`, r.email))) continue;
		const years = year - r.joinYear;
		if (years < 1) continue;
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `${years} ${years === 1 ? 'year' : 'years'} at ${name.orgName} — happy anniversary, ${r.memberName.split(' ')[0]}`,
			...renderEmail({
				...name,
				heading: `Happy ${years}-year anniversary`,
				lines: [
					`Hi ${r.memberName} — ${years} ${years === 1 ? 'year' : 'years'} ago today you joined ${name.orgName}, and we're glad you did.`,
					'Thanks for being part of the community.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/** "You just referred someone" to the member behind a ?ref= join. One email per referred member. */
export async function notifyReferralJoin(orgId: string, referrerId: string, newMemberId: string) {
	const [[referrer], [joined]] = await Promise.all([
		db
			.select({ name: gymMember.name, email: gymMember.email })
			.from(gymMember)
			.where(and(eq(gymMember.id, referrerId), eq(gymMember.organizationId, orgId))),
		db
			.select({ name: gymMember.name })
			.from(gymMember)
			.where(and(eq(gymMember.id, newMemberId), eq(gymMember.organizationId, orgId)))
	]);
	if (!referrer?.email || !joined) return;
	if (!(await logOnce(orgId, 'referral_join', newMemberId, referrer.email))) return;
	const name = await orgBrand(orgId);
	await sendMemberEmail(referrerId, {
		to: referrer.email,
		subject: `${joined.name} just joined ${name.orgName} from your link`,
		...renderEmail({
			...name,
			heading: 'Your referral worked',
			lines: [
				`Hi ${referrer.name} — ${joined.name} just signed up at ${name.orgName} using your referral link.`,
				'Thanks for spreading the word — keep sharing your link from the member portal.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/** "Class cancelled" to every booked/waitlisted member of the session. One email per member. */
export async function notifySessionCancelled(orgId: string, sessionId: string) {
	const rows = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(
			and(eq(booking.sessionId, sessionId), inArray(booking.status, ['booked', 'waitlisted']))
		);
	if (!rows.length) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	for (const row of rows) {
		if (!row.email) continue;
		if (!(await logOnce(orgId, 'session_cancelled', sessionId, row.email))) continue;
		const date = localDate(row.startsAt, tz);
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `${row.className} on ${date} is cancelled`,
			...renderEmail({
				...name,
				heading: `${row.className} is cancelled`,
				lines: [
					`Hi ${row.memberName} — ${row.className} at ${name.orgName} on ${date} at ${localTime(row.startsAt, tz)} has been cancelled.`,
					'Check the member portal for the rest of this week’s schedule.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
	}
}

/**
 * "Your booking was cancelled" — confirms the cancel to the member, whether they
 * cancelled in the portal or staff pulled their spot. One email per booking (idempotent).
 */
export async function notifyBookingCancelled(orgId: string, bookingId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt,
			locationName: location.name
		})
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(eq(booking.id, bookingId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'booking_cancelled', bookingId, row.email))) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Cancelled: ${row.className} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `Your ${row.className} booking is cancelled`,
			lines: [
				`Hi ${row.memberName} — your ${row.className} spot on ${when}${row.locationName ? ` at ${row.locationName}` : ''} has been cancelled.`,
				'Any class credit it used is back on your membership.'
			],
			action: { label: 'Rebook in the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * "Your instructor changed" — one email per booked/waitlisted member when a session's
 * instructor is swapped. Dedup key includes the new instructor id so a re-sub notifies again.
 */
export async function notifyInstructorChanged(orgId: string, sessionId: string) {
	const [sess] = await db
		.select({
			instructorId: classSession.instructorId,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(eq(classSession.id, sessionId));
	if (!sess) return;
	const [instr] = sess.instructorId
		? await db
				.select({ name: user.name })
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(eq(member.id, sess.instructorId))
				.limit(1)
		: [undefined];
	const rows = await db
		.select({ memberId: gymMember.id, email: gymMember.email, memberName: gymMember.name })
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.where(
			and(eq(booking.sessionId, sessionId), inArray(booking.status, ['booked', 'waitlisted']))
		);
	if (!rows.length) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const date = `${localDate(sess.startsAt, tz)} at ${localTime(sess.startsAt, tz)}`;
	const who = instr?.name ?? 'a new instructor';
	for (const row of rows) {
		if (!row.email) continue;
		if (
			!(await logOnce(
				orgId,
				'instructor_changed',
				`${sessionId}:${sess.instructorId ?? 'none'}`,
				row.email
			))
		)
			continue;
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `${sess.className} on ${localDate(sess.startsAt, tz)}: now taught by ${who}`,
			...renderEmail({
				...name,
				heading: `Instructor change for ${sess.className}`,
				lines: [
					`Hi ${row.memberName} — your ${sess.className} at ${name.orgName} on ${date} is now taught by ${who}.`,
					'Everything else about the class is unchanged.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
	}
}

/**
 * "Your class moved" — one email per booked/waitlisted member when a session's start
 * time or location changes. Dedup key carries the new values so each reschedule notifies once.
 */
export async function notifySessionChanged(orgId: string, sessionId: string) {
	const [sess] = await db
		.select({
			startsAt: classSession.startsAt,
			locationId: classSession.locationId,
			className: classType.name,
			locationName: location.name
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(eq(classSession.id, sessionId));
	if (!sess) return;
	const rows = await db
		.select({ memberId: gymMember.id, email: gymMember.email, memberName: gymMember.name })
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.where(
			and(eq(booking.sessionId, sessionId), inArray(booking.status, ['booked', 'waitlisted']))
		);
	if (!rows.length) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const when = `${localDate(sess.startsAt, tz)} at ${localTime(sess.startsAt, tz)}`;
	const where = sess.locationName ? ` at ${sess.locationName}` : '';
	for (const row of rows) {
		if (!row.email) continue;
		if (
			!(await logOnce(
				orgId,
				'session_changed',
				`${sessionId}:${sess.startsAt.toISOString()}:${sess.locationId ?? ''}`,
				row.email
			))
		)
			continue;
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `${sess.className} moved — now ${when}${where}`,
			...renderEmail({
				...name,
				heading: `${sess.className} has moved`,
				lines: [
					`Hi ${row.memberName} — your ${sess.className} at ${name.orgName} is now ${when}${where}.`,
					'Your booking carries over — nothing to rebook.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
	}
}

/**
 * "Your class is tomorrow" — one email per booked member for sessions starting in the
 * next ~24h (the cron runs daily, so each session is caught exactly once).
 * Returns the number of emails sent.
 */
export async function sendClassReminders(orgId: string) {
	const soon = new Date(Date.now() + 26 * 3600_000);
	const rows = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt,
			bookingId: booking.id,
			locationName: location.name
		})
		.from(booking)
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.status, 'booked'),
				gte(classSession.startsAt, new Date()),
				lte(classSession.startsAt, soon),
				isNull(classSession.cancelledAt)
			)
		);
	if (!rows.length) return 0;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	let sent = 0;
	for (const row of rows) {
		if (!row.email) continue;
		if (!(await logOnce(orgId, 'class_reminder', row.bookingId, row.email))) continue;
		const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `Tomorrow: ${row.className} at ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `See you tomorrow, ${row.memberName}`,
				lines: [
					`You're booked into ${row.className} on ${when}${row.locationName ? ` at ${row.locationName}` : ''}.`,
					'Need to change it? Cancel or rebook in the member portal.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/** Daily cron: reminds registered members when their event starts within ~26h. */
export async function sendEventReminders(orgId: string) {
	const soon = new Date(Date.now() + 26 * 3600_000);
	const rows = await db
		.select({
			registrationId: eventRegistration.id,
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			eventName: gymEvent.name,
			startsAt: gymEvent.startsAt,
			locationName: location.name
		})
		.from(eventRegistration)
		.innerJoin(gymMember, eq(eventRegistration.memberId, gymMember.id))
		.innerJoin(gymEvent, eq(eventRegistration.eventId, gymEvent.id))
		.leftJoin(location, eq(gymEvent.locationId, location.id))
		.where(
			and(
				eq(eventRegistration.organizationId, orgId),
				eq(eventRegistration.status, 'registered'),
				eq(gymEvent.active, true),
				gte(gymEvent.startsAt, new Date()),
				lte(gymEvent.startsAt, soon)
			)
		);
	if (!rows.length) return 0;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	let sent = 0;
	for (const row of rows) {
		if (!row.email) continue;
		if (!(await logOnce(orgId, 'event_reminder', row.registrationId, row.email))) continue;
		const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `Tomorrow: ${row.eventName} at ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `See you tomorrow, ${row.memberName}`,
				lines: [
					`You're registered for ${row.eventName} on ${when}${row.locationName ? ` at ${row.locationName}` : ''}.`,
					'Can’t make it? Cancel in the member portal so someone else gets the spot.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/** Day-before reminder for amenity reservations (sauna, court, child care). */
export async function sendResourceReminders(orgId: string) {
	const soon = new Date(Date.now() + 26 * 3600_000);
	const rows = await db
		.select({
			bookingId: resourceBooking.id,
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			resourceName: facilityResource.name,
			startsAt: resourceBooking.startsAt,
			locationName: location.name
		})
		.from(resourceBooking)
		.innerJoin(gymMember, eq(resourceBooking.memberId, gymMember.id))
		.innerJoin(facilityResource, eq(resourceBooking.resourceId, facilityResource.id))
		.leftJoin(location, eq(facilityResource.locationId, location.id))
		.where(
			and(
				eq(resourceBooking.organizationId, orgId),
				eq(resourceBooking.status, 'booked'),
				gte(resourceBooking.startsAt, new Date()),
				lte(resourceBooking.startsAt, soon)
			)
		);
	if (!rows.length) return 0;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	let sent = 0;
	for (const row of rows) {
		if (!row.email) continue;
		if (!(await logOnce(orgId, 'amenity_reminder', row.bookingId, row.email))) continue;
		const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `Tomorrow: ${row.resourceName} at ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `Your ${row.resourceName} slot is tomorrow`,
				lines: [
					`Hi ${row.memberName.split(' ')[0] ?? row.memberName} — you're booked for ${row.resourceName} on ${when}${row.locationName ? ` at ${row.locationName}` : ''}.`,
					'Can’t make it? Cancel in the member portal so someone else gets the slot.'
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * "Almost out of classes" nudge — once per pack membership (notification_log),
 * when the remaining credits hit ≤2. Returns whether the mail went out.
 */
export async function notifyPackLowCredit(
	orgId: string,
	memberId: string,
	remaining: number,
	limit: number,
	membershipId: string
) {
	const [m] = await db
		.select({ email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m?.email || !(await logOnce(orgId, 'pack-low-credit', membershipId, m.email))) return false;
	const name = await orgBrand(orgId);
	const first = m.name.split(' ')[0] ?? m.name;
	const heading =
		remaining > 0
			? `${remaining} class${remaining === 1 ? '' : 'es'} left on your pack`
			: 'Your class pack is used up';
	const { text, html } = renderEmail({
		...name,
		heading,
		lines: [
			`Hi ${first},`,
			remaining > 0
				? `You've used ${limit - remaining} of ${limit} classes on your pack at ${name.orgName}.`
				: `You've used all ${limit} classes on your pack at ${name.orgName}.`,
			'Grab a new pack anytime from the member portal.'
		],
		action: { label: 'Buy a pack', url: `${appOrigin()}/portal` }
	});
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `${name.orgName}: ${heading}`,
		text,
		html
	});
	return true;
}

/**
 * "X gave you N classes" to the recipient of a pack-credit transfer.
 * `transferId` is unique per transfer, so re-sends on retries still log once.
 */
export async function notifyCreditsGifted(
	orgId: string,
	transferId: string,
	toMemberId: string,
	fromName: string,
	credits: number
) {
	const [m] = await db
		.select({ email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, toMemberId)));
	if (!m?.email || !(await logOnce(orgId, 'credits-gifted', transferId, m.email))) return;
	const name = await orgBrand(orgId);
	const first = m.name.split(' ')[0] ?? m.name;
	const heading = `${fromName} gave you ${credits} class${credits === 1 ? '' : 'es'}`;
	const { text, html } = renderEmail({
		...name,
		heading,
		lines: [
			`Hi ${first},`,
			`${fromName} passed ${credits} of their class-pack credits to you at ${name.orgName}.`,
			'Book your next class from the member portal.'
		],
		action: { label: 'Book a class', url: `${appOrigin()}/portal` }
	});
	await sendMemberEmail(toMemberId, {
		to: m.email,
		subject: `${name.orgName}: ${heading}`,
		text,
		html
	});
}

/**
 * Referral bounty: when a member referred via a ?ref= link records their first
 * non-refunded payment, the referrer earns `gymSettings.referralCredits` bonus
 * credits on their active membership. Called after every recordPayment; returns
 * false unless a reward actually went out. Once per referred member via
 * notification_log; skipped entirely when the bounty is unset or the referrer
 * has no active membership to credit.
 */
export async function notifyReferralReward(orgId: string, paidMemberId: string) {
	const [s] = await db
		.select({ referralCredits: gymSettings.referralCredits })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const credits = s?.referralCredits ?? 0;
	if (credits <= 0) return false;
	const [joined] = await db
		.select({ name: gymMember.name, referredByMemberId: gymMember.referredByMemberId })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, paidMemberId)));
	if (!joined?.referredByMemberId) return false;
	// Only the member's first payment earns the bounty.
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				eq(payment.memberId, paidMemberId),
				isNull(payment.refundedAt)
			)
		);
	if (n !== 1) return false;
	const [referrer] = await db
		.select({ name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, joined.referredByMemberId)));
	if (!referrer?.email) return false;
	const [ms] = await db
		.select({ id: membership.id })
		.from(membership)
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, joined.referredByMemberId),
				eq(membership.status, 'active')
			)
		)
		.limit(1);
	if (!ms) return false;
	if (!(await logOnce(orgId, 'referral_reward', paidMemberId, referrer.email))) return false;
	await db
		.update(membership)
		.set({ bonusCredits: sql`${membership.bonusCredits} + ${credits}` })
		.where(eq(membership.id, ms.id));
	const name = await orgBrand(orgId);
	await sendMemberEmail(joined.referredByMemberId, {
		to: referrer.email,
		subject: `${name.orgName}: you earned ${credits} class credits`,
		...renderEmail({
			...name,
			heading: `You earned ${credits} class credits`,
			lines: [
				`Hi ${referrer.name} — ${joined.name} just became a paying member at ${name.orgName} using your referral link.`,
				`${credits} bonus class credit${credits === 1 ? ' is' : 's are'} on your membership — book your next class in the portal.`,
				'Keep sharing your referral link to earn more.'
			],
			action: { label: 'Book a class', url: `${appOrigin()}/portal` }
		})
	});
	return true;
}

/**
 * Daily sweep: active members with no current-version waiver signature get one
 * reminder email each (once per member per waiver version via notification_log
 * — the portal also prompts on every visit). No-op when the gym hasn't
 * configured waiver text.
 */
/** Day-one invite: a challenge that starts today (org tz) emails every active member. */
export async function sendChallengeInvites(orgId: string) {
	const tz = await orgTimezone(orgId);
	const today = localDate(new Date(), tz);
	const rows = await db
		.select()
		.from(challenge)
		.where(
			and(
				eq(challenge.organizationId, orgId),
				eq(challenge.active, true),
				eq(challenge.startDate, today)
			)
		);
	if (!rows.length) return 0;
	const members = await db
		.select({ id: gymMember.id, email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				isNotNull(gymMember.email)
			)
		);
	if (!members.length) return 0;
	const name = await orgBrand(orgId);
	let sent = 0;
	for (const c of rows) {
		for (const m of members) {
			if (!m.email) continue;
			if (!(await logOnce(orgId, 'challenge_invite', c.id, m.email))) continue;
			await sendMemberEmail(m.id, {
				to: m.email,
				subject: `New challenge: ${c.name} at ${name.orgName}`,
				...renderEmail({
					...name,
					heading: `${c.name} starts today`,
					lines: [
						c.description ||
							`Check in ${c.goal} times between ${c.startDate} and ${c.endDate} to finish.`,
						`Goal: ${c.goal} check-ins, ${c.startDate} → ${c.endDate}.${c.prize ? ` Prize: ${c.prize}.` : ''} Join in the member portal.`
					],
					action: { label: 'Join the challenge', url: `${appOrigin()}/portal` }
				})
			});
			sent++;
		}
	}
	return sent;
}

/** Day after a challenge ends: every participant gets their final rank and the result. */
export async function sendChallengeResults(orgId: string) {
	const tz = await orgTimezone(orgId);
	const yesterday = addDays(localDate(new Date(), tz), -1);
	const rows = await db
		.select()
		.from(challenge)
		.where(and(eq(challenge.organizationId, orgId), eq(challenge.endDate, yesterday)));
	if (!rows.length) return 0;
	const name = await orgBrand(orgId);
	let sent = 0;
	for (const c of rows) {
		const entries = await entryProgress(
			orgId,
			c.id,
			zonedToUtc(`${c.startDate}T00:00`, tz),
			zonedToUtc(`${addDays(c.endDate, 1)}T00:00`, tz)
		);
		if (!entries.length) continue;
		const finishers = entries.filter((e) => e.count >= c.goal);
		const top = entries[0]!;
		for (const [i, e] of entries.entries()) {
			const email = e.memberEmail;
			if (!email) continue;
			if (!(await logOnce(orgId, 'challenge_results', `${c.id}:${e.entry.memberId}`, email)))
				continue;
			const finished = e.count >= c.goal;
			await sendMemberEmail(e.entry.memberId, {
				to: email,
				subject: `${c.name} — final results at ${name.orgName}`,
				...renderEmail({
					...name,
					heading: `${c.name} has ended`,
					lines: [
						finished
							? `You finished it — ${e.count} check-ins against a ${c.goal}-check-in goal. Nice work.`
							: `You logged ${e.count} of ${c.goal} check-ins.`,
						`You placed #${i + 1} of ${entries.length} participants.${
							finishers.length
								? ` ${finishers.length} member${finishers.length === 1 ? '' : 's'} hit the goal — led by ${top.memberName} (${top.count}).`
								: ` Top scorer: ${top.memberName} (${top.count}).`
						}`
					],
					action: { label: 'See the leaderboard', url: `${appOrigin()}/portal` }
				})
			});
			sent++;
		}
	}
	return sent;
}

export async function sendWaiverReminders(orgId: string) {
	const [s] = await db
		.select({ waiver: gymSettings.waiver })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	if (!s?.waiver) return 0;
	const unsigned = await db
		.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				isNotNull(gymMember.email),
				sql`not exists (select 1 from ${waiver} w where w.member_id = ${gymMember.id} and w.text = ${s.waiver})`
			)
		);
	// Version tag so members who signed an older waiver get re-nudged once per edit.
	let versionHash = 5381;
	for (const c of s.waiver) versionHash = (versionHash * 33) ^ c.charCodeAt(0);
	const version = (versionHash >>> 0).toString(36);
	const name = await orgBrand(orgId);
	let sent = 0;
	for (const m of unsigned) {
		if (!m.email || !(await logOnce(orgId, 'waiver_reminder', `${m.id}:${version}`, m.email)))
			continue;
		const first = m.name.split(' ')[0] ?? m.name;
		await sendMemberEmail(m.id, {
			to: m.email,
			subject: `${name.orgName}: please sign your waiver`,
			...renderEmail({
				...name,
				heading: 'Please sign your waiver',
				lines: [
					`Hi ${first},`,
					`Before your next visit to ${name.orgName}, take a minute to review and sign the liability waiver.`,
					'It shows up automatically the next time you open the member portal.'
				],
				action: { label: 'Open the portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Staff-prompted "you owe $X" email — member-page "Request payment" button.
 * At most one per member per day (notification_log keyed on member+date), and
 * skipped entirely when the balance is already ≤0. Balance math mirrors
 * billing.ts memberBalance (open charge remainders minus unapplied payments);
 * duplicated here because billing.ts already imports this module.
 */
export async function requestPaymentNotice(orgId: string, memberId: string) {
	const [m] = await db
		.select({ name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m?.email) return false;
	const [b] = await db
		.select({
			balance:
				sql<number>`coalesce(sum(case when ${charge.status} = 'open' then ${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${charge.id} and p.refunded_at is null), 0) else 0 end), 0) - coalesce((select sum(p2.amount) from ${payment} p2 where p2.member_id = ${memberId} and p2.charge_id is null and p2.refunded_at is null), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.memberId, memberId)));
	const amount = b?.balance ?? 0;
	if (amount <= 0) return false;
	const day = new Date().toISOString().slice(0, 10);
	if (!(await logOnce(orgId, 'payment_request', `${memberId}:${day}`, m.email))) return false;
	const name = await orgBrand(orgId);
	const [st] = await db
		.select({ currency: gymSettings.currency })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const first = m.name.split(' ')[0] ?? m.name;
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `${name.orgName}: you have a balance due`,
		...renderEmail({
			...name,
			heading: 'You have a balance due',
			lines: [
				`Hi ${first},`,
				`Your open balance at ${name.orgName} is ${formatMoney(amount, st?.currency ?? 'usd')}.`,
				'You can pay it anytime from the member portal.'
			],
			action: { label: 'Pay online', url: `${appOrigin()}/portal` }
		})
	});
	return true;
}

/**
 * Billing "Email all" — runs the payment-request notice for every member with
 * an unpaid open charge. requestPaymentNotice re-checks the net balance, the
 * once-per-day cap, and the unsubscribe list per member. Returns how many of
 * the debtors actually got an email.
 */
export async function requestAllPaymentNotices(orgId: string) {
	const debtors = await db
		.select({ memberId: charge.memberId })
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.status, 'open')))
		.groupBy(charge.memberId)
		.having(
			sql`sum(${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${charge.id} and p.refunded_at is null), 0)) > 0`
		);
	let sent = 0;
	for (const d of debtors) if (await requestPaymentNotice(orgId, d.memberId)) sent++;
	return { debtors: debtors.length, sent };
}

/** Replaces {name} and {first_name} merge tags in an announcement draft. */
export function mergeTags(t: string, memberName: string) {
	const first = memberName.trim().split(/\s+/)[0] ?? memberName;
	return t.replaceAll('{first_name}', first).replaceAll('{name}', memberName);
}

/** Sends one preview of the draft announcement to the staff user composing it. */
export async function sendAnnouncementTest(
	orgId: string,
	userId: string,
	subject: string,
	message: string
) {
	if (!emailProvider()) error(409, 'No email provider configured');
	const [u] = await db
		.select({ email: user.email, name: user.name })
		.from(user)
		.where(eq(user.id, userId));
	if (!u?.email) error(400, 'Your account has no email address');
	const name = await orgBrand(orgId);
	const { text, html } = renderEmail({
		...name,
		heading: mergeTags(subject, u.name),
		lines: mergeTags(message, u.name).split(/\n+/).filter(Boolean),
		action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
	});
	await sendEmail({
		to: u.email,
		subject: `[Test] ${name.orgName}: ${mergeTags(subject, u.name)}`,
		text,
		html
	});
	return { sent: 1 };
}

/**
 * Staff announcement to every active member with an email on file.
 * Requires a real email provider — 409s when mail isn't configured so the
 * front desk isn't misled by a logged-but-unsent batch. Resending the exact
 * same subject+body is a no-op per member (notification_log 'announcement').
 */
export async function sendAnnouncement(
	orgId: string,
	subject: string,
	message: string,
	memberIds?: string[],
	tag?: string,
	planId?: string
) {
	if (!emailProvider()) error(409, 'No email provider configured');
	const members = await db
		.select({ id: gymMember.id, email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				memberIds?.length ? inArray(gymMember.id, memberIds) : undefined,
				tag
					? sql`exists (select 1 from ${memberTag} t where t.member_id = ${gymMember.id} and t.organization_id = ${orgId} and t.tag = ${tag})`
					: undefined,
				planId ? membersOnPlan(orgId, planId) : undefined,
				isNull(gymMember.unsubscribedAt),
				sql`${gymMember.email} is not null and ${gymMember.email} <> ''`
			)
		)
		.limit(1000);
	if (!members.length) return { sent: 0, total: 0 };
	const name = await orgBrand(orgId);
	const planName = planId
		? await db
				.select({ name: plan.name })
				.from(plan)
				.where(and(eq(plan.id, planId), eq(plan.organizationId, orgId)))
				.then((r) => r[0]?.name ?? null)
		: null;
	const entityId = `announcement:${subject}::${message}`;
	// {name} / {first_name} merge tags personalize per member; without them
	// the body renders once and is shared.
	const personalized = subject.includes('{') || message.includes('{');
	const render = (memberName: string) =>
		renderEmail({
			...name,
			heading: mergeTags(subject, memberName),
			lines: mergeTags(message, memberName).split(/\n+/).filter(Boolean),
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		});
	const shared = personalized ? null : render('');
	let sent = 0;
	for (const m of members) {
		if (!m.email || !(await logOnce(orgId, 'announcement', entityId, m.email))) continue;
		const { text, html } = personalized ? render(m.name) : shared!;
		await sendMemberEmail(m.id, {
			to: m.email,
			subject: `${name.orgName}: ${mergeTags(subject, m.name)}`,
			text,
			html
		});
		sent++;
	}
	await emit({
		orgId,
		actorId: null,
		entityType: 'announcement',
		entityId,
		action: 'sent',
		summary: `Announcement sent to ${sent} member${sent === 1 ? '' : 's'}: ${subject}`,
		data: { subject, message, sent, total: members.length, tag: tag ?? null, plan: planName }
	});
	return { sent, total: members.length };
}

/** EXISTS clause: the member holds an active membership on this plan. */
const membersOnPlan = (orgId: string, planId: string) =>
	sql`exists (select 1 from ${membership} mm where mm.member_id = ${gymMember.id} and mm.organization_id = ${orgId} and mm.status = 'active' and mm.plan_id = ${planId})`;

/** Recipients an announcement would reach — same filter as sendAnnouncement, count only. */
export async function countAnnouncementAudience(orgId: string, tag?: string, planId?: string) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				tag
					? sql`exists (select 1 from ${memberTag} t where t.member_id = ${gymMember.id} and t.organization_id = ${orgId} and t.tag = ${tag})`
					: undefined,
				planId ? membersOnPlan(orgId, planId) : undefined,
				isNull(gymMember.unsubscribedAt),
				sql`${gymMember.email} is not null and ${gymMember.email} <> ''`
			)
		);
	return n;
}

/** Queues an announcement for a later send time; the cron delivers it. */
export async function scheduleAnnouncement(
	orgId: string,
	actorId: string | null | undefined,
	opts: { subject: string; message: string; sendAt: Date; tag?: string; planId?: string }
) {
	if (opts.sendAt.getTime() <= Date.now()) error(400, 'Pick a send time in the future');
	if (!opts.tag && !opts.planId && !(await countAnnouncementAudience(orgId)))
		error(409, 'No members to email');
	const entityId = `scheduled:${crypto.randomUUID()}`;
	await emit({
		orgId,
		actorId: actorId ?? null,
		entityType: 'announcement',
		entityId,
		action: 'scheduled',
		summary: `Announcement scheduled for ${opts.sendAt.toISOString()}: ${opts.subject}`,
		data: {
			subject: opts.subject,
			message: opts.message,
			sendAt: opts.sendAt.toISOString(),
			tag: opts.tag ?? null,
			planId: opts.planId ?? null
		}
	});
	return { scheduledFor: opts.sendAt };
}

/**
 * Delivers scheduled announcements whose time has come — runs from the daily
 * cron per org. Each pending row goes through sendAnnouncement (which logs
 * its own 'sent' history row), then the 'scheduled' placeholder is deleted.
 */
export async function sendDueAnnouncements(orgId: string) {
	const due = await db
		.select({
			id: activity.id,
			subject: sql<string>`${activity.data}->>'subject'`,
			message: sql<string>`${activity.data}->>'message'`,
			tag: sql<string | null>`${activity.data}->>'tag'`,
			planId: sql<string | null>`${activity.data}->>'planId'`
		})
		.from(activity)
		.where(
			and(
				eq(activity.organizationId, orgId),
				eq(activity.entityType, 'announcement'),
				eq(activity.action, 'scheduled'),
				sql`(${activity.data}->>'sendAt')::timestamptz <= now()`
			)
		);
	let sent = 0;
	for (const a of due) {
		await sendAnnouncement(
			orgId,
			a.subject,
			a.message,
			undefined,
			a.tag ?? undefined,
			a.planId ?? undefined
		);
		await db.delete(activity).where(eq(activity.id, a.id));
		sent++;
	}
	return sent;
}

// ---------- Recurring announcements (weekly sends the cron delivers) ----------

export async function listRecurringAnnouncements(orgId: string) {
	return db
		.select({ rule: recurringAnnouncement, planName: plan.name })
		.from(recurringAnnouncement)
		.leftJoin(plan, eq(plan.id, recurringAnnouncement.planId))
		.where(eq(recurringAnnouncement.organizationId, orgId))
		.orderBy(recurringAnnouncement.weekday, recurringAnnouncement.time);
}

export async function createRecurringAnnouncement(
	orgId: string,
	actorId: string | null | undefined,
	input: {
		subject: string;
		message: string;
		tag?: string;
		planId?: string | null;
		weekday: number;
		time: string;
	}
) {
	const [row] = await db
		.insert(recurringAnnouncement)
		.values({
			organizationId: orgId,
			subject: input.subject.trim().slice(0, 150),
			message: input.message.trim().slice(0, 5000),
			tag: input.tag || null,
			planId: input.planId || null,
			weekday: input.weekday,
			time: input.time,
			createdBy: actorId ?? null
		})
		.returning();
	void emit({
		orgId,
		actorId: actorId ?? null,
		entityType: 'announcement',
		entityId: row.id,
		action: 'recurring_created',
		summary: `Weekly announcement scheduled (${input.time}): ${input.subject}`
	});
	return row;
}

export async function deleteRecurringAnnouncement(orgId: string, id: string) {
	const [row] = await db
		.delete(recurringAnnouncement)
		.where(and(eq(recurringAnnouncement.organizationId, orgId), eq(recurringAnnouncement.id, id)))
		.returning();
	if (!row) error(404, 'Recurring announcement not found');
	return { ok: true };
}

/**
 * Sends each active recurring announcement whose weekday+time has arrived
 * (org-local), once per day. Runs from the daily cron.
 */
export async function sendDueRecurringAnnouncements(orgId: string) {
	const [st] = await db
		.select({ timezone: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = st?.timezone ?? 'UTC';
	const now = new Date();
	const todayISO = localDate(now, tz);
	const nowMin = localMinutes(now, tz);
	const weekday = localWeekday(now, tz);
	const rules = await db
		.select()
		.from(recurringAnnouncement)
		.where(
			and(
				eq(recurringAnnouncement.organizationId, orgId),
				eq(recurringAnnouncement.active, true),
				eq(recurringAnnouncement.weekday, weekday)
			)
		);
	let sent = 0;
	for (const r of rules) {
		const [hh, mm] = r.time.split(':').map(Number);
		if ((hh ?? 0) * 60 + (mm ?? 0) > nowMin) continue;
		if (r.lastSentOn === todayISO) continue;
		try {
			await sendAnnouncement(
				orgId,
				r.subject,
				r.message,
				undefined,
				r.tag ?? undefined,
				r.planId ?? undefined
			);
		} catch (err) {
			console.error(`recurring announcement ${r.id} failed`, err);
			continue;
		}
		await db
			.update(recurringAnnouncement)
			.set({ lastSentOn: todayISO, updatedAt: new Date() })
			.where(eq(recurringAnnouncement.id, r.id));
		sent++;
	}
	return sent;
}

/**
 * Announcements this member actually received — notification_log 'announcement'
 * rows for their email. The portal shows these as a News feed so a member who
 * deleted the email can still read the notice.
 */
/** Stamps openedAt on a member's unread announcement rows — called when the portal News card renders. */
export async function markAnnouncementsRead(orgId: string, email: string) {
	await db
		.update(notificationLog)
		.set({ openedAt: new Date() })
		.where(
			and(
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.kind, 'announcement'),
				eq(notificationLog.recipient, email),
				isNull(notificationLog.openedAt)
			)
		);
}

export async function memberAnnouncements(orgId: string, email: string, limit = 10) {
	const rows = await db
		.select({ entityId: notificationLog.entityId, sentAt: notificationLog.createdAt })
		.from(notificationLog)
		.where(
			and(
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.kind, 'announcement'),
				eq(notificationLog.recipient, email)
			)
		)
		.orderBy(desc(notificationLog.createdAt))
		.limit(limit);
	// entityId is `announcement:${subject}::${message}` — parse both back out.
	return rows.map((r) => {
		const rest = r.entityId.slice('announcement:'.length);
		const sep = rest.indexOf('::');
		return {
			subject: rest.slice(0, sep),
			message: rest.slice(sep + 2).slice(0, 500),
			sentAt: r.sentAt
		};
	});
}

/** Recent staff announcements, most recent first — surfaced on the Members page. */
export async function listRecentAnnouncements(orgId: string, limit = 5) {
	const rows = await db
		.select({
			id: activity.id,
			action: activity.action,
			createdAt: activity.createdAt,
			subject: sql<string>`${activity.data}->>'subject'`,
			message: sql<string>`${activity.data}->>'message'`,
			sent: sql<number>`(${activity.data}->>'sent')::int`,
			total: sql<number>`(${activity.data}->>'total')::int`,
			sendAt: sql<string | null>`${activity.data}->>'sendAt'`,
			tag: sql<string | null>`${activity.data}->>'tag'`,
			plan: sql<string | null>`${activity.data}->>'plan'`,
			read: sql<number>`(select count(*) from ${notificationLog} nl where nl.organization_id = ${orgId} and nl.kind = 'announcement' and nl.opened_at is not null and nl.entity_id = 'announcement:' || (${activity.data}->>'subject') || '::' || (${activity.data}->>'message'))`.mapWith(
				Number
			)
		})
		.from(activity)
		.where(and(eq(activity.organizationId, orgId), eq(activity.entityType, 'announcement')))
		.orderBy(desc(activity.createdAt))
		.limit(limit);
	return rows;
}

/** Drops a queued announcement before it sends (staff changed their mind). */
export async function cancelScheduledAnnouncement(orgId: string, id: string) {
	const r = await db
		.delete(activity)
		.where(
			and(
				eq(activity.organizationId, orgId),
				eq(activity.id, id),
				eq(activity.entityType, 'announcement'),
				eq(activity.action, 'scheduled')
			)
		)
		.returning({ id: activity.id });
	if (!r.length) error(404, 'Scheduled announcement not found');
}

/** "Invoice ready" when a charge posts — membership billing, first period, anything else. */
export async function notifyChargePosted(orgId: string, chargeId: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			description: charge.description,
			amount: charge.amount,
			dueDate: charge.dueDate
		})
		.from(charge)
		.innerJoin(gymMember, eq(charge.memberId, gymMember.id))
		.where(eq(charge.id, chargeId));
	if (!row?.email) return;
	if (!(await logOnce(orgId, 'charge_posted', chargeId, row.email))) return;
	const [name, settings] = await Promise.all([
		orgBrand(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const amount = formatMoney(row.amount, settings[0]?.currency ?? 'usd');
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `New charge from ${name.orgName}: ${amount}`,
		...renderEmail({
			...name,
			heading: `${amount} due ${formatDate(row.dueDate)}`,
			lines: [
				`Hi ${row.memberName} — ${name.orgName} posted a charge to your account:`,
				row.description ?? `${amount}`,
				'You can pay it online from the member portal.'
			],
			action: { label: 'Pay in the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * "Membership suspended" to each member whose membership just flipped for non-payment.
 * Dedup key includes today's date so a second suspension later still emails.
 */
export async function notifyMembershipSuspended(orgId: string, memberIds: string[]) {
	const rows = await db
		.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), inArray(gymMember.id, memberIds)));
	if (!rows.length) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);
	for (const m of rows) {
		if (!m.email) continue;
		if (!(await logOnce(orgId, 'membership_suspended', `${m.id}:${today}`, m.email))) continue;
		await sendMemberEmail(m.id, {
			to: m.email,
			subject: `Membership suspended — ${name.orgName}`,
			...renderEmail({
				...name,
				heading: 'Your membership is suspended',
				lines: [
					`Hi ${m.name} — your membership at ${name.orgName} was suspended because of an overdue balance.`,
					'Class bookings are paused until the balance is paid; your membership resumes automatically once it clears.'
				],
				action: { label: 'Pay in the member portal', url: `${appOrigin()}/portal` }
			})
		});
	}
}

/** "Welcome back" when a frozen membership auto-resumes on its resume date. Deduped per membership. */
export async function notifyMembershipResumed(
	orgId: string,
	membershipId: string,
	nextChargeOn: string
) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			planName: plan.name
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.id, membershipId)));
	if (!row?.memberEmail) return;
	if (!(await logOnce(orgId, 'membership_resumed', membershipId, row.memberEmail))) return;
	const name = await orgBrand(orgId);
	await sendMemberEmail(row.memberId, {
		to: row.memberEmail,
		subject: `Welcome back — your ${row.planName} membership is active`,
		...renderEmail({
			...name,
			heading: 'Welcome back!',
			lines: [
				`Hi ${row.memberName} — your pause is over and your ${row.planName} membership at ${name.orgName} is active again.`,
				`Your next bill is scheduled for ${formatDate(nextChargeOn)}. Book a class and pick up where you left off.`
			],
			action: { label: 'Book a class', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * A member asked to cancel in the portal: staff (org owner/admins) get the request,
 * the member gets a "we received it" confirmation. Deduped per request day.
 */
export async function notifyCancellationRequested(orgId: string, membershipId: string) {
	const [row] = await db
		.select({
			memberId: membership.memberId,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			planName: plan.name
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.id, membershipId)));
	if (!row) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);

	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	for (const s of staff) {
		if (!(await logOnce(orgId, 'cancel_request_staff', `${membershipId}:${today}`, s.email)))
			continue;
		await sendEmail({
			to: s.email,
			subject: `Cancellation request — ${row.memberName}`,
			...renderEmail({
				...name,
				heading: `${row.memberName} wants to cancel`,
				lines: [
					`${row.memberName} requested cancellation of their ${row.planName} membership from the member portal.`,
					'Open their member page to confirm the cancellation or dismiss the request.'
				]
			})
		});
	}

	if (!row.memberEmail) return;
	if (!(await logOnce(orgId, 'cancel_request', `${membershipId}:${today}`, row.memberEmail)))
		return;
	await sendMemberEmail(row.memberId, {
		to: row.memberEmail,
		subject: `Cancellation requested — ${name.orgName}`,
		...renderEmail({
			...name,
			heading: 'We received your request',
			lines: [
				`Hi ${row.memberName} — we got your request to cancel your ${row.planName} membership at ${name.orgName}.`,
				'A staff member will confirm your cancellation shortly. Changed your mind? You can withdraw the request from the member portal until then.'
			]
		})
	});
}

/**
 * Weekly owner/admin digest (Mondays, org tz): last-7-day new members, check-ins,
 * bookings, collected revenue — plus open-balance and at-risk counts so nothing
 * quietly drifts. Deduped per ISO week via the Monday date in the log key.
 */
export async function sendWeeklyDigest(orgId: string) {
	const tz = await orgTimezone(orgId);
	const today = localDate(new Date(), tz);
	if (localWeekday(new Date(), tz) !== 1) return 0; // Mondays only

	const weekAgo = addDays(today, -7);
	const [newMembers] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), gte(gymMember.joinedAt, weekAgo)));
	const [visits] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, new Date(`${weekAgo}T00:00:00Z`))
			)
		);
	const [bookings] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.where(
			and(
				eq(booking.organizationId, orgId),
				inArray(booking.status, ['booked', 'attended', 'no_show']),
				gte(booking.createdAt, new Date(`${weekAgo}T00:00:00Z`))
			)
		);
	const [collected] = await db
		.select({ n: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number) })
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				isNull(payment.refundedAt),
				notInArray(payment.method, ['gift_card', 'credit']),
				gte(payment.createdAt, new Date(`${weekAgo}T00:00:00Z`))
			)
		);
	const [openBalance] = await db
		.select({
			n: sql<number>`coalesce(sum(${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${charge.id} and p.refunded_at is null), 0)), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.status, 'open')));
	const [active] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(membership)
		.where(and(eq(membership.organizationId, orgId), eq(membership.status, 'active')));

	const [name, st] = await Promise.all([
		orgBrand(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const currency = st[0]?.currency ?? 'usd';

	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	let sent = 0;
	for (const s of staff) {
		if (!(await logOnce(orgId, 'weekly_digest', today, s.email))) continue;
		await sendEmail({
			to: s.email,
			subject: `${name.orgName}: your week — ${newMembers!.n} new members, ${formatMoney(collected!.n, currency)} collected`,
			...renderEmail({
				...name,
				heading: 'Your weekly digest',
				lines: [
					`<strong>${newMembers!.n}</strong> new members joined in the last 7 days (active memberships: ${active!.n}).`,
					`<strong>${visits!.n}</strong> check-ins · <strong>${bookings!.n}</strong> class bookings this week.`,
					`<strong>${formatMoney(collected!.n, currency)}</strong> collected · <strong>${formatMoney(openBalance!.n, currency)}</strong> still open.`
				],
				action: { label: 'Open reports', url: `${appOrigin()}/reports` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Daily morning briefing to owner/admin staff: today's sessions with booked and
 * waitlisted counts, pending cancel/pause requests, member birthdays, and
 * yesterday's joins. One per gym-local day (logOnce keyed on the date);
 * skipped entirely when the staffBriefing setting is off or there's nothing
 * to report.
 */
export async function sendStaffBriefing(orgId: string) {
	const [name, tz, st] = await Promise.all([
		orgBrand(orgId),
		orgTimezone(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	if (st[0] && !st[0].staffBriefing) return 0;
	const today = localDate(new Date(), tz);
	const yesterday = addDays(today, -1);

	const [sessions, pending, birthdays, joins, cover] = await Promise.all([
		db
			.select({
				id: classSession.id,
				className: classType.name,
				startsAt: classSession.startsAt,
				capacity: classSession.capacity,
				instructorName: user.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.leftJoin(member, eq(classSession.instructorId, member.id))
			.leftJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(classSession.organizationId, orgId),
					isNull(classSession.cancelledAt),
					sql`to_char(${classSession.startsAt} at time zone ${tz}, 'YYYY-MM-DD') = ${today}`
				)
			)
			.orderBy(asc(classSession.startsAt)),
		db
			.select({
				memberName: gymMember.name,
				kind: sql<string>`case when ${membership.pauseRequestedAt} is not null then 'pause' else 'cancel' end`,
				reason: membership.requestReason
			})
			.from(membership)
			.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
			.where(
				and(
					eq(membership.organizationId, orgId),
					or(isNotNull(membership.cancelRequestedAt), isNotNull(membership.pauseRequestedAt))
				)
			)
			.orderBy(asc(gymMember.name)),
		db
			.select({ name: gymMember.name })
			.from(gymMember)
			.where(
				and(
					eq(gymMember.organizationId, orgId),
					eq(gymMember.status, 'active'),
					sql`to_char(${gymMember.birthday}, 'MM-DD') = ${today.slice(5)}`
				)
			)
			.orderBy(asc(gymMember.name)),
		db
			.select({ name: gymMember.name })
			.from(gymMember)
			.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.joinedAt, yesterday)))
			.orderBy(asc(gymMember.name)),
		db
			.select({
				className: classType.name,
				startsAt: classSession.startsAt,
				instructorName: user.name
			})
			.from(classSession)
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.leftJoin(member, eq(classSession.instructorId, member.id))
			.leftJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(classSession.organizationId, orgId),
					isNotNull(classSession.coverRequestedAt),
					isNull(classSession.cancelledAt),
					gt(classSession.startsAt, new Date())
				)
			)
			.orderBy(asc(classSession.startsAt))
			.limit(10)
	]);
	if (!sessions.length && !pending.length && !birthdays.length && !joins.length && !cover.length)
		return 0;

	const counts = sessions.length
		? await db
				.select({
					sessionId: booking.sessionId,
					status: booking.status,
					n: sql<number>`count(*)`.mapWith(Number)
				})
				.from(booking)
				.where(
					and(
						eq(booking.organizationId, orgId),
						inArray(
							booking.sessionId,
							sessions.map((s) => s.id)
						)
					)
				)
				.groupBy(booking.sessionId, booking.status)
		: [];
	const countsBySession = new Map<string, { booked: number; waitlisted: number }>();
	for (const c of counts) {
		const entry = countsBySession.get(c.sessionId) ?? { booked: 0, waitlisted: 0 };
		if (c.status === 'waitlisted') entry.waitlisted = c.n;
		else if (c.status === 'booked' || c.status === 'attended') entry.booked = c.n;
		countsBySession.set(c.sessionId, entry);
	}

	const lines: string[] = [];
	if (sessions.length) {
		lines.push(
			`<strong>${sessions.length} class${sessions.length === 1 ? '' : 'es'} today:</strong>`
		);
		for (const s of sessions) {
			const c = countsBySession.get(s.id) ?? { booked: 0, waitlisted: 0 };
			const who = s.instructorName ? ` — ${s.instructorName}` : '';
			lines.push(
				`${localTime(s.startsAt, tz)} ${s.className}${who} · ${c.booked}/${s.capacity} booked${c.waitlisted ? `, ${c.waitlisted} waitlisted` : ''}`
			);
		}
	}
	if (pending.length) {
		lines.push(
			`<strong>${pending.length} member request${pending.length === 1 ? '' : 's'} to review:</strong>`
		);
		for (const p of pending)
			lines.push(`${p.memberName} wants to ${p.kind}${p.reason ? ` — “${p.reason}”` : ''}`);
	}
	if (cover.length) {
		lines.push(`<strong>Needs cover:</strong>`);
		for (const s of cover)
			lines.push(
				`${localDate(s.startsAt, tz)} ${localTime(s.startsAt, tz)} ${s.className}${s.instructorName ? ` — ${s.instructorName}` : ''}`
			);
	}
	if (birthdays.length)
		lines.push(`<strong>Birthday today:</strong> ${birthdays.map((b) => b.name).join(', ')}`);
	if (joins.length)
		lines.push(
			`<strong>${joins.length} new member${joins.length === 1 ? '' : 's'} yesterday:</strong> ${joins.map((j) => j.name).join(', ')}`
		);

	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	let sent = 0;
	for (const s of staff) {
		if (!(await logOnce(orgId, 'staff_briefing', today, s.email))) continue;
		await sendEmail({
			to: s.email,
			subject: `${name.orgName}: morning briefing — ${formatDate(today)}`,
			...renderEmail({
				...name,
				heading: `Today at ${name.orgName}`,
				lines,
				action: { label: 'Open dashboard', url: `${appOrigin()}/dashboard` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * "Your plan changed" — member-facing confirmation when a member switches plans
 * from the portal. No dedupe: every switch is a real event worth confirming.
 */
export async function notifyPlanChanged(orgId: string, membershipId: string, oldPlanName: string) {
	const [row] = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			planName: plan.name,
			amount: plan.amount,
			interval: plan.interval,
			nextChargeAt: membership.nextChargeAt
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.id, membershipId)));
	if (!row?.email) return;
	const [name, st, tz] = await Promise.all([
		orgBrand(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1),
		orgTimezone(orgId)
	]);
	const lines = [
		`Hi ${row.memberName} — your membership at ${name.orgName} switched from ${oldPlanName} to ${row.planName}.`,
		row.nextChargeAt
			? `Your next bill on ${localDate(row.nextChargeAt, tz)} will be ${formatMoney(row.amount, st[0]?.currency ?? 'usd')}/${row.interval}.`
			: `Your new rate is ${formatMoney(row.amount, st[0]?.currency ?? 'usd')}/${row.interval}.`
	];
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Your plan changed: ${row.planName} at ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `You're on ${row.planName} now`,
			lines,
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * Member asked to pause — staff get a heads-up and the member gets a
 * confirmation, same shape as notifyCancellationRequested. Deduped per day.
 */
export async function notifyPauseRequested(orgId: string, membershipId: string) {
	const [row] = await db
		.select({
			memberId: membership.memberId,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			planName: plan.name,
			pauseUntil: membership.pauseUntil
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.id, membershipId)));
	if (!row) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);
	const resume = row.pauseUntil ? formatDate(row.pauseUntil) : 'a future date';

	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	for (const s of staff) {
		if (!(await logOnce(orgId, 'pause_request_staff', `${membershipId}:${today}`, s.email)))
			continue;
		await sendEmail({
			to: s.email,
			subject: `Pause request — ${row.memberName}`,
			...renderEmail({
				...name,
				heading: `${row.memberName} wants to pause`,
				lines: [
					`${row.memberName} asked to pause their ${row.planName} membership until ${resume}.`,
					'Approve it from their member page — billing and bookings stop until the resume date.'
				]
			})
		});
	}

	if (!row.memberEmail) return;
	if (!(await logOnce(orgId, 'pause_request', `${membershipId}:${today}`, row.memberEmail))) return;
	await sendMemberEmail(row.memberId, {
		to: row.memberEmail,
		subject: `Pause requested — ${name.orgName}`,
		...renderEmail({
			...name,
			heading: 'We received your request',
			lines: [
				`Hi ${row.memberName} — we got your request to pause your ${row.planName} membership at ${name.orgName} until ${resume}.`,
				'A staff member will confirm your pause shortly. Changed your mind? You can withdraw the request from the member portal until then.'
			]
		})
	});
}

/**
 * Daily cron: nudge active members whose last check-in (or signup, if never)
 * was 30+ days ago. At most one email per member per calendar month.
 * Returns emails sent.
 */
export async function sendWinBackNudges(orgId: string) {
	const rows = await db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			joined: gymMember.createdAt,
			lastVisit: sql<string | null>`max(${checkIn.checkedAt})`
		})
		.from(gymMember)
		.leftJoin(checkIn, eq(checkIn.memberId, gymMember.id))
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				isNotNull(gymMember.email)
			)
		)
		.groupBy(gymMember.id, gymMember.name, gymMember.email, gymMember.createdAt)
		.limit(200);
	const cutoff = Date.now() - 30 * 86400_000;
	const month = new Date().toISOString().slice(0, 7);
	const name = await orgBrand(orgId);
	let sent = 0;
	for (const r of rows) {
		if (!r.email) continue;
		const since = r.lastVisit ? new Date(r.lastVisit) : r.joined;
		if (since.getTime() > cutoff) continue;
		if (!(await logOnce(orgId, 'winback', `${r.memberId}:${month}`, r.email))) continue;
		const days = Math.floor((Date.now() - since.getTime()) / 86400_000);
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `We miss you at ${name.orgName}`,
			...renderEmail({
				...name,
				heading: 'We miss you',
				lines: [
					`Hi ${r.name} — it's been ${days} days since your last visit to ${name.orgName}.`,
					'Your spot is still here. Book a class and get back into the rhythm.'
				],
				action: { label: 'Book a class', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Daily cron: follow up with public-page leads 3+ days after they left their
 * info — one nudge per lead ever, skipped once they hold any membership.
 * Returns emails sent.
 */
export async function sendLeadNudges(orgId: string) {
	const rows = await db
		.select({ memberId: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.innerJoin(memberTag, and(eq(memberTag.memberId, gymMember.id), eq(memberTag.tag, 'lead')))
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				isNotNull(gymMember.email),
				lte(gymMember.createdAt, new Date(Date.now() - 3 * 86400_000))
			)
		)
		.limit(200);
	if (!rows.length) return 0;
	const joined = new Set(
		(
			await db
				.select({ memberId: membership.memberId })
				.from(membership)
				.where(
					and(
						eq(membership.organizationId, orgId),
						inArray(
							membership.memberId,
							rows.map((r) => r.memberId)
						)
					)
				)
		).map((r) => r.memberId)
	);
	const [[org], name] = await Promise.all([
		db
			.select({ slug: organization.slug })
			.from(organization)
			.where(eq(organization.id, orgId))
			.limit(1),
		orgBrand(orgId)
	]);
	let sent = 0;
	for (const r of rows) {
		if (!r.email || joined.has(r.memberId)) continue;
		if (!(await logOnce(orgId, 'lead_nudge', r.memberId, r.email))) continue;
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `Still thinking it over? — ${name.orgName}`,
			...renderEmail({
				...name,
				heading: 'Still thinking it over?',
				lines: [
					`Hi ${r.name} — thanks for your interest in ${name.orgName} a few days ago.`,
					'Ready when you are — have a look at the timetable and grab a plan, or just reply to this email with any questions.'
				],
				action: { label: 'See plans', url: `${appOrigin()}/j/${org?.slug}` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Daily cron: the day after a course ends, email every enrollee who attended
 * at least one session a completion congrats. One email per enrollment.
 */
export async function sendCourseCompletions(orgId: string) {
	const tz = await orgTimezone(orgId);
	const yesterday = addDays(localDate(new Date(), tz), -1);
	const ended = await db
		.select()
		.from(course)
		.where(and(eq(course.organizationId, orgId), eq(course.endsOn, yesterday)))
		.limit(20);
	if (!ended.length) return 0;
	const courseIds = ended.map((c) => c.id);
	const enrs = await db
		.select({
			id: courseEnrollment.id,
			courseId: courseEnrollment.courseId,
			memberId: courseEnrollment.memberId,
			memberName: gymMember.name,
			email: gymMember.email
		})
		.from(courseEnrollment)
		.innerJoin(gymMember, eq(courseEnrollment.memberId, gymMember.id))
		.where(inArray(courseEnrollment.courseId, courseIds));
	if (!enrs.length) return 0;

	// Attended count per enrollee: 'attended' bookings on sessions materialized
	// from this course's bounded templates.
	const attended = await db
		.select({
			memberId: booking.memberId,
			courseId: classTemplate.courseId,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classTemplate, eq(classSession.templateId, classTemplate.id))
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.status, 'attended'),
				inArray(classTemplate.courseId, courseIds)
			)
		)
		.groupBy(booking.memberId, classTemplate.courseId);
	const attendedBy = new Map(attended.map((a) => [`${a.memberId}:${a.courseId}`, a.n]));

	const name = await orgBrand(orgId);
	let sent = 0;
	for (const e of enrs) {
		const n = attendedBy.get(`${e.memberId}:${e.courseId}`) ?? 0;
		if (n < 1 || !e.email) continue;
		if (!(await logOnce(orgId, 'course_completed', e.id, e.email))) continue;
		const c = ended.find((x) => x.id === e.courseId)!;
		await sendMemberEmail(e.memberId, {
			to: e.email,
			subject: `You finished ${c.name} — ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `You did it, ${e.memberName.split(' ')[0]}!`,
				lines: [
					`${c.name} wrapped up yesterday — you made it to ${n} session${n === 1 ? '' : 's'}.`,
					'Keep the momentum going: your next class is already on the schedule.'
				],
				action: { label: 'Book your next class', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Member email when a booking is marked no-show by the daily cron —
 * a gentle rebook nudge. Deduped per booking.
 */
export async function notifyNoShow(
	orgId: string,
	bookingId: string,
	memberId: string,
	className: string,
	startsAt: Date
) {
	const [m, name, tz] = await Promise.all([
		db
			.select({ email: gymMember.email, name: gymMember.name })
			.from(gymMember)
			.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)))
			.then((r) => r[0]),
		orgBrand(orgId),
		orgTimezone(orgId)
	]);
	if (!m?.email) return;
	if (!(await logOnce(orgId, 'noshow', bookingId, m.email))) return;
	const when = `${localDate(startsAt, tz)} ${localTime(startsAt, tz)}`;
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `We missed you at ${className}`,
		...renderEmail({
			...name,
			heading: 'We missed you',
			lines: [
				`Hi ${m.name} — you were booked into ${className} on ${when} but didn't make it. Life happens.`,
				'Spots go fast, so grab your next one now.'
			],
			action: { label: 'Book your next class', url: `${appOrigin()}/portal` }
		})
	});
}

/** "You've hit N check-ins!" — retention nudge fired when a visit crosses a milestone. */
export async function notifyCheckInMilestone(orgId: string, memberId: string, count: number) {
	const [m] = await db
		.select({ email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m?.email) return;
	if (!(await logOnce(orgId, 'checkin_milestone', `${memberId}:${count}`, m.email))) return;
	const name = await orgBrand(orgId);
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `${count} check-ins at ${name.orgName} — nice work, ${m.name.split(' ')[0]}`,
		...renderEmail({
			...name,
			heading: `${count} check-ins. Keep it up.`,
			lines: [
				`Hi ${m.name} — you just hit ${count} check-ins at ${name.orgName}. That's real consistency.`,
				'See you at the next one.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * Streak-reward email at week-streak milestones. Returns true only when this
 * check-in actually won the dedupe — callers grant the comp credits then, so a
 * re-run can't double-pay. Also sends the congrats email (best-effort).
 */
export async function notifyStreakReward(
	orgId: string,
	memberId: string,
	weeks: number,
	credits: number
) {
	const [m] = await db
		.select({ email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m?.email) return false;
	if (!(await logOnce(orgId, 'streak_reward', `${memberId}:${weeks}`, m.email))) return false;
	const name = await orgBrand(orgId);
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `${weeks}-week streak at ${name.orgName} — ${credits} free class${credits === 1 ? '' : 'es'} on us`,
		...renderEmail({
			...name,
			heading: `${weeks} weeks in a row. Impressive.`,
			lines: [
				`Hi ${m.name} — you've checked in every week for ${weeks} weeks straight.`,
				`We've added ${credits} free class${credits === 1 ? '' : 'es'} to your membership. Keep the streak alive.`
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	}).catch(() => {});
	return true;
}

/** Welcome note on a member's very first check-in. Deduped per member. */
export async function notifyFirstVisit(orgId: string, memberId: string) {
	const [m] = await db
		.select({ email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m?.email) return;
	if (!(await logOnce(orgId, 'first_visit', memberId, m.email))) return;
	const name = await orgBrand(orgId);
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `First visit down at ${name.orgName} — nice work, ${m.name.split(' ')[0]}`,
		...renderEmail({
			...name,
			heading: 'Your first visit is in the books.',
			lines: [
				`Hi ${m.name} — welcome to ${name.orgName}. You just checked in for the first time, which is the hardest one.`,
				'Book your next class in the portal and keep the streak going.'
			],
			action: { label: 'Book your next class', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * Daily cron: emails each staff instructor their roster for the day — class,
 * time, location, booked/waitlist counts. Staff mail, so no unsubscribe check.
 */
export async function sendInstructorRosters(orgId: string) {
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);
	const sessions = await db
		.select({
			id: classSession.id,
			instructorId: classSession.instructorId,
			className: classType.name,
			startsAt: classSession.startsAt,
			capacity: classSession.capacity,
			checkinCode: classSession.checkinCode,
			locationName: location.name
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(classSession.organizationId, orgId),
				isNull(classSession.cancelledAt),
				isNotNull(classSession.instructorId),
				sql`to_char(${classSession.startsAt} at time zone ${tz}, 'YYYY-MM-DD') = ${today}`
			)
		)
		.orderBy(asc(classSession.startsAt));
	if (!sessions.length) return 0;

	const counts = await db
		.select({
			sessionId: booking.sessionId,
			status: booking.status,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(booking)
		.where(
			and(
				eq(booking.organizationId, orgId),
				inArray(
					booking.sessionId,
					sessions.map((s) => s.id)
				)
			)
		)
		.groupBy(booking.sessionId, booking.status);
	const countsBySession = new Map<string, { booked: number; waitlisted: number }>();
	for (const c of counts) {
		const entry = countsBySession.get(c.sessionId) ?? { booked: 0, waitlisted: 0 };
		if (c.status === 'waitlisted') entry.waitlisted = c.n;
		else if (c.status === 'booked' || c.status === 'attended') entry.booked = c.n;
		countsBySession.set(c.sessionId, entry);
	}

	const instructorIds = [...new Set(sessions.map((s) => s.instructorId as string))];
	const instructors = await db
		.select({ id: member.id, name: user.name, email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(inArray(member.id, instructorIds));

	let sent = 0;
	for (const instructor of instructors) {
		if (!instructor.email) continue;
		if (!(await logOnce(orgId, 'instructor_roster', `${instructor.id}:${today}`, instructor.email)))
			continue;
		const lines = sessions
			.filter((s) => s.instructorId === instructor.id)
			.map((s) => {
				const c = countsBySession.get(s.id) ?? { booked: 0, waitlisted: 0 };
				const where = s.locationName ? ` at ${s.locationName}` : '';
				return `${localTime(s.startsAt, tz)} — ${s.className}${where} · ${c.booked}/${s.capacity} booked${c.waitlisted ? `, ${c.waitlisted} waitlisted` : ''}${s.checkinCode ? ` · check-in code ${s.checkinCode}` : ''}`;
			});
		if (!lines.length) continue;
		await sendEmail({
			to: instructor.email,
			subject: `Today's classes at ${name.orgName} — ${lines.length} on your schedule`,
			...renderEmail({
				...name,
				heading: `Your classes today, ${instructor.name.split(' ')[0]}`,
				lines: [`${formatDate(today)} at ${name.orgName}:`, ...lines]
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Weekly (Monday) digest: every instructor who received new class feedback in
 * the last 7 days gets their average, count and newest comments by email —
 * pushes the My classes "Your ratings" data to them. One email per instructor
 * per week via the notification log.
 */
export async function sendInstructorFeedbackDigests(orgId: string) {
	const tz = await orgTimezone(orgId);
	const today = localDate(new Date(), tz);
	if (localWeekday(new Date(), tz) !== 1) return 0; // Mondays only

	const rows = await db
		.select({
			instructorId: classSession.instructorId,
			rating: sessionFeedback.rating,
			comment: sessionFeedback.comment,
			className: classType.name,
			memberName: gymMember.name
		})
		.from(sessionFeedback)
		.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.innerJoin(gymMember, eq(sessionFeedback.memberId, gymMember.id))
		.where(
			and(
				eq(sessionFeedback.organizationId, orgId),
				gte(sessionFeedback.createdAt, new Date(Date.now() - 7 * 86400_000)),
				isNotNull(classSession.instructorId)
			)
		)
		.orderBy(desc(sessionFeedback.createdAt));
	if (!rows.length) return 0;

	const instructorIds = [...new Set(rows.map((r) => r.instructorId as string))];
	const instructors = await db
		.select({ id: member.id, name: user.name, email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(inArray(member.id, instructorIds));

	const name = await orgBrand(orgId);
	let sent = 0;
	for (const ins of instructors) {
		if (!ins.email) continue;
		const mine = rows.filter((r) => r.instructorId === ins.id);
		if (!mine.length) continue;
		if (!(await logOnce(orgId, 'instructor_feedback', `${ins.id}:${today}`, ins.email))) continue;
		const avg = (mine.reduce((a, r) => a + r.rating, 0) / mine.length).toFixed(1);
		const lines = [
			`Your average rating this week: ${avg}★ across ${mine.length} rating${mine.length === 1 ? '' : 's'}.`
		];
		for (const c of mine.filter((r) => r.comment?.trim()).slice(0, 3)) {
			lines.push(`“${c.comment}” — ${c.memberName} (${c.className}, ${'★'.repeat(c.rating)})`);
		}
		lines.push('The full history lives on My classes → Your ratings.');
		await sendEmail({
			to: ins.email,
			subject: `Your class feedback this week — ${avg}★ (${mine.length} new)`,
			...renderEmail({
				...name,
				heading: `Your feedback this week, ${ins.name.split(' ')[0]}`,
				lines
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Heads-up billing emails, seven days out:
 * - recurring members: "your plan renews on {date} — {amount}" (once per period)
 * - pack members: "your class pack expires {date} — {n} credits left" (once per pack)
 */
export async function sendBillingReminders(orgId: string) {
	const now = new Date();
	const soon = new Date(now.getTime() + 7 * 86400_000);
	const [name, tz, st] = await Promise.all([
		orgBrand(orgId),
		orgTimezone(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const currency = st[0]?.currency ?? 'usd';

	// Recurring memberships renewing within 7 days.
	const renewals = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			planName: plan.name,
			amount: plan.amount,
			price: membership.price,
			interval: plan.interval,
			when: membership.nextChargeAt,
			membershipId: membership.id
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, false),
				gt(membership.nextChargeAt, now),
				lte(membership.nextChargeAt, soon)
			)
		);

	let sent = 0;
	for (const r of renewals) {
		const amount = r.price ?? r.amount;
		if (!r.email || !r.when || amount <= 0) continue;
		const key = `${r.membershipId}:${r.when.toISOString().slice(0, 10)}`;
		if (!(await logOnce(orgId, 'renewal_reminder', key, r.email))) continue;
		const date = localDate(r.when, tz);
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `Your ${r.planName} membership renews ${date}`,
			...renderEmail({
				...name,
				heading: 'Membership renewal coming up',
				lines: [
					`Hi ${r.memberName} — your ${r.planName} membership at ${name.orgName} renews on ${date} for ${formatMoney(amount, currency)}.`,
					`Need to pause or cancel instead? You can request either in the member portal, or just reply to this email.`
				],
				action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}

	// Class packs expiring within 7 days.
	const expiring = await db
		.select({
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			planName: plan.name,
			classCredits: plan.classCredits,
			bonusCredits: membership.bonusCredits,
			startsAt: membership.startsAt,
			when: membership.endsAt,
			membershipId: membership.id
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, true),
				isNotNull(membership.endsAt),
				gt(membership.endsAt, now),
				lte(membership.endsAt, soon)
			)
		);
	for (const r of expiring) {
		if (!r.email || !r.when) continue;
		const key = `${r.membershipId}:${r.when.toISOString().slice(0, 10)}`;
		if (!(await logOnce(orgId, 'pack_expiry', key, r.email))) continue;
		const date = localDate(r.when, tz);
		let creditsLine = 'Any unused classes expire with it.';
		if (r.classCredits != null) {
			const [{ count: used }] = await db
				.select({ count: sql<number>`count(*)`.mapWith(Number) })
				.from(booking)
				.innerJoin(classSession, eq(booking.sessionId, classSession.id))
				.where(
					and(
						eq(booking.organizationId, orgId),
						eq(booking.memberId, r.memberId),
						inArray(booking.status, ['booked', 'attended', 'no_show']),
						isNull(classSession.cancelledAt),
						gte(classSession.startsAt, r.startsAt),
						lt(classSession.startsAt, r.when)
					)
				);
			const left = Math.max(0, r.classCredits + r.bonusCredits - used);
			creditsLine = left
				? `You still have ${left} class${left === 1 ? '' : 'es'} left — book them before they expire.`
				: 'All your classes are used up.';
		}
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `Your ${r.planName} pack expires ${date}`,
			...renderEmail({
				...name,
				heading: 'Class pack expiring soon',
				lines: [
					`Hi ${r.memberName} — your ${r.planName} class pack at ${name.orgName} expires on ${date}. ${creditsLine}`
				],
				action: { label: 'Book a class', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/**
 * Staff-wide "cover needed" email when a session gets flagged needsCover.
 * Deduped per flag instance — clearing and re-flagging can re-mail.
 */
export async function sendCoverRequests(orgId: string, sessionId: string, flaggedAt: Date) {
	const [row] = await db
		.select({
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			className: classType.name,
			locationName: location.name,
			instructorName: user.name,
			booked: sql<number>`(select count(*)::int + coalesce(sum(b.guest_count), 0)::int from ${booking} b where b.session_id = ${classSession.id} and b.status = 'booked')`
		})
		.from(classSession)
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(classSession.organizationId, orgId), eq(classSession.id, sessionId)));
	if (!row) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const day = localDate(row.startsAt, tz);
	const time = localTime(row.startsAt, tz);

	// Name whoever is already rota'd to work during the session — the likeliest sub.
	const onRota = (
		await db
			.select({ staffName: user.name })
			.from(rota)
			.innerJoin(member, eq(rota.memberId, member.id))
			.innerJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(rota.organizationId, orgId),
					eq(rota.weekday, localWeekday(row.startsAt, tz)),
					lt(rota.startTime, localTime(row.endsAt, tz)),
					gt(rota.endTime, localTime(row.startsAt, tz))
				)
			)
	).map((r) => r.staffName);

	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId));
	for (const s of staff) {
		if (!(await logOnce(orgId, 'cover_request', `${sessionId}:${flaggedAt.getTime()}`, s.email)))
			continue;
		await sendEmail({
			to: s.email,
			subject: `Cover needed: ${row.className} — ${formatDate(day)} ${time}`,
			...renderEmail({
				...name,
				heading: `${row.className} needs a sub`,
				lines: [
					`${row.instructorName ?? 'The assigned instructor'} can't make ${row.className} on ${formatDate(day)} at ${time}${row.locationName ? ` (${row.locationName})` : ''} — ${row.booked} booked.`,
					...(onRota.length ? [`Scheduled to work then: ${onRota.join(', ')}.`] : []),
					'Tap below to claim it — you become the instructor, the flag clears, and booked members are emailed.'
				],
				action: {
					label: "I'll cover it",
					url: `${appOrigin()}/schedule?focus=${sessionId}&claim=1`
				}
			})
		});
	}
}

/**
 * "How was class?" — emails attended members a rating nudge the day a session
 * ends, once per (session, member); skips sessions that already have feedback.
 */
export async function ratingNudges(orgId: string) {
	const since = new Date(Date.now() - 36 * 3600_000);
	const rows = await db
		.select({
			sessionId: classSession.id,
			memberId: gymMember.id,
			email: gymMember.email,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.innerJoin(gymMember, eq(booking.memberId, gymMember.id))
		.leftJoin(
			sessionFeedback,
			and(
				eq(sessionFeedback.sessionId, classSession.id),
				eq(sessionFeedback.memberId, booking.memberId)
			)
		)
		.where(
			and(
				eq(booking.organizationId, orgId),
				eq(booking.status, 'attended'),
				isNull(classSession.cancelledAt),
				isNull(sessionFeedback.id),
				gte(classSession.endsAt, since),
				lt(classSession.endsAt, new Date())
			)
		)
		.limit(200);
	if (!rows.length) return 0;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	let sent = 0;
	for (const r of rows) {
		if (!r.email) continue;
		if (!(await logOnce(orgId, 'rating_nudge', `${r.sessionId}:${r.memberId}`, r.email))) continue;
		const first = r.memberName.split(' ')[0] ?? r.memberName;
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `How was ${r.className}?`,
			...renderEmail({
				...name,
				heading: `How was ${r.className}?`,
				lines: [
					`Hi ${first},`,
					`You took ${r.className} on ${localDate(r.startsAt, tz)} — a quick star rating helps ${name.orgName} tune the schedule.`,
					'Rate it from your Class history in the member portal — takes 10 seconds.'
				],
				action: { label: 'Rate this class', url: `${appOrigin()}/portal` }
			})
		});
		sent++;
	}
	return sent;
}

/** A member rated a class ≤3 — alert owner/admin so someone can follow up. Once per (session, member). */
export async function notifyLowRating(orgId: string, sessionId: string, memberId: string) {
	const [row] = await db
		.select({
			rating: sessionFeedback.rating,
			comment: sessionFeedback.comment,
			memberName: gymMember.name,
			className: classType.name,
			startsAt: classSession.startsAt,
			instructorName: user.name
		})
		.from(sessionFeedback)
		.innerJoin(gymMember, eq(sessionFeedback.memberId, gymMember.id))
		.innerJoin(classSession, eq(sessionFeedback.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(member, eq(classSession.instructorId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(sessionFeedback.organizationId, orgId),
				eq(sessionFeedback.sessionId, sessionId),
				eq(sessionFeedback.memberId, memberId)
			)
		)
		.limit(1);
	if (!row || row.rating > 3) return;
	const [name, tz] = await Promise.all([orgBrand(orgId), orgTimezone(orgId)]);
	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	for (const s of staff) {
		if (!(await logOnce(orgId, 'low_rating', `${sessionId}:${memberId}`, s.email))) continue;
		await sendEmail({
			to: s.email,
			subject: `${row.rating}★ for ${row.className} — ${row.memberName}`,
			...renderEmail({
				...name,
				heading: `Low rating on ${row.className}`,
				lines: [
					`${row.memberName} rated ${row.className} ${row.rating}/5 from ${localDate(row.startsAt, tz)}${row.instructorName ? ` (${row.instructorName})` : ''}.`,
					row.comment ? `"${row.comment}"` : 'They left no comment.',
					'Worth a quick follow-up before they drift.'
				],
				action: { label: 'Open member page', url: `${appOrigin()}/members/${memberId}` }
			})
		});
	}
}

/**
 * "Your membership is cancelled" confirmation to the member on a staff cancel.
 * Mentions the early-termination fee when one posted. Deduped per membership.
 */
export async function notifyMembershipCancelled(
	orgId: string,
	membershipId: string,
	earlyFeeCents = 0
) {
	const [row] = await db
		.select({
			memberId: membership.memberId,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			planName: plan.name
		})
		.from(membership)
		.innerJoin(gymMember, eq(membership.memberId, gymMember.id))
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.id, membershipId)));
	if (!row?.memberEmail) return;
	if (!(await logOnce(orgId, 'membership_cancelled', membershipId, row.memberEmail))) return;
	const name = await orgBrand(orgId);
	await sendMemberEmail(row.memberId, {
		to: row.memberEmail,
		subject: `Membership cancelled — ${name.orgName}`,
		...renderEmail({
			...name,
			heading: 'Your membership is cancelled',
			lines: [
				`Hi ${row.memberName} — your ${row.planName} membership at ${name.orgName} has been cancelled.`,
				...(earlyFeeCents > 0
					? [
							`An early-cancellation fee of ${formatMoney(earlyFeeCents)} was posted to your account, payable from your member portal.`
						]
					: []),
				'If this was a mistake, talk to the front desk — they can resume your membership.'
			],
			...(earlyFeeCents > 0
				? { action: { label: 'Open member portal', url: `${appOrigin()}/portal` } }
				: {})
		})
	});
}

/**
 * "Running low" to owner/admin staff when a sale drops a tracked shop item to
 * its alert level. Dedup key carries the new count, so each lower level (and a
 * dip after restock) emails once.
 */
export async function notifyLowStock(orgId: string, itemId: string, newStock: number) {
	const [item] = await db
		.select({ name: shopItem.name })
		.from(shopItem)
		.where(and(eq(shopItem.organizationId, orgId), eq(shopItem.id, itemId)));
	if (!item) return;
	const name = await orgBrand(orgId);
	const staff = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), sql`${member.role} in ('owner','admin')`));
	for (const s of staff) {
		if (!(await logOnce(orgId, 'low_stock', `${itemId}:${newStock}`, s.email))) continue;
		await sendEmail({
			to: s.email,
			subject: `${newStock === 0 ? 'Out of stock' : 'Low stock'}: ${item.name} — ${name.orgName}`,
			...renderEmail({
				...name,
				heading: `${item.name} ${newStock === 0 ? 'is out of stock' : 'is running low'}`,
				lines: [
					newStock === 0
						? `${item.name} just sold out — the front desk can no longer sell it.`
						: `${item.name} is down to ${newStock} left in stock.`,
					'Update the count after restocking from Billing → Shop.'
				],
				action: { label: 'Open shop', url: `${appOrigin()}/billing` }
			})
		});
	}
}

/** "A document needs your signature" — sent when staff issues a sign request. */
export async function notifySignRequest(orgId: string, signRequestId: string) {
	const [row] = await db
		.select({
			memberId: signRequest.memberId,
			title: signRequest.title,
			email: gymMember.email,
			memberName: gymMember.name
		})
		.from(signRequest)
		.innerJoin(gymMember, eq(signRequest.memberId, gymMember.id))
		.where(eq(signRequest.id, signRequestId));
	if (!row?.email) return;
	const name = await orgBrand(orgId);
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Please sign: ${row.title} — ${name.orgName}`,
		...renderEmail({
			...name,
			heading: `Hi ${row.memberName}, a document needs your signature`,
			lines: [
				`${name.orgName} sent you "${row.title}" to review and sign.`,
				'It only takes a minute in your member portal.'
			],
			action: { label: 'Review and sign', url: `${appOrigin()}/portal` }
		})
	});
}

/**
 * "How are we doing?" — after a member crosses the gym's reviewAfterVisits
 * threshold, send them the review link once ever (notification_log).
 */
export async function notifyReviewRequest(orgId: string, memberId: string, reviewUrl: string) {
	const [m] = await db
		.select({ email: gymMember.email, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m?.email || !(await logOnce(orgId, 'review-request', memberId, m.email))) return false;
	const name = await orgBrand(orgId);
	const first = m.name.split(' ')[0] ?? m.name;
	const { text, html } = renderEmail({
		...name,
		heading: 'Enjoying your training?',
		lines: [
			`Hi ${first},`,
			`You've been putting in the work at ${name.orgName} — we'd love to hear about it.`,
			'A quick review helps others find the gym and means a lot to the team.'
		],
		action: { label: 'Leave a review', url: reviewUrl }
	});
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `${name.orgName}: how are we doing?`,
		text,
		html
	});
	return true;
}

export async function listAnnouncementTemplates(orgId: string) {
	return db
		.select()
		.from(announcementTemplate)
		.where(eq(announcementTemplate.organizationId, orgId))
		.orderBy(asc(announcementTemplate.createdAt));
}

export async function createAnnouncementTemplate(
	orgId: string,
	userId: string,
	input: { name: string; subject: string; message: string; tag?: string }
) {
	const [row] = await db
		.insert(announcementTemplate)
		.values({
			organizationId: orgId,
			name: input.name,
			subject: input.subject,
			message: input.message,
			tag: input.tag || null,
			createdBy: userId
		})
		.returning();
	return row;
}

export async function deleteAnnouncementTemplate(orgId: string, id: string) {
	const [row] = await db
		.delete(announcementTemplate)
		.where(and(eq(announcementTemplate.id, id), eq(announcementTemplate.organizationId, orgId)))
		.returning({ id: announcementTemplate.id });
	if (!row) error(404, 'Template not found');
	return { ok: true };
}
