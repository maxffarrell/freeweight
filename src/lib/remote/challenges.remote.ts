import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/challenges.ts';
import { challengeInput, challengeUpdate, idSchema } from '#lib/schemas.ts';

export const getChallenges = query(async () => svc.listChallenges((await requireOrg()).orgId));

export const createChallenge = command(challengeInput, async (input) => {
	const r = await svc.createChallenge(await requireOrg(), input);
	void getChallenges().refresh();
	return r;
});

export const updateChallenge = command(challengeUpdate, async (input) => {
	const r = await svc.updateChallenge(await requireOrg(), input);
	void getChallenges().refresh();
	return r;
});

/** Staff enroll a member into a challenge. Idempotent. */
export const joinMemberChallenge = command(
	v.object({
		challengeId: idSchema,
		memberId: idSchema,
		team: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)))
	}),
	async ({ challengeId, memberId, team }) => {
		const ctx = await requireOrg();
		const r = await svc.joinChallenge(ctx.orgId, challengeId, memberId, ctx.userId, team);
		void getChallenges().refresh();
		return r;
	}
);

/** Staff remove a member from a challenge. */
export const removeMemberChallenge = command(
	v.object({ challengeId: idSchema, memberId: idSchema }),
	async ({ challengeId, memberId }) => {
		const { orgId } = await requireOrg();
		const r = await svc.leaveChallenge(orgId, challengeId, memberId);
		void getChallenges().refresh();
		return r;
	}
);
