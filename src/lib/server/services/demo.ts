import { db } from '#lib/server/db/index.ts';
import { eq } from 'drizzle-orm';
import {
	booking,
	challenge,
	challengeEntry,
	charge,
	checkIn,
	classSession,
	classType,
	course,
	courseEnrollment,
	deskTask,
	equipment,
	eventRegistration,
	expense,
	facilityResource,
	giftCard,
	gymEvent,
	gymMember,
	gymSettings,
	location,
	memberTag,
	membership,
	payment,
	plan,
	promoCode,
	recurringCharge,
	resourceBooking,
	shopItem,
	waiver
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { zonedToUtc } from '#lib/tz.ts';

/** Fills a fresh workspace with a believable gym: classes this week, members, bookings, payments. */
export async function loadDemoData(ctx: OrgContext) {
	const tz = 'America/Los_Angeles';
	const now = new Date();
	const today = now.toISOString().slice(0, 10);

	await db
		.insert(gymSettings)
		.values({
			organizationId: ctx.orgId,
			timezone: tz,
			currency: 'usd',
			publicPage: true,
			tagline: 'Strength, conditioning and yoga in the Mission.',
			address: '2140 Mission St, San Francisco, CA',
			phone: '(415) 555-0134'
		})
		.onConflictDoNothing();

	const [loc] = await db
		.insert(location)
		.values({ organizationId: ctx.orgId, name: 'Mission HQ', address: '2140 Mission St' })
		.returning();

	const [unlimited, offPeak, dropIn] = await db
		.insert(plan)
		.values([
			{
				organizationId: ctx.orgId,
				name: 'Unlimited',
				description: 'All classes, all locations, anytime.',
				amount: 12900,
				interval: 'month',
				signupFee: 4900
			},
			{
				organizationId: ctx.orgId,
				name: 'Off-Peak',
				description: 'Classes before 4pm on weekdays.',
				amount: 7900,
				interval: 'month',
				signupFee: 2900
			},
			{
				organizationId: ctx.orgId,
				name: '10-Class Pack',
				description: 'Ten classes, use them within six months.',
				amount: 22000,
				interval: 'year',
				classCredits: 10,
				isPack: true,
				listed: true
			}
		])
		.returning();

	const [hiit, strength, yoga] = await db
		.insert(classType)
		.values([
			{
				organizationId: ctx.orgId,
				locationId: loc!.id,
				name: 'HIIT Express',
				color: '#ef4444',
				durationMin: 45,
				capacity: 18
			},
			{
				organizationId: ctx.orgId,
				locationId: loc!.id,
				name: 'Strength Foundations',
				color: '#3b82f6',
				durationMin: 60,
				capacity: 12
			},
			{
				organizationId: ctx.orgId,
				locationId: loc!.id,
				name: 'Vinyasa Yoga',
				color: '#22c55e',
				durationMin: 60,
				capacity: 24
			}
		])
		.returning();

	const memberNames = [
		'Alex Rivera',
		'Jordan Lee',
		'Sam Patel',
		'Casey Kim',
		'Riley Chen',
		'Morgan Diaz',
		'Taylor Brooks',
		'Jamie Nguyen'
	];
	const members = await db
		.insert(gymMember)
		.values(
			memberNames.map((name, i) => ({
				organizationId: ctx.orgId,
				locationId: loc!.id,
				name,
				email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
				joinedAt: today.slice(0, 8) + String((i % 20) + 1).padStart(2, '0')
			}))
		)
		.returning();

	const plans = [unlimited!, offPeak!, dropIn!];
	for (const [i, m] of members.entries()) {
		const p = plans[i % plans.length]!;
		const [ms] = await db
			.insert(membership)
			.values({
				organizationId: ctx.orgId,
				memberId: m.id,
				planId: p.id,
				startsAt: new Date(`${today.slice(0, 8)}01T00:00:00Z`),
				nextChargeAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
			})
			.returning();
		const [c] = await db
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				memberId: m.id,
				membershipId: ms!.id,
				kind: 'membership',
				description: `${p.name} — period starting ${today.slice(0, 8)}01`,
				periodStart: `${today.slice(0, 8)}01`,
				dueDate: `${today.slice(0, 8)}01`,
				amount: p.amount
			})
			.returning();
		if (i % 3 !== 0) {
			await db.insert(payment).values({
				organizationId: ctx.orgId,
				memberId: m.id,
				chargeId: c!.id,
				amount: p.amount,
				method: 'card',
				paidAt: new Date(now.getTime() - (i + 1) * 86400_000)
			});
		}
	}

	// This week's sessions at 7:00, 12:15, 17:30.
	const times = ['07:00', '12:15', '17:30'];
	const types = [hiit!, strength!, yoga!];
	const sessions = [];
	for (let day = 0; day < 7; day++) {
		for (const [ti, t] of times.entries()) {
			const ct = types[(day + ti) % types.length]!;
			const d = new Date(now.getTime() + day * 86400_000);
			const dateStr = d.toISOString().slice(0, 10);
			const start = zonedToUtc(`${dateStr}T${t}`, tz);
			sessions.push({
				organizationId: ctx.orgId,
				classTypeId: ct.id,
				locationId: loc!.id,
				startsAt: start,
				endsAt: new Date(start.getTime() + ct.durationMin * 60_000),
				capacity: ct.capacity
			});
		}
	}
	const created = await db.insert(classSession).values(sessions).returning();

	// Sprinkle bookings and today's check-ins.
	let bi = 0;
	for (const s of created) {
		for (const m of members.slice(0, 4 + (bi % 3))) {
			await db.insert(booking).values({
				organizationId: ctx.orgId,
				sessionId: s.id,
				memberId: m.id,
				status: 'booked'
			});
		}
		bi++;
	}
	for (const m of members.slice(0, 5)) {
		await db.insert(checkIn).values({
			organizationId: ctx.orgId,
			memberId: m.id,
			locationId: loc!.id,
			method: 'qr',
			checkedAt: new Date(now.getTime() - Math.floor(Math.random() * 8) * 3600_000)
		});
	}

	// ------- newer surfaces: waiver, tags, shop, expenses, promo, gift card -------
	const waiverText =
		'I understand that training at Iron Works Gym involves physical exertion and I ' +
		'assume all risks. I release Iron Works Gym and its staff from liability for ' +
		'injuries sustained on the premises or during classes.';
	await db
		.update(gymSettings)
		.set({ waiver: waiverText })
		.where(eq(gymSettings.organizationId, ctx.orgId));
	for (const m of members.slice(0, 6)) {
		await db.insert(waiver).values({
			organizationId: ctx.orgId,
			memberId: m.id,
			text: waiverText
		});
	}

	await db.insert(memberTag).values([
		{ organizationId: ctx.orgId, memberId: members[0]!.id, tag: 'vip' },
		{ organizationId: ctx.orgId, memberId: members[6]!.id, tag: 'lead' }
	]);

	await db.insert(shopItem).values([
		{ organizationId: ctx.orgId, name: 'Water bottle', price: 250, stock: 40, lowStockAt: 10 },
		{ organizationId: ctx.orgId, name: 'Wrist wraps', price: 1800, stock: 4, lowStockAt: 5 },
		{ organizationId: ctx.orgId, name: 'Chalk block', price: 400, stock: 25 }
	]);

	await db.insert(expense).values([
		{
			organizationId: ctx.orgId,
			label: 'Rent — Mission HQ',
			category: 'rent',
			amountCents: 420000,
			expenseOn: `${today.slice(0, 8)}01`
		},
		{
			organizationId: ctx.orgId,
			label: 'Coach payroll',
			category: 'payroll',
			amountCents: 310000,
			expenseOn: `${today.slice(0, 8)}15`
		}
	]);

	await db.insert(promoCode).values({
		organizationId: ctx.orgId,
		code: 'FALL20',
		percentOff: 20,
		maxUses: 50,
		timesUsed: 7
	});

	await db.insert(giftCard).values({
		organizationId: ctx.orgId,
		code: 'GC-DEMO-2026',
		amount: 10000,
		balance: 7500,
		purchaserMemberId: members[1]!.id,
		note: 'Birthday gift for Alex'
	});

	await db.insert(recurringCharge).values({
		organizationId: ctx.orgId,
		memberId: members[0]!.id,
		description: 'Towel service',
		amount: 1000,
		interval: 'month',
		nextDue: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
			.toISOString()
			.slice(0, 10)
	});

	// ------- amenities, equipment, events, challenges, courses -------
	const [sauna] = await db
		.insert(facilityResource)
		.values({
			organizationId: ctx.orgId,
			name: 'Sauna',
			kind: 'Recovery',
			description: 'Book a 30-minute sauna slot.',
			slotMin: 30,
			capacity: 2,
			openFrom: '07:00',
			openTo: '21:00',
			locationId: loc!.id
		})
		.returning();
	await db.insert(resourceBooking).values({
		organizationId: ctx.orgId,
		resourceId: sauna!.id,
		memberId: members[2]!.id,
		startsAt: zonedToUtc(`${today}T18:00`, tz),
		endsAt: zonedToUtc(`${today}T18:30`, tz)
	});

	await db.insert(equipment).values([
		{
			organizationId: ctx.orgId,
			name: 'Treadmill 1',
			kind: 'Cardio',
			locationId: loc!.id,
			status: 'maintenance',
			notes: 'Belt slipping — service scheduled',
			nextServiceOn: today
		},
		{ organizationId: ctx.orgId, name: 'Treadmill 2', kind: 'Cardio', locationId: loc!.id },
		{ organizationId: ctx.orgId, name: 'Rowing machine', kind: 'Cardio', locationId: loc!.id }
	]);

	const compDay = new Date(now.getTime() + 9 * 86400_000).toISOString().slice(0, 10);
	const [comp] = await db
		.insert(gymEvent)
		.values({
			organizationId: ctx.orgId,
			name: 'Fall Throwdown',
			description: 'In-house lifting comp — all levels welcome.',
			locationId: loc!.id,
			startsAt: zonedToUtc(`${compDay}T10:00`, tz),
			endsAt: zonedToUtc(`${compDay}T13:00`, tz),
			capacity: 30,
			price: 2500
		})
		.returning();
	for (const m of members.slice(0, 3)) {
		await db.insert(eventRegistration).values({
			organizationId: ctx.orgId,
			eventId: comp!.id,
			memberId: m.id
		});
	}

	const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
		.toISOString()
		.slice(0, 10);
	const [chal] = await db
		.insert(challenge)
		.values({
			organizationId: ctx.orgId,
			name: 'Consistency Challenge',
			description: 'Check in 12 times this month — finishers get a gym tee.',
			prize: 'Iron Works tee',
			goal: 12,
			startDate: `${today.slice(0, 8)}01`,
			endDate: monthEnd
		})
		.returning();
	for (const m of members.slice(0, 4)) {
		await db.insert(challengeEntry).values({
			organizationId: ctx.orgId,
			challengeId: chal!.id,
			memberId: m.id
		});
	}

	const courseEnd = new Date(now.getTime() + 42 * 86400_000).toISOString().slice(0, 10);
	const [sixWeek] = await db
		.insert(course)
		.values({
			organizationId: ctx.orgId,
			name: '6-Week Foundations',
			description: 'Learn the core lifts with a coach — beginners welcome.',
			classTypeId: strength!.id,
			startsOn: today,
			endsOn: courseEnd,
			priceCents: 18000,
			capacity: 16
		})
		.returning();
	for (const m of members.slice(4, 6)) {
		await db.insert(courseEnrollment).values({
			organizationId: ctx.orgId,
			courseId: sixWeek!.id,
			memberId: m.id
		});
	}

	await db.insert(deskTask).values([
		{ organizationId: ctx.orgId, label: 'Wipe down cardio deck', sortOrder: 1 },
		{ organizationId: ctx.orgId, label: 'Restock towels', sortOrder: 2 },
		{ organizationId: ctx.orgId, label: 'Count the till', sortOrder: 3 }
	]);

	return { members: members.length, sessions: created.length };
}
