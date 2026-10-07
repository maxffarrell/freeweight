import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	booking,
	charge,
	checkIn,
	classSession,
	classType,
	document,
	gymMember,
	location,
	memberNote,
	memberTag,
	membership,
	organization,
	payment,
	user,
	waiver,
	plan,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { creditUsage } from './schedule.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export type MemberSort = 'name' | 'joined' | 'lastVisit' | 'balance';

const MEMBER_ORDER = {
	name: asc(gymMember.name),
	joined: desc(gymMember.joinedAt),
	lastVisit: sql`"lastVisit" desc nulls last`,
	balance: sql`"openBalance" desc`
} as const;

export async function listMembers(
	orgId: string,
	q?: string,
	tag?: string,
	status?: 'active' | 'inactive',
	planId?: string,
	sort: MemberSort = 'name'
) {
	const term = q?.trim();
	return db
		.select({
			id: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			phone: gymMember.phone,
			status: gymMember.status,
			joinedAt: gymMember.joinedAt,
			locationName: location.name,
			tags: sql<
				string[]
			>`coalesce((select array_agg(t.tag order by t.tag) from ${memberTag} t where t.member_id = ${outer(gymMember.id)}), '{}')`,
			openBalance:
				sql<number>`coalesce((select sum(c.amount - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id and p.refunded_at is null), 0)) from ${charge} c where c.member_id = ${outer(gymMember.id)} and c.status = 'open'), 0)`.mapWith(
					Number
				),
			planName: sql<
				string | null
			>`(select p2.name from ${membership} m2 join ${plan} p2 on p2.id = m2.plan_id where m2.member_id = ${outer(gymMember.id)} and m2.status = 'active' order by m2.created_at desc limit 1)`,
			lastVisit: sql<Date | null>`(select max(c.checked_at) from ${checkIn} c where c.member_id = ${outer(gymMember.id)})`
		})
		.from(gymMember)
		.leftJoin(location, eq(gymMember.locationId, location.id))
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				term
					? or(
							ilike(gymMember.name, `%${term}%`),
							ilike(gymMember.email, `%${term}%`),
							ilike(gymMember.phone, `%${term}%`)
						)
					: undefined,
				tag
					? sql`exists (select 1 from ${memberTag} t where t.member_id = ${gymMember.id} and t.tag = ${tag})`
					: undefined,
				status ? eq(gymMember.status, status) : undefined,
				planId
					? sql`exists (select 1 from ${membership} m3 where m3.member_id = ${gymMember.id} and m3.status = 'active' and m3.plan_id = ${planId})`
					: undefined
			)
		)
		.orderBy(MEMBER_ORDER[sort]);
}

/** Every tag in use in the workspace — feeds the list filter and member-page autocomplete. */
export async function listTags(orgId: string) {
	const rows = await db
		.selectDistinct({ tag: memberTag.tag })
		.from(memberTag)
		.where(eq(memberTag.organizationId, orgId))
		.orderBy(asc(memberTag.tag));
	return rows.map((r) => r.tag);
}

/** Tag names on one member. */
export async function memberTags(orgId: string, memberId: string) {
	const rows = await db
		.select({ tag: memberTag.tag })
		.from(memberTag)
		.where(and(eq(memberTag.organizationId, orgId), eq(memberTag.memberId, memberId)))
		.orderBy(asc(memberTag.tag));
	return rows.map((r) => r.tag);
}

export async function addMemberTag(ctx: OrgContext, memberId: string, tag: string) {
	const name = tag.trim().replace(/\s+/g, ' ');
	if (!name) error(400, 'Tag is required');
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	await db
		.insert(memberTag)
		.values({ organizationId: ctx.orgId, memberId, tag: name })
		.onConflictDoNothing();
}

/** Applies one tag to many members at once; ids outside the org are dropped. Returns tagged count. */
export async function addTagToMembers(ctx: OrgContext, memberIds: string[], tag: string) {
	const name = tag.trim().replace(/\s+/g, ' ');
	if (!name) error(400, 'Tag is required');
	const rows = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), inArray(gymMember.id, memberIds)));
	if (!rows.length) return 0;
	await db
		.insert(memberTag)
		.values(rows.map(({ id }) => ({ organizationId: ctx.orgId, memberId: id, tag: name })))
		.onConflictDoNothing();
	return rows.length;
}

export async function removeMemberTag(ctx: OrgContext, memberId: string, tag: string) {
	await db
		.delete(memberTag)
		.where(
			and(
				eq(memberTag.organizationId, ctx.orgId),
				eq(memberTag.memberId, memberId),
				eq(memberTag.tag, tag)
			)
		);
}

