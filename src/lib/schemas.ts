import * as v from 'valibot';

const optionalText = v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(5000))));
const requiredText = (label: string) =>
	v.pipe(v.string(), v.trim(), v.nonEmpty(`${label} is required`), v.maxLength(200));
const isoDate = v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD'));
/** Money is sent in cents. */
const cents = v.pipe(v.number(), v.integer(), v.minValue(0));
const emailField = v.optional(
	v.nullable(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email('Invalid email'))]))
);

export const idSchema = v.pipe(v.string(), v.nonEmpty());

export const memberStatuses = ['active', 'inactive'] as const;
export const planIntervals = ['week', 'month', 'year'] as const;
export const membershipStatuses = ['active', 'paused', 'suspended', 'cancelled'] as const;
export const bookingStatuses = [
	'booked',
	'waitlisted',
	'cancelled',
	'attended',
	'no_show'
] as const;
export const chargeKinds = ['membership', 'signup', 'dropin', 'other'] as const;
export const chargeStatuses = ['open', 'paid', 'void'] as const;
export const paymentMethods = ['card', 'cash', 'bank', 'stripe', 'other'] as const;

export const memberInput = v.object({
	name: requiredText('Name'),
	email: emailField,
	phone: optionalText,
	locationId: v.optional(v.nullable(idSchema)),
	status: v.optional(v.picklist(memberStatuses), 'active'),
	notes: optionalText,
	joinedAt: v.optional(v.nullable(isoDate)),
	birthday: v.optional(v.nullable(isoDate)),
	/** Household payer — membership charges post under this member instead. */
	guardianId: v.optional(v.nullable(idSchema))
});
export const memberImportRow = v.object({
	name: requiredText('Name'),
	email: emailField,
	phone: optionalText
});
export const memberImportInput = v.pipe(
	v.array(memberImportRow),
	v.minLength(1),
	v.maxLength(2000)
);

export const memberUpdate = v.object({ id: idSchema, ...v.partial(memberInput).entries });

export const planInput = v.object({
	name: requiredText('Name'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	amount: cents,
	interval: v.optional(v.picklist(planIntervals), 'month'),
	signupFee: v.optional(cents, 0),
	classCredits: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	isPack: v.optional(v.boolean(), false),
	packDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	trialDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	guestPasses: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	commitmentMonths: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	listed: v.optional(v.boolean(), true),
	active: v.optional(v.boolean(), true)
});
export const planUpdate = v.object({ id: idSchema, ...v.partial(planInput).entries });

export const membershipInput = v.object({
	memberId: idSchema,
	planId: idSchema,
	startsAt: v.optional(isoDate)
});
export const membershipUpdate = v.object({
	id: idSchema,
	status: v.optional(v.picklist(membershipStatuses)),
	/** With status 'paused': auto-resume on this date. */
	resumeAt: v.optional(v.nullable(isoDate)),
	/** Staff: clear a member's cancellation request. */
	clearCancelRequest: v.optional(v.boolean()),
	/** Staff: clear a member's pause request. */
	clearPauseRequest: v.optional(v.boolean())
});

export const grantCreditsInput = v.object({
	membershipId: idSchema,
	count: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))
});

export const locationInput = v.object({
	name: requiredText('Name'),
	address: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)), '')
});
export const locationUpdate = v.object({
	id: idSchema,
	...v.partial(locationInput).entries,
	archived: v.optional(v.boolean())
});

export const classTypeInput = v.object({
	name: requiredText('Name'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	color: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20)), ''),
	durationMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(1440)), 60),
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 20),
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	/** Minor units; null/undefined = drop-in bookings aren't sold online. */
	dropInPrice: v.optional(v.nullable(cents)),
	active: v.optional(v.boolean(), true)
});
export const classTypeUpdate = v.object({ id: idSchema, ...v.partial(classTypeInput).entries });

/** Local wall-clock time (`YYYY-MM-DDTHH:mm`) in the workspace timezone. */
const localDateTime = v.pipe(v.string(), v.isoDateTime('Use YYYY-MM-DDTHH:mm'));

