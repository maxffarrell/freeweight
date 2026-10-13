import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { idSchema } from '#lib/schemas.ts';
import { disconnect, getLink, setMemberSync, syncLink } from '#lib/server/profile/client.ts';

export const getProfileLink = query(async () => getLink(requireUser().user.id));

export const setProfileSync = command(
	v.object({ memberId: idSchema, on: v.boolean() }),
	async ({ memberId, on }) => {
		await setMemberSync(requireUser().user.id, memberId, on);
		void getProfileLink().refresh();
	}
);

export const syncProfileNow = command(async () => {
	const r = await syncLink(requireUser().user.id);
	void getProfileLink().refresh();
	return r;
});

export const disconnectProfile = command(async () => {
	await disconnect(requireUser().user.id);
	void getProfileLink().refresh();
});
