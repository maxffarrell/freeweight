import { createHash, randomBytes } from 'node:crypto';
import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import { BETTER_AUTH_SECRET, FREEWEIGHT_DEMO, FREEWEIGHT_PROFILE_URL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { gymMember, organization, profileLink } from '#lib/server/db/schema.ts';
import { appOrigin } from '#lib/server/email.ts';
import { seal, unseal } from '#lib/server/profile/seal.ts';
import {
	PROFILE_CALLBACK_PATH,
	parseScopes,
	safeNext,
	sharedProfile,
	type SharedProfile
} from '#lib/profile.ts';

/** Install side of Leroa Profile. Sign-in never depends on it; only profile sharing does. */
export const profileHubUrl = (): string | null =>
	FREEWEIGHT_DEMO ? null : (FREEWEIGHT_PROFILE_URL ?? null);

/** What this install asks for: sign-in identity plus shared contact details. */
const REQUESTED_SCOPES = ['identity', 'contact'] as const;

const FLOW_COOKIE = 'suite_profile_flow';
const PREFILL_COOKIE = 'suite_profile_prefill';
const TTL_MS = 10 * 60 * 1000;
const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

type Flow = { s: string; v: string; n: string; u: string | null; k: boolean; e: number };

const secure = () => appOrigin().startsWith('https:');

function readSealed<T extends { e: number }>(cookies: Cookies, name: string): T | null {
	const raw = cookies.get(name);
	if (!raw) return null;
	try {
		const x = JSON.parse(unseal(BETTER_AUTH_SECRET, raw)) as T;
		return typeof x.e === 'number' && x.e > Date.now() ? x : null;
	} catch {
		return null;
	}
}

/** Sends the member to the profile service's consent screen. */
export function startConnect(event: RequestEvent): never {
	const hub = profileHubUrl();
	if (!hub) error(404, "Leroa Profile isn't set up on this site");
	const verifier = randomBytes(32).toString('base64url');
	const flow: Flow = {
		s: randomBytes(16).toString('base64url'),
		v: verifier,
		n: safeNext(event.url.searchParams.get('next')),
		u: event.locals.user?.id ?? null,
		k: event.url.searchParams.get('keep') === '1',
		e: Date.now() + TTL_MS
	};
	event.cookies.set(FLOW_COOKIE, seal(BETTER_AUTH_SECRET, JSON.stringify(flow)), {
		path: '/api/profile',
		httpOnly: true,
		sameSite: 'lax',
		secure: secure(),
		maxAge: TTL_MS / 1000
	});
	const origin = appOrigin();
	const u = new URL('/id/authorize', hub);
	u.searchParams.set('response_type', 'code');
	u.searchParams.set('client_id', origin);
	u.searchParams.set('redirect_uri', origin + PROFILE_CALLBACK_PATH);
	u.searchParams.set('scope', REQUESTED_SCOPES.join(' '));
	u.searchParams.set('state', flow.s);
	u.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
	u.searchParams.set('code_challenge_method', 'S256');
	redirect(303, u.toString(), { external: true });
}

const tokenResponse = v.object({
	access_token: v.pipe(v.string(), v.minLength(1)),
	scope: v.optional(v.string(), ''),
	sub: v.pipe(v.string(), v.minLength(1))
});
const profileResponse = v.object({ scope: v.optional(v.string(), ''), profile: sharedProfile });

async function hubFetch(path: string, init: RequestInit) {
	const hub = profileHubUrl();
	if (!hub) throw new Error('Leroa Profile is not configured');
	return fetch(new URL(path, hub), { ...init, signal: AbortSignal.timeout(10_000) });
}

async function fetchProfile(token: string) {
	const res = await hubFetch('/id/profile', { headers: { authorization: `Bearer ${token}` } });
	if (res.status === 401) return null;
	if (!res.ok) throw new Error(`Leroa Profile returned ${res.status}`);
	return v.parse(profileResponse, await res.json());
}

async function revokeAtHub(token: string) {
	try {
		await hubFetch('/id/revoke', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token })
		});
	} catch (err) {
		console.error('Could not revoke Leroa Profile token', err);
	}
}

