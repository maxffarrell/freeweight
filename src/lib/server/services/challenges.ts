import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import {
	challenge,
	challengeEntry,
	checkIn,
	gymMember,
	gymSettings
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { addDays, localDate, zonedToUtc } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

/** Members' check-in counts inside a challenge's local-date window. */
export async function entryProgress(orgId: string, challengeId: string, start: Date, end: Date) {
	return db
		.select({
			entry: challengeEntry,
			memberName: gymMember.name,
			memberEmail: gymMember.email,
			count: sql<number>`count(${checkIn.id})`.mapWith(Number)
		})
		.from(challengeEntry)
		.innerJoin(gymMember, eq(challengeEntry.memberId, gymMember.id))
		.leftJoin(
			checkIn,
			and(
				eq(checkIn.memberId, challengeEntry.memberId),
				eq(checkIn.organizationId, orgId),
				isNull(checkIn.guestName),
				gte(checkIn.checkedAt, start),
				lt(checkIn.checkedAt, end)
			)
		)
		.where(
			and(eq(challengeEntry.organizationId, orgId), eq(challengeEntry.challengeId, challengeId))
		)
		.groupBy(challengeEntry.id, gymMember.name, gymMember.email)
		.orderBy(desc(sql`count(${checkIn.id})`), asc(gymMember.name));
}

/** Per-team rollup of entryProgress — used when a challenge runs in team mode. */
function teamRollup(entries: Awaited<ReturnType<typeof entryProgress>>) {
	const teams = new Map<string, { count: number; members: number }>();
	for (const e of entries) {
		const t = e.entry.team?.trim();
		if (!t) continue;
		const cur = teams.get(t) ?? { count: 0, members: 0 };
		cur.count += e.count;
		cur.members += 1;
		teams.set(t, cur);
	}
	return [...teams.entries()]
		.map(([team, v]) => ({ team, count: v.count, members: v.members }))
		.sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
}

/** All challenges with joined counts + per-entry progress (staff view). */
export async function listChallenges(orgId: string) {
	const [settings, rows] = await Promise.all([
		db
			.select({ timezone: gymSettings.timezone })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1),
		db
			.select()
			.from(challenge)
			.where(eq(challenge.organizationId, orgId))
			.orderBy(desc(challenge.startDate))
	]);
	const tz = settings[0]?.timezone ?? 'UTC';
	const today = localDate(new Date(), tz);
	return Promise.all(
		rows.map(async (c) => {
			const entries = await entryProgress(
				orgId,
				c.id,
				zonedToUtc(`${c.startDate}T00:00`, tz),
				zonedToUtc(`${addDays(c.endDate, 1)}T00:00`, tz)
			);
			return {
				challenge: c,
				state: today < c.startDate ? 'upcoming' : today > c.endDate ? 'ended' : 'live',
				joined: entries.length,
				finished: entries.filter((e) => e.count >= c.goal).length,
				entries,
				teams: c.teamMode ? teamRollup(entries) : []
			};
		})
	);
}

/** Active + upcoming challenges with this member's entry and progress (portal view). */
export async function portalChallenges(orgId: string, memberId: string) {
	const all = await listChallenges(orgId);
	return all
		.filter((c) => c.challenge.active && c.state !== 'ended')
		.map((c) => {
			const mine = c.entries.find((e) => e.entry.memberId === memberId) ?? null;
			return {
				challenge: c.challenge,
				state: c.state,
				joined: c.joined,
				finished: c.finished,
				leaders: c.entries.slice(0, 5).map((e) => ({ name: e.memberName, count: e.count })),
				teams: c.teams.slice(0, 5),
				mine
			};
		});
}

export async function createChallenge(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.challengeInput>
) {
	if (input.endDate < input.startDate) error(400, 'End date is before the start date');
	const [row] = await db
		.insert(challenge)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description ?? '',
			prize: input.prize ?? '',
			goal: input.goal,
			startDate: input.startDate,
			endDate: input.endDate,
			teamMode: input.teamMode ?? false
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'challenge',
		entityId: row!.id,
		action: 'created',
		summary: `Challenge "${row!.name}" created`
	});
	return row;
}

export async function updateChallenge(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.challengeUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(challenge)
		.set({ ...set, updatedAt: new Date() })
		.where(and(eq(challenge.organizationId, ctx.orgId), eq(challenge.id, id)))
		.returning();
	if (!row) error(404, 'Challenge not found');
	return row;
}

/** Enroll a member — staff action and portal self-join share this. Idempotent. */
export async function joinChallenge(
	orgId: string,
	challengeId: string,
	memberId: string,
	actorId?: string,
	team?: string
) {
	const [c] = await db
		.select()
		.from(challenge)
		.where(and(eq(challenge.organizationId, orgId), eq(challenge.id, challengeId)));
	if (!c || !c.active) error(404, 'Challenge not found');
	const [m] = await db
		.select()
		.from(gymMember)
		.where(and(eq(gymMember.organizationId, orgId), eq(gymMember.id, memberId)));
	if (!m) error(404, 'Member not found');
	const [row] = await db
		.insert(challengeEntry)
		.values({ organizationId: orgId, challengeId, memberId, team: team?.trim() || null })
		.onConflictDoNothing()
		.returning();
	if (row) {
		await emit({
			orgId,
			actorId,
			entityType: 'challenge',
			entityId: challengeId,
			action: 'joined',
			summary: `${m.name} joined "${c.name}"${team ? ` (team ${team.trim()})` : ''}`
		});
	}
	return row ?? null;
}

/** Member or staff removes an entry. */
export async function leaveChallenge(orgId: string, challengeId: string, memberId: string) {
	const [row] = await db
		.delete(challengeEntry)
		.where(
			and(
				eq(challengeEntry.organizationId, orgId),
				eq(challengeEntry.challengeId, challengeId),
				eq(challengeEntry.memberId, memberId)
			)
		)
		.returning();
	return row ?? null;
}
