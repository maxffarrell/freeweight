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
	/** Short front-desk flag — shown on the kiosk check-in screen. */
	deskNote: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
	joinedAt: v.optional(v.nullable(isoDate)),
	birthday: v.optional(v.nullable(isoDate)),
	/** Household payer — membership charges post under this member instead. */
	/** Emergency contact. */
	emergencyName: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(80)))),
	emergencyPhone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(30)))),
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
	/** Pack-only: restricts the pack's credits to one class type; null = any class. */
	classTypeId: v.optional(v.nullable(idSchema)),
	packDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	trialDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	guestPasses: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	commitmentMonths: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	earlyCancelFeeCents: v.optional(v.nullable(cents)),
	memberLimit: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	bookAheadDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	listed: v.optional(v.boolean(), true),
	active: v.optional(v.boolean(), true)
});
export const planUpdate = v.object({
	id: idSchema,
	...v.partial(planInput).entries,
	/** On a price change: lock current members' recurring rate instead of repricing them. */
	grandfatherPrice: v.optional(v.boolean())
});

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
	clearPauseRequest: v.optional(v.boolean()),
	/** Staff: move the membership to another plan; new price applies from the next charge. */
	planId: v.optional(v.nullable(idSchema)),
	/** With planId: also post the prorated price difference for the rest of this period. */
	prorate: v.optional(v.boolean()),
	/** Staff: custom recurring price in minor units; null clears the override. */
	price: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	/** Pack memberships: renew automatically when the pack runs out or expires. */
	autoRenew: v.optional(v.boolean()),
	/** Comp'd membership — billing cron never charges it. */
	noBill: v.optional(v.boolean())
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
	/** Minor units the instructor earns per session; null = unrated. */
	payRate: v.optional(v.nullable(cents)),
	/** Cron cancels sessions below this enrollment the day before; null = never. */
	minEnrollment: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Max waitlist depth per session; null = unlimited, 0 = no waitlist. */
	waitlistLimit: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	/** Minutes before start that member booking closes; null = the gym-wide setting. */
	bookCutoffMin: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	/** false = members can't self-book in the portal; staff bookings unaffected. */
	memberBookable: v.optional(v.boolean(), true),
	minLevelId: v.optional(v.nullable(idSchema)),
	active: v.optional(v.boolean(), true)
});
export const classTypeUpdate = v.object({ id: idSchema, ...v.partial(classTypeInput).entries });

/** A bookable amenity (sauna, court, child care). */
const timeHM = v.pipe(v.string(), v.regex(/^\d{2}:\d{2}$/, 'Use HH:MM'));
export const resourceInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name required'), v.maxLength(80)),
	kind: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	slotMin: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(480)),
	capacity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
	openFrom: timeHM,
	openTo: timeHM,
	locationId: v.optional(v.nullable(idSchema)),
	active: v.optional(v.boolean(), true),
	/** 'open' | 'maintenance' | 'closed' — non-open blocks every new booking. */
	status: v.optional(v.picklist(['open', 'maintenance', 'closed']), 'open'),
	/** Short "why" shown to members while the amenity isn't open. */
	statusNote: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	/** Minutes blocked after each booking for cleaning/reset (0 = back-to-back). */
	bufferMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(120)), 0)
});
export const resourceUpdate = v.object({ id: idSchema, ...v.partial(resourceInput).entries });

/** A tracked piece of facility equipment (treadmill, rower, cable machine). */
export const equipmentInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name required'), v.maxLength(80)),
	kind: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	locationId: v.optional(v.nullable(idSchema)),
	status: v.optional(v.picklist(['operational', 'maintenance', 'out_of_order']), 'operational'),
	notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300))),
	servicedOn: v.optional(v.nullable(isoDate)),
	nextServiceOn: v.optional(v.nullable(isoDate))
});
export const equipmentUpdate = v.object({
	id: idSchema,
	...v.partial(equipmentInput).entries
});

/** Slot availability for one org-local date. */
export const resourceDayInput = v.object({ resourceId: idSchema, day: isoDate });

/** Member self-booking a resource slot. */
export const resourceBookInput = v.object({
	memberId: idSchema,
	resourceId: idSchema,
	day: isoDate,
	time: timeHM,
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120)))
});

/** A gym closure day. */
export const closureInput = v.object({
	date: isoDate,
	reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), '')
});