function withParam(path: string, key: string, value: string) {
	const [base, hash] = path.split('#');
	const u = new URL(base!, 'http://x');
	u.searchParams.set(key, value);
	return `${u.pathname}${u.search}${hash ? `#${hash}` : ''}`;
}

/**
 * Finishes the consent redirect. A signed-in member keeps the connection only when the
 * flow was started with ?keep=1 (the portal's Connect button). Every other flow — like a
 * booking's one-time fill — reads the profile once and revokes the token straight away.
 */
export async function finishConnect(event: RequestEvent): Promise<never> {
	const { url, cookies } = event;
	const flow = readSealed<Flow>(cookies, FLOW_COOKIE);
	cookies.delete(FLOW_COOKIE, { path: '/api/profile' });
	if (!flow || url.searchParams.get('state') !== flow.s) {
		redirect(303, '/portal?profile=expired');
	}
	if (url.searchParams.get('error') || !url.searchParams.get('code')) {
		redirect(303, withParam(flow.n, 'profile', 'declined'));
	}
	const origin = appOrigin();
	const res = await hubFetch('/id/token', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'authorization_code',
			code: url.searchParams.get('code'),
			code_verifier: flow.v,
			client_id: origin,
			redirect_uri: origin + PROFILE_CALLBACK_PATH
		})
	});
	if (!res.ok) redirect(303, withParam(flow.n, 'profile', 'failed'));
	const token = v.parse(tokenResponse, await res.json());
	const shared = await fetchProfile(token.access_token);
	if (!shared) redirect(303, withParam(flow.n, 'profile', 'failed'));

	const userId = event.locals.user?.id;
	if (flow.k && userId && flow.u === userId) {
		const old = await db.query.profileLink.findFirst({
			where: (l, { eq }) => eq(l.userId, userId)
		});
		const values = {
			hubUrl: profileHubUrl()!,
			accessToken: seal(BETTER_AUTH_SECRET, token.access_token),
			scopes: parseScopes(shared.scope || token.scope),
			data: shared.profile,
			syncedAt: new Date()
		};
		await db
			.insert(profileLink)
			.values({ userId, ...values })
			.onConflictDoUpdate({ target: profileLink.userId, set: values });
		if (old) await revokeAtHub(unseal(BETTER_AUTH_SECRET, old.accessToken));
		await applyToMembers(userId, shared.profile);
	} else {
		await revokeAtHub(token.access_token);
	}
	cookies.set(
		PREFILL_COOKIE,
		seal(BETTER_AUTH_SECRET, JSON.stringify({ p: shared.profile, e: Date.now() + TTL_MS })),
		{ path: '/', httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: TTL_MS / 1000 }
	);
	redirect(303, withParam(flow.n, 'profile', 'connected'));
}

/** Reads (and clears) the profile a member just shared, so a form can be prefilled once. */
export function takePrefill(cookies: Cookies): SharedProfile | null {
	const x = readSealed<{ p: unknown; e: number }>(cookies, PREFILL_COOKIE);
	if (cookies.get(PREFILL_COOKIE)) cookies.delete(PREFILL_COOKIE, { path: '/' });
	if (!x) return null;
	const r = v.safeParse(sharedProfile, x.p);
	return r.success ? r.output : null;
}

