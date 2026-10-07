import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import type { OrgContext } from '#lib/server/context.ts';
import * as members from '#lib/server/services/members.ts';
import * as billing from '#lib/server/services/billing.ts';
import * as schedule from '#lib/server/services/schedule.ts';
import * as events from '#lib/server/services/gym-events.ts';
import * as challenges from '#lib/server/services/challenges.ts';
import * as checkins from '#lib/server/services/checkins.ts';
import * as amenities from '#lib/server/services/resources.ts';
import * as shifts from '#lib/server/services/shifts.ts';
import * as giftcards from '#lib/server/services/giftcards.ts';
import * as recurring from '#lib/server/services/recurring.ts';
import * as reports from '#lib/server/services/reports.ts';
import * as settings from '#lib/server/services/settings.ts';
import { zonedToUtc } from '#lib/tz.ts';
import * as s from '#lib/schemas.ts';

type Resource = {
	description: string;
	list: (ctx: OrgContext, url: URL) => Promise<unknown>;
	get?: (ctx: OrgContext, id: string) => Promise<unknown>;
	create?: { schema: v.GenericSchema; run: (ctx: OrgContext, input: never) => Promise<unknown> };
	update?: { schema: v.GenericSchema; run: (ctx: OrgContext, input: never) => Promise<unknown> };
	delete?: (ctx: OrgContext, id: string) => Promise<unknown>;
};

