import { error } from '@sveltejs/kit';
import {
	isNull,
	gte,
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	ne,
	or,
	sql
} from 'drizzle-orm';
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
	gymSettings,
	incident,
	location,
	memberMeasurement,
	memberNote,
	memberTag,
	membership,
	notificationLog,
	organization,
	payment,
	personalRecord,
	signRequest,
	trialRequest,
	user,
	waiver,
	plan,
	outer,
	workoutResult
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { loyaltyTier, todayISO } from '#lib/format.ts';
import { localDate } from '#lib/tz.ts';
import { emit } from './events.ts';
import { creditUsage, creditsUsedIn } from './schedule.ts';
import {
	notifyCreditsGifted,
	notifyDeletionRequested,
	notifySignRequest
} from './notifications.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export type MemberSort = 'name' | 'joined' | 'lastVisit' | 'balance';

const MEMBER_ORDER = {
	name: asc(gymMember.name),
	joined: desc(gymMember.joinedAt),
	lastVisit: sql`"lastVisit" desc nulls last`,
	balance: sql`"openBalance" desc`
} as const;

/** Dependents billing under a member — the kiosk's family check-in rows. */
export async function listDependents(orgId: string, memberId: string) {
	return db
		.select({
			id: gymMember.id,
			name: gymMember.name,
			status: gymMember.status,
			deskNote: gymMember.deskNote,
			photoDocumentId: gymMember.photoDocumentId
		})
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.guardianId, memberId)))
		.orderBy(asc(gymMember.name));
}

export async function listMembers(
	orgId: string,
	q?: string,
	tag?: string,
	status?: 'active' | 'inactive',
	planId?: string,
	sort: MemberSort = 'name',
	owes?: boolean,
	suspended?: boolean,
	recent?: boolean,
	risk?: boolean,
	family?: boolean,
	birthday?: boolean
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
			photoDocumentId: gymMember.photoDocumentId,
			deskNote: gymMember.deskNote,
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
			/** Dependents can book from a guardian's membership — the picker's
			 * eligibility gate needs to know without a second query. */
			guardianPlanName: sql<
				string | null
			>`(select p3.name from ${membership} m3 join ${plan} p3 on p3.id = m3.plan_id join ${gymMember} g on g.guardian_id = m3.member_id where g.id = ${outer(gymMember.id)} and m3.status = 'active' order by m3.created_at desc limit 1)`,
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
				planId === 'none'
					? sql`not exists (select 1 from ${membership} m3 where m3.member_id = ${gymMember.id} and m3.status = 'active')`
					: planId === 'pack'
						? sql`exists (select 1 from ${membership} m3 join ${plan} p4 on p4.id = m3.plan_id where m3.member_id = ${gymMember.id} and m3.status = 'active' and p4.is_pack)`
						: planId === 'recurring'
							? sql`exists (select 1 from ${membership} m3 join ${plan} p4 on p4.id = m3.plan_id where m3.member_id = ${gymMember.id} and m3.status = 'active' and not p4.is_pack)`
							: planId
								? sql`exists (select 1 from ${membership} m3 where m3.member_id = ${gymMember.id} and m3.status = 'active' and m3.plan_id = ${planId})`
								: undefined,
				owes
					? sql`exists (select 1 from ${charge} c where c.member_id = ${gymMember.id} and c.status = 'open' and c.amount > coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id and p.refunded_at is null), 0))`
					: undefined,
				suspended
					? sql`exists (select 1 from ${membership} m4 where m4.member_id = ${gymMember.id} and m4.status = 'suspended')`
					: undefined,
				recent
					? gte(gymMember.joinedAt, new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
					: undefined,
				// At-risk: active member with no check-in in the last 30 days (or ever).
				risk
					? sql`${gymMember.status} = 'active' and not exists (select 1 from ${checkIn} c where c.member_id = ${gymMember.id} and c.checked_at > ${new Date(Date.now() - 30 * 86_400_000).toISOString()})`
					: undefined,
				// Birthday this calendar month (member's stored MM, today-anchored).
				birthday
					? sql`extract(month from ${gymMember.birthday}) = ${new Date().getUTCMonth() + 1}`
					: undefined,
				// In a household: has a guardian payer, or is the guardian of someone.
				family
					? sql`(${gymMember.guardianId} is not null or exists (select 1 from ${gymMember} g2 where g2.guardian_id = ${outer(gymMember.id)}))`
					: undefined
			)
		)
		.orderBy(MEMBER_ORDER[sort]);
}