/** Copies contact details into the gymMember records the member opted in to keeping up to date. */
async function applyToMembers(userId: string, p: SharedProfile, memberIds?: string[]) {
	const c = p.contact;
	if (!c) return 0;
	const name = `${c.firstName} ${c.lastName}`.trim();
	const set = {
		...(name ? { name } : {}),
		...(c.email ? { email: c.email.toLowerCase() } : {}),
		...(c.phone ? { phone: c.phone } : {})
	};
	if (!Object.keys(set).length) return 0;
	const rows = await db
		.update(gymMember)
		.set(set)
		.where(
			and(
				eq(gymMember.portalUserId, userId),
				memberIds ? inArray(gymMember.id, memberIds) : eq(gymMember.profileSync, true)
			)
		)
		.returning({ id: gymMember.id });
	return rows.length;
}

export async function getLink(userId: string) {
	const link = await db.query.profileLink.findFirst({ where: (l, { eq }) => eq(l.userId, userId) });
	const members = await db
		.select({
			id: gymMember.id,
			orgName: organization.name,
			profileSync: gymMember.profileSync
		})
		.from(gymMember)
		.innerJoin(organization, eq(organization.id, gymMember.organizationId))
		.where(eq(gymMember.portalUserId, userId));
	return {
		hub: profileHubUrl(),
		link: link
			? {
					hubHost: new URL(link.hubUrl).host,
					scopes: link.scopes,
					syncedAt: link.syncedAt,
					createdAt: link.createdAt,
					contact: link.data.contact ?? null
				}
			: null,
		members
	};
}

/** Pulls the latest profile. A revoked or deleted grant drops the local connection. */
export async function syncLink(userId: string) {
	const link = await db.query.profileLink.findFirst({ where: (l, { eq }) => eq(l.userId, userId) });
	if (!link || !profileHubUrl()) return { ok: false as const, reason: 'not_connected' };
	const shared = await fetchProfile(unseal(BETTER_AUTH_SECRET, link.accessToken));
	if (!shared) {
		await disconnect(userId, false);
		return { ok: false as const, reason: 'revoked' };
	}
	await db
		.update(profileLink)
		.set({ data: shared.profile, scopes: parseScopes(shared.scope), syncedAt: new Date() })
		.where(eq(profileLink.userId, userId));
	const updated = await applyToMembers(userId, shared.profile);
	return { ok: true as const, updated };
}

/** Portal visits refresh a connection at most once a day. */
export async function syncIfStale(userId: string) {
	const link = await db.query.profileLink.findFirst({ where: (l, { eq }) => eq(l.userId, userId) });
	if (!link || Date.now() - link.syncedAt.getTime() < SYNC_EVERY_MS) return;
	try {
		await syncLink(userId);
	} catch (err) {
		console.error('Leroa Profile sync failed', err);
	}
}

export async function syncAllProfiles() {
	if (!profileHubUrl()) return { synced: 0, failed: 0 };
	const links = await db.select({ userId: profileLink.userId }).from(profileLink);
	let synced = 0;
	let failed = 0;
	for (const l of links) {
		try {
			if ((await syncLink(l.userId)).ok) synced++;
		} catch (err) {
			failed++;
			console.error(`Leroa Profile sync failed for ${l.userId}`, err);
		}
	}
	return { synced, failed };
}

export async function setMemberSync(userId: string, memberId: string, on: boolean) {
	const [c] = await db
		.update(gymMember)
		.set({ profileSync: on })
		.where(and(eq(gymMember.id, memberId), eq(gymMember.portalUserId, userId)))
		.returning({ id: gymMember.id });
	if (!c) error(404, 'Not found');
	if (on) {
		const link = await db.query.profileLink.findFirst({
			where: (l, { eq }) => eq(l.userId, userId)
		});
		if (link) await applyToMembers(userId, link.data, [memberId]);
	}
}

export async function disconnect(userId: string, revoke = true) {
	const [link] = await db.delete(profileLink).where(eq(profileLink.userId, userId)).returning();
	await db.update(gymMember).set({ profileSync: false }).where(eq(gymMember.portalUserId, userId));
	if (link && revoke) await revokeAtHub(unseal(BETTER_AUTH_SECRET, link.accessToken));
}