export const sessionInput = v.object({
	classTypeId: idSchema,
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	startsAt: localDateTime,
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	/** Repeat weekly until this ISO date (inclusive). */
	repeatUntil: v.optional(v.nullable(isoDate))
});
export const templateInput = v.object({
	classTypeId: idSchema,
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	/** Org-local weekday: 0 = Sunday … 6 = Saturday. */
	weekday: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)),
	/** Org-local `HH:MM`. */
	startTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')),
	capacity: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))))
});

export const sessionUpdate = v.object({
	id: idSchema,
	startsAt: v.optional(localDateTime),
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	cancelled: v.optional(v.boolean())
});

export const bookingInput = v.object({
	sessionId: idSchema,
	memberId: idSchema
});
export const bookingUpdate = v.object({
	id: idSchema,
	status: v.picklist(bookingStatuses)
});

export const checkInInput = v.object({
	/** QR token from the member's portal code, or a member id for a manual check-in. */
	code: requiredText('Code'),
	locationId: v.optional(v.nullable(idSchema))
});

export const guestVisitInput = v.object({
	memberId: idSchema,
	guestName: requiredText('Guest name'),
	locationId: v.optional(v.nullable(idSchema))
});

export const chargeInput = v.object({
	memberId: idSchema,
	kind: v.optional(v.picklist(chargeKinds), 'other'),
	description: optionalText,
	amount: cents,
	dueDate: isoDate
});
export const chargeUpdate = v.object({
	id: idSchema,
	status: v.optional(v.picklist(chargeStatuses)),
	description: optionalText,
	amount: v.optional(cents),
	dueDate: v.optional(isoDate)
});

export const paymentInput = v.object({
	memberId: idSchema,
	chargeId: v.optional(v.nullable(idSchema)),
	amount: v.pipe(v.number(), v.integer(), v.minValue(1)),
	method: v.optional(v.picklist(paymentMethods), 'card'),
	reference: optionalText,
	notes: optionalText
});

export const settingsInput = v.object({
	timezone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
	currency: v.optional(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.length(3))),
	publicPage: v.optional(v.boolean()),
	tagline: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	address: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	phone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50))),
	website: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	waiver: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20000))),
	bookingWindowDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	cancelCutoffMin: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	waitlistCutoffMin: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	maxBookingsPerDay: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	noShowFee: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	lateCancelFee: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	suspendAfterDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))))
});

export const webhookInput = v.object({
	url: v.pipe(v.string(), v.trim(), v.url('Use a full https:// URL')),
	events: v.array(v.pipe(v.string(), v.trim(), v.maxLength(60)))
});

/** Public join-page form. */
export const referralSources = [
	'Friend or family',
	'Google',
	'Instagram',
	'Facebook',
	'Walked by',
	'Other'
] as const;

export const joinInput = v.object({
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: optionalText,
	referralSource: v.optional(v.nullable(v.picklist(referralSources))),
	/** Member id from a ?ref= referral link. */
	referredById: v.optional(v.nullable(idSchema)),
	planId: v.optional(v.nullable(idSchema)),
	agreedWaiver: v.optional(v.boolean(), false),
	/** Honeypot: must stay empty. */
	website: v.optional(v.string(), '')
});

/** Visitor buying a single class on the public page. */
export const dropInInput = v.object({
	sessionId: idSchema,
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: v.optional(optionalText),
	agreedWaiver: v.optional(v.boolean(), false)
});

export const emailRosterInput = v.object({
	sessionId: idSchema,
	subject: requiredText('Subject'),
	message: requiredText('Message')
});

export const announcementInput = v.object({
	subject: requiredText('Subject'),
	message: requiredText('Message'),
	/** Restrict the batch to these members (e.g. the at-risk list); empty = all actives. */
	memberIds: v.optional(v.pipe(v.array(idSchema), v.maxLength(500))),
	/** Restrict the batch to members carrying this tag. */
	tag: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50)))
});

export const memberNoteInput = v.object({
	memberId: idSchema,
	body: v.pipe(requiredText('Note'), v.maxLength(2000))
});

export const memberTagInput = v.object({
	memberId: idSchema,
	tag: v.pipe(requiredText('Tag'), v.maxLength(50))
});
