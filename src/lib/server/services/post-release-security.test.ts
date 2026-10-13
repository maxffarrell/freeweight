vi.mock(
	'$app/env/private',
	() =>
		new Proxy(
			{
				DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/unavailable',
				BETTER_AUTH_SECRET: 'post-release-test-only'
			} as Record<string, unknown>,
			{ get: (t, k) => t[String(k)], has: () => true }
		)
);
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import * as s from '#lib/schemas.ts';
import type { OrgContext } from '../context.ts';
vi.mock('./events.ts', () => ({ emit: vi.fn(async () => undefined) }));
vi.mock('./notifications.ts', () => ({
	unsubscribeToken: vi.fn(async () => undefined),
	validUnsubscribeToken: vi.fn(async () => undefined),
	calendarToken: vi.fn(async () => undefined),
	validCalendarToken: vi.fn(async () => undefined),
	sendReferralInvite: vi.fn(async () => undefined),
	openToken: vi.fn(async () => undefined),
	validOpenToken: vi.fn(async () => undefined),
	markEmailOpened: vi.fn(async () => undefined),
	notifyWaitlistPromoted: vi.fn(async () => undefined),
	notifyBookingConfirmed: vi.fn(async () => undefined),
	notifyResourceBooked: vi.fn(async () => undefined),
	notifyEventRegistered: vi.fn(async () => undefined),
	notifyEventWaitlisted: vi.fn(async () => undefined),
	notifyCourseWaitlisted: vi.fn(async () => undefined),
	notifyCourseEnrolled: vi.fn(async () => undefined),
	notifyEventCancelled: vi.fn(async () => undefined),
	notifySeriesBooked: vi.fn(async () => undefined),
	notifyPlanPriceChange: vi.fn(async () => undefined),
	notifyPaymentReceived: vi.fn(async () => undefined),
	resendPaymentReceipt: vi.fn(async () => undefined),
	notifyPaymentRefunded: vi.fn(async () => undefined),
	sendPastDueNotices: vi.fn(async () => undefined),
	sendTrialEndingNotices: vi.fn(async () => undefined),
	sendBirthdayGreetings: vi.fn(async () => undefined),
	sendAnniversaryGreetings: vi.fn(async () => undefined),
	notifyReferralJoin: vi.fn(async () => undefined),
	notifySessionCancelled: vi.fn(async () => undefined),
	notifyBookingCancelled: vi.fn(async () => undefined),
	notifyInstructorChanged: vi.fn(async () => undefined),
	notifySessionChanged: vi.fn(async () => undefined),
	sendClassReminders: vi.fn(async () => undefined),
	sendEventReminders: vi.fn(async () => undefined),
	sendResourceReminders: vi.fn(async () => undefined),
	notifyPackLowCredit: vi.fn(async () => undefined),
	notifyCreditsGifted: vi.fn(async () => undefined),
	notifyReferralReward: vi.fn(async () => undefined),
	sendChallengeInvites: vi.fn(async () => undefined),
	sendChallengeResults: vi.fn(async () => undefined),
	sendWaiverReminders: vi.fn(async () => undefined),
	requestPaymentNotice: vi.fn(async () => undefined),
	requestAllPaymentNotices: vi.fn(async () => undefined),
	mergeTags: vi.fn(async () => undefined),
	sendAnnouncementTest: vi.fn(async () => undefined),
	sendAnnouncement: vi.fn(async () => undefined),
	previewAnnouncement: vi.fn(async () => undefined),
	countAnnouncementAudience: vi.fn(async () => undefined),
	scheduleAnnouncement: vi.fn(async () => undefined),
	sendDueAnnouncements: vi.fn(async () => undefined),
	listRecurringAnnouncements: vi.fn(async () => undefined),
	createRecurringAnnouncement: vi.fn(async () => undefined),
	deleteRecurringAnnouncement: vi.fn(async () => undefined),
	sendDueRecurringAnnouncements: vi.fn(async () => undefined),
	markAnnouncementsRead: vi.fn(async () => undefined),
	memberAnnouncements: vi.fn(async () => undefined),
	listRecentAnnouncements: vi.fn(async () => undefined),
	cancelScheduledAnnouncement: vi.fn(async () => undefined),
	notifyChargePosted: vi.fn(async () => undefined),
	notifyMembershipSuspended: vi.fn(async () => undefined),
	notifyMembershipResumed: vi.fn(async () => undefined),
	notifyCancellationRequested: vi.fn(async () => undefined),
	sendWeeklyDigest: vi.fn(async () => undefined),
	sendMemberDigest: vi.fn(async () => undefined),
	sendStaffBriefing: vi.fn(async () => undefined),
	notifyPlanChanged: vi.fn(async () => undefined),
	notifyPauseRequested: vi.fn(async () => undefined),
	sendWinBackNudges: vi.fn(async () => undefined),
	sendLeadNudges: vi.fn(async () => undefined),
	sendCourseCompletions: vi.fn(async () => undefined),
	notifyNoShow: vi.fn(async () => undefined),
	notifyCheckInMilestone: vi.fn(async () => undefined),
	notifyPersonalRecord: vi.fn(async () => undefined),
	sendNewMemberDrip: vi.fn(async () => undefined),
	notifyStreakReward: vi.fn(async () => undefined),
	notifyFirstVisit: vi.fn(async () => undefined),
	sendInstructorRosters: vi.fn(async () => undefined),
	sendInstructorFeedbackDigests: vi.fn(async () => undefined),
	sendBillingReminders: vi.fn(async () => undefined),
	sendCoverRequests: vi.fn(async () => undefined),
	ratingNudges: vi.fn(async () => undefined),
	notifyLowRating: vi.fn(async () => undefined),
	notifyMembershipCancelled: vi.fn(async () => undefined),
	notifyLowStock: vi.fn(async () => undefined),
	notifySignRequest: vi.fn(async () => undefined),
	sendSignReminders: vi.fn(async () => undefined),
	notifyReviewRequest: vi.fn(async () => undefined),
	listAnnouncementTemplates: vi.fn(async () => undefined),
	createAnnouncementTemplate: vi.fn(async () => undefined),
	deleteAnnouncementTemplate: vi.fn(async () => undefined),
	notifyTrialRequested: vi.fn(async () => undefined),
	notifyTrialConfirmed: vi.fn(async () => undefined),
	notifyTrialDeclined: vi.fn(async () => undefined),
	notifyDeletionRequested: vi.fn(async () => undefined),
	notifyClassFull: vi.fn(async () => undefined),
	sendUsualClassNudges: vi.fn(async () => undefined),
	notifyClassWatchers: vi.fn(async () => undefined),
	sendEquipmentServiceReminders: vi.fn(async () => undefined),
	sendOwnerInsights: vi.fn(async () => undefined),
	resendAnnouncementToNonOpeners: vi.fn(async () => undefined)
}));
import { db } from '../db/index.ts';
import {
	organization,
	user,
	member,
	gymMember,
	session,
	location,
	classType,
	classSession,
	classTemplate,
	deskTask,
	deskTaskDone,
	gymEvent,
	facilityResource,
	ptRequest
} from '../db/schema.ts';
import { toggleDeskTask, clockIn } from './shifts.ts';
import { anonymizeMember } from './members.ts';
import {
	createClassType,
	updateClassType,
	createSession,
	updateSession,
	createTemplate,
	updateTemplate,
	instructorHandoff,
	listClassTypes,
	materializeTemplates
} from './schedule.ts';
import { createEvent, updateEvent } from './gym-events.ts';
import { createResource, updateResource } from './resources.ts';
import { requestPt, memberPtRequests } from './pt.ts';
const orgs = [randomUUID(), randomUUID()],
	users = [randomUUID(), randomUUID(), randomUUID()];
