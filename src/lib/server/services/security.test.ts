import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	booking,
	charge,
	classSession,
	classType,
	classWatch,
	gymMember,
	gymSettings,
	membership,
	organization,
	payment,
	plan,
	waiver,
	user
} from '#lib/server/db/schema.ts';
import {
	bookDropIn,
	buyDayPass,
	captureLead,
	getPublicGym,
	joinGym,
	requestTrial
} from './public.ts';
import { createMember, listMembers, transferPackCredits, updateMember } from './members.ts';
import {
	createMembership,
	listCharges,
	memberBalance,
	postMembershipCharge,
	recordPayment,
	refundPayment
} from './billing.ts';
import { dashboard } from './dashboard.ts';
import { getReports } from './reports.ts';
import { notifyCreditsGifted, notifyPaymentReceived, notifyPlanChanged } from './notifications.ts';
import { bookSession, creditsUsedIn } from './schedule.ts';
import {
	acceptSaveOffer,
	claimPortal,
	portalToken,
	memberChangePlan,
	setClassWatch
} from './portal.ts';

const notificationSpies = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

// A synchronous fixture avoids notifications -> reports -> members importing real
// notification functions while an importOriginal-based factory is still loading.
vi.mock('./notifications.ts', () => {
	const names = [
		'calendarToken',
		'notifyBookingCancelled',
		'notifyBookingConfirmed',
		'notifyCancellationRequested',
		'notifyChargePosted',
		'notifyClassFull',
		'notifyClassWatchers',
		'notifyCreditsGifted',
		'notifyDeletionRequested',
		'notifyInstructorChanged',
		'notifyLowRating',
		'notifyLowStock',
		'notifyMembershipCancelled',
		'notifyMembershipResumed',
		'notifyMembershipSuspended',
		'notifyNoShow',
		'notifyPackLowCredit',
		'notifyPauseRequested',
		'notifyPaymentReceived',
		'notifyPaymentRefunded',
		'notifyPersonalRecord',
		'notifyPlanChanged',
		'notifyPlanPriceChange',
		'notifyReferralJoin',
		'notifyReferralReward',
		'notifySeriesBooked',
		'notifySessionCancelled',
		'notifySessionChanged',
		'notifySignRequest',
		'notifyTrialRequested',
		'notifyWaitlistPromoted',
		'sendCoverRequests'
	];
	return Object.fromEntries(
		names.map((key) => {
			let spy = notificationSpies.get(key);
			if (!spy) {
				spy = vi.fn(async () => undefined);
				notificationSpies.set(key, spy);
			}
			return [key, spy];
		})
	);
});
vi.mock('./events.ts', () => ({ emit: vi.fn(async () => undefined) }));

describe('notification mock identities', () => {
	it('shares stable keyed spies across module imports', () => {
		expect(notifyCreditsGifted).toBe(notificationSpies.get('notifyCreditsGifted'));
		expect(notifyPaymentReceived).toBe(notificationSpies.get('notifyPaymentReceived'));
		expect(notifyPlanChanged).toBe(notificationSpies.get('notifyPlanChanged'));
	});
});