/** Local wall-clock time (`YYYY-MM-DDTHH:mm`) in the workspace timezone. */
const localDateTime = v.pipe(v.string(), v.isoDateTime('Use YYYY-MM-DDTHH:mm'));

/** A one-off gym event — seminar, comp, bring-a-friend day. */
export const eventInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name required'), v.maxLength(80)),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500))),
	locationId: v.optional(v.nullable(idSchema)),
	/** Local wall-clock start (`YYYY-MM-DDTHH:mm`) in the workspace timezone. */
	startsAt: localDateTime,
	durationMin: v.pipe(v.number(), v.integer(), v.minValue(15), v.maxValue(24 * 60)),
	capacity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
	/** Signup price in cents; null/0 = free. */
	price: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	memberBookable: v.optional(v.boolean(), true),
	minLevelId: v.optional(v.nullable(idSchema)),
	active: v.optional(v.boolean(), true)
});
/** Times aren't editable — recreate the event (registrations keep the old row). */
export const eventUpdate = v.object({
	id: idSchema,
	...v.partial(v.omit(eventInput, ['startsAt', 'durationMin'])).entries
});

export const challengeInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name required'), v.maxLength(80)),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500))),
	/** What finishers win — e.g. "a free month". */
	prize: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	/** Check-ins needed to finish. */
	goal: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
	startDate: isoDate,
	endDate: isoDate,
	active: v.optional(v.boolean(), true)
});
export const challengeUpdate = v.object({
	id: idSchema,
	...v.partial(challengeInput).entries
});

export const sessionInput = v.object({
	classTypeId: idSchema,
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	startsAt: localDateTime,
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	/** Per-session duration override; defaults to the class type's durationMin. */
	durationMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	/** Repeat weekly until this ISO date (inclusive). */
	repeatUntil: v.optional(v.nullable(isoDate)),
	note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))))
});
export const templateInput = v.object({
	classTypeId: idSchema,
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	/** Org-local weekday: 0 = Sunday … 6 = Saturday. */
	weekday: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)),
	/** Org-local `HH:MM`. */
	startTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')),
	capacity: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Last date sessions are generated for (inclusive); null = runs forever. */
	until: v.optional(v.nullable(isoDate))
});

/** Same fields as templateInput plus the row id — the form always submits all values. */
export const templateUpdate = v.object({ id: idSchema, ...templateInput.entries });

export const sessionUpdate = v.object({
	id: idSchema,
	startsAt: v.optional(localDateTime),
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	/** Recomputes endsAt from the session's start time. */
	durationMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	locationId: v.optional(v.nullable(idSchema)),
	instructorId: v.optional(v.nullable(idSchema)),
	cancelled: v.optional(v.boolean()),
	/** On cancel: try re-booking 'booked' members into the next session of this class. */
	rebookNext: v.optional(v.boolean()),
	/** Flag/unflag the session as needing a substitute instructor. */
	needsCover: v.optional(v.boolean()),
	note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
	/** Workout of the day shown to booked members (multi-line ok). */
	workout: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))))
});

/** Live instructor double-booking check for the session dialogs. */
export const instructorConflictInput = v.object({
	instructorId: idSchema,
	startsAt: localDateTime,
	durationMin: v.pipe(v.number(), v.integer(), v.minValue(1)),
	/** Also check weekly recurrences through this date (the create dialog's repeat). */
	repeatUntil: v.optional(v.nullable(isoDate)),
	excludeSessionId: v.optional(idSchema)
});

/** Instructor self-reported time-off window (inclusive org-local dates). */
export const timeOffInput = v.object({
	startDate: isoDate,
	endDate: isoDate,
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120)))
});

/** Instructor's recurring weekly availability — replaces their whole set. */
export const availabilityInput = v.object({
	windows: v.pipe(
		v.array(
			v.object({
				weekday: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)),
				startTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')),
				endTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'))
			})
		),
		v.maxLength(30)
	)
});

/** Admin-set weekly rota for one staff member — replaces their whole set. */
export const rotaInput = v.object({
	memberId: idSchema,
	windows: v.pipe(
		v.array(
			v.object({
				weekday: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)),
				startTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')),
				endTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'))
			})
		),
		v.maxLength(30)
	)
});

