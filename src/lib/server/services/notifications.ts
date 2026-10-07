import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	booking,
	charge,
	checkIn,
	classSession,
	classType,
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
	user
} from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import { appOrigin, emailProvider, sendEmail } from '#lib/server/email.ts';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import type { Email } from '#lib/server/email.ts';
import { formatDate, formatMoney } from '#lib/format.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { addDays, localDate, localTime, localWeekday } from '#lib/tz.ts';

async function orgName(orgId: string) {
	const [o] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, orgId));
	return o?.name ?? 'your gym';
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
	const [name, settings] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const date = localDate(row.startsAt, settings);
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `You're in: ${row.className} at ${name}`,
		...renderEmail({
			orgName: name,
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
	const [name, settings] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, settings)} at ${localTime(row.startsAt, settings)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: waitlisted
			? `Waitlisted: ${row.className} at ${name}`
			: `Booked: ${row.className} at ${name}`,
		...renderEmail({
			orgName: name,
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
		orgName(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const money = formatMoney(amount, st[0]?.currency ?? 'usd');
	await sendMemberEmail(row.balanceMemberId, {
		to: row.email,
		subject: `Payment received: ${money} at ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Thanks, ${row.memberName} — ${money} received`,
			lines: [
				`${name} received your ${money} payment (${method}).`,
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
		orgName(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const money = formatMoney(row.amount, st[0]?.currency ?? 'usd');
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Refund issued: ${money} at ${name}`,
		...renderEmail({
			orgName: name,
			heading: `Hi ${row.memberName} — ${money} refunded`,
			lines: [
				`${name} issued a ${money} refund to you.`,
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
		orgName(orgId),
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
			subject: `Payment due: ${total} at ${name}`,
			...renderEmail({
				orgName: name,
				heading: `${total} is past due`,
				lines: [
					`Hi ${g.memberName} — you have ${g.count} overdue ${g.count === 1 ? 'charge' : 'charges'} totaling ${total} at ${name}.`,
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
		orgName(orgId),
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
			subject: `Your free trial at ${name} ends ${date}`,
			...renderEmail({
				orgName: name,
				heading: 'Your trial is almost up',
				lines: [
					`Hi ${r.memberName} — your free trial of ${r.planName} at ${name} ends ${date}.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
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
				orgName: name,
				heading: 'Happy birthday!',
				lines: [
					`Hi ${r.memberName} — everyone at ${name} is wishing you a great birthday.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
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
			subject: `${years} ${years === 1 ? 'year' : 'years'} at ${name} — happy anniversary, ${r.memberName.split(' ')[0]}`,
			...renderEmail({
				orgName: name,
				heading: `Happy ${years}-year anniversary`,
				lines: [
					`Hi ${r.memberName} — ${years} ${years === 1 ? 'year' : 'years'} ago today you joined ${name}, and we're glad you did.`,
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
	const name = await orgName(orgId);
	await sendMemberEmail(referrerId, {
		to: referrer.email,
		subject: `${joined.name} just joined ${name} from your link`,
		...renderEmail({
			orgName: name,
			heading: 'Your referral worked',
			lines: [
				`Hi ${referrer.name} — ${joined.name} just signed up at ${name} using your referral link.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	for (const row of rows) {
		if (!row.email) continue;
		if (!(await logOnce(orgId, 'session_cancelled', sessionId, row.email))) continue;
		const date = localDate(row.startsAt, tz);
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `${row.className} on ${date} is cancelled`,
			...renderEmail({
				orgName: name,
				heading: `${row.className} is cancelled`,
				lines: [
					`Hi ${row.memberName} — ${row.className} at ${name} on ${date} at ${localTime(row.startsAt, tz)} has been cancelled.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Cancelled: ${row.className} at ${name}`,
		...renderEmail({
			orgName: name,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
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
				orgName: name,
				heading: `Instructor change for ${sess.className}`,
				lines: [
					`Hi ${row.memberName} — your ${sess.className} at ${name} on ${date} is now taught by ${who}.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
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
				orgName: name,
				heading: `${sess.className} has moved`,
				lines: [
					`Hi ${row.memberName} — your ${sess.className} at ${name} is now ${when}${where}.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	let sent = 0;
	for (const row of rows) {
		if (!row.email) continue;
		if (!(await logOnce(orgId, 'class_reminder', row.bookingId, row.email))) continue;
		const when = `${localDate(row.startsAt, tz)} at ${localTime(row.startsAt, tz)}`;
		await sendMemberEmail(row.memberId, {
			to: row.email,
			subject: `Tomorrow: ${row.className} at ${name}`,
			...renderEmail({
				orgName: name,
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
	tag?: string
) {
	if (!emailProvider()) error(409, 'No email provider configured');
	const members = await db
		.select({ id: gymMember.id, email: gymMember.email })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				memberIds?.length ? inArray(gymMember.id, memberIds) : undefined,
				tag
					? sql`exists (select 1 from ${memberTag} t where t.member_id = ${gymMember.id} and t.organization_id = ${orgId} and t.tag = ${tag})`
					: undefined,
				isNull(gymMember.unsubscribedAt),
				sql`${gymMember.email} is not null and ${gymMember.email} <> ''`
			)
		)
		.limit(1000);
	if (!members.length) return { sent: 0, total: 0 };
	const name = await orgName(orgId);
	const entityId = `announcement:${subject}::${message}`;
	const { text, html } = renderEmail({
		orgName: name,
		heading: subject,
		lines: message.split(/\n+/).filter(Boolean),
		action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
	});
	let sent = 0;
	for (const m of members) {
		if (!m.email || !(await logOnce(orgId, 'announcement', entityId, m.email))) continue;
		await sendMemberEmail(m.id, { to: m.email, subject: `${name}: ${subject}`, text, html });
		sent++;
	}
	await emit({
		orgId,
		actorId: null,
		entityType: 'announcement',
		entityId,
		action: 'sent',
		summary: `Announcement sent to ${sent} member${sent === 1 ? '' : 's'}: ${subject}`,
		data: { subject, message, sent, total: members.length, tag: tag ?? null }
	});
	return { sent, total: members.length };
}

/** Recent staff announcements, most recent first — surfaced on the Members page. */
export async function listRecentAnnouncements(orgId: string, limit = 5) {
	const rows = await db
		.select({
			id: activity.id,
			createdAt: activity.createdAt,
			subject: sql<string>`${activity.data}->>'subject'`,
			message: sql<string>`${activity.data}->>'message'`,
			sent: sql<number>`(${activity.data}->>'sent')::int`,
			total: sql<number>`(${activity.data}->>'total')::int`,
			tag: sql<string | null>`${activity.data}->>'tag'`
		})
		.from(activity)
		.where(and(eq(activity.organizationId, orgId), eq(activity.entityType, 'announcement')))
		.orderBy(desc(activity.createdAt))
		.limit(limit);
	return rows;
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
		orgName(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1)
	]);
	const amount = formatMoney(row.amount, settings[0]?.currency ?? 'usd');
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `New charge from ${name}: ${amount}`,
		...renderEmail({
			orgName: name,
			heading: `${amount} due ${formatDate(row.dueDate)}`,
			lines: [
				`Hi ${row.memberName} — ${name} posted a charge to your account:`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
	const today = localDate(new Date(), tz);
	for (const m of rows) {
		if (!m.email) continue;
		if (!(await logOnce(orgId, 'membership_suspended', `${m.id}:${today}`, m.email))) continue;
		await sendMemberEmail(m.id, {
			to: m.email,
			subject: `Membership suspended — ${name}`,
			...renderEmail({
				orgName: name,
				heading: 'Your membership is suspended',
				lines: [
					`Hi ${m.name} — your membership at ${name} was suspended because of an overdue balance.`,
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
	const name = await orgName(orgId);
	await sendMemberEmail(row.memberId, {
		to: row.memberEmail,
		subject: `Welcome back — your ${row.planName} membership is active`,
		...renderEmail({
			orgName: name,
			heading: 'Welcome back!',
			lines: [
				`Hi ${row.memberName} — your pause is over and your ${row.planName} membership at ${name} is active again.`,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
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
				orgName: name,
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
		subject: `Cancellation requested — ${name}`,
		...renderEmail({
			orgName: name,
			heading: 'We received your request',
			lines: [
				`Hi ${row.memberName} — we got your request to cancel your ${row.planName} membership at ${name}.`,
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
		orgName(orgId),
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
			subject: `${name}: your week — ${newMembers!.n} new members, ${formatMoney(collected!.n, currency)} collected`,
			...renderEmail({
				orgName: name,
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
		orgName(orgId),
		db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId)).limit(1),
		orgTimezone(orgId)
	]);
	const lines = [
		`Hi ${row.memberName} — your membership at ${name} switched from ${oldPlanName} to ${row.planName}.`,
		row.nextChargeAt
			? `Your next bill on ${localDate(row.nextChargeAt, tz)} will be ${formatMoney(row.amount, st[0]?.currency ?? 'usd')}/${row.interval}.`
			: `Your new rate is ${formatMoney(row.amount, st[0]?.currency ?? 'usd')}/${row.interval}.`
	];
	await sendMemberEmail(row.memberId, {
		to: row.email,
		subject: `Your plan changed: ${row.planName} at ${name}`,
		...renderEmail({
			orgName: name,
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
	const [name, tz] = await Promise.all([orgName(orgId), orgTimezone(orgId)]);
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
				orgName: name,
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
		subject: `Pause requested — ${name}`,
		...renderEmail({
			orgName: name,
			heading: 'We received your request',
			lines: [
				`Hi ${row.memberName} — we got your request to pause your ${row.planName} membership at ${name} until ${resume}.`,
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
			lastVisit: sql<Date | null>`max(${checkIn.checkedAt})`
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
	const name = await orgName(orgId);
	let sent = 0;
	for (const r of rows) {
		if (!r.email) continue;
		const since = r.lastVisit ?? r.joined;
		if (since.getTime() > cutoff) continue;
		if (!(await logOnce(orgId, 'winback', `${r.memberId}:${month}`, r.email))) continue;
		const days = Math.floor((Date.now() - since.getTime()) / 86400_000);
		await sendMemberEmail(r.memberId, {
			to: r.email,
			subject: `We miss you at ${name}`,
			...renderEmail({
				orgName: name,
				heading: 'We miss you',
				lines: [
					`Hi ${r.name} — it's been ${days} days since your last visit to ${name}.`,
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
		orgName(orgId),
		orgTimezone(orgId)
	]);
	if (!m?.email) return;
	if (!(await logOnce(orgId, 'noshow', bookingId, m.email))) return;
	const when = `${localDate(startsAt, tz)} ${localTime(startsAt, tz)}`;
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `We missed you at ${className}`,
		...renderEmail({
			orgName: name,
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
	const name = await orgName(orgId);
	await sendMemberEmail(memberId, {
		to: m.email,
		subject: `${count} check-ins at ${name} — nice work, ${m.name.split(' ')[0]}`,
		...renderEmail({
			orgName: name,
			heading: `${count} check-ins. Keep it up.`,
			lines: [
				`Hi ${m.name} — you just hit ${count} check-ins at ${name}. That's real consistency.`,
				'See you at the next one.'
			],
			action: { label: 'Open the member portal', url: `${appOrigin()}/portal` }
		})
	});
}
