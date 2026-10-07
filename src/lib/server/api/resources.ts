import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import type { OrgContext } from '#lib/server/context.ts';
import * as members from '#lib/server/services/members.ts';
import * as billing from '#lib/server/services/billing.ts';
import * as schedule from '#lib/server/services/schedule.ts';
import * as checkins from '#lib/server/services/checkins.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import * as s from '#lib/schemas.ts';

type Resource = {
	description: string;
	list: (ctx: OrgContext, url: URL) => Promise<unknown>;
	get?: (ctx: OrgContext, id: string) => Promise<unknown>;
	create?: { schema: v.GenericSchema; run: (ctx: OrgContext, input: never) => Promise<unknown> };
	update?: { schema: v.GenericSchema; run: (ctx: OrgContext, input: never) => Promise<unknown> };
};

/** Public REST surface, mirrored by the OpenAPI document. Mutations go through the same services as the UI. */
export const resources: Record<string, Resource> = {
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
				const settings = await getSettings(ctx.orgId);
				return schedule.createSession(ctx, settings.timezone, input as never);
			}
		}
	},
	bookings: {
		description: 'Book a member into a session; PATCH cancels or sets attended/no_show',
		list: async () => error(405, 'List bookings via GET /sessions/{id} roster'),
		create: { schema: s.bookingInput, run: (ctx, input) => schedule.bookSession(ctx, input) },
		update: { schema: s.bookingUpdate, run: schedule.updateBooking as never }
	},
	check_ins: {
		description: 'Front-desk check-ins (QR token or member id as `code`)',
		list: async (ctx) => {
			const since = new Date();
			since.setHours(0, 0, 0, 0);
			return checkins.listTodayCheckIns(ctx.orgId, since);
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