/** Member's rating of a class they attended (portal). */
export const sessionFeedbackInput = v.object({
	sessionId: idSchema,
	memberId: idSchema,
	rating: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
	comment: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)))
});

export const bookingInput = v.object({
	sessionId: idSchema,
	memberId: idSchema,
	/** Staff: sell a drop-in — posts the class's drop-in charge; no membership required. */
	dropIn: v.optional(v.boolean()),
	/** Extra spots held for the member's guests — passes first, then drop-in priced. */
	guests: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(5)))
});
/** Book a member into every upcoming session of a class type for N weeks. */
export const seriesBookingInput = v.object({
	memberId: idSchema,
	classTypeId: idSchema,
	weeks: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)), 4)
});

/** "Kate is leaving" — reassign (toId) or cancel every future session an
 * instructor teaches; optional classTypeId scopes it to one class. */
export const instructorHandoffInput = v.object({
	fromId: idSchema,
	classTypeId: v.optional(v.string()),
	toId: v.optional(v.string()),
	cancel: v.optional(v.boolean(), false)
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
	dueDate: isoDate,
	cogsCents: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))))
});
/** One manual charge posted to every member with an active membership. */
export const bulkChargeInput = v.object({
	description: requiredText('Description'),
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

export const recurringChargeInput = v.object({
	memberId: idSchema,
	description: requiredText('Description'),
	amount: cents,
	interval: v.optional(v.picklist(planIntervals), 'month'),
	/** First posting date (gym-local YYYY-MM-DD). */
	nextDue: isoDate
});
export const recurringChargeUpdate = v.object({
	id: idSchema,
	active: v.optional(v.boolean()),
	nextDue: v.optional(isoDate)
});

export const giftCardSale = v.object({
	memberId: idSchema,
	amount: cents,
	note: v.optional(v.string(), '')
});
export const shopItemInput = v.object({
	name: requiredText('Item name'),
	price: cents,
	/** Units on hand; omit/null = untracked. */
	stock: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99999)))),
	/** Staff alert when stock drops to this level; null = never. */
	lowStockAt: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99999)))
	),
	/** Unit cost in cents — feeds shop COGS/margin; null = untracked. */
	cost: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99999999))))
});

export const shopItemUpdate = v.object({
	id: idSchema,
	name: v.optional(requiredText('Item name')),
	price: v.optional(cents),
	stock: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99999)))),
	lowStockAt: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99999)))
	),
	cost: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99999999)))
	),
	active: v.optional(v.boolean())
});

/** A front-desk sale — posts a charge (or charge + payment when paid now). */
export const saleInput = v.object({
	itemId: idSchema,
	memberId: idSchema,
	qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
	payNow: v.optional(v.boolean(), false),
	method: v.optional(v.picklist(paymentMethods), 'card')
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
	portalNotice: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500))),
	staffBriefing: v.optional(v.boolean()),
	firstClassFree: v.optional(v.boolean()),
	bookingWindowDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	cancelCutoffMin: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	bookCutoffMin: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	waitlistCutoffMin: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	maxBookingsPerDay: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	noShowFee: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	lateCancelFee: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Single-day pass price in minor units; null = not sold on the public page. */
	dayPassPrice: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	suspendAfterDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	referralCredits: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Retention: % off the next bill offered when a member requests cancel; null = no offer. */
	saveOfferPct: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)))
	),
	/** Max people inside at once; null = no cap. */
	occupancyCap: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** One-time charge when a membership is paused; null/0 = free to freeze. */
	freezeFee: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Review link (Google/Yelp) sent to members after `reviewAfterVisits` visits; null = off. */
	reviewUrl: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.url(), v.maxLength(300)))),
	/** Lifetime attended visits that triggers a once-per-member review request; null = off. */
	/** Comp classes granted at each check-in milestone; null/0 = off. */
	rewardCredits: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)))
	),
	streakRewardCredits: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)))
	),
	lateCancelFreebies: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)))
	),
	reviewAfterVisits: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)))
	),
	/** Monthly revenue goal in minor units for the Reports progress bar; null = off. */
	revenueTarget: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	/** Weekly opening hours {weekday: 'HH:MM-HH:MM'}; '' = closed that day. */
	openHours: v.optional(v.record(v.string(), v.pipe(v.string(), v.trim(), v.maxLength(11))))
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