/** Public REST surface, mirrored by the OpenAPI document. Mutations go through the same services as the UI. */
export const resources: Record<string, Resource> = {
	locations: {
		description: 'Gym branches',
		list: (ctx) => settings.listLocations(ctx.orgId, true),
		create: { schema: s.locationInput, run: settings.createLocation as never },
		update: { schema: s.locationUpdate, run: settings.updateLocation as never }
	},
	class_types: {
		description: 'Class templates (name, color, capacity, drop-in price)',
		list: (ctx) => schedule.listClassTypes(ctx.orgId),
		create: { schema: s.classTypeInput, run: schedule.createClassType as never },
		update: { schema: s.classTypeUpdate, run: schedule.updateClassType as never }
	},
	members: {
		description: 'Gym members (`?q=` to search)',
		list: (ctx, url) => members.listMembers(ctx.orgId, url.searchParams.get('q') ?? undefined),
		get: (ctx, id) => members.getMember(ctx.orgId, id),
		create: { schema: s.memberInput, run: members.createMember as never },
		update: { schema: s.memberUpdate, run: members.updateMember as never }
	},
	plans: {
		description: 'Membership plans',
		list: (ctx) => billing.listPlans(ctx.orgId),
		create: { schema: s.planInput, run: billing.createPlan as never },
		update: { schema: s.planUpdate, run: billing.updatePlan as never }
	},
	memberships: {
		description: 'Member subscriptions to plans (`?status=active`)',
		list: (ctx, url) => billing.listMemberships(ctx.orgId, url.searchParams.getAll('status')),
		create: { schema: s.membershipInput, run: billing.createMembership as never },
		update: { schema: s.membershipUpdate, run: billing.updateMembership as never }
	},
	sessions: {
		description: 'Class sessions between `?from=` and `?to=` (ISO dates, default next 14 days)',
		list: async (ctx, url) => {
			const from = url.searchParams.get('from')
				? new Date(`${url.searchParams.get('from')}T00:00:00Z`)
				: new Date();
			const to = url.searchParams.get('to')
				? new Date(`${url.searchParams.get('to')}T00:00:00Z`)
				: new Date(from.getTime() + 14 * 86400_000);
			return schedule.listSessions(ctx.orgId, from, to);
		},
		get: (ctx, id) => schedule.getSession(ctx.orgId, id),
		create: {
			schema: s.sessionInput,
			run: async (ctx: OrgContext, input: never) => {
				const st = await settings.getSettings(ctx.orgId);
				return schedule.createSession(ctx, st.timezone, input as never);
			}
		}
	},
	class_templates: {
		description:
			'Recurring weekly class rules (weekday + startTime; sessions materialize ~2 weeks ahead)',
		list: (ctx) => schedule.listTemplates(ctx.orgId),
		create: { schema: s.templateInput, run: schedule.createTemplate as never },
		delete: (ctx, id) => schedule.deleteTemplate(ctx, id)
	},
	bookings: {
		description:
			'Bookings filtered by `?session=`, `?member=`, `?status=` (repeatable), and session time `?from=`/`?to=` (ISO dates, default next 14 days; max 200). POST books a member; PATCH cancels or sets attended/no_show',
		list: (ctx, url) => {
			const from = url.searchParams.get('from')
				? new Date(`${url.searchParams.get('from')}T00:00:00Z`)
				: new Date();
			const to = url.searchParams.get('to')
				? new Date(`${url.searchParams.get('to')}T00:00:00Z`)
				: new Date(from.getTime() + 14 * 86400_000);
			return schedule.listBookings(ctx.orgId, {
				sessionId: url.searchParams.get('session') ?? undefined,
				memberId: url.searchParams.get('member') ?? undefined,
				status: url.searchParams.getAll('status'),
				from,
				to
			});
		},
		create: { schema: s.bookingInput, run: (ctx, input) => schedule.bookSession(ctx, input) },
		update: { schema: s.bookingUpdate, run: schedule.updateBooking as never }
	},
	check_ins: {
		description:
			'Front-desk check-ins (QR token or member id as `code`). List: `?from=`/`?to=` ISO dates (default today), `?member=`, `?inside=1` (still inside), `?q=` name search',
		list: (ctx, url) => {
			const since = url.searchParams.get('from')
				? new Date(`${url.searchParams.get('from')}T00:00:00Z`)
				: (() => {
						const d = new Date();
						d.setHours(0, 0, 0, 0);
						return d;
					})();
			const until = url.searchParams.get('to')
				? new Date(`${url.searchParams.get('to')}T00:00:00Z`)
				: undefined;
			return checkins.listCheckIns(ctx.orgId, {
				since,
				until,
				q: url.searchParams.get('q') ?? undefined,
				memberId: url.searchParams.get('member') ?? undefined,
				inside: url.searchParams.get('inside') === '1'
			});
		},
		create: { schema: s.checkInInput, run: checkins.recordCheckIn as never }
	},
	charges: {
		description: 'Receivables against members (`?status=open`)',
		list: (ctx, url) => billing.listCharges(ctx.orgId, url.searchParams.get('status') ?? undefined),
		create: { schema: s.chargeInput, run: billing.addCharge as never },
		update: { schema: s.chargeUpdate, run: billing.updateCharge as never }
	},
	payments: {
		description: 'Record received payments',
		list: (ctx) => billing.listPayments(ctx.orgId),
		create: { schema: s.paymentInput, run: billing.recordPayment as never }
	},
	events: {
		description:
			'One-off events/workshops (`?from=`/`?to=` ISO dates; DELETE cancels the event: registrants emailed, open signup charges voided)',
		list: async (ctx, url) => {
			const rows = await events.listEvents(ctx.orgId);
			const from = url.searchParams.get('from');
			const to = url.searchParams.get('to');
			return rows.filter(
				(r) =>
					(!from || r.event.startsAt >= new Date(`${from}T00:00:00Z`)) &&
					(!to || r.event.startsAt < new Date(`${to}T00:00:00Z`))
			);
		},
		create: {
			schema: s.eventInput,
			run: async (ctx: OrgContext, input: never) => {
				const st = await settings.getSettings(ctx.orgId);
				const { startsAt: start, ...rest } = input as v.InferOutput<typeof s.eventInput>;
				const startsAt = zonedToUtc(start, st.timezone);
				return events.createEvent(ctx, {
					...rest,
					startsAt,
					endsAt: new Date(startsAt.getTime() + rest.durationMin * 60_000)
				});
			}
		},
		update: { schema: s.eventUpdate, run: events.updateEvent as never },
		delete: (ctx, id) => events.cancelEvent(ctx.orgId, id)
	},
	event_registrations: {
		description:
			'Event rosters (`?event=` required). POST registers a member (posts the signup charge); PATCH marks attendance; DELETE cancels (voids an unpaid charge)',
		list: (ctx, url) => {
			const eventId = url.searchParams.get('event');
			if (!eventId) error(400, 'event_registrations requires ?event=<id>');
			return events.eventRoster(ctx.orgId, eventId);
		},
		create: {
			schema: v.object({ eventId: s.idSchema, memberId: s.idSchema }),
			run: (ctx, input: never) => {
				const { eventId, memberId } = input as { eventId: string; memberId: string };
				return events.registerForEvent(ctx.orgId, memberId, eventId);
			}
		},
		update: {
			schema: v.object({ id: s.idSchema, attended: v.boolean() }),
			run: (ctx, input: never) => {
				const { id, attended } = input as { id: string; attended: boolean };
				return events.setEventAttended(ctx.orgId, id, attended);
			}
		},
		delete: (ctx, id) => events.cancelRegistration(ctx.orgId, id)
	},
	challenges: {
		description:
			'Check-in challenges (members race to N check-ins inside a date window). List includes live progress per entrant',
		list: (ctx) => challenges.listChallenges(ctx.orgId),
		create: { schema: s.challengeInput, run: challenges.createChallenge as never },
		update: { schema: s.challengeUpdate, run: challenges.updateChallenge as never }
	},
	amenities: {
		description:
			'Bookable amenities (sauna, court, child care). slotMin = slot length, capacity = concurrent bookings per slot, openFrom/openTo = daily bookable window',
		list: (ctx) => amenities.listResources(ctx.orgId),
		create: { schema: s.resourceInput, run: amenities.createResource as never },
		update: { schema: s.resourceUpdate, run: amenities.updateResource as never }
	},
	amenity_bookings: {
		description:
			'Upcoming amenity reservations with resource + member names. POST books a member into a slot ({memberId, resourceId, day, time, note}); DELETE cancels',
		list: (ctx) => amenities.listResourceBookings(ctx.orgId),
		create: {
			schema: s.resourceBookInput,
			run: async (ctx, input) => {
				const { timezone } = await settings.getSettings(ctx.orgId);
				const { memberId, resourceId, day, time, note } = input as {
					memberId: string;
					resourceId: string;
					day: string;
					time: string;
					note?: string;
				};
				return amenities.bookResource(ctx.orgId, memberId, resourceId, day, time, note, timezone);
			}
		},
		delete: (ctx, id) => amenities.cancelResourceBooking(ctx.orgId, id)
	},
	equipment: {
		description:
			'Tracked facility equipment (treadmill, rower): status (operational/maintenance/out_of_order) + service dates',
		list: (ctx) => amenities.listEquipment(ctx.orgId),
		create: { schema: s.equipmentInput, run: amenities.createEquipment as never },
		update: { schema: s.equipmentUpdate, run: amenities.updateEquipment as never },
		delete: (ctx, id) => amenities.deleteEquipment(ctx, id)
	},
	shifts: {
		description:
			'Staff clock-in/out records — ?from=&to= (YYYY-MM-DD) bound the range, defaults to the last 30 days',
		list: (ctx, url) =>
			shifts.listShifts(ctx.orgId, {
				from:
					url.searchParams.get('from') ??
					new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
				to: url.searchParams.get('to') ?? new Date().toISOString().slice(0, 10)
			})
	},
	session_feedback: {
		description: 'Member 1–5 class ratings submitted in the portal — newest first, last 90 days',
		list: (ctx) => reports.listSessionFeedback(ctx.orgId)
	},
	shop_items: {
		description: 'Front-desk retail items (name, price, optional stock count)',
		list: (ctx) => billing.listShopItems(ctx.orgId),
		create: { schema: s.shopItemInput, run: billing.createShopItem as never },
		update: { schema: s.shopItemUpdate, run: billing.updateShopItem as never }
	},
	promo_codes: {
		description:
			'Join-page discount codes (percentOff or amountOff in cents, optional maxUses/expiresAt; PATCH toggles active)',
		list: (ctx) => billing.listPromoCodes(ctx.orgId),
		create: { schema: s.promoCodeInput, run: billing.createPromoCode as never },
		update: { schema: s.promoCodeUpdate, run: billing.updatePromoCode as never }
	},
	gift_cards: {
		description:
			'Gift cards — code-keyed store credit; POST sells a card (memberId + amount in cents, posts an `other` charge to the buyer)',
		list: (ctx) => giftcards.listGiftCards(ctx.orgId),
		create: { schema: s.giftCardSale, run: giftcards.sellGiftCard as never }
	},
	recurring_charges: {
		description:
			'Recurring member add-ons (PT package, towel service) — cron posts an `other` charge each week/month/year until inactive',
		list: (ctx) => recurring.listRecurring(ctx.orgId),
		create: { schema: s.recurringChargeInput, run: recurring.addRecurring as never },
		update: { schema: s.recurringChargeUpdate, run: recurring.updateRecurring as never },
		delete: (ctx, id) => recurring.removeRecurring(ctx, id)
	},
	expenses: {
		description:
			'Gym operating expenses (rent, payroll, equipment…) — feed the P&L on Reports. `expenseOn` is YYYY-MM-DD, `amountCents` minor units',
		list: (ctx) => billing.listExpenses(ctx.orgId),
		create: { schema: s.expenseInput, run: billing.addExpense as never },
		delete: (ctx, id) => billing.removeExpense(ctx, id)
	},
	member_tags: {
		description:
			"Tag labels on members — `?member=` lists one member's tags, bare list = all distinct tags. POST {memberId, tag}; DELETE `/{memberId}:{tag}`",
		list: (ctx, url) => {
			const memberId = url.searchParams.get('member');
			return memberId ? members.memberTags(ctx.orgId, memberId) : members.listTags(ctx.orgId);
		},
		create: {
			schema: s.memberTagInput,
			run: (ctx, input) => {
				const { memberId, tag } = input as { memberId: string; tag: string };
				return members.addMemberTag(ctx, memberId, tag);
			}
		},
		delete: (ctx, id) => {
			const [memberId, ...rest] = id.split(':');
			if (!memberId || !rest.length) error(400, 'member_tags id must be {memberId}:{tag}');
			return members.removeMemberTag(ctx, memberId, rest.join(':'));
		}
	},
	desk_tasks: {
		description:
			"Daily front-desk checklist tasks (with today's tick state). POST {label}; DELETE removes the task",
		list: (ctx) => shifts.deskChecklist(ctx.orgId),
		create: {
			schema: v.object({
				label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120))
			}),
			run: (ctx, input) => shifts.createDeskTask(ctx, (input as { label: string }).label)
		},
		delete: (ctx, id) => shifts.removeDeskTask(ctx, id)
	}
};

export function resource(name: string) {
	const r = resources[name];
	if (!r) error(404, `Unknown resource "${name}"`);
	return r;
}

export async function parseBody<T extends v.GenericSchema>(
	schema: T,
	request: Request,
	extra: Record<string, unknown> = {}
) {
	const body = await request.json().catch(() => error(400, 'Body must be JSON'));
	const result = v.safeParse(schema, { ...body, ...extra });
	if (!result.success) {
		error(422, result.issues.map((i) => `${v.getDotPath(i) ?? 'body'}: ${i.message}`).join('; '));
	}
	return result.output as v.InferOutput<T>;
}