/**
 * Possible duplicate members — groups of 2+ sharing a normalized email (exact,
 * case-insensitive) or a normalized name (case/whitespace-insensitive). Groups
 * that fully overlap are merged; capped at 10. Feeds the members-list hint
 * that points staff at member merge.
 */
export async function findDuplicates(orgId: string) {
	const rows = await db
		.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(eq(gymMember.organizationId, orgId))
		.orderBy(asc(gymMember.name));
	const byKey = new Map<string, typeof rows>();
	for (const r of rows) {
		const keys = [
			r.email ? `e:${r.email.trim().toLowerCase()}` : null,
			`n:${r.name.trim().toLowerCase().replace(/\s+/g, ' ')}`
		];
		for (const key of keys) {
			if (!key) continue;
			const g = byKey.get(key) ?? [];
			if (!g.some((m) => m.id === r.id)) g.push(r);
			byKey.set(key, g);
		}
	}
	const seen = new Set<string>();
	const out: { reason: string; members: typeof rows }[] = [];
	for (const [key, members] of byKey) {
		if (members.length < 2 || members.every((m) => seen.has(m.id))) continue;
		for (const m of members) seen.add(m.id);
		out.push({
			reason: key.startsWith('e:') ? `same email ${members[0]!.email}` : 'same name',
			members
		});
	}
	return out.slice(0, 10);
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
	const [
		[att],
		[bs],
		referredBy,
		[referralCount],
		guardian,
		dependents,
		memberOptions,
		emails,
		measurements,
		scores,
		prs,
		incidents,
		signRequests
	] = await Promise.all([
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
				noShows: sql<number>`count(*) filter (where ${booking.status} = 'no_show')`.mapWith(Number)
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
			.limit(500),
		row.member.email
			? db
					.select({
						id: notificationLog.id,
						kind: notificationLog.kind,
						openedAt: notificationLog.openedAt,
						createdAt: notificationLog.createdAt
					})
					.from(notificationLog)
					.where(
						and(
							eq(notificationLog.organizationId, orgId),
							eq(notificationLog.recipient, row.member.email)
						)
					)
					.orderBy(desc(notificationLog.createdAt))
					.limit(20)
			: Promise.resolve([]),
		db
			.select()
			.from(memberMeasurement)
			.where(and(eq(memberMeasurement.organizationId, orgId), eq(memberMeasurement.memberId, id)))
			.orderBy(desc(memberMeasurement.recordedAt), desc(memberMeasurement.createdAt))
			.limit(12),
		db
			.select({
				result: workoutResult,
				startsAt: classSession.startsAt,
				className: classType.name
			})
			.from(workoutResult)
			.innerJoin(classSession, eq(workoutResult.sessionId, classSession.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(workoutResult.organizationId, orgId), eq(workoutResult.memberId, id)))
			.orderBy(desc(classSession.startsAt))
			.limit(12),
		db
			.select()
			.from(personalRecord)
			.where(and(eq(personalRecord.organizationId, orgId), eq(personalRecord.memberId, id)))
			.orderBy(desc(personalRecord.recordedOn), desc(personalRecord.createdAt))
			.limit(25),
		db
			.select()
			.from(incident)
			.where(and(eq(incident.organizationId, orgId), eq(incident.memberId, id)))
			.orderBy(desc(incident.occurredOn), desc(incident.createdAt)),
		db
			.select()
			.from(signRequest)
			.where(and(eq(signRequest.organizationId, orgId), eq(signRequest.memberId, id)))
			.orderBy(desc(signRequest.createdAt))
			.limit(25)
	]);
	// Current week-streak for the member page (same rule as the portal card).
	const yearAgo = new Date(Date.now() - 370 * 86400_000);
	const streakVisits = await db
		.select({ checkedAt: checkIn.checkedAt })
		.from(checkIn)
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				eq(checkIn.memberId, id),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, yearAgo)
			)
		);
	const [stz] = await db
		.select({ tz: gymSettings.timezone })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId));
	const mweekOf = (iso: string) => {
		const d = new Date(`${iso}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		return d.toISOString().slice(0, 10);
	};
	const mweeks = new Set(streakVisits.map((v) => mweekOf(localDate(v.checkedAt, stz?.tz ?? 'UTC'))));
	let weekStreak = 0;
	let mw = mweekOf(localDate(new Date(), stz?.tz ?? 'UTC'));
	if (!mweeks.has(mw)) {
		const prev = new Date(`${mw}T12:00:00Z`);
		prev.setUTCDate(prev.getUTCDate() - 7);
		mw = prev.toISOString().slice(0, 10);
	}
	while (mweeks.has(mw)) {
		weekStreak++;
		const prev = new Date(`${mw}T12:00:00Z`);
		prev.setUTCDate(prev.getUTCDate() - 7);
		mw = prev.toISOString().slice(0, 10);
	}

	const trialRequests = await db
		.select({
			request: trialRequest,
			className: classType.name,
			startsAt: classSession.startsAt
		})
		.from(trialRequest)
		.innerJoin(classSession, eq(trialRequest.sessionId, classSession.id))
		.innerJoin(classType, eq(classSession.classTypeId, classType.id))
		.where(and(eq(trialRequest.memberId, id), eq(trialRequest.status, 'pending')));

	return {
		...row,
		memberships,
		charges,
		payments,
		bookings,
		trialRequests,
		weekStreak,
		checkIns,
		credits,
		signedWaiver,
		tags: await memberTags(orgId, id),
		referredBy: referredBy[0] ?? null,
		referralCount: referralCount?.n ?? 0,
		guardian: guardian[0] ?? null,
		dependents,
		memberOptions,
		emails,
		measurements,
		scores,
		prs,
		incidents,
		signRequests,
		guestPasses: activeMs?.guestPasses ?? 0,
		guestsUsed: guests?.n ?? 0,
		loyalty: loyaltyTier(att?.visits ?? 0),
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
		for (const t of [
			waiver,
			membership,
			checkIn,
			charge,
			payment,
			memberNote,
			memberTag,
			memberMeasurement
		]) {
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
		// Documents are entity-typed, not FK'd ('member' files + 'member_avatar' photo).
		await tx
			.update(document)
			.set({ entityId: keepId })
			.where(
				and(
					eq(document.organizationId, ctx.orgId),
					inArray(document.entityType, ['member', 'member_avatar']),
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
			'deskNote',
			'locationId',
			'portalUserId',
			'referralSource',
			'unsubscribedAt',
			'photoDocumentId'
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
			deskNote: set.deskNote === undefined ? undefined : set.deskNote || null,
			joinedAt: set.joinedAt,
			birthday: set.birthday,
			emergencyName: set.emergencyName === undefined ? undefined : set.emergencyName || null,
			emergencyPhone: set.emergencyPhone === undefined ? undefined : set.emergencyPhone || null,
			guardianId: set.guardianId === undefined ? undefined : set.guardianId || null
		})
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, id)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
}

/** Push a pack's expiry out by N days (or to today+N if it already lapsed). */
export async function extendPack(ctx: OrgContext, membershipId: string, days: number) {
	const [ms] = await db
		.select({ endsAt: membership.endsAt, memberId: membership.memberId })
		.from(membership)
		.where(and(eq(membership.organizationId, ctx.orgId), eq(membership.id, membershipId)));
	if (!ms) error(404, 'Membership not found');
	const base =
		ms.endsAt && ms.endsAt.getTime() > Date.now() ? ms.endsAt.getTime() : Date.now();
	const endsAt = new Date(base + days * 86_400_000);
	const [row] = await db
		.update(membership)
		.set({ endsAt })
		.where(eq(membership.id, membershipId))
		.returning();
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

// ------- member-logged body metrics (portal Progress card + member page) -------

export async function listMeasurements(orgId: string, memberId: string, limit = 12) {
	return db
		.select()
		.from(memberMeasurement)
		.where(
			and(eq(memberMeasurement.organizationId, orgId), eq(memberMeasurement.memberId, memberId))
		)
		.orderBy(desc(memberMeasurement.recordedAt), desc(memberMeasurement.createdAt))
		.limit(limit);
}

export async function addMeasurement(
	orgId: string,
	memberId: string,
	input: v.InferOutput<typeof s.measurementInput>
) {
	const [m] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(memberMeasurement)
		.values({
			organizationId: orgId,
			memberId,
			kind: input.kind,
			value: input.value,
			unit: input.unit,
			recordedAt: input.recordedAt ?? todayISO()
		})
		.returning();
	await emit({
		orgId,
		entityType: 'member',
		entityId: memberId,
		action: 'measurement_logged',
		summary: `Logged ${input.kind.replace('_', ' ')}: ${input.value} ${input.unit}`,
		data: { measurementId: row!.id }
	});
	return row;
}

/** Delete is member-scoped — the portal lets members remove their own entries only. */
export async function deleteMeasurement(orgId: string, memberId: string, id: string) {
	const [row] = await db
		.delete(memberMeasurement)
		.where(
			and(
				eq(memberMeasurement.organizationId, orgId),
				eq(memberMeasurement.memberId, memberId),
				eq(memberMeasurement.id, id)
			)
		)
		.returning();
	if (!row) error(404, 'Entry not found');
}

// ---------- Personal records (member PR board) ----------

export async function listPersonalRecords(orgId: string, memberId: string, limit = 50) {
	return db
		.select()
		.from(personalRecord)
		.where(and(eq(personalRecord.organizationId, orgId), eq(personalRecord.memberId, memberId)))
		.orderBy(desc(personalRecord.recordedOn), desc(personalRecord.createdAt))
		.limit(limit);
}

export async function addPersonalRecord(
	orgId: string,
	memberId: string,
	input: v.InferOutput<typeof s.prInput>
) {
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(personalRecord)
		.values({
			organizationId: orgId,
			memberId,
			label: input.label,
			value: input.value,
			recordedOn: input.recordedOn ?? todayISO()
		})
		.returning();
	await emit({
		orgId,
		entityType: 'member',
		entityId: memberId,
		action: 'pr_logged',
		summary: `New PR: ${input.label} — ${input.value}`,
		data: { prId: row!.id }
	});
	return row;
}

/** Delete is member-scoped — the portal lets members remove their own entries only. */
export async function deletePersonalRecord(orgId: string, memberId: string, id: string) {
	const [row] = await db
		.delete(personalRecord)
		.where(
			and(
				eq(personalRecord.organizationId, orgId),
				eq(personalRecord.memberId, memberId),
				eq(personalRecord.id, id)
			)
		)
		.returning();
	if (!row) error(404, 'Record not found');
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

/**
 * Portal-visible check-in leaderboard: top-10 visitors this calendar month plus
 * the caller's own rank + count (rank counts members with strictly more visits).
 */
export async function membersLeaderboard(orgId: string, memberId: string, tz: string) {
	const month = localDate(new Date(), tz).slice(0, 7);
	const rows = await db
		.select({
			memberId: gymMember.id,
			name: gymMember.name,
			visits: sql<number>`count(${checkIn.id})`.mapWith(Number)
		})
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				isNull(checkIn.guestName),
				ne(gymMember.name, 'Former member'),
				sql`to_char(${checkIn.checkedAt} at time zone ${sql.raw(`'${tz.replace(/'/g, '')}'`)}, 'YYYY-MM') = ${month}`
			)
		)
		.groupBy(gymMember.id, gymMember.name)
		.orderBy(desc(sql`count(${checkIn.id})`), gymMember.name);
	const mine = rows.find((r) => r.memberId === memberId);
	const rank = mine ? rows.filter((r) => r.visits > mine.visits).length + 1 : null;
	return { top: rows.slice(0, 10), mine: mine ?? null, rank };
}

/** Latest PRs across the gym — the portal's PR leaderboard. */
export async function prBoard(orgId: string, limit = 20) {
	return db
		.select({ pr: personalRecord, memberName: gymMember.name })
		.from(personalRecord)
		.innerJoin(
			gymMember,
			and(eq(personalRecord.memberId, gymMember.id), eq(personalRecord.organizationId, orgId))
		)
		.where(eq(personalRecord.organizationId, orgId))
		.orderBy(desc(personalRecord.recordedOn), desc(personalRecord.createdAt))
		.limit(limit);
}

// ---------- Incident / injury reports ----------

export async function listIncidents(orgId: string, memberId?: string) {
	return db
		.select({ incident, memberName: gymMember.name })
		.from(incident)
		.leftJoin(gymMember, eq(incident.memberId, gymMember.id))
		.where(
			and(
				eq(incident.organizationId, orgId),
				memberId ? eq(incident.memberId, memberId) : undefined
			)
		)
		.orderBy(desc(incident.occurredOn), desc(incident.createdAt))
		.limit(memberId ? 50 : 200);
}

/** Logs an injury/incident report. `subjectName` is required when memberId is null. */
export async function logIncident(ctx: OrgContext, input: v.InferOutput<typeof s.incidentInput>) {
	if (!input.memberId && !input.subjectName?.trim()) error(400, 'Pick a member or enter a name');
	if (input.memberId) {
		const [m] = await db
			.select({ id: gymMember.id })
			.from(gymMember)
			.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
		if (!m) error(404, 'Member not found');
	}
	const [row] = await db
		.insert(incident)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			subjectName: input.subjectName?.trim() ?? '',
			kind: input.kind,
			occurredOn: input.occurredOn,
			description: input.description,
			reportedById: ctx.userId ?? null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'member',
		entityId: input.memberId ?? ctx.orgId,
		action: 'incident_logged',
		summary: `${input.kind === 'injury' ? 'Injury' : 'Incident'} report — ${input.subjectName?.trim() || 'member'}`
	});
	return row;
}

export async function updateIncident(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.incidentUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(incident)
		.set(set)
		.where(and(eq(incident.organizationId, ctx.orgId), eq(incident.id, id)))
		.returning();
	if (!row) error(404, 'Incident not found');
	return row;
}

// ---------- Signature requests ----------

export async function listSignRequests(orgId: string, memberId?: string) {
	return db
		.select()
		.from(signRequest)
		.where(
			and(
				eq(signRequest.organizationId, orgId),
				memberId ? eq(signRequest.memberId, memberId) : undefined
			)
		)
		.orderBy(desc(signRequest.createdAt))
		.limit(memberId ? 50 : 200);
}

/** Sends a document for the member to sign in the portal; emails them the link. */
export async function sendSignRequest(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.signRequestInput>
) {
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, input.memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(signRequest)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			title: input.title,
			body: input.body,
			sentById: ctx.userId ?? null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'member',
		entityId: input.memberId,
		action: 'sign_request_sent',
		summary: `Sent "${input.title}" for signature`
	});
	notifySignRequest(ctx.orgId, row!.id).catch(() => {});
	return row;
}

/** Member signs in the portal — typed name + timestamp, one shot. */
export async function signDocumentRequest(
	orgId: string,
	memberId: string,
	id: string,
	signedName: string
) {
	if (!signedName.trim()) error(400, 'Type your name to sign');
	const [row] = await db
		.update(signRequest)
		.set({ status: 'signed', signedName: signedName.trim(), signedAt: new Date() })
		.where(
			and(
				eq(signRequest.organizationId, orgId),
				eq(signRequest.memberId, memberId),
				eq(signRequest.id, id),
				eq(signRequest.status, 'pending')
			)
		)
		.returning();
	if (!row) error(404, 'Request not found or already handled');
	await emit({
		orgId,
		entityType: 'member',
		entityId: memberId,
		action: 'document_signed',
		summary: `Signed "${row.title}"`
	});
	return row;
}

/** Staff withdraws a pending request. */
export async function voidSignRequest(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(signRequest)
		.set({ status: 'voided' })
		.where(
			and(
				eq(signRequest.organizationId, ctx.orgId),
				eq(signRequest.id, id),
				eq(signRequest.status, 'pending')
			)
		)
		.returning();
	if (!row) error(404, 'Request not found or already handled');
	return row;
}

/**
 * Moves N class-pack credits from one member's active pack to another member.
 * Effective pack credits are `plan.classCredits + membership.bonusCredits`, so
 * the donor's bonusCredits drops by N and the recipient either gets +N on an
 * existing pack on the same plan or a fresh pack membership whose bonusCredits
 * nets out to exactly N. No money moves — the original charge stays with the
 * donor. Returns the donor's remaining credits.
 */
export async function transferPackCredits(
	ctx: { orgId: string; userId?: string | null },
	fromMembershipId: string,
	to: { memberId?: string; email?: string },
	credits: number
) {
	if (!Number.isInteger(credits) || credits < 1) error(400, 'Give at least 1 class');
	const [donor] = await db
		.select({
			ms: membership,
			classCredits: plan.classCredits,
			classTypeId: plan.classTypeId,
			planName: plan.name
		})
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.id, fromMembershipId),
				eq(membership.organizationId, ctx.orgId),
				eq(membership.status, 'active'),
				eq(plan.isPack, true),
				isNotNull(plan.classCredits)
			)
		);
	if (!donor) error(404, 'Active pack membership not found');
	const [recipient] = to.memberId
		? await db
				.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
				.from(gymMember)
				.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, to.memberId)))
		: await db
				.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
				.from(gymMember)
				.where(
					and(
						eq(gymMember.organizationId, ctx.orgId),
						eq(sql`lower(${gymMember.email})`, (to.email ?? '').trim().toLowerCase())
					)
				);
	if (!recipient) error(404, 'No member with that email at this gym');
	if (recipient.id === donor.ms.memberId) error(400, 'That is already their pack');
	const window = {
		start: donor.ms.startsAt.toISOString().slice(0, 10),
		end: (donor.ms.endsAt ?? new Date()).toISOString().slice(0, 10)
	};
	const used = await creditsUsedIn(
		ctx.orgId,
		donor.ms.memberId,
		donor.ms.id,
		window,
		donor.classTypeId
	);
	const remaining = donor.classCredits! + donor.ms.bonusCredits - used;
	if (credits > remaining)
		error(400, `Only ${remaining} class${remaining === 1 ? '' : 'es'} left on this pack`);
	const [donorMember] = await db
		.select({ name: gymMember.name })
		.from(gymMember)
		.where(eq(gymMember.id, donor.ms.memberId));
	await db.transaction(async (tx) => {
		await tx
			.update(membership)
			.set({ bonusCredits: sql`${membership.bonusCredits} - ${credits}` })
			.where(eq(membership.id, donor.ms.id));
		const [existing] = await tx
			.select({ id: membership.id })
			.from(membership)
			.where(
				and(
					eq(membership.organizationId, ctx.orgId),
					eq(membership.memberId, recipient.id),
					eq(membership.planId, donor.ms.planId),
					eq(membership.status, 'active')
				)
			)
			.limit(1);
		if (existing)
			await tx
				.update(membership)
				.set({ bonusCredits: sql`${membership.bonusCredits} + ${credits}` })
				.where(eq(membership.id, existing.id));
		else
			await tx.insert(membership).values({
				organizationId: ctx.orgId,
				memberId: recipient.id,
				planId: donor.ms.planId,
				startsAt: new Date(),
				// The gifted classes live and die with the donor pack's window.
				endsAt: donor.ms.endsAt,
				// Effective credits = plan.classCredits + bonusCredits = exactly `credits`.
				bonusCredits: credits - donor.classCredits!
			});
	});
	const fromName = donorMember?.name ?? 'A member';
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'member',
		entityId: recipient.id,
		action: 'credits.transferred',
		summary: `${credits} pack class${credits === 1 ? '' : 'es'} from ${fromName}`
	});
	await notifyCreditsGifted(
		ctx.orgId,
		`${donor.ms.id}:${crypto.randomUUID()}`,
		recipient.id,
		fromName,
		credits
	);
	return { remaining: remaining - credits, toName: recipient.name };
}

/** Remaining classes on one pack membership — for the transfer dialog. */
export async function packRemaining(orgId: string, membershipId: string) {
	const [row] = await db
		.select({ ms: membership, classCredits: plan.classCredits, classTypeId: plan.classTypeId })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.id, membershipId),
				eq(membership.organizationId, orgId),
				eq(plan.isPack, true),
				isNotNull(plan.classCredits)
			)
		);
	if (!row) return null;
	const used = await creditsUsedIn(
		orgId,
		row.ms.memberId,
		row.ms.id,
		{
			start: row.ms.startsAt.toISOString().slice(0, 10),
			end: (row.ms.endsAt ?? new Date()).toISOString().slice(0, 10)
		},
		row.classTypeId
	);
	const limit = row.classCredits! + row.ms.bonusCredits;
	return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Portal-side gift: the member gives N credits off their own pack to another
 * member by email. Picks their pack with the most remaining credits.
 */
export async function giftPackCredits(
	orgId: string,
	fromMemberId: string,
	email: string,
	credits: number,
	userId?: string | null
) {
	const packs = await db
		.select({ ms: membership, classCredits: plan.classCredits, classTypeId: plan.classTypeId })
		.from(membership)
		.innerJoin(plan, eq(membership.planId, plan.id))
		.where(
			and(
				eq(membership.organizationId, orgId),
				eq(membership.memberId, fromMemberId),
				eq(membership.status, 'active'),
				eq(plan.isPack, true),
				isNotNull(plan.classCredits)
			)
		);
	let best: { id: string; remaining: number } | null = null;
	for (const p of packs) {
		const used = await creditsUsedIn(
			orgId,
			fromMemberId,
			p.ms.id,
			{
				start: p.ms.startsAt.toISOString().slice(0, 10),
				end: (p.ms.endsAt ?? new Date()).toISOString().slice(0, 10)
			},
			p.classTypeId
		);
		const remaining = p.classCredits! + p.ms.bonusCredits - used;
		if (!best || remaining > best.remaining) best = { id: p.ms.id, remaining };
	}
	if (!best) error(400, 'You have no active class pack');
	if (credits > best!.remaining)
		error(
			400,
			`Only ${best!.remaining} class${best!.remaining === 1 ? '' : 'es'} left on your pack`
		);
	return transferPackCredits({ orgId, userId }, best!.id, { email }, credits);
}

/** Latest personal records across the gym — the lobby PR wall. */
export async function prWall(orgId: string) {
	const records = await db
		.select({
			pr: personalRecord,
			memberName: gymMember.name,
			photoDocumentId: gymMember.photoDocumentId
		})
		.from(personalRecord)
		.innerJoin(gymMember, eq(personalRecord.memberId, gymMember.id))
		.where(eq(personalRecord.organizationId, orgId))
		.orderBy(desc(personalRecord.recordedOn), desc(personalRecord.createdAt))
		.limit(40);

	// Top current week-streaks — one year of check-ins, grouped by ISO week.
	const since = new Date(Date.now() - 52 * 7 * 86_400_000);
	const visits = await db
		.select({
			memberId: checkIn.memberId,
			checkedAt: checkIn.checkedAt,
			memberName: gymMember.name
		})
		.from(checkIn)
		.innerJoin(gymMember, eq(checkIn.memberId, gymMember.id))
		.where(
			and(
				eq(checkIn.organizationId, orgId),
				gte(checkIn.checkedAt, since),
				isNull(checkIn.guestName)
			)
		);
	const weekOf = (d: Date) => {
		const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
		x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
		return x.getTime();
	};
	const byMember = new Map<string, { name: string; weeks: Set<number> }>();
	for (const v of visits) {
		const e = byMember.get(v.memberId) ?? { name: v.memberName, weeks: new Set<number>() };
		e.weeks.add(weekOf(v.checkedAt));
		byMember.set(v.memberId, e);
	}
	const thisWeek = weekOf(new Date());
	const streaks = [...byMember.entries()]
		.map(([memberId, e]) => {
			let w = thisWeek;
			if (!e.weeks.has(w)) w -= 7 * 86_400_000;
			let streak = 0;
			while (e.weeks.has(w)) {
				streak++;
				w -= 7 * 86_400_000;
			}
			return { memberId, memberName: e.name, streak };
		})
		.filter((r) => r.streak >= 2)
		.sort((a, b) => b.streak - a.streak)
		.slice(0, 5);

	return { records, streaks };
}

/** Member asks (via the portal) for their personal data to be deleted. */
export async function requestDataDeletion(orgId: string, memberId: string) {
	const [m] = await db
		.update(gymMember)
		.set({ deletionRequestedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.id, memberId),
				isNull(gymMember.deletionRequestedAt)
			)
		)
		.returning();
	if (!m) return { ok: true, already: true };
	await emit({
		orgId,
		entityType: 'member',
		entityId: memberId,
		action: 'deletion_requested',
		summary: `${m.name} requested deletion of their personal data`
	});
	notifyDeletionRequested(orgId, memberId).catch(() => {});
	return { ok: true };
}

/**
 * Anonymize a member's personal data (staff action on a deletion request, or
 * manual). Scrubs name/contact/profile fields — bookings, charges and payments
 * keep pointing at the row so financial history stays intact.
 */
export async function anonymizeMember(ctx: OrgContext, memberId: string) {
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	await db
		.update(gymMember)
		.set({
			name: 'Former member',
			email: null,
			phone: null,
			birthday: null,
			notes: null,
			deskNote: null,
			emergencyName: null,
			emergencyPhone: null,
			referralSource: null,
			photoDocumentId: null,
			goalVisitsPerMonth: null,
			deletionRequestedAt: null,
			updatedAt: new Date()
		})
		.where(eq(gymMember.id, memberId));
	// Drop free-text staff notes and measurements too — they're personal data.
	await db
		.delete(memberNote)
		.where(and(eq(memberNote.organizationId, ctx.orgId), eq(memberNote.memberId, memberId)));
	await db
		.delete(memberMeasurement)
		.where(
			and(eq(memberMeasurement.organizationId, ctx.orgId), eq(memberMeasurement.memberId, memberId))
		);
	await emit({
		orgId: ctx.orgId,
		entityType: 'member',
		entityId: memberId,
		action: 'anonymized',
		summary: `Personal data anonymized for ${m.name}`,
		actorId: ctx.userId
	});
	return { ok: true };
}