const staff = [randomUUID(), randomUUID()],
	locs = [randomUUID(), randomUUID()],
	types = [randomUUID(), randomUUID()];
const portal = [randomUUID(), randomUUID()],
	sid = randomUUID(),
	template = randomUUID(),
	event = randomUUID(),
	resource = randomUUID(),
	task = randomUUID(),
	sessionId = randomUUID();
const ctx = {
	orgId: orgs[0],
	userId: users[0],
	role: 'owner',
	org: { id: orgs[0], name: 'Test', slug: orgs[0], logo: null }
} as OrgContext;
const future = new Date(Date.now() + 7 * 86400000),
	wall = future.toISOString().slice(0, 16);
const templateInput = { classTypeId: types[0], weekday: 1, startTime: '12:00' };
describe.runIf(Boolean(process.env.DATABASE_URL))(
	'post-release tenant boundaries in PostgreSQL',
	() => {
		beforeAll(async () => {
			await db
				.insert(user)
				.values(
					users.map((id) => ({ id, name: 'PRIVATE FOREIGN STAFF', email: `${id}@example.invalid` }))
				);
			await db
				.insert(organization)
				.values(orgs.map((id) => ({ id, name: 'Test', slug: id, createdAt: new Date() })));
			await db.insert(member).values(
				staff.map((id, i) => ({
					id,
					organizationId: orgs[i],
					userId: users[i],
					role: 'owner',
					createdAt: new Date()
				}))
			);
			await db
				.insert(location)
				.values(
					locs.map((id, i) => ({ id, organizationId: orgs[i], name: 'PRIVATE FOREIGN LOCATION' }))
				);
			await db.insert(classType).values(
				types.map((id, i) => ({
					id,
					organizationId: orgs[i],
					name: 'Class',
					locationId: locs[i],
					instructorId: staff[i]
				}))
			);
			await db.insert(gymMember).values(
				portal.map((id, i) => ({
					id,
					organizationId: orgs[i],
					name: 'Portal',
					portalUserId: users[2]
				}))
			);
			await db
				.insert(session)
				.values({ id: sid, token: randomUUID(), userId: users[2], expiresAt: future });
			await db.insert(classTemplate).values({
				id: template,
				organizationId: orgs[0],
				classTypeId: types[0],
				instructorId: staff[0],
				weekday: 1,
				startTime: '12:00'
			});
			await db.insert(classSession).values({
				id: sessionId,
				organizationId: orgs[0],
				classTypeId: types[0],
				startsAt: future,
				endsAt: new Date(+future + 3600000),
				capacity: 10
			});
			await db.insert(gymEvent).values({
				id: event,
				organizationId: orgs[0],
				name: 'Event',
				startsAt: future,
				endsAt: future,
				capacity: 10
			});
			await db
				.insert(facilityResource)
				.values({ id: resource, organizationId: orgs[0], name: 'Room' });
			await db
				.insert(deskTask)
				.values({ id: task, organizationId: orgs[1], label: 'PRIVATE FOREIGN TASK' });
		}, 15000);
		afterAll(async () => {
			await db.delete(organization).where(inArray(organization.id, orgs));
			await db.delete(user).where(inArray(user.id, users));
		});
		it('foreign desk tick cannot preempt and foreign untick cannot erase completion', async () => {
			await expect(toggleDeskTask(ctx, task, true)).rejects.toMatchObject({ status: 404 });
			expect(
				await db.select().from(deskTaskDone).where(eq(deskTaskDone.taskId, task))
			).toHaveLength(0);
			const foreignCtx = { ...ctx, orgId: orgs[1], userId: users[1] };
			await toggleDeskTask(foreignCtx, task, true);
			await expect(toggleDeskTask(ctx, task, false)).rejects.toMatchObject({ status: 404 });
			expect(
				await db.select().from(deskTaskDone).where(eq(deskTaskDone.taskId, task))
			).toHaveLength(1);
			await toggleDeskTask(foreignCtx, task, false);
			expect(
				await db.select().from(deskTaskDone).where(eq(deskTaskDone.taskId, task))
			).toHaveLength(0);
		});
		it('local anonymization preserves the shared global account, session and other gym link', async () => {
			await anonymizeMember(ctx, portal[0]);
			const rows = await db.select().from(gymMember).where(inArray(gymMember.id, portal));
			expect(rows.find((r) => r.id === portal[0])).toMatchObject({
				portalUserId: null,
				name: 'Former member'
			});
			expect(rows.find((r) => r.id === portal[1])!.portalUserId).toBe(users[2]);
			expect(await db.select().from(user).where(eq(user.id, users[2]))).toHaveLength(1);
			expect(await db.select().from(session).where(eq(session.id, sid))).toHaveLength(1);
		});
		it.each(['locationId', 'instructorId'] as const)(
			'rejects foreign %s on every class writer',
			async (field) => {
				const refs = { [field]: field === 'locationId' ? locs[1] : staff[1] };
				const base = v.parse(s.classTypeInput, {
					name: 'New',
					durationMin: 60,
					capacity: 10,
					...refs
				});
				await expect(createClassType(ctx, base)).rejects.toMatchObject({ status: 404 });
				await expect(updateClassType(ctx, { id: types[0], ...refs })).rejects.toMatchObject({
					status: 404
				});
				await expect(
					createSession(
						ctx,
						'UTC',
						v.parse(s.sessionInput, { classTypeId: types[0], startsAt: wall, ...refs })
					)
				).rejects.toMatchObject({ status: 404 });
				await expect(updateSession(ctx, 'UTC', { id: sessionId, ...refs })).rejects.toMatchObject({
					status: 404
				});
				await expect(createTemplate(ctx, { ...templateInput, ...refs })).rejects.toMatchObject({
					status: 404
				});
				await expect(
					updateTemplate(ctx, { id: template, ...templateInput, ...refs })
				).rejects.toMatchObject({ status: 404 });
			}
		);
		it('validates portal PT instructors and location writers independently of their parent', async () => {
			await expect(requestPt(orgs[0], portal[0], staff[1], future, '')).rejects.toMatchObject({
				status: 404
			});
			await expect(clockIn(ctx, { locationId: locs[1] })).rejects.toMatchObject({ status: 404 });
			await expect(
				createEvent(ctx, {
					name: 'Event',
					startsAt: future,
					endsAt: future,
					capacity: 10,
					memberBookable: true,
					active: true,
					locationId: locs[1]
				})
			).rejects.toMatchObject({ status: 404 });
			await expect(updateEvent(ctx, { id: event, locationId: locs[1] })).rejects.toMatchObject({
				status: 404
			});
			await expect(
				createResource(
					ctx,
					v.parse(s.resourceInput, {
						name: 'Room',
						slotMin: 60,
						capacity: 1,
						openFrom: '09:00',
						openTo: '17:00',
						locationId: locs[1]
					})
				)
			).rejects.toMatchObject({ status: 404 });
			await expect(
				updateResource(ctx, { id: resource, locationId: locs[1] })
			).rejects.toMatchObject({ status: 404 });
		});
		it('preserves valid references, partial omission and explicit clearing', async () => {
			await updateClassType(ctx, { id: types[0], name: 'Renamed' });
			expect(
				(await db.select().from(classType).where(eq(classType.id, types[0])))[0].locationId
			).toBe(locs[0]);
			await updateClassType(ctx, { id: types[0], locationId: null });
			expect(
				(await db.select().from(classType).where(eq(classType.id, types[0])))[0].locationId
			).toBeNull();
			const pt = await requestPt(orgs[0], portal[0], staff[0], future, 'Okay');
			expect(pt.instructorId).toBe(staff[0]);
			await updateResource(ctx, { id: resource, locationId: locs[0] });
			expect(
				(await db.select().from(facilityResource).where(eq(facilityResource.id, resource)))[0]
					.locationId
			).toBe(locs[0]);
		});
		it('rejects template-only handoff and poisoned inherited defaults before propagation', async () => {
			await expect(
				instructorHandoff(ctx, 'UTC', { fromId: staff[0], toId: staff[1], cancel: false })
			).rejects.toMatchObject({ status: 404 });
			await db.update(classType).set({ instructorId: staff[1] }).where(eq(classType.id, types[0]));
			await expect(
				createSession(
					ctx,
					'UTC',
					v.parse(s.sessionInput, { classTypeId: types[0], startsAt: wall })
				)
			).rejects.toMatchObject({ status: 404 });
			await db
				.update(classTemplate)
				.set({ instructorId: null })
				.where(eq(classTemplate.id, template));
			await expect(materializeTemplates(orgs[0])).rejects.toMatchObject({ status: 404 });
			const listed = await listClassTypes(orgs[0]);
			expect(listed.find((r) => r.id === types[0])!.instructorName).toBeNull();
			await db.insert(ptRequest).values({
				organizationId: orgs[0],
				memberId: portal[0],
				instructorId: staff[1],
				preferredAt: future
			});
			const requests = await memberPtRequests(orgs[0], portal[0]);
			expect(requests.find((r) => r.request.instructorId === staff[1])!.instructorName).toBeNull();
		});
	}
);
