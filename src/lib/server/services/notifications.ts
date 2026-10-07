import { error } from '@sveltejs/kit';
import { and, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	member,
	notificationLog,
	organization,
	payment,
	user
} from '#lib/server/db/schema.ts';
import { appOrigin, emailProvider, sendEmail } from '#lib/server/email.ts';
import { formatDate, formatMoney } from '#lib/format.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { localDate, localTime } from '#lib/tz.ts';

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
	await sendEmail({
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
	await sendEmail({
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
	await sendEmail({
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
		await sendEmail({
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

/** "Class cancelled" to every booked/waitlisted member of the session. One email per member. */
export async function notifySessionCancelled(orgId: string, sessionId: string) {
	const rows = await db
		.select({
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
		await sendEmail({
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
		.select({ email: gymMember.email, memberName: gymMember.name })
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
		await sendEmail({
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
 * "Your class is tomorrow" — one email per booked member for sessions starting in the
 * next ~24h (the cron runs daily, so each session is caught exactly once).
 * Returns the number of emails sent.
 */
export async function sendClassReminders(orgId: string) {
	const soon = new Date(Date.now() + 26 * 3600_000);
	const rows = await db
		.select({
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
		await sendEmail({
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
	memberIds?: string[]
) {
	if (!emailProvider()) error(409, 'No email provider configured');
	const members = await db
		.select({ email: gymMember.email })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				memberIds?.length ? inArray(gymMember.id, memberIds) : undefined,
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
		await sendEmail({ to: m.email, subject: `${name}: ${subject}`, text, html });
		sent++;
	}
	return { sent, total: members.length };
}

/** "Invoice ready" when a charge posts — membership billing, first period, anything else. */
export async function notifyChargePosted(orgId: string, chargeId: string) {
	const [row] = await db
		.select({
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
	await sendEmail({
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
