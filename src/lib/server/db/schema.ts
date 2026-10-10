import { getTableName, sql } from 'drizzle-orm';
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { member, organization, user } from './auth.schema.ts';

export * from './auth.schema.ts';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Table-qualified column for correlated subqueries; Drizzle omits the qualifier on single-table selects. */
export const outer = (column: AnyPgColumn) =>
	sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const orgId = () =>
	text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' });

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
};

/** One row per workspace: branding, timezone and public-page settings. */
export const gymSettings = pgTable('gym_settings', {
	organizationId: text('organization_id')
		.primaryKey()
		.references(() => organization.id, { onDelete: 'cascade' }),
	/** IANA timezone used for "today", schedule display and charge due dates. */
	timezone: text('timezone').notNull().default('UTC'),
	/** ISO 4217, lowercase (e.g. `usd`). */
	currency: text('currency').notNull().default('usd'),
	/** Public page at /j/[org-slug] with plans and the week's schedule. */
	publicPage: boolean('public_page').notNull().default(true),
	/** Uploaded logo shown on the public join page, portal and kiosk; null = name only. */
	logoDocumentId: text('logo_document_id').references(() => document.id, {
		onDelete: 'set null'
	}),
	/** Short pitch shown on the public page. */
	tagline: text('tagline').notNull().default(''),
	address: text('address').notNull().default(''),
	phone: text('phone').notNull().default(''),
	website: text('website').notNull().default(''),
	/** Liability waiver text; when non-empty, joiners and drop-ins must agree before signing up. */
	waiver: text('waiver').notNull().default(''),
	/** Persistent notice shown at the top of every member's portal; empty = hidden. */
	portalNotice: text('portal_notice').notNull().default(''),
	/** Weekly opening hours, {weekday(0=Sun): 'HH:MM-HH:MM'}; ''/missing = closed. Shown on the public timetable. */
	openHours: jsonb('open_hours').$type<Record<string, string>>().notNull().default({}),
	/** Daily morning briefing email to owner/admin staff; off skips the cron send. */
	staffBriefing: boolean('staff_briefing').notNull().default(true),
	/** Owner dismissed the launch checklist on the dashboard. */
	setupDismissed: boolean('setup_dismissed').notNull().default(false),
	/** "First class free" — a member's first-ever drop-in books without posting the charge. */
	firstClassFree: boolean('first_class_free').notNull().default(false),
	/** How far ahead portal members may book, in days; null = unlimited. */
	bookingWindowDays: integer('booking_window_days'),
	/** Members can't cancel a class within this many minutes of start; null = anytime. */
	cancelCutoffMin: integer('cancel_cutoff_min'),
	/** Portal bookings close this many minutes before start; null = bookable until start. */
	bookCutoffMin: integer('book_cutoff_min'),
	/** Stop promoting waitlisted members within this many minutes of start; null/0 = always promote. */
	waitlistCutoffMin: integer('waitlist_cutoff_min'),
	/** Max sessions a member may hold bookings for on a single local day; null = unlimited. */
	maxBookingsPerDay: integer('max_bookings_per_day'),
	/** Open charge posted per auto-marked no-show, in minor units; null/0 = no fee. */
	noShowFee: integer('no_show_fee'),
	/** Charged when a booking is cancelled inside cancelCutoffMin; also lets members late-cancel. */
	lateCancelFee: integer('late_cancel_fee'),
	/** Price of a single-day visit sold on the public join page (minor units); null = not sold. */
	dayPassPrice: integer('day_pass_price'),
	/** Auto-suspend a membership once a charge is this many days overdue; null = off. */
	suspendAfterDays: integer('suspend_after_days'),
	/** Bonus class credits a referrer earns when a referred member first pays; null/0 = off. */
	referralCredits: integer('referral_credits'),
	/** Max people allowed inside at once (fire-code cap); kiosk warns past it. null = no cap. */
	occupancyCap: integer('occupancy_cap'),
	/** One-time "stay" offer: % off the next bill shown when a member requests cancel. null = off. */
	saveOfferPct: integer('save_offer_pct'),
	/** One-time charge posted when a membership is paused (minor units); null = free to freeze. */
	freezeFee: integer('freeze_fee'),
	/** Google/whatever review link nudged to members after `reviewAfterVisits` visits; null = off. */
	reviewUrl: text('review_url'),
	/** Lifetime visits that triggers the once-per-member review-request email; null = off. */
	reviewAfterVisits: integer('review_after_visits'),
	/** Comp classes granted when a member hits a check-in milestone; null/0 = off. */
	rewardCredits: integer('reward_credits'),
	/** Comp classes granted at week-streak milestones (4/8/13/26/52); null = off. */
	streakRewardCredits: integer('streak_reward_credits'),
	/** Comp classes granted on the member's birthday each year; null/0 = off. */
	birthdayCompCredits: integer('birthday_comp_credits'),
	/** Days per calendar year a member may pause their own membership in the portal; null/0 = off. */
	selfFreezeDays: integer('self_freeze_days'),
	/** Late cancels forgiven per member per calendar month before the fee applies. Null/0 = no freebies. */
	lateCancelFreebies: integer('late_cancel_freebies'),
	/** Monthly revenue goal in minor units, shown as a progress bar on Reports; null = off. */
	revenueTarget: integer('revenue_target'),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});

/** A physical gym/studio branch. Members and classes can be scoped to one. */
export const location = pgTable(
	'location',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		address: text('address').notNull().default(''),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [index('location_org_idx').on(t.organizationId)]
);

export const memberStatus = pgEnum('member_status', ['active', 'inactive']);

