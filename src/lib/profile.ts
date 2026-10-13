import * as v from 'valibot';

/** What a resident can share from their Leroa Profile. Nothing sensitive (SSN, DOB, screening) lives here. */
export const PROFILE_SCOPES = ['identity', 'contact', 'household', 'pets', 'application'] as const;
export type ProfileScope = (typeof PROFILE_SCOPES)[number];

export const PROFILE_SCOPE_LABELS: Record<ProfileScope, { label: string; description: string }> = {
	identity: {
		label: 'Sign-in identity',
		description: 'Your account id, name and email — lets the install sign you in'
	},
	contact: { label: 'Contact details', description: 'Name, email and phone' },
	household: { label: 'Household', description: 'People who would live with you' },
	pets: { label: 'Pets', description: 'Type, name, breed and weight' },
	application: {
		label: 'Rental application',
		description: 'Current address, employer and monthly income'
	}
};

const text = (max: number) => v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)), '');

const contact = v.object({
	firstName: text(100),
	lastName: text(100),
	email: v.optional(
		v.union([
			v.literal(''),
			v.pipe(v.string(), v.trim(), v.email('Enter a valid email'), v.maxLength(200))
		]),
		''
	),
	phone: text(40)
});
const member = v.object({ name: text(100), relationship: text(60) });
const pet = v.object({ kind: text(40), name: text(60), breed: text(80), weight: text(20) });
const application = v.object({
	currentAddress: text(300),
	employer: text(200),
	monthlyIncome: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000_000))),
		null
	)
});

export const profileData = v.object({
	contact,
	household: v.object({ members: v.pipe(v.array(member), v.maxLength(19)) }),
	pets: v.pipe(v.array(pet), v.maxLength(10)),
	application
});
export type ProfileData = v.InferOutput<typeof profileData>;

/** Returned only when the resident grants the `identity` scope: a stable subject for unified sign-in. */
export const identityClaims = v.object({
	sub: v.pipe(v.string(), v.minLength(1)),
	name: text(200),
	email: v.pipe(v.string(), v.trim(), v.email('Enter a valid email'), v.maxLength(200)),
	emailVerified: v.boolean()
});
export type IdentityClaims = v.InferOutput<typeof identityClaims>;

/** What a hub returns: only the sections the resident agreed to share. */
export const sharedProfile = v.object({
	contact: v.optional(contact),
	household: v.optional(v.object({ members: v.pipe(v.array(member), v.maxLength(19)) })),
	pets: v.optional(v.pipe(v.array(pet), v.maxLength(10))),
	application: v.optional(application),
	identity: v.optional(identityClaims)
});

export type SharedProfile = v.InferOutput<typeof sharedProfile>;

export const blankProfile = (): ProfileData => ({
	contact: { firstName: '', lastName: '', email: '', phone: '' },
	household: { members: [] },
	pets: [],
	application: { currentAddress: '', employer: '', monthlyIncome: null }
});

export function parseScopes(raw: string | null | undefined): ProfileScope[] {
	const want = new Set((raw ?? '').split(/[\s,]+/));
	return PROFILE_SCOPES.filter((s) => want.has(s));
}

export function shareProfile(profile: ProfileData, scopes: readonly ProfileScope[]): SharedProfile {
	const out: SharedProfile = {};
	for (const s of scopes) {
		if (s === 'contact') out.contact = profile.contact;
		if (s === 'household') out.household = profile.household;
		if (s === 'pets') out.pets = profile.pets;
		if (s === 'application') out.application = profile.application;
	}
	return out;
}

export function petsText(pets: ProfileData['pets']) {
	return pets
		.map((p) => {
			const extra = [p.breed, p.weight].filter(Boolean).join(', ');
			const head = [p.kind, p.name].filter(Boolean).join(': ');
			return extra ? `${head} (${extra})` : head;
		})
		.filter(Boolean)
		.join('; ');
}

/** Rental application fields a shared profile can fill in. Only returns what the profile has. */
export function applicationPrefill(p: SharedProfile) {
	const out: Partial<{
		firstName: string;
		lastName: string;
		email: string;
		phone: string;
		occupants: number;
		pets: string;
		employer: string;
		monthlyIncome: number | null;
		currentAddress: string;
	}> = {};
	const set = <K extends keyof typeof out>(k: K, val: (typeof out)[K] | undefined) => {
		if (val !== undefined && val !== '' && val !== null) out[k] = val;
	};
	set('firstName', p.contact?.firstName);
	set('lastName', p.contact?.lastName);
	set('email', p.contact?.email);
	set('phone', p.contact?.phone);
	if (p.household) out.occupants = Math.min(20, 1 + p.household.members.length);
	if (p.pets) set('pets', petsText(p.pets).slice(0, 500));
	set('employer', p.application?.employer);
	set('monthlyIncome', p.application?.monthlyIncome);
	set('currentAddress', p.application?.currentAddress);
	return out;
}

export const PROFILE_FILE_FORMAT = 'leroa-profile';

export function profileFile(profile: ProfileData) {
	return { format: PROFILE_FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), profile };
}

const profileFileSchema = v.object({
	format: v.literal(PROFILE_FILE_FORMAT),
	version: v.literal(1),
	profile: profileData
});

export function parseProfileFile(json: unknown): ProfileData | null {
	const r = v.safeParse(profileFileSchema, json);
	return r.success ? r.output.profile : null;
}

const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/** A client id is the install's own origin: https, or http on localhost for development. */
export function validClientId(raw: string | null): string | null {
	if (!raw) return null;
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	if (u.origin !== raw) return null;
	if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocalHost(u.hostname)))
		return u.origin;
	return null;
}

export const PROFILE_CALLBACK_PATH = '/api/profile/callback';

/**
 * Installs register nothing: the redirect must stay on the install's own origin.
 * Any path is allowed (the profile callback for sharing, the auth callback for
 * unified sign-in); codes are single-use and PKCE-bound either way.
 */
export function validRedirect(clientId: string, raw: string | null): boolean {
	if (!raw) return false;
	try {
		return new URL(raw).origin === clientId;
	} catch {
		return false;
	}
}

/** Only same-site relative paths, so the connect flow can't be used as an open redirect. */
export function safeNext(raw: string | null, fallback = '/portal') {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
	return raw;
}
