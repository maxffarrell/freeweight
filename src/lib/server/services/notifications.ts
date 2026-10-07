import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	classSession,
	classType,
	gymMember,
	gymSettings,
	location,
	notificationLog,
	organization
} from '#lib/server/db/schema.ts';
import { appOrigin, sendEmail } from '#lib/server/email.ts';
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