/** A gym member. `portalUserId` links their login once they claim the portal. */
export const gymMember = pgTable(
	'gym_member',
	{
		id: id(),
		organizationId: orgId(),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		portalUserId: text('portal_user_id').references(() => user.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		email: text('email'),
		phone: text('phone'),
		status: memberStatus('status').notNull().default('active'),
		notes: text('notes'),
		/** Short staff flag surfaced at the front desk — "owes $50", "injury: no jumping". */
		deskNote: text('desk_note'),
		/** Emergency contact — shown on the member page for staff. */
		emergencyName: text('emergency_name'),
		emergencyPhone: text('emergency_phone'),
		/** "How did you hear about us?" — set from the public join form. */
		referralSource: text('referral_source'),
		/** Member who sent them the ?ref= join link; null = not referred. */
		referredByMemberId: text('referred_by_member_id').references((): AnyPgColumn => gymMember.id, {
			onDelete: 'set null'
		}),
		/** Household payer: membership charges post under the guardian (e.g. a parent). null = bills to self. */
		guardianId: text('guardian_id').references((): AnyPgColumn => gymMember.id, {
			onDelete: 'set null'
		}),
		/** Staff-uploaded photo — the document row is tagged entityType 'member_avatar'.
		 * Null = no photo; the member page shows initials instead. */
		photoDocumentId: text('photo_document_id').references((): AnyPgColumn => document.id, {
			onDelete: 'set null'
		}),
		/** Set via the signed /unsubscribe link in member-facing emails. */
		unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
		/** Member's own monthly visit target, set in the portal; drives the progress bar. */
		goalVisitsPerMonth: integer('goal_visits_per_month'),
		/** Progression rank (belt/level) the member currently holds — see member_level. */
		skillLevelId: text('skill_level_id'),
		joinedAt: date('joined_at', { mode: 'string' }),
		birthday: date('birthday', { mode: 'string' }),
		/** Member asked (via the portal) for their personal data to be deleted — staff anonymize. */
		deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('gym_member_org_idx').on(t.organizationId),
		index('gym_member_email_idx').on(t.organizationId, t.email),
		index('gym_member_portal_idx').on(t.portalUserId)
	]
);

export const planInterval = pgEnum('plan_interval', ['week', 'month', 'year']);

/** A membership plan a member can subscribe to, e.g. "Open Gym — $40/mo". */
export const plan = pgTable(
	'plan',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		/** Price in minor units (cents) per interval. */
		amount: integer('amount').notNull(),
		interval: planInterval('interval').notNull().default('month'),
		signupFee: integer('signup_fee').notNull().default(0),
		/** Bookable classes per interval; null = unlimited. */
		classCredits: integer('class_credits'),
		/** One-time punch pass: sells `classCredits` classes for `amount`, no recurring billing. */
		isPack: boolean('is_pack').notNull().default(false),
		/** Pack restricted to one class type ("Yoga 10-pack"); null = valid for any class. */
		classTypeId: text('class_type_id').references((): AnyPgColumn => classType.id),
		/** Days a pack stays valid after purchase; null = never expires. */
		packDays: integer('pack_days'),
		/** Free days before the first recurring charge posts; 0 = bill from day one. */
		trialDays: integer('trial_days').notNull().default(0),
		/** Guest check-ins a member on this plan may log per calendar month; null = none. */
		guestPasses: integer('guest_passes'),
		/** Minimum contract term in months — members can't self-cancel before it ends. */
		commitmentMonths: integer('commitment_months'),
		/** Fee (minor units) posted when staff cancels a membership inside its commitment window. */
		earlyCancelFeeCents: integer('early_cancel_fee_cents'),
		/** Max active members on the plan; null = unlimited. Full plans can't be joined. */
		memberLimit: integer('member_limit'),
		/** Days ahead members on this plan may book; null = the gym-wide window. */
		bookAheadDays: integer('book_ahead_days'),
		/** Shown on the public join page. */
		listed: boolean('listed').notNull().default(true),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('plan_org_idx').on(t.organizationId)]
);

/** Discount code redeemed on the public join page — off the up-front charge. */
export const promoCode = pgTable(
	'promo_code',
	{
		id: id(),
		organizationId: orgId(),
		code: text('code').notNull(),
		/** Percent off (1–100) XOR amountOff. */
		percentOff: integer('percent_off'),
		/** Flat amount off in minor units XOR percentOff. */
		amountOff: integer('amount_off'),
		/** Total redemptions allowed; null = unlimited. */
		maxUses: integer('max_uses'),
		timesUsed: integer('times_used').notNull().default(0),
		/** Local-date cutoff, inclusive; null = never expires. */
		expiresAt: date('expires_at', { mode: 'string' }),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [uniqueIndex('promo_code_org_code_idx').on(t.organizationId, t.code)]
);

/** A member's signed liability waiver — stores the exact text they agreed to. */
export const waiver = pgTable(
	'waiver',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		/** Snapshot of the waiver text at signing time. */
		text: text('text').notNull(),
		signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('waiver_member_idx').on(t.memberId)]
);

export const membershipStatus = pgEnum('membership_status', [
	'active',
	'paused',
	'suspended',
	'cancelled'
]);

/** A member's subscription to a plan; drives recurring charges. */
export const membership = pgTable(
	'membership',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		planId: text('plan_id')
			.notNull()
			.references(() => plan.id, { onDelete: 'restrict' }),
		status: membershipStatus('status').notNull().default('active'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		/** When the next recurring membership charge should be posted. */
		nextChargeAt: timestamp('next_charge_at', { withTimezone: true }),
		/** Pack expiry; null = recurring membership or a pack that never expires. */
		endsAt: timestamp('ends_at', { withTimezone: true }),
		/** Paused memberships auto-resume on this date (billing restarts); null = manual resume. */
		frozenUntil: date('frozen_until', { mode: 'string' }),
		/** Member asked to cancel in the portal; staff confirm from the member page. */
		cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
		/** Member asked to pause in the portal; staff approve from the member page. */
		pauseRequestedAt: timestamp('pause_requested_at', { withTimezone: true }),
		/** The auto-resume date the member asked for with their pause request. */
		pauseUntil: date('pause_until', { mode: 'string' }),
		/** Staff-granted comp classes on top of the plan's classCredits (per period / per pack). */
		bonusCredits: integer('bonus_credits').notNull().default(0),
		/** The member's stated reason on a pending cancel/pause request. */
		requestReason: text('request_reason'),
		/** Why they left — captured from their request when cancelled/paused; cleared on resume. */
		endReason: text('end_reason'),
		/** Staff price override (minor units) — recurring charges bill this instead of the plan price. */
		price: integer('price'),
		/** When the member last took a retention save offer; each membership may take one. */
		saveOfferAt: timestamp('save_offer_at', { withTimezone: true }),
		/** Pack memberships: buy the same pack again when it runs out or expires. */
		autoRenew: boolean('auto_renew').notNull().default(false),
		/** Comp'd membership — the billing cron never posts a charge for it. */
		noBill: boolean('no_bill').notNull().default(false),
		/** Self-serve freeze days used this calendar year (cap = gymSettings.selfFreezeDays). */
		selfFreezeUsedDays: integer('self_freeze_used_days').notNull().default(0),
		selfFreezeYear: integer('self_freeze_year'),
		...timestamps
	},
	(t) => [
		index('membership_member_idx').on(t.memberId),
		index('membership_org_charge_idx').on(t.organizationId, t.nextChargeAt)
	]
);