export const promoCodeInput = v.object({
	code: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(2),
		v.maxLength(50),
		v.regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only')
	),
	percentOff: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)))
	),
	amountOff: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	maxUses: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	expiresAt: v.optional(v.nullable(isoDate))
});

export const promoCodeUpdate = v.object({
	id: idSchema,
	active: v.boolean()
});

export const joinInput = v.object({
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: optionalText,
	referralSource: v.optional(v.nullable(v.picklist(referralSources))),
	/** Member id from a ?ref= referral link. */
	referredById: v.optional(v.nullable(idSchema)),
	planId: v.optional(v.nullable(idSchema)),
	agreedWaiver: v.optional(v.boolean(), false),
	/** Discount code applied to the up-front charge. */
	promoCode: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(50)))),
	/** Honeypot: must stay empty. */
	website: v.optional(v.string(), '')
});

/** "Not ready to join — keep me posted" form on the public page. */
export const leadInput = v.object({
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: v.optional(optionalText),
	/** What they asked about — stored as a staff note on the new member. */
	interest: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
	/** Honeypot: must stay empty. */
	website: v.optional(v.string(), '')
});

/** Visitor requesting a free trial class on the public schedule. */
export const trialInput = v.object({
	sessionId: idSchema,
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: v.optional(optionalText)
});

/** Visitor buying a single class on the public page. */
export const dropInInput = v.object({
	sessionId: idSchema,
	name: requiredText('Name'),
	email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
	phone: v.optional(optionalText),
	agreedWaiver: v.optional(v.boolean(), false)
});

/** Visitor buying a single-day gym pass on the public page. */
export const dayPassInput = v.object({
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

/** Email everyone registered for an event — same treatment as a session roster. */
export const emailEventRosterInput = v.object({
	eventId: idSchema,
	subject: requiredText('Subject'),
	message: requiredText('Message')
});

export const announcementInput = v.object({
	subject: requiredText('Subject'),
	message: requiredText('Message'),
	/** Restrict the batch to these members (e.g. the at-risk list); empty = all actives. */
	memberIds: v.optional(v.pipe(v.array(idSchema), v.maxLength(500))),
	/** Restrict the batch to members carrying this tag. */
	tag: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50))),
	/** Restrict the batch to members holding an active membership on this plan. */
	planId: v.optional(idSchema),
	/** Restrict the batch to the at-risk list (no visit in 30+ days). */
	atRisk: v.optional(v.boolean())
});

export const scheduledAnnouncementInput = v.object({
	...announcementInput.entries,
	/** ISO timestamp to send at (client converts their local pick). */
	sendAt: v.pipe(v.string(), v.isoTimestamp('Use a full ISO timestamp'))
});

export const memberNoteInput = v.object({
	memberId: idSchema,
	body: v.pipe(requiredText('Note'), v.maxLength(2000))
});

export const measurementKinds = ['weight', 'body_fat', 'waist', 'chest'] as const;
export const measurementUnits = ['lb', 'kg', '%', 'in', 'cm'] as const;

export const measurementInput = v.object({
	kind: v.picklist(measurementKinds),
	value: v.pipe(v.number(), v.gtValue(0), v.maxValue(2000)),
	unit: v.picklist(measurementUnits),
	recordedAt: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)))
});

export const memberTagInput = v.object({
	memberId: idSchema,
	tag: v.pipe(requiredText('Tag'), v.maxLength(50))
});

export const incidentInput = v.object({
	/** Member it happened to; null for a guest/walk-in (then subjectName is required). */
	memberId: v.nullable(idSchema),
	subjectName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	kind: v.picklist(['injury', 'incident']),
	occurredOn: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
	description: requiredText('Description')
});

export const incidentUpdate = v.object({
	id: idSchema,
	status: v.optional(v.picklist(['open', 'closed'])),
	followUp: v.optional(v.pipe(v.string(), v.maxLength(4000)))
});

export const signRequestInput = v.object({
	memberId: idSchema,
	title: requiredText('Title'),
	/** Full document text the member agrees to. */
	body: v.pipe(requiredText('Document text'), v.maxLength(20000))
});

export const classVideoInput = v.object({
	classTypeId: idSchema,
	title: requiredText('Title'),
	url: v.pipe(requiredText('URL'), v.url('Must be a URL'))
});