export async function getMember(orgId: string, id: string) {
	const [row] = await db
		.select({ member: gymMember, locationName: location.name, orgName: organization.name })
		.from(gymMember)
		.leftJoin(location, eq(gymMember.locationId, location.id))
		.innerJoin(organization, eq(gymMember.organizationId, organization.id))
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, id)));
	if (!row) error(404, 'Member not found');

	const memberships = await db
		.select({
			membership,
			planName: plan.name,
			amount: plan.amount,
			interval: plan.interval,
			isPack: plan.isPack,
			guestPasses: plan.guestPasses
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(and(eq(membership.organizationId, orgId), eq(membership.memberId, id)))
		.orderBy(desc(membership.createdAt));

	const charges = await db
		.select({
			charge,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.refunded_at is null), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.memberId, id)))
		.orderBy(desc(charge.dueDate))
		.limit(50);

	const payments = await db
		.select()
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), eq(payment.memberId, id)))
		.orderBy(desc(payment.paidAt))
		.limit(50);

	const bookings = await db
		.select({
			booking,
			startsAt: classSession.startsAt,
			endsAt: classSession.endsAt,
			className: classType.name
		})
		.from(booking)
		.innerJoin(classSession, eq(booking.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(booking.organizationId, orgId), eq(booking.memberId, id)))
		.orderBy(desc(classSession.startsAt))
		.limit(50);

	const checkIns = await db
		.select()
		.from(checkIn)
		.where(and(eq(checkIn.organizationId, orgId), eq(checkIn.memberId, id)))
		.orderBy(desc(checkIn.checkedAt))
		.limit(50);

	const credits = await creditUsage(orgId, id);

	const [signedWaiver] = await db
		.select()
		.from(waiver)
		.where(eq(waiver.memberId, id))
		.orderBy(desc(waiver.signedAt))
		.limit(1);

	const activeMs = memberships.find((m) => m.membership.status === 'active');
	const [guests] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, id),
				isNotNull(checkIn.guestName),
				sql`${checkIn.checkedAt} >= date_trunc('month', now())`
			)
		);
	const [[att], [bs], referredBy, [referralCount], guardian, dependents, memberOptions] =
		await Promise.all([
			db
				.select({
					visits: sql<number>`count(*) filter (where ${checkIn.guestName} is null)`.mapWith(Number),
					thisMonth:
						sql<number>`count(*) filter (where ${checkIn.guestName} is null and ${checkIn.checkedAt} >= date_trunc('month', now()))`.mapWith(
							Number
						)
				})
				.from(checkIn)
				.where(and(eq(checkIn.organizationId, orgId), eq(checkIn.memberId, id))),
			db
				.select({
					attended: sql<number>`count(*) filter (where ${booking.status} = 'attended')`.mapWith(
						Number
					),
					noShows: sql<number>`count(*) filter (where ${booking.status} = 'no_show')`.mapWith(
						Number
					)
				})
				.from(booking)
				.where(and(eq(booking.organizationId, orgId), eq(booking.memberId, id))),
			row.member.referredByMemberId
				? db
						.select({ id: gymMember.id, name: gymMember.name })
						.from(gymMember)
						.where(eq(gymMember.id, row.member.referredByMemberId))
						.limit(1)
				: Promise.resolve([]),
			db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(gymMember)
				.where(eq(gymMember.referredByMemberId, id)),
			row.member.guardianId
				? db
						.select({ id: gymMember.id, name: gymMember.name })
						.from(gymMember)
						.where(eq(gymMember.id, row.member.guardianId))
						.limit(1)
				: Promise.resolve([]),
			db
				.select({ id: gymMember.id, name: gymMember.name })
				.from(gymMember)
				.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.guardianId, id)))
				.orderBy(asc(gymMember.name)),
			db
				.select({ id: gymMember.id, name: gymMember.name })
				.from(gymMember)
				.where(and(eq(gymMember.organizationId, orgId), ne(gymMember.id, id)))
				.orderBy(asc(gymMember.name))
				.limit(500)
		]);
	return {
		...row,
		memberships,
		charges,
		payments,
		bookings,
		checkIns,
		credits,
		signedWaiver,
		tags: await memberTags(orgId, id),
		referredBy: referredBy[0] ?? null,
		referralCount: referralCount?.n ?? 0,
		guardian: guardian[0] ?? null,
		dependents,
		memberOptions,
		guestPasses: activeMs?.guestPasses ?? 0,
		guestsUsed: guests?.n ?? 0,
		attendance: {
			visits: att?.visits ?? 0,
			thisMonth: att?.thisMonth ?? 0,
			noShows: bs?.noShows ?? 0,
			/** % of attended+no-show bookings the member showed up for; null when no history. */
			showRate:
				(bs?.attended ?? 0) + (bs?.noShows ?? 0) > 0
					? Math.round((100 * (bs?.attended ?? 0)) / ((bs?.attended ?? 0) + (bs?.noShows ?? 0)))
					: null
		}
	};
}