// CI supplies a migrated disposable PostgreSQL database. Fixtures never use existing tenants.
describe.skipIf(!process.env.DATABASE_URL)(
	'public ownership, tenant isolation and financial atomicity',
	() => {
		const a = crypto.randomUUID(),
			b = crypto.randomUUID();
		const slug = `security-${a}`;
		let victim: typeof gymMember.$inferSelect, foreign: typeof gymMember.$inferSelect;
		let sessionId: string;
		beforeEach(async () => {
			vi.clearAllMocks();
			await db.insert(organization).values([
				{ id: a, name: 'Gym', slug, createdAt: new Date(), metadata: 'private' },
				{ id: b, name: 'Other', slug: `security-${b}`, createdAt: new Date() }
			]);
			await db.insert(gymSettings).values({
				organizationId: a,
				publicPage: true,
				waiver: 'Terms',
				dayPassPrice: 500,
				saveOfferPct: 25,
				kioskPin: '9381'
			});
			[victim] = await db
				.insert(gymMember)
				.values({
					organizationId: a,
					name: 'Victim',
					email: 'Victim@example.test',
					notes: 'medical information'
				})
				.returning();
			[foreign] = await db
				.insert(gymMember)
				.values({ organizationId: b, name: 'Foreign' })
				.returning();
			const [ct] = await db
				.insert(classType)
				.values({ organizationId: a, name: 'Yoga', dropInPrice: 500 })
				.returning();
			const [session] = await db
				.insert(classSession)
				.values({
					organizationId: a,
					classTypeId: ct.id,
					startsAt: new Date(Date.now() + 86400000),
					endsAt: new Date(Date.now() + 90000000),
					capacity: 10,
					checkinCode: 'secret',
					streamUrl: 'https://private.example.test',
					note: 'internal'
				})
				.returning();
			sessionId = session.id;
		});
		afterEach(async () => {
			await db.delete(organization).where(inArray(organization.id, [a, b]));
		});
		it('claims only unbound or same-owner records and returns a minimal DTO', async () => {
			const first = crypto.randomUUID(),
				second = crypto.randomUUID();
			await db.insert(user).values([
				{
					id: first,
					name: 'First',
					email: `${first}@example.test`,
					emailVerified: false,
					createdAt: new Date(),
					updatedAt: new Date()
				},
				{
					id: second,
					name: 'Second',
					email: `${second}@example.test`,
					emailVerified: false,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]);
			try {
				const token = portalToken(victim.id);
				expect(await claimPortal(token, first)).toEqual({ id: victim.id });
				expect(await claimPortal(token, first)).toEqual({ id: victim.id });
				await expect(claimPortal(token, second)).rejects.toMatchObject({
					status: 404,
					body: { message: 'Not found' }
				});
				await expect(claimPortal(portalToken(crypto.randomUUID()), first)).rejects.toMatchObject({
					status: 404,
					body: { message: 'Not found' }
				});
				await expect(claimPortal('malformed', first)).rejects.toMatchObject({ status: 404 });
				const [stored] = await db
					.select({ owner: gymMember.portalUserId })
					.from(gymMember)
					.where(eq(gymMember.id, victim.id));
				expect(stored.owner).toBe(first);
			} finally {
				await db.delete(user).where(inArray(user.id, [first, second]));
			}
		});
		it('public pages disclose only schedule and public settings fields', async () => {
			const result = await getPublicGym(slug);
			expect(result.settings).not.toHaveProperty('kioskPin');
			expect(result.org).not.toHaveProperty('metadata');
			expect(result.sessions[0].session).not.toHaveProperty('checkinCode');
			expect(result.sessions[0].session).not.toHaveProperty('streamUrl');
			expect(result.sessions[0].session).not.toHaveProperty('note');
			expect(result.settings.waiver).toBe('Terms');
			expect(result.sessions[0].session.id).toBe(sessionId);
		});
		it('runs timezone-bound reporting and positional grouping against PostgreSQL', async () => {
			await db
				.update(gymSettings)
				.set({ timezone: 'America/Chicago' })
				.where(eq(gymSettings.organizationId, a));
			const result = await getReports(a);
			expect(result.hours).toHaveLength(24);
			expect(result.weekdays).toHaveLength(7);
			expect(result.heatmap).toEqual([]);
		});
		it('email case variants cannot sign victim waivers or post victim charges and trial requests', async () => {
			const input = {
				name: 'Attacker',
				email: 'victim@EXAMPLE.test',
				agreedWaiver: true,
				website: ''
			};
			await expect(joinGym(slug, crypto.randomUUID(), input)).rejects.toMatchObject({
				status: 409
			});
			await expect(
				bookDropIn(slug, crypto.randomUUID(), { ...input, sessionId })
			).rejects.toMatchObject({ status: 409 });
			await expect(buyDayPass(slug, crypto.randomUUID(), input)).rejects.toMatchObject({
				status: 409
			});
			await expect(
				requestTrial(slug, crypto.randomUUID(), { ...input, sessionId })
			).rejects.toMatchObject({ status: 409 });
			expect(await db.select().from(waiver).where(eq(waiver.memberId, victim.id))).toHaveLength(0);
			expect(await db.select().from(charge).where(eq(charge.memberId, victim.id))).toHaveLength(0);
			expect(await captureLead(slug, crypto.randomUUID(), input)).toEqual({ existing: true });
		});
		it('new visitors still join and book without member record disclosure', async () => {
			expect(
				await joinGym(slug, crypto.randomUUID(), {
					name: 'New',
					email: 'join@example.test',
					website: '',
					agreedWaiver: true
				})
			).toEqual({ existing: false, checkoutUrl: null });
			const result = await bookDropIn(slug, crypto.randomUUID(), {
				name: 'Visitor',
				email: 'drop@example.test',
				agreedWaiver: true,
				sessionId
			});
			expect(result).not.toHaveProperty('member');
			expect(await db.select().from(booking).where(eq(booking.id, result.bookingId))).toHaveLength(
				1
			);
		});
		it('rejects foreign and same-tenant other-member charges; accepts owned charges', async () => {
			const [other] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Other' })
				.returning();
			const [foreignCharge, otherCharge, ownCharge] = await db
				.insert(charge)
				.values([
					{
						organizationId: b,
						memberId: foreign.id,
						kind: 'other',
						amount: 100,
						dueDate: '2026-10-01'
					},
					{
						organizationId: a,
						memberId: other.id,
						kind: 'other',
						amount: 100,
						dueDate: '2026-10-01'
					},
					{
						organizationId: a,
						memberId: victim.id,
						kind: 'other',
						amount: 100,
						dueDate: '2026-10-01'
					}
				])
				.returning();
			for (const c of [foreignCharge, otherCharge])
				await expect(
					recordPayment(
						{ orgId: a },
						{ memberId: victim.id, chargeId: c.id, amount: 100, method: 'cash' }
					)
				).rejects.toMatchObject({ status: 404 });
			const result = await recordPayment(
				{ orgId: a },
				{ memberId: victim.id, chargeId: ownCharge.id, amount: 100, method: 'cash' }
			);
			expect(result?.chargeId).toBe(ownCharge.id);
		});
		it('historical foreign or wrong-member payments never pay another member charge or reduce its balances', async () => {
			const [other] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Other local member' })
				.returning();
			const [c] = await db
				.insert(charge)
				.values({
					organizationId: a,
					memberId: victim.id,
					kind: 'other',
					amount: 1000,
					dueDate: '2026-10-01'
				})
				.returning();
			await db.insert(payment).values([
				{ organizationId: b, memberId: foreign.id, chargeId: c.id, amount: 800, method: 'cash' },
				{ organizationId: a, memberId: other.id, chargeId: c.id, amount: 800, method: 'cash' },
				{ organizationId: b, memberId: victim.id, chargeId: null, amount: 800, method: 'credit' }
			]);
			expect(await memberBalance(a, victim.id)).toBe(1000);
			expect((await listCharges(a)).find((row) => row.charge.id === c.id)?.paid).toBe(0);
			expect((await listMembers(a)).find((row) => row.id === victim.id)?.openBalance).toBe(1000);
			expect((await dashboard(a)).openTotal).toBe(1000);
			const own = await recordPayment(
				{ orgId: a },
				{ memberId: victim.id, chargeId: c.id, amount: 300, method: 'cash' }
			);
			expect(await memberBalance(a, victim.id)).toBe(700);
			expect((await listCharges(a)).find((row) => row.charge.id === c.id)?.paid).toBe(300);
			expect((await dashboard(a)).openTotal).toBe(700);
			expect((await db.select().from(charge).where(eq(charge.id, c.id)))[0].status).toBe('open');
			expect(notifyPaymentReceived).toHaveBeenCalledOnce();
			await refundPayment({ orgId: a, userId: null } as never, own!.id);
			expect(await memberBalance(a, victim.id)).toBe(1000);
			expect((await listCharges(a)).find((row) => row.charge.id === c.id)?.paid).toBe(0);
		});
		it('refunding a historical foreign or wrong-member payment cannot reopen another member charge', async () => {
			const [other] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Other local member' })
				.returning();
			const [foreignTarget, wrongMemberTarget] = await db
				.insert(charge)
				.values([
					{
						organizationId: a,
						memberId: victim.id,
						kind: 'other',
						amount: 1000,
						dueDate: '2026-10-01',
						status: 'paid'
					},
					{
						organizationId: a,
						memberId: victim.id,
						kind: 'other',
						amount: 1000,
						dueDate: '2026-10-01',
						status: 'paid'
					}
				])
				.returning();
			const [foreignPayment, wrongMemberPayment] = await db
				.insert(payment)
				.values([
					{
						organizationId: b,
						memberId: foreign.id,
						chargeId: foreignTarget.id,
						amount: 1000,
						method: 'cash'
					},
					{
						organizationId: a,
						memberId: other.id,
						chargeId: wrongMemberTarget.id,
						amount: 1000,
						method: 'cash'
					}
				])
				.returning();
			await refundPayment({ orgId: b, userId: null } as never, foreignPayment.id);
			await refundPayment({ orgId: a, userId: null } as never, wrongMemberPayment.id);
			expect(
				(
					await db
						.select()
						.from(charge)
						.where(inArray(charge.id, [foreignTarget.id, wrongMemberTarget.id]))
				).map((row) => row.status)
			).toEqual(['paid', 'paid']);
		});
		it('guardian create/update stays within the tenant, including clearing a guardian', async () => {
			await expect(
				createMember({ orgId: a } as never, {
					name: 'Child',
					status: 'active',
					guardianId: foreign.id
				})
			).rejects.toMatchObject({ status: 404 });
			await expect(
				updateMember({ orgId: a } as never, { id: victim.id, guardianId: foreign.id })
			).rejects.toMatchObject({ status: 404 });
			const child = await createMember({ orgId: a } as never, {
				name: 'Child',
				status: 'active',
				guardianId: victim.id
			});
			expect(child?.guardianId).toBe(victim.id);
			expect(
				(await updateMember({ orgId: a } as never, { id: child!.id, guardianId: null })).guardianId
			).toBeNull();
		});
		it('historical cross-tenant guardian rows cannot create or renew billing', async () => {
			const [p] = await db
				.insert(plan)
				.values({ organizationId: a, name: 'Monthly', amount: 1000 })
				.returning();
			await db.update(gymMember).set({ guardianId: foreign.id }).where(eq(gymMember.id, victim.id));
			await expect(
				createMembership({ orgId: a }, { memberId: victim.id, planId: p.id })
			).rejects.toMatchObject({ status: 404 });
			expect(
				await db.select().from(membership).where(eq(membership.memberId, victim.id))
			).toHaveLength(0);
			const [ms] = await db
				.insert(membership)
				.values({ organizationId: a, memberId: victim.id, planId: p.id })
				.returning();
			await expect(postMembershipCharge(a, ms.id, '2026-10-01', p)).rejects.toMatchObject({
				status: 404
			});
			expect(await db.select().from(charge).where(eq(charge.organizationId, a))).toHaveLength(0);
		});
		it('class watch subscriptions reject foreign class or member IDs and allow local toggles', async () => {
			const [foreignClass] = await db
				.insert(classType)
				.values({ organizationId: b, name: 'Private' })
				.returning();
			const [localClass] = await db.select().from(classType).where(eq(classType.organizationId, a));
			await expect(setClassWatch(a, victim.id, foreignClass.id, true)).rejects.toMatchObject({
				status: 404
			});
			await expect(setClassWatch(a, foreign.id, localClass.id, true)).rejects.toMatchObject({
				status: 404
			});
			expect(
				await db.select().from(classWatch).where(eq(classWatch.organizationId, a))
			).toHaveLength(0);
			await setClassWatch(a, victim.id, localClass.id, true);
			expect(
				await db.select().from(classWatch).where(eq(classWatch.memberId, victim.id))
			).toHaveLength(1);
			await setClassWatch(a, victim.id, localClass.id, false);
			expect(
				await db.select().from(classWatch).where(eq(classWatch.memberId, victim.id))
			).toHaveLength(0);
		});
		it('concurrent save offers grant exactly one credit', async () => {
			const [p] = await db
				.insert(plan)
				.values({ organizationId: a, name: 'Monthly', amount: 1000 })
				.returning();
			const [ms] = await db
				.insert(membership)
				.values({ organizationId: a, memberId: victim.id, planId: p.id })
				.returning();
			const results = await Promise.allSettled([
				acceptSaveOffer(a, victim.id),
				acceptSaveOffer(a, victim.id)
			]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const credits = await db
				.select()
				.from(payment)
				.where(and(eq(payment.memberId, victim.id), eq(payment.method, 'credit')));
			expect(credits.map((p) => p.amount)).toEqual([250]);
			expect(
				(await db.select().from(membership).where(eq(membership.id, ms.id)))[0].saveOfferAt
			).not.toBeNull();
		});
		it('financial helpers roll back credits and claims together without emitting on abort', async () => {
			const [p] = await db
				.insert(plan)
				.values({ organizationId: a, name: 'Monthly', amount: 1000 })
				.returning();
			const [ms] = await db
				.insert(membership)
				.values({ organizationId: a, memberId: victim.id, planId: p.id })
				.returning();
			const effects: Array<() => Promise<void>> = [];
			await expect(
				db.transaction(async (tx) => {
					await recordPayment(
						{ orgId: a },
						{ memberId: victim.id, amount: 250, method: 'credit' },
						{ tx, afterCommit: effects, silent: true }
					);
					await tx
						.update(membership)
						.set({ saveOfferAt: new Date() })
						.where(eq(membership.id, ms.id));
					throw new Error('forced failure');
				})
			).rejects.toThrow('forced failure');
			expect(await db.select().from(payment).where(eq(payment.memberId, victim.id))).toHaveLength(
				0
			);
			expect(
				(await db.select().from(membership).where(eq(membership.id, ms.id)))[0].saveOfferAt
			).toBeNull();
			expect(effects).toHaveLength(1);
		});
		it('concurrent plan switches cannot multiply the same proration credit', async () => {
			const [old, next] = await db
				.insert(plan)
				.values([
					{ organizationId: a, name: 'Old', amount: 2000 },
					{ organizationId: a, name: 'Next', amount: 1000 }
				])
				.returning();
			await db.insert(membership).values({
				organizationId: a,
				memberId: victim.id,
				planId: old.id,
				nextChargeAt: new Date(Date.now() + 15 * 86400000)
			});
			const results = await Promise.allSettled([
				memberChangePlan(a, victim.id, next.id),
				memberChangePlan(a, victim.id, next.id)
			]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(
				results
					.filter((r) => r.status === 'rejected')
					.map((r) => (r as PromiseRejectedResult).reason.status)
			).toEqual([409]);
			expect(notifyPlanChanged).toHaveBeenCalledOnce();
			expect(
				await db
					.select()
					.from(payment)
					.where(and(eq(payment.memberId, victim.id), eq(payment.method, 'credit')))
			).toHaveLength(1);
		});
		it('a dependent and guardian cannot each spend a single shared pack credit', async () => {
			const [dependent] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Dependent', guardianId: victim.id })
				.returning();
			const [p] = await db
				.insert(plan)
				.values({
					organizationId: a,
					name: 'One class',
					amount: 100,
					isPack: true,
					classCredits: 1
				})
				.returning();
			const [ms] = await db
				.insert(membership)
				.values({
					organizationId: a,
					memberId: victim.id,
					planId: p.id,
					endsAt: new Date(Date.now() + 30 * 86400000)
				})
				.returning();
			const ctx = { orgId: a, userId: null } as never;
			await bookSession(ctx, { memberId: dependent.id, sessionId }, null, { notify: false });
			const [first] = await db.select().from(booking).where(eq(booking.memberId, dependent.id));
			expect(first.membershipId).toBe(ms.id);
			const [session] = await db.select().from(classSession).where(eq(classSession.id, sessionId));
			const [second] = await db
				.insert(classSession)
				.values({
					organizationId: a,
					classTypeId: session.classTypeId,
					startsAt: new Date(Date.now() + 2 * 86400000),
					endsAt: new Date(Date.now() + 2 * 86400000 + 3600000),
					capacity: 10
				})
				.returning();
			await expect(
				bookSession(ctx, { memberId: victim.id, sessionId: second.id }, null, { notify: false })
			).rejects.toMatchObject({ status: 402 });
			expect(
				await creditsUsedIn(a, victim.id, ms.id, {
					start: ms.startsAt.toISOString().slice(0, 10),
					end: ms.endsAt!.toISOString().slice(0, 10)
				})
			).toBe(1);
		});
		it('legacy bookings count only the owner household and do not drain unrelated packs', async () => {
			const [unrelated, recipient, dependent] = await db
				.insert(gymMember)
				.values([
					{ organizationId: a, name: 'Unrelated' },
					{ organizationId: a, name: 'Recipient' },
					{ organizationId: a, name: 'Dependent', guardianId: victim.id }
				])
				.returning();
			const [p] = await db
				.insert(plan)
				.values({
					organizationId: a,
					name: 'Legacy pack',
					amount: 1000,
					isPack: true,
					classCredits: 3
				})
				.returning();
			const [ms] = await db
				.insert(membership)
				.values({
					organizationId: a,
					memberId: victim.id,
					planId: p.id,
					endsAt: new Date(Date.now() + 30 * 86400000)
				})
				.returning();
			await db.insert(booking).values([
				{
					organizationId: a,
					memberId: unrelated.id,
					sessionId,
					status: 'booked',
					membershipId: null
				},
				{
					organizationId: a,
					memberId: dependent.id,
					sessionId,
					status: 'booked',
					membershipId: null
				}
			]);
			const window = {
				start: ms.startsAt.toISOString().slice(0, 10),
				end: ms.endsAt!.toISOString().slice(0, 10)
			};
			expect(await creditsUsedIn(a, null, ms.id, window)).toBe(1);
			expect(
				await transferPackCredits({ orgId: a }, ms.id, { memberId: recipient.id }, 2)
			).toMatchObject({ remaining: 0 });
		});
		it('member listing hides foreign guardian plans while retaining local guardian plans', async () => {
			const [foreignPlan, localPlan] = await db
				.insert(plan)
				.values([
					{ organizationId: b, name: 'Secret foreign plan', amount: 1000 },
					{ organizationId: a, name: 'Local family plan', amount: 1000 }
				])
				.returning();
			await db.insert(membership).values([
				{ organizationId: b, memberId: foreign.id, planId: foreignPlan.id },
				{ organizationId: a, memberId: victim.id, planId: localPlan.id }
			]);
			const [dependent] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Local dependent', guardianId: victim.id })
				.returning();
			const [corrupt] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Historical corrupt dependent', guardianId: foreign.id })
				.returning();
			const rows = await listMembers(a);
			expect(rows.find((row) => row.id === corrupt.id)?.guardianPlanName).toBeNull();
			expect(rows.find((row) => row.id === dependent.id)?.guardianPlanName).toBe(
				'Local family plan'
			);
		});
		it('concurrent gifts cannot spend the same balance twice', async () => {
			const [recipient] = await db
				.insert(gymMember)
				.values({ organizationId: a, name: 'Recipient' })
				.returning();
			const [p] = await db
				.insert(plan)
				.values({ organizationId: a, name: 'Pack', amount: 1000, isPack: true, classCredits: 5 })
				.returning();
			const [ms] = await db
				.insert(membership)
				.values({
					organizationId: a,
					memberId: victim.id,
					planId: p.id,
					endsAt: new Date(Date.now() + 30 * 86400000)
				})
				.returning();
			const results = await Promise.allSettled([
				transferPackCredits({ orgId: a }, ms.id, { memberId: recipient.id }, 4),
				transferPackCredits({ orgId: a }, ms.id, { memberId: recipient.id }, 4)
			]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(
				results
					.filter((r) => r.status === 'rejected')
					.map((r) => (r as PromiseRejectedResult).reason.status)
			).toEqual([400]);
			expect(notifyCreditsGifted).toHaveBeenCalledOnce();
			expect(
				(await db.select().from(membership).where(eq(membership.id, ms.id)))[0].bonusCredits
			).toBe(-4);
			expect(
				await db.select().from(membership).where(eq(membership.memberId, recipient.id))
			).toHaveLength(1);
		});
	}
);