export const prInput = v.object({
	/** Lift or benchmark — "Back squat", "Fran". */
	label: v.pipe(requiredText('Lift or benchmark'), v.maxLength(60)),
	/** Free-form result — "315 lb", "3:12". */
	value: v.pipe(requiredText('Result'), v.maxLength(30)),
	recordedOn: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)))
});

export const memberMergeInput = v.object({
	keepId: idSchema,
	dropId: idSchema
});

export const bulkTagInput = v.object({
	memberIds: v.pipe(v.array(idSchema), v.minLength(1), v.maxLength(500)),
	tag: v.pipe(requiredText('Tag'), v.maxLength(50))
});

export const expenseCategories = [
	'rent',
	'payroll',
	'equipment',
	'utilities',
	'marketing',
	'other'
] as const;
export const expenseInput = v.object({
	label: requiredText('Label'),
	category: v.optional(v.picklist(expenseCategories), 'other'),
	amountCents: cents,
	/** Gym-local date the cost was incurred. */
	expenseOn: isoDate
});

/** Multi-week priced program — enrolls the member into every session of a class type in the window. */
export const courseInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name required'), v.maxLength(80)),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500))),
	classTypeId: idSchema,
	startsOn: isoDate,
	endsOn: isoDate,
	/** One-time signup price in cents; 0 = free. */
	priceCents: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
	/** Program-wide enrollment cap; null = per-session capacities only. */
	capacity: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
	memberBookable: v.optional(v.boolean(), true),
	minLevelId: v.optional(v.nullable(idSchema)),
	/** Split the price into this many monthly installments (1 = pay up front). */
	installments: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)))
	),
	/** Weekly sessions generated for the course (0 = Sunday … 6 = Saturday). */
	weekdays: v.pipe(
		v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6))),
		v.minLength(1, 'Pick at least one day')
	),
	/** Org-local session start, `HH:MM` 24h. */
	startTime: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')),
	instructorId: v.optional(v.nullable(idSchema)),
	locationId: v.optional(v.nullable(idSchema))
});

/** Generate bookable slots inside an instructor's availability windows. */
export const slotGenInput = v.object({
	classTypeId: idSchema,
	instructorId: idSchema,
	from: isoDate,
	to: isoDate,
	/** Seats per slot; 1 = a private session. */
	capacity: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
		1
	)
});

/** Staff-assigned workout routine on the member page / in the portal. */
export const workoutInput = v.object({
	memberId: idSchema,
	title: v.pipe(requiredText('Title'), v.maxLength(80)),
	body: v.pipe(requiredText('Workout'), v.maxLength(4000))
});

export const workoutUpdate = v.object({
	id: idSchema,
	title: v.pipe(requiredText('Title'), v.maxLength(80)),
	body: v.pipe(requiredText('Workout'), v.maxLength(4000))
});

/** Staff: move pack credits from one member's pack membership to another member. */
export const creditTransferInput = v.object({
	membershipId: idSchema,
	toMemberId: idSchema,
	credits: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))
});

/** Portal: member gifts pack credits to another member by email. */
export const giftCreditsInput = v.object({
	memberId: idSchema,
	email: v.pipe(requiredText('Email'), v.email('Must be an email')),
	credits: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))
});

/** Member requesting a 1:1 session in the portal. */
export const ptRequestInput = v.object({
	instructorId: v.optional(v.nullable(idSchema)),
	preferredAt: v.pipe(v.string(), v.nonEmpty('Pick a date and time')),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)))
});

/** Staff approving a PT request — session to create. */
export const ptApproveInput = v.object({
	id: idSchema,
	classTypeId: idSchema,
	startsAt: v.optional(v.pipe(v.string(), v.nonEmpty()))
});

/** Weekly recurring announcement (cron-delivered). */
export const recurringEmailInput = v.object({
	subject: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(150)),
	message: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(5000)),
	tag: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
	planId: v.optional(v.nullable(idSchema)),
	weekday: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6)),
	time: v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'))
});

export const levelInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)),
	color: v.optional(v.pipe(v.string(), v.maxLength(30)))
});

export const setLevelInput = v.object({
	memberId: idSchema,
	levelId: v.nullable(idSchema)
});

export const announcementTemplateInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
	subject: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(150)),
	message: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(5000)),
	tag: v.optional(v.pipe(v.string(), v.maxLength(50)))
});

export const lockerInput = v.object({
	label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(30))
});
