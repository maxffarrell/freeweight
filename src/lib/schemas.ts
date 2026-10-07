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
export const membershipStatuses = ['active', 'paused', 'cancelled'] as const;
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
	joinedAt: v.optional(v.nullable(isoDate))
});
export const memberUpdate = v.object({ id: idSchema, ...v.partial(memberInput).entries });

export const planInput = v.object({
	name: requiredText('Name'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
	amount: cents,
	interval: v.optional(v.picklist(planIntervals), 'month'),
	signupFee: v.optional(cents, 0),
	classCredits: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
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
	status: v.optional(v.picklist(membershipStatuses))
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
	active: v.optional(v.boolean(), true)
});
export const classTypeUpdate = v.object({ id: idSchema, ...v.partial(classTypeInput).entries });

/** Local wall-clock time (`YYYY-MM-DDTHH:mm`) in the workspace timezone. */
const localDateTime = v.pipe(v.string(), v.isoTimestamp('Use YYYY-MM-DDTHH:mm'));

export const sessionInput = v.object({
	classTypeId: idSchema,
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	startsAt: localDateTime,
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	/** Repeat weekly until this ISO date (inclusive). */
	repeatUntil: v.optional(v.nullable(isoDate))
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
	website: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)))
});

export const webhookInput = v.object({
	url: v.pipe(v.string(), v.trim(), v.url('Use a full https:// URL')),
	events: v.array(v.pipe(v.string(), v.trim(), v.maxLength(60)))
});

/** Public join-page form. */
export const joinInput = v.object({
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: optionalText,
	planId: v.optional(v.nullable(idSchema)),
	/** Honeypot: must stay empty. */
	website: v.optional(v.string(), '')
});
