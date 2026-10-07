import { error } from '@sveltejs/kit';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	notificationLog,
	organization
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
