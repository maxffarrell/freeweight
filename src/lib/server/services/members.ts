import { error } from '@sveltejs/kit';
import {
	isNull,
	gte,
	lte,
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	lt,
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
	memberFieldValue,
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
	signDocTemplate,
	memberIssue,
	workoutLog,
	workoutResult
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { loyaltyTier, todayISO } from '#lib/format.ts';
import { localDate } from '#lib/tz.ts';
import { emit } from './events.ts';
import { healthFormsEnabled, requestParqResign } from '#lib/server/ee/health-forms.ts';
import { creditUsage, creditsUsedIn } from './schedule.ts';
import {
	notifyCreditsGifted,
	notifyDeletionRequested,
	notifySignRequest,
	notifyPersonalRecord
} from './notifications.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export type MemberSort = 'name' | 'joined' | 'lastVisit' | 'stale' | 'balance' | 'visits30';

const MEMBER_ORDER = {
	name: asc(gymMember.name),
	joined: desc(gymMember.joinedAt),
	lastVisit: sql`"lastVisit" desc nulls last`,
	balance: sql`"openBalance" desc`,
	visits30: sql`"visits30" desc`,
	stale: sql`"lastVisit" asc nulls first`
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
	birthday?: boolean,
	noContact?: boolean,
	/** Members who hit the unsubscribe link — excluded from member emails. */
	unsubscribed?: boolean,
	/** Members brought in by another member's referral link. */
	referred?: boolean,
	/** Active members who have never had a booking (any status). */
	neverBooked?: boolean,
	/** Members whose active membership (pack or term) ends within 30 days. */
	endingSoon?: boolean,
	/** Members missing a signature for the org's current waiver text (no-op when none is set). */
	noWaiver?: boolean,
	/** Members currently waitlisted on an upcoming session. */
	onWaitlist?: boolean,
	/** Members with a paused membership. */
	paused?: boolean,
	/** Members with no upcoming booked sessions. */
	noUpcoming?: boolean,
	/** Members on a comp'd (no-bill) membership. */
	comped?: boolean,
	/** Members with an active class pack expiring within 14 days. */
	packExpiring?: boolean,
	/** Members currently checked in (no check-out yet). */
	insideNow?: boolean,
	/** Members holding an assigned locker. */
	hasLocker?: boolean,
	/** Members with one or fewer credits left on an active class pack. */
	lowCredits?: boolean,
	/** Members whose pack is set to auto-renew. */
	autoRenew?: boolean,
	/** Members with a pending portal cancel request. */
	cancelRequested?: boolean,
	/** Members with a pending portal pause request. */
	pauseRequested?: boolean,
	/** Members who have never claimed a portal login. */
	noPortal?: boolean,
	/** Members with no birthday on file — gaps in the birthday-marketing list. */
	noBirthday?: boolean,
	/** Members with no staff photo on file. */
	noPhoto?: boolean,
	/** Members whose membership still holds comp/bonus class credits. */
	hasCompCredits?: boolean,
	/** Members entered in a currently-active challenge. */
	inChallenge?: boolean,
	/** Members who are a guardian of at least one dependent. */
	hasDependents?: boolean,
	/** Members with a check-in in the last 7 days. */
	visitedThisWeek?: boolean,
	/** Members who have referred at least one other member. */
	isReferrer?: boolean,
	/** Members enrolled in a course ending today or later. */
	inCourse?: boolean,
	/** Members with an open charge due within the next 7 days. */
	dueSoon?: boolean,
	/** Members with at least one upcoming booked session. */
	hasUpcoming?: boolean,
	/** Active members whose plan commitment term ends within 30 days — renewal pitch targets. */
	commitmentEnding?: boolean,
	/** Dependent members (book/bill through a guardian). */
	isDependent?: boolean,
	/** Members with no emergency contact on file. */
	noEmergency?: boolean,
	/** Members with an active workout-program assignment. */
	hasProgram?: boolean,
	/** Members who redeemed a gift card that still has a balance — unused account credit. */
	hasGiftBalance?: boolean,
	/** Members whose free-trial first bill lands within 3 days and who haven't been charged yet. */
	trialEnding?: boolean,
	/** Members with a booked session today — who's coming in. */
	bookedToday?: boolean,
	/** Members with an unresolved issue report. */
	hasIssue?: boolean,
	/** Members registered for an upcoming event. */
	inEvent?: boolean,
	/** Enterprise health-forms: members without a signed PAR-Q. */
	noHealthForm?: boolean,
	parqExpiring?: boolean,
	/** Enterprise custom-fields: member has a value containing `value` on this field. */
	customField?: { fieldId: string; value: string },
	retentionExempt?: boolean,
	doorBlocked?: boolean
) {
	const [parqS] = await db
		.select({ parqMonths: gymSettings.parqMonths })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const parqMonths = parqS?.parqMonths ?? 0;
	const term = q?.trim();
	const [st] = noWaiver
		? await db
				.select({ waiver: gymSettings.waiver })
				.from(gymSettings)
				.where(eq(gymSettings.organizationId, orgId))
				.limit(1)
		: [undefined];
	return db
		.select({
			id: gymMember.id,
			name: gymMember.name,
			email: gymMember.email,
			phone: gymMember.phone,
			status: gymMember.status,
			joinedAt: gymMember.joinedAt,
			photoDocumentId: gymMember.photoDocumentId,
			portalUserId: gymMember.portalUserId,
			parqSignedAt: gymMember.parqSignedAt,
			deskNote: gymMember.deskNote,
			referralSource: gymMember.referralSource,
			guardianId: gymMember.guardianId,
			locationName: location.name,
			tags: sql<
				string[]
			>`coalesce((select array_agg(t.tag order by t.tag) from ${memberTag} t where t.member_id = ${outer(gymMember.id)}), '{}')`,
			openBalance:
				sql<number>`coalesce((select sum(c.amount - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id and p.organization_id = c.organization_id and p.member_id = c.member_id and p.refunded_at is null), 0)) from ${charge} c where c.member_id = ${outer(gymMember.id)} and c.organization_id = ${outer(gymMember.organizationId)} and c.status = 'open'), 0)`.mapWith(
					Number
				),
			planName: sql<
				string | null
			>`(select p2.name from ${membership} m2 join ${plan} p2 on p2.id = m2.plan_id where m2.member_id = ${outer(gymMember.id)} and m2.status = 'active' order by m2.created_at desc limit 1)`,
			/** Dependents can book from a guardian's membership — the picker's
			 * eligibility gate needs to know without a second query. */
			guardianPlanName: sql<
				string | null
			>`(select p3.name from ${membership} m3 join ${plan} p3 on p3.id = m3.plan_id join ${gymMember} g on g.guardian_id = m3.member_id join ${gymMember} guardian on guardian.id = g.guardian_id where g.id = ${outer(gymMember.id)} and g.organization_id = ${outer(gymMember.organizationId)} and guardian.organization_id = ${outer(gymMember.organizationId)} and m3.organization_id = ${outer(gymMember.organizationId)} and p3.organization_id = ${outer(gymMember.organizationId)} and m3.status = 'active' order by m3.created_at desc limit 1)`,
			lastVisit: sql<Date | null>`(select max(c.checked_at) from ${checkIn} c where c.member_id = ${outer(gymMember.id)})`,
			/** Guardian member's name (dependents only) — family exports need it. */
			guardianName: sql<
				string | null
			>`(select g3.name from ${gymMember} g3 where g3.id = ${outer(gymMember.guardianId)} and g3.organization_id = ${outer(gymMember.organizationId)})`,
			/** Enterprise custom-field values keyed by field id — powers the CSV's dynamic columns. */
			customFields: sql<
				Record<string, string>
			>`coalesce((select jsonb_object_agg(mfv.field_id, mfv.value) from member_field_value mfv where mfv.member_id = ${outer(gymMember.id)}), '{}'::jsonb)`,
			/** Nearest end date of an active membership (pack expiry or commitment end); null = open-ended. */
			memberEnds: sql<Date | null>`(select m6.ends_at from ${membership} m6 where m6.member_id = ${outer(gymMember.id)} and m6.status = 'active' and m6.ends_at is not null order by m6.ends_at asc limit 1)`,
			/** Member's own visits in the trailing 30 days (excludes their guest check-ins). */
			visits30:
				sql<number>`(select count(*)::int from ${checkIn} c where c.member_id = ${outer(gymMember.id)} and c.guest_name is null and c.checked_at > ${new Date(Date.now() - 30 * 86_400_000).toISOString()})`.mapWith(
					Number
				)
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
					? sql`exists (select 1 from ${charge} c where c.member_id = ${outer(gymMember.id)} and c.organization_id = ${outer(gymMember.organizationId)} and c.status = 'open' and c.amount > coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id and p.organization_id = c.organization_id and p.member_id = c.member_id and p.refunded_at is null), 0))`
					: undefined,
				suspended
					? sql`exists (select 1 from ${membership} m4 where m4.member_id = ${gymMember.id} and m4.status = 'suspended')`
					: undefined,
				noContact ? and(isNull(gymMember.email), isNull(gymMember.phone)) : undefined,
				unsubscribed ? isNotNull(gymMember.unsubscribedAt) : undefined,
				referred ? isNotNull(gymMember.referredByMemberId) : undefined,
				customField?.value.trim()
					? sql`exists (select 1 from member_field_value mfv where mfv.member_id = ${gymMember.id} and mfv.field_id = ${customField.fieldId} and mfv.value ilike ${'%' + customField.value.trim() + '%'})`
					: undefined,
				neverBooked
					? sql`not exists (select 1 from booking b where b.member_id = ${gymMember.id})`
					: undefined,
				endingSoon
					? sql`exists (select 1 from membership m5 where m5.member_id = ${gymMember.id} and m5.status = 'active' and m5.ends_at is not null and m5.ends_at >= now() and m5.ends_at <= now() + interval '30 days')`
					: undefined,
				noWaiver && st?.waiver
					? sql`not exists (select 1 from waiver w where w.member_id = ${gymMember.id} and w.text = ${st.waiver})`
					: undefined,
				onWaitlist
					? sql`exists (select 1 from booking b6 join class_session s6 on s6.id = b6.session_id where b6.member_id = ${gymMember.id} and b6.status = 'waitlisted' and s6.starts_at > now())`
					: undefined,
				paused
					? sql`exists (select 1 from membership m8 where m8.member_id = ${gymMember.id} and m8.status = 'paused')`
					: undefined,
				noUpcoming
					? sql`not exists (select 1 from booking b7 join class_session s7 on s7.id = b7.session_id where b7.member_id = ${gymMember.id} and b7.status = 'booked' and s7.starts_at > now())`
					: undefined,
				comped
					? sql`exists (select 1 from membership m9 where m9.member_id = ${gymMember.id} and m9.status = 'active' and m9.no_bill)`
					: undefined,
				packExpiring
					? sql`exists (select 1 from membership m10 join plan p10 on p10.id = m10.plan_id where m10.member_id = ${gymMember.id} and m10.status = 'active' and p10.is_pack and m10.ends_at is not null and m10.ends_at >= now() and m10.ends_at <= now() + interval '14 days')`
					: undefined,
				insideNow
					? sql`exists (select 1 from check_in c10 where c10.member_id = ${gymMember.id} and c10.checked_out_at is null)`
					: undefined,
				hasLocker
					? sql`exists (select 1 from locker l10 where l10.member_id = ${gymMember.id})`
					: undefined,
				lowCredits
					? sql`exists (select 1 from membership m11 join plan p11 on p11.id = m11.plan_id where m11.member_id = ${gymMember.id} and m11.status = 'active' and p11.is_pack and p11.class_credits is not null and (select count(*) from booking b11 join class_session s11 on s11.id = b11.session_id where b11.membership_id = m11.id and b11.status in ('booked','attended','no_show') and s11.cancelled_at is null) >= p11.class_credits - 1)`
					: undefined,
				autoRenew
					? sql`exists (select 1 from membership m12 where m12.member_id = ${gymMember.id} and m12.status = 'active' and m12.auto_renew)`
					: undefined,
				cancelRequested
					? sql`exists (select 1 from membership m13 where m13.member_id = ${gymMember.id} and m13.cancel_requested_at is not null)`
					: undefined,
				pauseRequested
					? sql`exists (select 1 from membership m14 where m14.member_id = ${gymMember.id} and m14.status = 'active' and m14.pause_requested_at is not null)`
					: undefined,
				retentionExempt ? eq(gymMember.retentionExempt, true) : undefined,
				doorBlocked ? eq(gymMember.doorBlocked, true) : undefined,
				noPortal ? isNull(gymMember.portalUserId) : undefined,
				noBirthday ? isNull(gymMember.birthday) : undefined,
				noPhoto ? isNull(gymMember.photoDocumentId) : undefined,
				hasCompCredits
					? sql`exists (select 1 from membership m15 where m15.member_id = ${gymMember.id} and m15.status = 'active' and m15.bonus_credits > 0)`
					: undefined,
				inChallenge
					? sql`exists (select 1 from challenge_entry ce join challenge ch on ch.id = ce.challenge_id where ce.member_id = ${gymMember.id} and ch.active)`
					: undefined,
				hasDependents
					? sql`exists (select 1 from gym_member d where d.guardian_id = ${gymMember.id})`
					: undefined,
				visitedThisWeek
					? sql`exists (select 1 from ${checkIn} c where c.member_id = ${gymMember.id} and c.checked_at > ${new Date(Date.now() - 7 * 86_400_000).toISOString()})`
					: undefined,
				isReferrer
					? sql`exists (select 1 from gym_member r where r.referred_by_member_id = ${gymMember.id})`
					: undefined,
				inCourse
					? sql`exists (select 1 from course_enrollment ce join course c2 on c2.id = ce.course_id where ce.member_id = ${gymMember.id} and ce.waitlisted = false and c2.ends_on >= ${new Date().toISOString().slice(0, 10)})`
					: undefined,
				dueSoon
					? sql`exists (select 1 from charge c3 where c3.member_id = ${gymMember.id} and c3.status = 'open' and c3.due_date <= ${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)})`
					: undefined,
				hasUpcoming
					? sql`exists (select 1 from ${booking} b4 join ${classSession} s4 on s4.id = b4.session_id where b4.member_id = ${gymMember.id} and b4.status = 'booked' and s4.starts_at > now())`
					: undefined,
				commitmentEnding
					? sql`exists (select 1 from membership m16 join plan p16 on p16.id = m16.plan_id where m16.member_id = ${gymMember.id} and m16.status = 'active' and p16.commitment_months > 0 and m16.created_at + (p16.commitment_months || ' months')::interval > now() and m16.created_at + (p16.commitment_months || ' months')::interval <= ${new Date(Date.now() + 30 * 86_400_000).toISOString()})`
					: undefined,
				isDependent ? isNotNull(gymMember.guardianId) : undefined,
				noEmergency
					? or(isNull(gymMember.emergencyPhone), eq(gymMember.emergencyPhone, ''))
					: undefined,
				hasProgram
					? sql`exists (select 1 from member_program mp where mp.member_id = ${gymMember.id} and mp.status = 'active')`
					: undefined,
				hasGiftBalance
					? sql`exists (select 1 from gift_card gc where gc.redeemed_by_member_id = ${gymMember.id} and gc.balance > 0)`
					: undefined,
				trialEnding
					? sql`exists (select 1 from membership m17 join plan p17 on p17.id = m17.plan_id where m17.member_id = ${gymMember.id} and m17.status = 'active' and p17.trial_days > 0 and m17.next_charge_at <= ${new Date(Date.now() + 3 * 86_400_000).toISOString()} and not exists (select 1 from charge c4 where c4.membership_id = m17.id))`
					: undefined,
				bookedToday
					? sql`exists (select 1 from booking b5 join class_session s5 on s5.id = b5.session_id where b5.member_id = ${gymMember.id} and b5.status = 'booked' and s5.starts_at >= date_trunc('day', now()) and s5.starts_at < date_trunc('day', now()) + interval '1 day')`
					: undefined,
				hasIssue
					? sql`exists (select 1 from member_issue mi where mi.member_id = ${gymMember.id} and mi.resolved_at is null)`
					: undefined,
				inEvent
					? sql`exists (select 1 from event_registration er join gym_event ge on ge.id = er.event_id where er.member_id = ${gymMember.id} and er.status = 'registered' and er.waitlisted = false and ge.starts_at > now())`
					: undefined,
				noHealthForm && parqMonths > 0
					? or(
							isNull(gymMember.parqSignedAt),
							lt(gymMember.parqSignedAt, new Date(Date.now() - parqMonths * 30.4 * 86400_000))
						)
					: noHealthForm
						? isNull(gymMember.parqSignedAt)
						: undefined,
				// Signed but expires within 30 days (renewal-pitch window).
				parqExpiring && parqMonths > 0
					? and(
							gte(gymMember.parqSignedAt, new Date(Date.now() - parqMonths * 30.4 * 86400_000)),
							lte(
								gymMember.parqSignedAt,
								new Date(Date.now() - (parqMonths * 30.4 - 30) * 86400_000)
							)
						)
					: undefined,
				recent
					? gte(
							gymMember.joinedAt,
							new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
						)
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
		// 'Former member' is the anonymize scrub — every erased member shares it,
		// so it's never a duplicate signal (email is nulled by the scrub anyway).
		const keys = [
			r.email ? `e:${r.email.trim().toLowerCase()}` : null,
			r.name === 'Former member' ? null : `n:${r.name.trim().toLowerCase().replace(/\s+/g, ' ')}`
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

/** Bulk-mark members inactive — reversible, keeps all history. */
export async function setMembersInactive(ctx: OrgContext, memberIds: string[]) {
	const rows = await db
		.update(gymMember)
		.set({ status: 'inactive', updatedAt: new Date() })
		.where(
			and(
				eq(gymMember.organizationId, ctx.orgId),
				inArray(gymMember.id, memberIds),
				eq(gymMember.status, 'active')
			)
		)
		.returning({ id: gymMember.id });
	if (rows.length)
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId ?? null,
			entityType: 'gym_member',
			entityId: rows[0].id,
			action: 'bulk_set_inactive',
			summary: `${rows.length} member${rows.length === 1 ? '' : 's'} marked inactive`
		});
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
		.select({
			member: gymMember,
			locationName: location.name,
			orgName: organization.name,
			orgSlug: organization.slug
		})
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
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.organization_id = ${outer(charge.organizationId)} and p.member_id = ${outer(charge.memberId)} and p.refunded_at is null), 0)`.mapWith(
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

	const [parqS] = await db
		.select({ parqMonths: gymSettings.parqMonths })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);

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
		signRequests,
		workoutLogs,
		issues,
		topClass
	] = await Promise.all([
		db
			.select({
				visits: sql<number>`count(*) filter (where ${checkIn.guestName} is null)`.mapWith(Number),
				thisMonth:
					sql<number>`count(*) filter (where ${checkIn.guestName} is null and ${checkIn.checkedAt} >= date_trunc('month', now()))`.mapWith(
						Number
					),
				firstVisit: sql<Date | null>`min(${checkIn.checkedAt}) filter (where ${checkIn.guestName} is null)`,
				lastVisit: sql<Date | null>`max(${checkIn.checkedAt}) filter (where ${checkIn.guestName} is null)`
			})
			.from(checkIn)
			.where(and(eq(checkIn.organizationId, orgId), eq(checkIn.memberId, id))),
		db
			.select({
				attended: sql<number>`count(*) filter (where ${booking.status} = 'attended')`.mapWith(
					Number
				),
				noShows: sql<number>`count(*) filter (where ${booking.status} = 'no_show')`.mapWith(Number),
				thisMonth:
					sql<number>`count(*) filter (where ${booking.status} != 'cancelled' and ${classSession.startsAt} >= date_trunc('month', now()))`.mapWith(
						Number
					),
				waitlisted:
					sql<number>`count(*) filter (where ${booking.status} = 'waitlisted' and ${classSession.startsAt} > now())`.mapWith(
						Number
					),
				thisWeek:
					sql<number>`count(*) filter (where ${booking.status} != 'cancelled' and ${classSession.startsAt} >= date_trunc('week', now()) and ${classSession.startsAt} < date_trunc('week', now()) + interval '1 week')`.mapWith(
						Number
					)
			})
			.from(booking)
			.innerJoin(classSession, eq(booking.sessionId, classSession.id))
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
					.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, row.member.guardianId)))
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
			.limit(25),
		db
			.select()
			.from(workoutLog)
			.where(and(eq(workoutLog.organizationId, orgId), eq(workoutLog.memberId, id)))
			.orderBy(desc(workoutLog.day), desc(workoutLog.createdAt))
			.limit(10),
		db
			.select()
			.from(memberIssue)
			.where(and(eq(memberIssue.organizationId, orgId), eq(memberIssue.memberId, id)))
			.orderBy(desc(memberIssue.createdAt))
			.limit(15),
		db
			.select({ name: classType.name })
			.from(booking)
			.innerJoin(classSession, eq(booking.sessionId, classSession.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(and(eq(booking.organizationId, orgId), eq(booking.memberId, id)))
			.groupBy(classType.name)
			.orderBy(desc(sql`count(*)`))
			.limit(1)
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
	const mweeks = new Set(
		streakVisits.map((v) => mweekOf(localDate(v.checkedAt, stz?.tz ?? 'UTC')))
	);
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

	// "Usually visits" — top dow/hour combos from the member's check-in history
	// (org timezone so 6pm means 6pm at the gym).
	const tzLit = sql`${stz?.tz ?? 'UTC'}`;
	const usualTimes = await db
		.select({
			dow: sql<number>`extract(dow from ${checkIn.checkedAt} at time zone ${tzLit})`.mapWith(
				Number
			),
			hour: sql<number>`extract(hour from ${checkIn.checkedAt} at time zone ${tzLit})`.mapWith(
				Number
			),
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(checkIn)
		.where(
			and(eq(checkIn.organizationId, orgId), eq(checkIn.memberId, id), isNull(checkIn.guestName))
		)
		.groupBy(sql`1`, sql`2`)
		.orderBy(desc(sql`3`))
		.limit(3);

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

	const [emailStats] = row.member.email
		? await db
				.select({
					sent: sql<number>`count(*)`.mapWith(Number),
					opened:
						sql<number>`count(*) filter (where ${notificationLog.openedAt} is not null)`.mapWith(
							Number
						)
				})
				.from(notificationLog)
				.where(
					and(
						eq(notificationLog.organizationId, orgId),
						eq(notificationLog.recipient, row.member.email)
					)
				)
		: [{ sent: 0, opened: 0 }];

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
		workoutLogs,
		issues,
		emailStats,
		parqMonths: parqS?.parqMonths ?? 0,
		guestPasses: activeMs?.guestPasses ?? 0,
		guestsUsed: guests?.n ?? 0,
		loyalty: loyaltyTier(att?.visits ?? 0),
		attendance: {
			topClass: topClass[0]?.name ?? null,
			visits: att?.visits ?? 0,
			thisMonth: att?.thisMonth ?? 0,
			firstVisit: att?.firstVisit ?? null,
			lastVisit: att?.lastVisit ?? null,
			usualTimes,
			noShows: bs?.noShows ?? 0,
			bookedMonth: bs?.thisMonth ?? 0,
			bookedWeek: bs?.thisWeek ?? 0,
			waitlisted: bs?.waitlisted ?? 0,
			/** % of attended+no-show bookings the member showed up for; null when no history. */
			showRate:
				(bs?.attended ?? 0) + (bs?.noShows ?? 0) > 0
					? Math.round((100 * (bs?.attended ?? 0)) / ((bs?.attended ?? 0) + (bs?.noShows ?? 0)))
					: null
		}
	};
}

/** Staff resolves an issue a member reported in the portal. */
export async function resolveIssue(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(memberIssue)
		.set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(memberIssue.organizationId, ctx.orgId), eq(memberIssue.id, id)))
		.returning();
	if (!row) error(404, 'Issue not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'member_issue',
		entityId: id,
		action: 'resolved',
		summary: 'Resolved a member-reported issue'
	});
	return row;
}

async function assertGuardian(orgId: string, guardianId: string | null | undefined) {
	if (!guardianId) return;
	const [guardian] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, guardianId)));
	if (!guardian) error(404, 'Guardian not found');
}

export async function createMember(ctx: OrgContext, input: v.InferOutput<typeof s.memberInput>) {
	await assertGuardian(ctx.orgId, input.guardianId);
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
				phone: r.phone ?? null,
				birthday: r.birthday || null
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
	await assertGuardian(ctx.orgId, set.guardianId);
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
	const base = ms.endsAt && ms.endsAt.getTime() > Date.now() ? ms.endsAt.getTime() : Date.now();
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
	notifyPersonalRecord(orgId, row!.id).catch(() => {});
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
				sql`to_char(${checkIn.checkedAt} at time zone ${tz}, 'YYYY-MM') = ${month}`
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
	if (input.memberId && healthFormsEnabled()) {
		// An injury/incident may change what the member should have attested —
		// ask them to re-confirm their health questionnaire.
		void requestParqResign(input.memberId, ctx.orgId, ctx.userId).catch(() => {});
	}
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
	const { donor, recipient, donorMember, remaining } = await db.transaction(async (tx) => {
		await tx
			.select({ id: membership.id })
			.from(membership)
			.where(and(eq(membership.id, fromMembershipId), eq(membership.organizationId, ctx.orgId)))
			.for('update');
		const [donor] = await tx
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
			)
			.for('update', { of: membership });
		if (!donor) error(404, 'Active pack membership not found');
		const recipients = to.memberId
			? await tx
					.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
					.from(gymMember)
					.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, to.memberId)))
					.for('update')
			: await tx
					.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
					.from(gymMember)
					.where(
						and(
							eq(gymMember.organizationId, ctx.orgId),
							eq(sql`lower(${gymMember.email})`, (to.email ?? '').trim().toLowerCase())
						)
					)
					.for('update');
		const [recipient] = recipients;
		if (!recipient) error(404, 'No member with that email at this gym');
		if (recipient.id === donor.ms.memberId) error(400, 'That is already their pack');
		const window = {
			start: donor.ms.startsAt.toISOString().slice(0, 10),
			end: (donor.ms.endsAt ?? new Date()).toISOString().slice(0, 10)
		};
		const used = await creditsUsedIn(ctx.orgId, null, donor.ms.id, window, donor.classTypeId, tx);
		const remaining = donor.classCredits! + donor.ms.bonusCredits - used;
		if (credits > remaining)
			error(400, `Only ${remaining} class${remaining === 1 ? '' : 'es'} left on this pack`);
		const [donorMember] = await tx
			.select({ name: gymMember.name })
			.from(gymMember)
			.where(eq(gymMember.id, donor.ms.memberId));
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
		return { donor, recipient, donorMember, remaining };
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

	const streaks = await weekStreakLeaders(orgId, 5);
	return { records, streaks };
}

/**
 * Top current week-streaks — one year of check-ins grouped by ISO week,
 * streak counted back from this week (or last when this week isn't over).
 */
export async function weekStreakLeaders(orgId: string, limit = 5) {
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
	return [...byMember.entries()]
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
		.slice(0, limit);
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
export async function anonymizeMember(
	ctx: { orgId: string; userId: string | null },
	memberId: string
) {
	const [m] = await db
		.select({ id: gymMember.id, name: gymMember.name, portalUserId: gymMember.portalUserId })
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, ctx.orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	await db
		.update(gymMember)
		.set({
			portalUserId: null,
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
			parqSignedAt: null,
			parqAnswers: null,
			parqHistory: null,
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
	// Local erasure unlinks this membership; the shared login belongs to the user.
	// Health-questionnaire answers and custom-field values are PII too.
	await db
		.delete(memberFieldValue)
		.where(
			and(eq(memberFieldValue.organizationId, ctx.orgId), eq(memberFieldValue.memberId, memberId))
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

/** Saved sign-request document drafts for the member page. */
export async function listSignDocTemplates(orgId: string) {
	return db
		.select()
		.from(signDocTemplate)
		.where(eq(signDocTemplate.organizationId, orgId))
		.orderBy(asc(signDocTemplate.name));
}

export async function saveSignDocTemplate(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.signDocTemplateInput>
) {
	const [row] = await db
		.insert(signDocTemplate)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			title: input.title,
			body: input.body,
			createdBy: ctx.userId ?? null
		})
		.returning();
	return row;
}

export async function deleteSignDocTemplate(orgId: string, id: string) {
	await db
		.delete(signDocTemplate)
		.where(and(eq(signDocTemplate.organizationId, orgId), eq(signDocTemplate.id, id)));
}