/** A class template, e.g. "Morning HIIT". Sessions are the scheduled occurrences. */
export const classType = pgTable(
	'class_type',
	{
		id: id(),
		organizationId: orgId(),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		/** Hex color for schedule chips, e.g. `#3b82f6`. */
		color: text('color').notNull().default(''),
		durationMin: integer('duration_min').notNull().default(60),
		capacity: integer('capacity').notNull().default(20),
		/** Staff member (org `member` row) who usually teaches it. */
		instructorId: text('instructor_id').references(() => member.id, { onDelete: 'set null' }),
		/** Price in minor units for one drop-in booking; null = no online drop-in sales. */
		dropInPrice: integer('drop_in_price'),
		/** Instructor pay per session taught (minor units); null = unrated. Feeds the payroll report. */
		payRate: integer('pay_rate'),
		/** Cron cancels sessions booked below this the day before; null = never auto-cancel. */
		minEnrollment: integer('min_enrollment'),
		/** Max members on a session's waitlist; null = unlimited, 0 = waitlist off. */
		waitlistLimit: integer('waitlist_limit'),
		/** Minutes before start that member booking closes; null = the gym-wide setting. */
		bookCutoffMin: integer('book_cutoff_min'),
		/** Default join link for virtual sessions (Zoom/Meet) — new sessions inherit it. */
		defaultStreamUrl: text('default_stream_url'),
		/** false = staff-only: members can't self-book in the portal (desk bookings still work). */
		memberBookable: boolean('member_bookable').notNull().default(true),
		/** Members must hold at least this progression level to book — null = open to all. */
		minLevelId: text('min_level_id'),
		/** Minimum member age (years) to book — for kids/adults-only classes; null = all ages. */
		minAge: integer('min_age'),
		/** "What to bring" note shown in the portal under this class's bookings (mat, gloves…). */
		bringNote: text('bring_note').notNull().default(''),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('class_type_org_idx').on(t.organizationId)]
);

/** A day the gym is closed — live sessions on it are cancelled and templates skip it. */
export const closure = pgTable(
	'closure',
	{
		id: id(),
		organizationId: orgId(),
		/** Org-local day, YYYY-MM-DD. */
		date: date('date', { mode: 'string' }).notNull(),
		reason: text('reason').notNull().default(''),
		...timestamps
	},
	(t) => [uniqueIndex('closure_org_date_idx').on(t.organizationId, t.date)]
);

