import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { booking, classSession, classType, gymMember, location } from '#lib/server/db/schema.ts';
import { validCalendarToken } from '#lib/server/services/notifications.ts';
import type { RequestHandler } from './$types';

const stamp = (d: Date) =>
	d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
const esc = (s: string) =>
	s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Personal iCal feed of a member's upcoming bookings — subscribe via the portal's "Sync to calendar" link. */
export const GET: RequestHandler = async ({ url }) => {
	const memberId = url.searchParams.get('m') ?? '';
	const token = url.searchParams.get('t') ?? '';
	if (!memberId || !validCalendarToken(memberId, token))
		return new Response('Invalid calendar link', { status: 403 });

	const [m] = await db
		.select({ orgId: gymMember.organizationId })
		.from(gymMember)
		.where(eq(gymMember.id, memberId));
	if (!m) return new Response('Invalid calendar link', { status: 403 });

	const rows = await db
		.select({
			bookingId: booking.id,
			status: booking.status,
			className: classType.name,
			locationName: location.name,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.leftJoin(location, eq(classSession.locationId, location.id))
		.where(
			and(
				eq(booking.memberId, memberId),
				inArray(booking.status, ['booked', 'waitlisted']),
				isNull(classSession.cancelledAt),
				gte(classSession.startsAt, new Date(Date.now() - 86_400_000))
			)
		)
		.orderBy(asc(classSession.startsAt))
		.limit(200);

	const events = rows
		.map((r) =>
			[
				'BEGIN:VEVENT',
				`UID:${r.bookingId}@freeweight`,
				`DTSTAMP:${stamp(new Date())}`,
				`DTSTART:${stamp(r.startsAt)}`,
				`DTEND:${stamp(r.endsAt)}`,
				`SUMMARY:${esc(r.className)}${r.status === 'waitlisted' ? ' (waitlist)' : ''}`,
				r.locationName ? `LOCATION:${esc(r.locationName)}` : null,
				`DESCRIPTION:${r.status === 'waitlisted' ? 'You are on the waitlist for this class.' : 'Class booking'}`,
				'END:VEVENT'
			]
				.filter(Boolean)
				.join('\r\n')
		)
		.join('\r\n');

	const ics =
		'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//freeweight//member-bookings//EN\r\nCALSCALE:GREGORIAN\r\n' +
		(events ? `${events}\r\n` : '') +
		'END:VCALENDAR\r\n';
	return new Response(ics, {
		headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' }
	});
};
