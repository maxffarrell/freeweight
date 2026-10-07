import { error } from '@sveltejs/kit';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	course,
	courseEnrollment,
	gymMember,
	gymSettings
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { addCharge } from './billing.ts';
import { emit } from './events.ts';
import { formatMoney, todayISO } from '#lib/format.ts';
import { localDate } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

/** Sessions a course enrolls into: upcoming, non-cancelled sessions of its class type inside [startsOn, endsOn] (gym-tz dates). */
async function courseSessions(orgId: string, c: typeof course.$inferSelect) {
	const [settings] = await db
		.select({ tz: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const tz = settings?.tz ?? 'UTC';
	const rows = await db
		.select({
			id: classSession.id,
			capacity: classSession.capacity,
			startsAt: classSession.startsAt
		})
		.from(classSession)
		.where(
			and(
				eq(classSession.organizationId, orgId),
				eq(classSession.classTypeId, c.classTypeId),
				isNull(classSession.cancelledAt),
				// Wide pre-filter in UTC; the window is narrowed per the gym's tz below.
				sql`${classSession.startsAt} >= ${c.startsOn}::date - interval '2 days'`,
				sql`${classSession.startsAt} <= (${c.endsOn}::date + interval '2 days')`,
				gt(classSession.startsAt, new Date())
			)
		)
		.orderBy(asc(classSession.startsAt));
	return rows.filter((r) => {
		const d = localDate(r.startsAt, tz);
		return d >= c.startsOn && d <= c.endsOn;
	});
}

/** Staff view: every course with enrollee + remaining-session counts. */
export async function listCourses(orgId: string) {
	const rows = await db
		.select({ course, className: classType.name })
		.from(course)
		.innerJoin(classType, eq(course.classTypeId, classType.id))
		.where(eq(course.organizationId, orgId))
		.orderBy(asc(course.startsOn));
	const out = [];
	for (const r of rows) {
		const [en] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(courseEnrollment)
			.where(eq(courseEnrollment.courseId, r.course.id));
		const sessions = await courseSessions(orgId, r.course);
		out.push({ ...r, enrolled: en?.n ?? 0, sessionsLeft: sessions.length });
	}
	return out;
}

export async function createCourse(ctx: OrgContext, input: v.InferOutput<typeof s.courseInput>) {
	const [ct] = await db
		.select({ id: classType.id })
		.from(classType)
		.where(and(eq(classType.id, input.classTypeId), eq(classType.organizationId, ctx.orgId)));
	if (!ct) error(404, 'Class type not found');
	const [row] = await db
		.insert(course)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description ?? '',
			classTypeId: input.classTypeId,
			startsOn: input.startsOn,
			endsOn: input.endsOn,
			priceCents: input.priceCents ?? 0,
			capacity: input.capacity ?? null,
			memberBookable: input.memberBookable ?? true
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'course',
		entityId: row!.id,
		action: 'created',
		summary: `Course "${row!.name}" created`
	});
	return row;
}

/** Removes a course only while it has no enrollees; otherwise keep history. */
export async function removeCourse(ctx: OrgContext, id: string) {
	const [row] = await db
		.select()
		.from(course)
		.where(and(eq(course.id, id), eq(course.organizationId, ctx.orgId)));
	if (!row) error(404, 'Course not found');
	const [en] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(courseEnrollment)
		.where(eq(courseEnrollment.courseId, id));
	if ((en?.n ?? 0) > 0)
		error(
			409,
			`${en!.n} member${en!.n === 1 ? ' is' : 's are'} enrolled — cancel their enrollments first`
		);
	await db.delete(course).where(eq(course.id, id));
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'course',
		entityId: id,
		action: 'deleted',
		summary: `Course "${row.name}" removed`
	});
}

/** Who's enrolled in one course (staff roster). */
export async function courseRoster(orgId: string, courseId: string) {
	return db
		.select({
			enrollment: courseEnrollment,
			memberName: gymMember.name,
			memberEmail: gymMember.email
		})
		.from(courseEnrollment)
		.innerJoin(gymMember, eq(courseEnrollment.memberId, gymMember.id))
		.where(and(eq(courseEnrollment.organizationId, orgId), eq(courseEnrollment.courseId, courseId)))
		.orderBy(asc(courseEnrollment.createdAt));
}

/** Portal listing: open courses + the member's enrollments. */
export async function portalCourses(orgId: string, memberId: string) {
	const rows = await db
		.select({ course, className: classType.name })
		.from(course)
		.innerJoin(classType, eq(course.classTypeId, classType.id))
		.where(
			and(
				eq(course.organizationId, orgId),
				eq(course.memberBookable, true),
				sql`${course.endsOn} >= ${todayISO()}`
			)
		)
		.orderBy(asc(course.startsOn));
	const mine = await db
		.select({ courseId: courseEnrollment.courseId })
		.from(courseEnrollment)
		.where(eq(courseEnrollment.memberId, memberId));
	const enrolled = new Set(mine.map((m) => m.courseId));
	const out = [];
	for (const r of rows) {
		const [en] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(courseEnrollment)
			.where(eq(courseEnrollment.courseId, r.course.id));
		const n = en?.n ?? 0;
		out.push({
			course: r.course,
			className: r.className,
			enrolled: n,
			full: r.course.capacity !== null && n >= r.course.capacity,
			mine: enrolled.has(r.course.id)
		});
	}
	return out;
}