/** An instructor's approved time-off window (inclusive org-local dates). */
export const instructorTimeOff = pgTable(
	'instructor_time_off',
	{
		id: id(),
		organizationId: orgId(),
		instructorId: text('instructor_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		startDate: date('start_date', { mode: 'string' }).notNull(),
		endDate: date('end_date', { mode: 'string' }).notNull(),
		note: text('note').notNull().default(''),
		...timestamps
	},
	(t) => [index('instructor_time_off_member_idx').on(t.instructorId)]
);

/** Instructor's recurring weekly availability windows — scheduling outside them warns (does not block). Empty = always available. */
export const instructorAvailability = pgTable(
	'instructor_availability',
	{
		id: id(),
		organizationId: orgId(),
		instructorId: text('instructor_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		/** Org-local weekday: 0 = Sunday … 6 = Saturday. */
		weekday: integer('weekday').notNull(),
		startTime: text('start_time').notNull(),
		endTime: text('end_time').notNull(),
		...timestamps
	},
	(t) => [index('instructor_availability_member_idx').on(t.instructorId)]
);

/** Recurring rule — "Tuesdays at 6pm". The cron materializes sessions ~2 weeks ahead. */
export const classTemplate = pgTable(
	'class_template',
	{
		id: id(),
		organizationId: orgId(),
		classTypeId: text('class_type_id')
			.notNull()
			.references(() => classType.id, { onDelete: 'cascade' }),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		instructorId: text('instructor_id').references(() => member.id, { onDelete: 'set null' }),
		/** Org-local weekday: 0 = Sunday … 6 = Saturday. */
		weekday: integer('weekday').notNull(),
		/** Org-local start time, `HH:MM` 24h. */
		startTime: text('start_time').notNull(),
		/** Seat override; null → class type default. */
		capacity: integer('capacity'),
		/** Last org-local date sessions may be generated for; null = runs forever. */
		until: date('until', { mode: 'string' }),
		/** Set when the template generates a course's sessions — enrollees auto-book each one. */
		courseId: text('course_id').references(() => course.id, { onDelete: 'set null' }),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('class_template_org_idx').on(t.organizationId)]
);

/** One scheduled occurrence of a class type. */
export const classSession = pgTable(
	'class_session',
	{
		id: id(),
		organizationId: orgId(),
		classTypeId: text('class_type_id')
			.notNull()
			.references(() => classType.id, { onDelete: 'cascade' }),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		instructorId: text('instructor_id').references(() => member.id, { onDelete: 'set null' }),
		/** Set when generated from a class_template — used to dedup materialization. */
		templateId: text('template_id').references(() => classTemplate.id, { onDelete: 'set null' }),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		capacity: integer('capacity').notNull(),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		/** Instructor/staff flagged this session as needing a sub; cleared when the instructor changes. */
		coverRequestedAt: timestamp('cover_requested_at', { withTimezone: true }),
		/** Staff note on this session ("pool closed — bring mats"); shown on the roster. */
		note: text('note'),
		/** Member self-booking is locked for this session (staff can still add from the roster). */
		bookingClosed: boolean('booking_closed').notNull().default(false),
		/** Workout of the day — set by staff, shown to booked members in the portal. */
		workout: text('workout'),
		/** Virtual-class join link (Zoom/Meet); booked members see a Join button in the portal. */
		streamUrl: text('stream_url'),
		/** Short code the instructor announces at class; booked members self-check-in via the portal. */
		checkinCode: text('checkin_code'),
		...timestamps
	},
	(t) => [
		index('class_session_org_starts_idx').on(t.organizationId, t.startsAt),
		index('class_session_type_idx').on(t.classTypeId)
	]
);

export const bookingStatus = pgEnum('booking_status', [
	'booked',
	'waitlisted',
	'cancelled',
	'attended',
	'no_show'
]);

/** A member's spot in a class session; `waitlisted` promotes in order on cancellations. */
export const booking = pgTable(
	'booking',
	{
		id: id(),
		organizationId: orgId(),
		sessionId: text('session_id')
			.notNull()
			.references(() => classSession.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		status: bookingStatus('status').notNull().default('booked'),
		/** Membership this booking drains credits from (null for drop-ins and pre-entitlement rows). */
		membershipId: text('membership_id').references((): AnyPgColumn => membership.id, {
			onDelete: 'set null'
		}),
		/** Extra spots held for the member's guests (they don't book individually). */
		guestCount: integer('guest_count').notNull().default(0),
		/** Drop-in charge this booking created — voided when the booking/session is cancelled. */
		chargeId: text('charge_id').references(() => charge.id, { onDelete: 'set null' }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		/** Staff note on this booking ("first visit", "spot near fan") — roster + sign-in sheet. */
		note: text('note'),
		/** Coach note shared with the member — shown in their portal. */
		coachNote: text('coach_note'),
		/** Note the member wrote on their own booking ("riding with sore ankle") — shown to staff on the roster. */
		memberNote: text('member_note'),
		/** Cancelled booking this one replaces (member makeup for a gym-cancelled class). */
		compBookingId: text('comp_booking_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('booking_session_idx').on(t.sessionId),
		index('booking_member_idx').on(t.memberId),
		uniqueIndex('booking_open_idx')
			.on(t.sessionId, t.memberId)
			.where(sql`${t.status} != 'cancelled'`),
		uniqueIndex('booking_comp_idx')
			.on(t.compBookingId)
			.where(sql`${t.compBookingId} is not null and ${t.status} != 'cancelled'`)
	]
);

export const trialRequestStatus = pgEnum('trial_request_status', [
	'pending',
	'confirmed',
	'declined'
]);

/** Visitor "book a free trial class" request from the public schedule — staff confirm or decline. */
export const trialRequest = pgTable(
	'trial_request',
	{
		id: id(),
		organizationId: orgId(),
		sessionId: text('session_id')
			.notNull()
			.references(() => classSession.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		status: trialRequestStatus('status').notNull().default('pending'),
		/** Booking created on confirmation — the comp'd trial seat. */
		bookingId: text('booking_id').references(() => booking.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [
		index('trial_request_org_idx').on(t.organizationId),
		index('trial_request_member_idx').on(t.memberId),
		uniqueIndex('trial_request_open_idx')
			.on(t.sessionId, t.memberId)
			.where(sql`${t.status} != 'declined'`)
	]
);

/** Member's 1–5 rating + optional note on a class they attended. */
export const sessionFeedback = pgTable(
	'session_feedback',
	{
		id: id(),
		organizationId: orgId(),
		sessionId: text('session_id')
			.notNull()
			.references(() => classSession.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		rating: integer('rating').notNull(),
		comment: text('comment').notNull().default(''),
		...timestamps
	},
	(t) => [
		uniqueIndex('session_feedback_session_member_idx').on(t.sessionId, t.memberId),
		index('session_feedback_org_idx').on(t.organizationId)
	]
);

/**
 * Staff-logged incident/injury report tied to a member (or a named guest —
 * memberId null for drop-ins and walk-ins).
 */
export const incident = pgTable(
	'incident',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id').references(() => gymMember.id, { onDelete: 'set null' }),
		/** Who it happened to when not a member — e.g. a drop-in visitor. */
		subjectName: text('subject_name').notNull().default(''),
		/** 'injury' | 'incident' */
		kind: text('kind').notNull(),
		occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
		description: text('description').notNull(),
		/** 'open' | 'closed' */
		status: text('status').notNull().default('open'),
		/** Follow-up notes appended as the incident is handled. */
		followUp: text('follow_up').notNull().default(''),
		reportedById: text('reported_by_id').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [
		index('incident_org_idx').on(t.organizationId),
		index('incident_member_idx').on(t.memberId)
	]
);

/**
 * Staff-sent document a member signs in the portal — release forms, photo
 * consent, comp-team agreements. One typed-name signature per request.
 */
export const signRequest = pgTable(
	'sign_request',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		/** Full document text the member agrees to. */
		body: text('body').notNull(),
		/** 'pending' | 'signed' | 'voided' */
		status: text('status').notNull().default('pending'),
		signedName: text('signed_name').notNull().default(''),
		signedAt: timestamp('signed_at', { withTimezone: true }),
		sentById: text('sent_by_id').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [
		index('sign_request_member_idx').on(t.memberId),
		index('sign_request_org_idx').on(t.organizationId)
	]
);

/** Member's own free-form workout journal, written from the portal ("Ran 5k — 24:30"). */
export const workoutLog = pgTable(
	'workout_log',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		/** Entry date YYYY-MM-DD (org-local). */
		day: text('day').notNull(),
		text: text('text').notNull(),
		...timestamps
	},
	(t) => [index('workout_log_member_idx').on(t.memberId)]
);

/** Something a member flagged in the portal ("locker 12 hinge is broken") — Needs attention. */
export const memberIssue = pgTable(
	'member_issue',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		/** 'open' | 'resolved' */
		status: text('status').notNull().default('open'),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('member_issue_member_idx').on(t.memberId),
		index('member_issue_org_idx').on(t.organizationId)
	]
);

/** Movement/video links attached to a class type — the coaching library shown in the portal. */
export const classVideo = pgTable(
	'class_video',
	{
		id: id(),
		organizationId: orgId(),
		classTypeId: text('class_type_id')
			.notNull()
			.references(() => classType.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		url: text('url').notNull(),
		...timestamps
	},
	(t) => [index('class_video_org_idx').on(t.organizationId)]
);

/**
 * Personal records a member logs in the portal ("Back squat 315 lb") —
 * the classic whiteboard PR board, kept per member.
 */
export const personalRecord = pgTable(
	'personal_record',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		/** Lift or benchmark name — "Back squat", "Fran", "5K row". */
		label: text('label').notNull(),
		/** The result as the member wrote it — "315 lb", "3:12". */
		value: text('value').notNull(),
		/** Day it was set, `YYYY-MM-DD`. */
		recordedOn: date('recorded_on', { mode: 'string' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('personal_record_member_idx').on(t.memberId),
		index('personal_record_org_idx').on(t.organizationId)
	]
);

/**
 * A member's logged score on a session that had a workout of the day —
 * "12:34 RX". One row per member per session (upserted on re-log).
 */
export const workoutResult = pgTable(
	'workout_result',
	{
		id: id(),
		organizationId: orgId(),
		sessionId: text('session_id')
			.notNull()
			.references(() => classSession.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		score: text('score').notNull(),
		asRx: boolean('as_rx').notNull().default(false),
		...timestamps
	},
	(t) => [
		uniqueIndex('workout_result_session_member_idx').on(t.sessionId, t.memberId),
		index('workout_result_org_idx').on(t.organizationId)
	]
);

/** Bookable amenity — sauna, court, child-care room. Members self-book slots in the portal. */
export const facilityResource = pgTable(
	'facility_resource',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		/** Freeform label — "Sauna", "Court", "Child care". */
		kind: text('kind').notNull().default(''),
		description: text('description').notNull().default(''),
		/** Slot length in minutes. */
		slotMin: integer('slot_min').notNull().default(30),
		/** Concurrent bookings allowed per slot. */
		capacity: integer('capacity').notNull().default(1),
		/** Org-local bookable window each day, `HH:MM`. */
		openFrom: text('open_from').notNull().default('06:00'),
		openTo: text('open_to').notNull().default('22:00'),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		active: boolean('active').notNull().default(true),
		/** 'open' | 'maintenance' | 'closed' — non-open blocks every new booking (desk + portal). */
		status: text('status').notNull().default('open'),
		/** Short "why" shown to members when status isn't open ("leak — back Friday"). */
		statusNote: text('status_note').notNull().default(''),
		/** Minutes blocked after each booking for cleaning/reset. */
		bufferMin: integer('buffer_min').notNull().default(0),
		...timestamps
	},
	(t) => [index('facility_resource_org_idx').on(t.organizationId)]
);

export const resourceBookingStatus = pgEnum('resource_booking_status', ['booked', 'cancelled']);

/** Tracked equipment/machines — status + service dates, separate from bookable amenities. */
export const equipment = pgTable(
	'equipment',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		/** Freeform label — "Treadmill", "Rower", "Cable machine". */
		kind: text('kind').notNull().default(''),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		/** 'operational' | 'maintenance' | 'out_of_order' — text like gymMember.status. */
		status: text('status').notNull().default('operational'),
		notes: text('notes').notNull().default(''),
		/** Gym-local service dates, `YYYY-MM-DD`. */
		servicedOn: text('serviced_on'),
		nextServiceOn: text('next_service_on'),
		...timestamps
	},
	(t) => [index('equipment_org_idx').on(t.organizationId)]
);

/** Staff clock-in/out records — memberId is the org member (staff), like instructorId. */
export const shift = pgTable(
	'shift',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		clockedInAt: timestamp('clocked_in_at', { withTimezone: true }).notNull().defaultNow(),
		clockedOutAt: timestamp('clocked_out_at', { withTimezone: true }),
		note: text('note').notNull().default(''),
		...timestamps
	},
	(t) => [index('shift_org_idx').on(t.organizationId), index('shift_member_idx').on(t.memberId)]
);

/** Weekly staff rota — who is *scheduled* to work (vs `shift`, actual clock events). */
export const rota = pgTable(
	'rota',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		/** Org-local weekday: 0 = Sunday … 6 = Saturday. */
		weekday: integer('weekday').notNull(),
		startTime: text('start_time').notNull(),
		endTime: text('end_time').notNull(),
		...timestamps
	},
	(t) => [index('rota_org_idx').on(t.organizationId), index('rota_member_idx').on(t.memberId)]
);

/** A repeatable front-desk task ("Unlock doors", "Check sauna") ticked off daily. */
export const deskTask = pgTable(
	'desk_task',
	{
		id: id(),
		organizationId: orgId(),
		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('desk_task_org_idx').on(t.organizationId)]
);

/** A desk task completed on a given gym-local date by a staff member. */
export const deskTaskDone = pgTable(
	'desk_task_done',
	{
		id: id(),
		organizationId: orgId(),
		taskId: text('task_id')
			.notNull()
			.references(() => deskTask.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		/** Gym-local date the task was done ('YYYY-MM-DD'). */
		doneOn: date('done_on', { mode: 'string' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('desk_task_done_org_idx').on(t.organizationId),
		uniqueIndex('desk_task_done_task_date_idx').on(t.taskId, t.doneOn)
	]
);

export const resourceBooking = pgTable(
	'resource_booking',
	{
		id: id(),
		organizationId: orgId(),
		resourceId: text('resource_id')
			.notNull()
			.references(() => facilityResource.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		status: resourceBookingStatus('status').notNull().default('booked'),
		note: text('note').notNull().default(''),
		...timestamps
	},
	(t) => [
		index('resource_booking_resource_idx').on(t.resourceId, t.startsAt),
		index('resource_booking_member_idx').on(t.memberId)
	]
);

/** Member holds a weekly amenity slot — cron materializes bookings ~2 weeks out. */
export const resourceRecurring = pgTable(
	'resource_recurring',
	{
		id: id(),
		organizationId: orgId(),
		resourceId: text('resource_id')
			.notNull()
			.references(() => facilityResource.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		/** 0=Sun..6=Sat in the org's timezone. */
		weekday: integer('weekday').notNull(),
		/** Slot start, `HH:MM` org-local. */
		startTime: text('start_time').notNull(),
		runsUntil: date('runs_until', { mode: 'string' }),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('resource_recurring_org_idx').on(t.organizationId)]
);

/** A one-off paid/free event — seminar, comp, bring-a-friend day. */
export const gymEvent = pgTable(
	'gym_event',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		capacity: integer('capacity').notNull().default(20),
		/** Signup price in cents; null/0 = free. */
		price: integer('price'),
		/** Members can self-register in the portal. */
		memberBookable: boolean('member_bookable').notNull().default(true),
		/** Members must hold at least this progression level to book — null = open to all. */
		minLevelId: text('min_level_id'),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('gym_event_org_idx').on(t.organizationId)]
);

export const eventRegistrationStatus = pgEnum('event_registration_status', [
	'registered',
	'cancelled',
	'attended'
]);

export const eventRegistration = pgTable(
	'event_registration',
	{
		id: id(),
		organizationId: orgId(),
		eventId: text('event_id')
			.notNull()
			.references(() => gymEvent.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		status: eventRegistrationStatus('status').notNull().default('registered'),
		/** status stays 'registered'; this flag means "waiting for a seat" — promoted FIFO when one frees. */
		waitlisted: boolean('waitlisted').notNull().default(false),
		/** Signup charge this registration posted — voided on cancel before payment. */
		chargeId: text('charge_id').references(() => charge.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('event_registration_event_idx').on(t.eventId),
		index('event_registration_member_idx').on(t.memberId)
	]
);

/**
 * A multi-week priced program — "6-week beginner lifting". Enrolling books the
 * member into every upcoming session of the linked class type inside the window.
 */
export const course = pgTable(
	'course',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		classTypeId: text('class_type_id')
			.notNull()
			.references(() => classType.id, { onDelete: 'cascade' }),
		startsOn: date('starts_on', { mode: 'string' }).notNull(),
		endsOn: date('ends_on', { mode: 'string' }).notNull(),
		/** One-time price in minor units; 0 = free program. */
		priceCents: integer('price_cents').notNull().default(0),
		/** Max enrollees across the program; null = per-session capacities only. */
		capacity: integer('capacity'),
		/** false = staff enroll members; members can't self-register. */
		memberBookable: boolean('member_bookable').notNull().default(true),
		/** Members must hold at least this progression level to book — null = open to all. */
		minLevelId: text('min_level_id'),
		/** Split the course price across this many monthly charges (1 = pay up front). */
		installments: integer('installments').notNull().default(1),
		...timestamps
	},
	(t) => [index('course_org_idx').on(t.organizationId)]
);

/** One row per member enrolled in a course; the signup charge is linked for refunds. */
export const courseEnrollment = pgTable(
	'course_enrollment',
	{
		id: id(),
		organizationId: orgId(),
		courseId: text('course_id')
			.notNull()
			.references(() => course.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		chargeId: text('charge_id').references(() => charge.id, { onDelete: 'set null' }),
		/** Queued behind a full course — no charge or bookings until promoted. */
		waitlisted: boolean('waitlisted').notNull().default(false),
		...timestamps
	},
	(t) => [
		uniqueIndex('course_enrollment_course_member_idx').on(t.courseId, t.memberId),
		index('course_enrollment_member_idx').on(t.memberId)
	]
);

export const checkInMethod = pgEnum('check_in_method', ['qr', 'manual']);

/** A front-desk check-in, via the member's QR code or a staff search. */
export const checkIn = pgTable(
	'check_in',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		method: checkInMethod('method').notNull().default('manual'),
		/** Set on guest visits — the check-in belongs to the member who brought them. */
		guestName: text('guest_name'),
		/** Set on class-code check-ins — the session the member attended. */
		sessionId: text('session_id').references(() => classSession.id, { onDelete: 'set null' }),
		checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
		/** When they left — null while they're still in the gym. */
		checkedOutAt: timestamp('checked_out_at', { withTimezone: true })
	},
	(t) => [
		index('check_in_org_time_idx').on(t.organizationId, t.checkedAt),
		index('check_in_member_idx').on(t.memberId, t.checkedAt)
	]
);

export const chargeKind = pgEnum('charge_kind', ['membership', 'signup', 'dropin', 'other']);
export const chargeStatus = pgEnum('charge_status', ['open', 'paid', 'void', 'written_off']);

/** A receivable against a member: membership dues, signup fees, drop-ins. */
export const charge = pgTable(
	'charge',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		membershipId: text('membership_id').references(() => membership.id, {
			onDelete: 'set null'
		}),
		kind: chargeKind('kind').notNull().default('other'),
		description: text('description'),
		/** Billing period start for membership charges; keeps re-runs idempotent. */
		periodStart: date('period_start', { mode: 'string' }),
		dueDate: date('due_date', { mode: 'string' }).notNull(),
		amount: integer('amount').notNull(),
		status: chargeStatus('status').notNull().default('open'),
		/** Cost-of-goods snapshot (cents) for retail sales — feeds the P&L; null for
		 * non-merch charges. */
		cogsCents: integer('cogs_cents'),
		...timestamps
	},
	(t) => [
		index('charge_org_due_idx').on(t.organizationId, t.dueDate),
		index('charge_member_idx').on(t.memberId),
		uniqueIndex('charge_membership_period_idx')
			.on(t.membershipId, t.periodStart)
			.where(sql`${t.kind} = 'membership'`)
	]
);

export const paymentMethod = pgEnum('payment_method', [
	'card',
	'cash',
	'bank',
	'stripe',
	'other',
	'gift_card',
	/** System-posted account credit (e.g. plan-change proration) — not money received. */
	'credit'
]);

/** Money received from a member, applied to a charge or held as credit. */
export const payment = pgTable(
	'payment',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		chargeId: text('charge_id').references(() => charge.id, { onDelete: 'set null' }),
		amount: integer('amount').notNull(),
		method: paymentMethod('method').notNull().default('card'),
		reference: text('reference'),
		notes: text('notes'),
		recordedBy: text('recorded_by').references(() => user.id, { onDelete: 'set null' }),
		/** Provider payment ID (e.g. a Stripe PaymentIntent) for payments made online. */
		externalId: text('external_id'),
		paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
		/** Set by refundPayment — refunded payments stop counting toward charge/revenue sums. */
		refundedAt: timestamp('refunded_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('payment_org_paid_idx').on(t.organizationId, t.paidAt),
		uniqueIndex('payment_external_idx').on(t.externalId),
		index('payment_member_idx').on(t.memberId)
	]
);

/**
 * A sold gift card — store credit keyed by a human-typed code.
 * The sale is a normal `other` charge on the buyer (that's the revenue).
 * Redeeming drains the card into `gift_card`-method payments on the
 * redeemer's charges (+ unapplied credit) — excluded from revenue sums so
 * the money isn't counted twice. `balance` hits 0 on first redemption.
 */
export const giftCard = pgTable(
	'gift_card',
	{
		id: id(),
		organizationId: orgId(),
		/** Human-typed redemption code, e.g. GC-4K7M-9Q2X. Unique per org. */
		code: text('code').notNull(),
		/** Face value in minor units. */
		amount: integer('amount').notNull(),
		/** Remaining value — redeeming always drains it onto the member's account. */
		balance: integer('balance').notNull(),
		purchaserMemberId: text('purchaser_member_id').references(() => gymMember.id, {
			onDelete: 'set null'
		}),
		redeemedByMemberId: text('redeemed_by_member_id').references(() => gymMember.id, {
			onDelete: 'set null'
		}),
		redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
		note: text('note').notNull().default(''),
		...timestamps
	},
	(t) => [
		uniqueIndex('gift_card_org_code_idx').on(t.organizationId, t.code),
		index('gift_card_org_idx').on(t.organizationId)
	]
);

/**
 * A recurring add-on on a member — monthly PT packages, towel service,
 * locker rental. The cron posts an `other` charge and advances `nextDue`
 * each period; unlike plans these carry no access rights.
 */
export const recurringCharge = pgTable(
	'recurring_charge',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		description: text('description').notNull(),
		amount: integer('amount').notNull(),
		/** 'week' | 'month' | 'year' — same vocabulary as plan intervals. */
		interval: text('interval').notNull().default('month'),
		/** Next gym-local posting date (YYYY-MM-DD). */
		nextDue: date('next_due', { mode: 'string' }).notNull(),
		active: boolean('active').notNull().default(true),
		/** Member asked staff to stop this add-on — surfaced to staff until deactivated. */
		removalRequestedAt: timestamp('removal_requested_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('recurring_charge_org_due_idx').on(t.organizationId, t.nextDue),
		index('recurring_charge_member_idx').on(t.memberId)
	]
);

/** A repeating operating cost (rent, software, insurance) — cron posts an `expense` row per period. */
export const recurringExpense = pgTable(
	'recurring_expense',
	{
		id: id(),
		organizationId: orgId(),
		label: text('label').notNull(),
		category: text('category').notNull().default('other'),
		amountCents: integer('amount_cents').notNull(),
		/** 'week' | 'month' | 'year'. */
		interval: text('interval').notNull().default('month'),
		/** Next gym-local posting date (YYYY-MM-DD). */
		nextDue: date('next_due', { mode: 'string' }).notNull(),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('recurring_expense_org_due_idx').on(t.organizationId, t.nextDue)]
);

/** A front-desk retail item — water, wraps, shirts — sold into a charge or paid on the spot. */
export const shopItem = pgTable(
	'shop_item',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		price: integer('price').notNull(),
		/** Units on hand — null = untracked/unlimited. Decremented on each sale. */
		stock: integer('stock'),
		/** Alert staff when stock falls to or below this; null = never alert. */
		lowStockAt: integer('low_stock_at'),
		/** Unit cost (cents) — feeds shop COGS/margin on the P&L; null = untracked. */
		cost: integer('cost'),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('shop_item_org_idx').on(t.organizationId)]
);

/** One retail sale — links the charge to item+member and tracks desk pickup. */
export const shopSale = pgTable(
	'shop_sale',
	{
		id: id(),
		organizationId: orgId(),
		itemId: text('item_id')
			.notNull()
			.references(() => shopItem.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		chargeId: text('charge_id').references(() => charge.id, { onDelete: 'set null' }),
		qty: integer('qty').notNull().default(1),
		pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [
		index('shop_sale_org_idx').on(t.organizationId),
		index('shop_sale_member_idx').on(t.memberId)
	]
);

/** A workspace's settings for one online payment provider (`stripe`, …). */
export const paymentProvider = pgTable(
	'payment_provider',
	{
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		enabled: boolean('enabled').notNull().default(false),
		/** The workspace's own account with the provider, e.g. a Stripe Connect account. */
		accountId: text('account_id'),
		accountReady: boolean('account_ready').notNull().default(false),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		primaryKey({ columns: [t.organizationId, t.provider] }),
		index('payment_provider_account_idx').on(t.provider, t.accountId)
	]
);

export const webhook = pgTable(
	'webhook',
	{
		id: id(),
		organizationId: orgId(),
		url: text('url').notNull(),
		secret: text('secret').notNull(),
		events: text('events')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		enabled: boolean('enabled').notNull().default(true),
		lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
		lastDeliveryStatus: integer('last_delivery_status'),
		...timestamps
	},
	(t) => [index('webhook_org_idx').on(t.organizationId)]
);

/** One row per email sent, so each notice goes out once per recipient. */
export const notificationLog = pgTable(
	'notification_log',
	{
		id: id(),
		organizationId: orgId(),
		kind: text('kind').notNull(),
		entityId: text('entity_id').notNull(),
		recipient: text('recipient').notNull(),
		openedAt: timestamp('opened_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('notification_log_once_idx').on(t.kind, t.entityId, t.recipient)]
);

/** Files uploaded by staff — attached to a member (or other entity) via entityType/entityId. */
export const document = pgTable(
	'document',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		contentType: text('content_type').notNull(),
		size: integer('size').notNull(),
		storageKey: text('storage_key').notNull(),
		entityType: text('entity_type'),
		entityId: text('entity_id'),
		uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [index('document_entity_idx').on(t.organizationId, t.entityType, t.entityId)]
);

/** Blob bodies for the default Postgres blob store (see services/storage.ts). */
export const documentBlob = pgTable('document_blob', {
	storageKey: text('storage_key').primaryKey(),
	data: text('data').notNull()
});

/** Free-form staff labels on members — "VIP", "comp team", "6am crew". */
export const memberTag = pgTable(
	'member_tag',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('member_tag_member_idx').on(t.memberId),
		index('member_tag_org_tag_idx').on(t.organizationId, t.tag),
		uniqueIndex('member_tag_unique').on(t.memberId, t.tag)
	]
);

export const classWatch = pgTable(
	'class_watch',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		classTypeId: text('class_type_id')
			.notNull()
			.references(() => classType.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('class_watch_class_idx').on(t.classTypeId),
		uniqueIndex('class_watch_unique').on(t.memberId, t.classTypeId)
	]
);

/** Staff notes on a member — injuries, preferences, front-desk flags. */
export const memberNote = pgTable(
	'member_note',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
		body: text('body').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('member_note_member_idx').on(t.memberId, t.createdAt)]
);

/** Member-logged body metrics (weight, body fat, …) — the portal Progress card. */
export const memberMeasurement = pgTable(
	'member_measurement',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		value: real('value').notNull(),
		unit: text('unit').notNull(),
		recordedAt: date('recorded_at', { mode: 'string' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('member_measurement_member_idx').on(t.memberId, t.recordedAt)]
);

export const activity = pgTable(
	'activity',
	{
		id: id(),
		organizationId: orgId(),
		actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		action: text('action').notNull(),
		summary: text('summary').notNull(),
		data: jsonb('data').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('activity_org_created_idx').on(t.organizationId, t.createdAt),
		index('activity_entity_idx').on(t.entityType, t.entityId)
	]
);

/** Member challenge — "30 visits in 30 days". Progress = the member's check-ins inside the window. */
export const challenge = pgTable(
	'challenge',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		/** What finishers win — free text ("a free month", "hoodie"). Shown in invites/portal. */
		prize: text('prize').notNull().default(''),
		/** Team mode: entrants pick a team name; leaderboard also sums per team. */
		teamMode: boolean('team_mode').notNull().default(false),
		/** Check-ins needed to finish the challenge. */
		goal: integer('goal').notNull(),
		startDate: date('start_date', { mode: 'string' }).notNull(),
		endDate: date('end_date', { mode: 'string' }).notNull(),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('challenge_org_idx').on(t.organizationId)]
);

export const challengeEntry = pgTable(
	'challenge_entry',
	{
		id: id(),
		organizationId: orgId(),
		challengeId: text('challenge_id')
			.notNull()
			.references(() => challenge.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		/** Optional team name when the challenge runs in team mode. */
		team: text('team'),
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('challenge_entry_challenge_idx').on(t.challengeId),
		uniqueIndex('challenge_entry_member_key').on(t.challengeId, t.memberId)
	]
);

/** Per-user app prefs (tour seen, dismissals) — org-agnostic, keyed by string. */
export const userPref = pgTable(
	'user_pref',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [primaryKey({ columns: [t.userId, t.key] })]
);

/** Gym operating expense — rent, payroll, equipment buys; feeds the P&L on Reports. */
export const expense = pgTable(
	'expense',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		category: text('category').notNull().default('other'),
		amountCents: integer('amount_cents').notNull(),
		expenseOn: date('expense_on', { mode: 'string' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('expense_org_date_idx').on(t.organizationId, t.expenseOn)]
);

/** A workout routine a coach assigns to a member — shown in the member's portal. */
export const memberWorkout = pgTable(
	'member_workout',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		/** The routine as the coach wrote it — freeform text. */
		body: text('body').notNull(),
		/** Staff user who wrote it. */
		createdBy: text('created_by'),
		...timestamps
	},
	(t) => [
		index('member_workout_member_idx').on(t.memberId),
		index('member_workout_org_idx').on(t.organizationId)
	]
);

/** A member's request for a 1:1 training slot — staff approve into a session + booking. */
export const ptRequest = pgTable(
	'pt_request',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		/** Preferred coach; null = any. */
		instructorId: text('instructor_id').references(() => member.id, { onDelete: 'set null' }),
		preferredAt: timestamp('preferred_at', { withTimezone: true }).notNull(),
		note: text('note').notNull().default(''),
		/** 'pending' | 'approved' | 'declined' */
		status: text('status').notNull().default('pending'),
		/** Session created on approval. */
		sessionId: text('session_id').references(() => classSession.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [index('pt_request_org_idx').on(t.organizationId, t.status)]
);

/** A gym locker optionally assigned to a member. */
export const locker = pgTable(
	'locker',
	{
		id: id(),
		organizationId: orgId(),
		label: text('label').notNull(),
		memberId: text('member_id').references(() => gymMember.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [uniqueIndex('locker_org_label_idx').on(t.organizationId, t.label)]
);

/** A weekly bulk email that the cron resends to an audience on a set weekday+time. */
export const recurringAnnouncement = pgTable(
	'recurring_announcement',
	{
		id: id(),
		organizationId: orgId(),
		subject: text('subject').notNull(),
		message: text('message').notNull(),
		/** Member tag to target; null = all active members. */
		tag: text('tag'),
		planId: text('plan_id').references(() => plan.id, { onDelete: 'set null' }),
		/** Org-local weekday: 0 = Sunday … 6 = Saturday. */
		weekday: integer('weekday').notNull(),
		/** Org-local `HH:MM` 24h send time. */
		time: text('time').notNull(),
		active: boolean('active').notNull().default(true),
		lastSentOn: date('last_sent_on', { mode: 'string' }),
		createdBy: text('created_by'),
		...timestamps
	},
	(t) => [index('recurring_announcement_org_idx').on(t.organizationId)]
);

/** Configurable progression ranks — belts/levels staff define, ordered. */
export const memberLevel = pgTable(
	'member_level',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		color: text('color'),
		...timestamps
	},
	(t) => [index('member_level_org_idx').on(t.organizationId)]
);

/** Saved bulk-email drafts reusable from the Email dialog. */
export const announcementTemplate = pgTable(
	'announcement_template',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		subject: text('subject').notNull(),
		message: text('message').notNull(),
		tag: text('tag'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [index('announcement_template_org_idx').on(t.organizationId)]
);

/** Saved document drafts staff reuse when sending sign requests. */
export const signDocTemplate = pgTable(
	'sign_doc_template',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		...timestamps
	},
	(t) => [index('sign_doc_template_org_idx').on(t.organizationId)]
);

/** Which staff may teach which class type — empty per class = anyone. */
export const instructorQual = pgTable(
	'instructor_qual',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => member.id, { onDelete: 'cascade' }),
		classTypeId: text('class_type_id')
			.notNull()
			.references(() => classType.id, { onDelete: 'cascade' }),
		...timestamps
	},
	(t) => [index('instructor_qual_org_idx').on(t.organizationId)]
);

/** One-tap member satisfaction scores gathered in the portal. */
export const memberNps = pgTable(
	'member_nps',
	{
		id: id(),
		organizationId: orgId(),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		score: integer('score').notNull(),
		comment: text('comment'),
		...timestamps
	},
	(t) => [index('member_nps_org_idx').on(t.organizationId)]
);

/** Loanable kit (ropes, bands, mats) — stock + per-member loans. */
export const loanableItem = pgTable(
	'loanable_item',
	{
		id: id(),
		organizationId: orgId(),
		name: text('name').notNull(),
		quantity: integer('quantity').notNull().default(1),
		...timestamps
	},
	(t) => [index('loanable_item_org_idx').on(t.organizationId)]
);

export const equipmentLoan = pgTable(
	'equipment_loan',
	{
		id: id(),
		organizationId: orgId(),
		itemId: text('item_id')
			.notNull()
			.references(() => loanableItem.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		outAt: timestamp('out_at', { withTimezone: true }).notNull().defaultNow(),
		returnedAt: timestamp('returned_at', { withTimezone: true }),
		...timestamps
	},
	(t) => [index('equipment_loan_org_idx').on(t.organizationId)]
);

/** A reusable workout program template — name + a library of numbered days. */
export const workoutProgram = pgTable(
	'workout_program',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		weeks: integer('weeks').notNull().default(1),
		note: text('note'),
		createdBy: text('created_by'),
		...timestamps
	},
	(t) => [index('workout_program_org_idx').on(t.organizationId)]
);

/** One day inside a program — dayNo counts across the whole program (1..weeks*days). */
export const programDay = pgTable(
	'program_day',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		programId: text('program_id')
			.notNull()
			.references(() => workoutProgram.id, { onDelete: 'cascade' }),
		dayNo: integer('day_no').notNull(),
		title: text('title').notNull(),
		/** Freeform: exercises, sets/reps, notes. */
		body: text('body').notNull(),
		...timestamps
	},
	(t) => [index('program_day_program_idx').on(t.programId)]
);

/** A member assigned to a program — start date anchors "day N" on their portal. */
export const memberProgram = pgTable(
	'member_program',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		programId: text('program_id')
			.notNull()
			.references(() => workoutProgram.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => gymMember.id, { onDelete: 'cascade' }),
		startDate: text('start_date').notNull(),
		status: text('status').notNull().default('active'), // active | done | stopped
		...timestamps
	},
	(t) => [index('member_program_member_idx').on(t.memberId)]
);