export async function createMember(ctx: OrgContext, input: v.InferOutput<typeof s.memberInput>) {
	const [row] = await db
		.insert(gymMember)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			email: input.email || null,
			phone: input.phone ?? null,
			locationId: input.locationId ?? null,
			status: input.status,
			notes: input.notes ?? null,
			joinedAt: input.joinedAt ?? null,
			birthday: input.birthday ?? null,
			guardianId: input.guardianId ?? null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: row!.id,
		action: 'created',
		summary: `${input.name} joined`
	});
	return row;
}

/** Bulk-creates members from CSV rows; skips rows whose email already belongs to a member (or is repeated). */
export async function importMembers(
	ctx: OrgContext,
	rows: v.InferOutput<typeof s.memberImportInput>
) {
	const emails = rows.map((r) => r.email?.toLowerCase()).filter((e): e is string => !!e);
	const taken = new Set(
		emails.length
			? (
					await db
						.select({ email: sql<string>`lower(${gymMember.email})` })
						.from(gymMember)
						.where(
							and(
								eq(gymMember.organizationId, ctx.orgId),
								inArray(sql`lower(${gymMember.email})`, emails)
							)
						)
				).map((r) => r.email)
			: []
	);
	const seen = new Set<string>();
	const toInsert = rows.filter((r) => {
		const e = r.email?.toLowerCase();
		if (!e) return true;
		if (taken.has(e) || seen.has(e)) return false;
		seen.add(e);
		return true;
	});
	if (toInsert.length)
		await db.insert(gymMember).values(
			toInsert.map((r) => ({
				organizationId: ctx.orgId,
				name: r.name,
				email: r.email || null,
				phone: r.phone ?? null
			}))
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: 'csv-import',
		action: 'imported',
		summary: `Imported ${toInsert.length} member${toInsert.length === 1 ? '' : 's'}`,
		data: { skipped: rows.length - toInsert.length }
	});
	return { created: toInsert.length, skipped: rows.length - toInsert.length };
}

/**
 * Merges duplicate member `dropId` into `keepId`: every member-scoped row is
 * repointed, the survivor keeps its own profile fields and inherits the
 * loser's email/phone/portal login/etc. only where its own is empty, then the
 * loser row is deleted. Bookings/tags that would collide on a unique key are
 * dropped first; the loser's remaining rows cascade away with the delete.
 */