/**
 * Enrolls a member: posts the signup charge (if priced), then books them into
 * every upcoming session in the window — 'waitlisted' when a session is full.
 * One enrollment per member per course (unique index enforced).
 */
export async function enrollCourse(orgId: string, memberId: string, courseId: string) {
	const [c] = await db
		.select()
		.from(course)
		.where(and(eq(course.id, courseId), eq(course.organizationId, orgId)));
	if (!c) error(404, 'Course not found');
	const [already] = await db
		.select({ id: courseEnrollment.id })
		.from(courseEnrollment)
		.where(and(eq(courseEnrollment.courseId, courseId), eq(courseEnrollment.memberId, memberId)));
	if (already) error(409, 'Already enrolled');
	if (c.capacity !== null) {
		const [en] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(courseEnrollment)
			.where(eq(courseEnrollment.courseId, courseId));
		if ((en?.n ?? 0) >= c.capacity) error(409, 'Course is full');
	}
	const sessions = await courseSessions(orgId, c);
	if (!sessions.length) error(404, 'No upcoming sessions in this course window');

	// Charge first so a failure doesn't leave bookings behind.
	let chargeRow = null;
	if (c.priceCents > 0) {
		chargeRow = await addCharge(
			{ orgId },
			{
				memberId,
				kind: 'other',
				description: `Course: ${c.name}`,
				amount: c.priceCents,
				dueDate: todayISO()
			}
		);
	}
	const [enrollment] = await db
		.insert(courseEnrollment)
		.values({ organizationId: orgId, courseId, memberId, chargeId: chargeRow?.id ?? null })
		.returning();

	// Skip sessions the member is already booked into (unique open-booking index).
	const existing = await db
		.select({ sessionId: booking.sessionId })
		.from(booking)
		.where(
			and(
				eq(booking.memberId, memberId),
				ne(booking.status, 'cancelled'),
				inArray(
					booking.sessionId,
					sessions.map((x) => x.id)
				)
			)
		);
	const have = new Set(existing.map((e) => e.sessionId));
	const counts = await db
		.select({ sessionId: booking.sessionId, n: sql<number>`count(*)`.mapWith(Number) })
		.from(booking)
		.where(
			and(
				inArray(
					booking.sessionId,
					sessions.map((x) => x.id)
				),
				ne(booking.status, 'cancelled')
			)
		)
		.groupBy(booking.sessionId);
	const taken = new Map(counts.map((x) => [x.sessionId, x.n]));
	let booked = 0;
	let waitlisted = 0;
	for (const sess of sessions) {
		if (have.has(sess.id)) continue;
		const n = taken.get(sess.id) ?? 0;
		const status = n < sess.capacity ? 'booked' : 'waitlisted';
		await db.insert(booking).values({
			organizationId: orgId,
			sessionId: sess.id,
			memberId,
			status: status as never
		});
		taken.set(sess.id, n + 1);
		if (status === 'booked') booked++;
		else waitlisted++;
	}
	await emit({
		orgId,
		entityType: 'course',
		entityId: courseId,
		action: 'enrolled',
		summary: `Enrolled in course "${c.name}"${c.priceCents ? ` (${formatMoney(c.priceCents)})` : ''}`
	});
	return { enrollment, booked, waitlisted, charge: chargeRow };
}

/**
 * Member leaves a course: removes the enrollment, cancels their still-upcoming
 * bookings inside the window, and voids the signup charge if it is unpaid.
 */
export async function unenrollCourse(orgId: string, memberId: string, courseId: string) {
	const [enrollment] = await db
		.select()
		.from(courseEnrollment)
		.where(
			and(
				eq(courseEnrollment.organizationId, orgId),
				eq(courseEnrollment.courseId, courseId),
				eq(courseEnrollment.memberId, memberId)
			)
		);
	if (!enrollment) error(404, 'Not enrolled');
	const [c] = await db.select().from(course).where(eq(course.id, courseId));
	const sessions = c ? await courseSessions(orgId, c) : [];
	if (sessions.length) {
		await db
			.update(booking)
			.set({ status: 'cancelled', cancelledAt: new Date() })
			.where(
				and(
					eq(booking.memberId, memberId),
					inArray(
						booking.sessionId,
						sessions.map((x) => x.id)
					),
					inArray(booking.status, ['booked', 'waitlisted'])
				)
			);
	}
	if (enrollment.chargeId) {
		await db
			.update(charge)
			.set({ status: 'void', updatedAt: new Date() })
			.where(and(eq(charge.id, enrollment.chargeId), eq(charge.status, 'open')));
	}
	await db.delete(courseEnrollment).where(eq(courseEnrollment.id, enrollment.id));
	await emit({
		orgId,
		entityType: 'course',
		entityId: courseId,
		action: 'unenrolled',
		summary: `Left course "${c?.name ?? courseId}"${enrollment.chargeId ? ' (charge voided if unpaid)' : ''}`
	});
	return { ok: true };
}