export async function mergeMembers(ctx: OrgContext, keepId: string, dropId: string) {
	if (keepId === dropId) error(400, 'Pick two different members');
	const rows = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), inArray(gymMember.id, [keepId, dropId])));
	const keep = rows.find((r) => r.id === keepId);
	const drop = rows.find((r) => r.id === dropId);
	if (!keep || !drop) error(404, 'Member not found');
	await db.transaction(async (tx) => {
		// Tags collide on unique(memberId, tag) — drop the loser's shared tags before repointing.
		await tx.execute(sql`
			delete from ${memberTag} t
			where t.organization_id = ${ctx.orgId} and t.member_id = ${dropId}
				and exists (
					select 1 from ${memberTag} k
					where k.organization_id = ${ctx.orgId}
						and k.member_id = ${keepId} and k.tag = t.tag)`);
		for (const t of [waiver, membership, checkIn, charge, payment, memberNote, memberTag]) {
			await tx
				.update(t)
				.set({ memberId: keepId })
				.where(and(eq(t.organizationId, ctx.orgId), eq(t.memberId, dropId)));
		}
		// Bookings collide on unique(sessionId, memberId) — remove the loser's dup rows first.
		await tx.execute(sql`
			delete from ${booking} b
			where b.organization_id = ${ctx.orgId} and b.member_id = ${dropId}
				and exists (
					select 1 from ${booking} k
					where k.organization_id = ${ctx.orgId}
						and k.member_id = ${keepId} and k.session_id = b.session_id)`);
		await tx
			.update(booking)
			.set({ memberId: keepId })
			.where(and(eq(booking.organizationId, ctx.orgId), eq(booking.memberId, dropId)));
		// Documents are entity-typed, not FK'd.
		await tx
			.update(document)
			.set({ entityId: keepId })
			.where(
				and(
					eq(document.organizationId, ctx.orgId),
					eq(document.entityType, 'member'),
					eq(document.entityId, dropId)
				)
			);
		// Audit-feed history follows the survivor.
		await tx
			.update(activity)
			.set({ entityId: keepId })
			.where(
				and(
					eq(activity.organizationId, ctx.orgId),
					eq(activity.entityType, 'member'),
					eq(activity.entityId, dropId)
				)
			);
		// Self-FKs from other members (referrer, household guardian) repoint to the survivor.
		await tx
			.update(gymMember)
			.set({ referredByMemberId: keepId })
			.where(
				and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.referredByMemberId, dropId))
			);
		await tx
			.update(gymMember)
			.set({ guardianId: keepId })
			.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.guardianId, dropId)));
		// Survivor inherits the loser's values only for fields it doesn't have.
		const patch: Partial<typeof gymMember.$inferSelect> = {};
		for (const f of [
			'email',
			'phone',
			'birthday',
			'notes',
			'locationId',
			'portalUserId',
			'referralSource',
			'unsubscribedAt'
		] as const) {
			if (keep[f] == null && drop[f] != null) Object.assign(patch, { [f]: drop[f] });
		}
		// Referral credit chain: keep the loser's referrer unless that's the survivor itself.
		if (keep.referredByMemberId == null && drop.referredByMemberId !== keepId)
			patch.referredByMemberId = drop.referredByMemberId;
		if (keep.joinedAt == null || (drop.joinedAt && drop.joinedAt < keep.joinedAt))
			patch.joinedAt = drop.joinedAt;
		if (Object.keys(patch).length)
			await tx.update(gymMember).set(patch).where(eq(gymMember.id, keepId));
		await tx.delete(gymMember).where(eq(gymMember.id, dropId));
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: keepId,
		action: 'merged',
		summary: `Merged ${drop.name} into ${keep.name}`
	});
}

export async function updateMember(ctx: OrgContext, input: v.InferOutput<typeof s.memberUpdate>) {
	const { id, ...set } = input;
	if (set.guardianId === id) error(400, "A member can't be their own guardian");
	const [row] = await db
		.update(gymMember)
		.set({
			name: set.name,
			email: set.email === undefined ? undefined : set.email || null,
			phone: set.phone,
			locationId: set.locationId,
			status: set.status,
			notes: set.notes,
			joinedAt: set.joinedAt,
			birthday: set.birthday,
			guardianId: set.guardianId === undefined ? undefined : set.guardianId || null
		})
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, id)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
}

// ------- staff notes on a member -------

export async function listMemberNotes(orgId: string, memberId: string) {
	return db
		.select({
			id: memberNote.id,
			body: memberNote.body,
			createdAt: memberNote.createdAt,
			authorName: user.name
		})
		.from(memberNote)
		.leftJoin(user, eq(memberNote.authorId, user.id))
		.where(and(eq(memberNote.organizationId, orgId), eq(memberNote.memberId, memberId)))
		.orderBy(desc(memberNote.createdAt))
		.limit(50);
}

export async function addMemberNote(ctx: OrgContext, memberId: string, body: string) {
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(memberNote)
		.values({ organizationId: ctx.orgId, memberId, authorId: ctx.userId, body })
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: memberId,
		action: 'note_added',
		summary: 'Staff note added',
		data: { noteId: row!.id }
	});
	return row;
}

export async function deleteMemberNote(ctx: OrgContext, noteId: string) {
	const [row] = await db
		.delete(memberNote)
		.where(and(eq(memberNote.organizationId, ctx.orgId), eq(memberNote.id, noteId)))
		.returning();
	if (!row) error(404, 'Note not found');
}

/** Members whose portal login is this user — one user can belong to several gyms. */
export async function portalMembers(userId: string) {
	const own = await db
		.select({ member: gymMember, orgName: organization.name, orgSlug: organization.slug })
		.from(gymMember)
		.innerJoin(organization, eq(organization.id, gymMember.organizationId))
		.where(eq(gymMember.portalUserId, userId));
	const mine = own.map((o) => ({ ...o, dependent: false }));
	if (!own.length) return mine;
	// Dependents billing under this member show up in the portal switcher too,
	// so a parent can book and manage for the kids.
	const deps = await db
		.select({ member: gymMember, orgName: organization.name, orgSlug: organization.slug })
		.from(gymMember)
		.innerJoin(organization, eq(organization.id, gymMember.organizationId))
		.where(
			inArray(
				gymMember.guardianId,
				own.map((o) => o.member.id)
			)
		);
	return [...mine, ...deps.map((d) => ({ ...d, dependent: true }))];
}
