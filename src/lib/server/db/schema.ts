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
	/** Short pitch shown on the public page. */
	tagline: text('tagline').notNull().default(''),
	address: text('address').notNull().default(''),
	phone: text('phone').notNull().default(''),
	website: text('website').notNull().default(''),
	/** Liability waiver text; when non-empty, joiners and drop-ins must agree before signing up. */
	waiver: text('waiver').notNull().default(''),
	/** How far ahead portal members may book, in days; null = unlimited. */
	bookingWindowDays: integer('booking_window_days'),
	/** Members can't cancel a class within this many minutes of start; null = anytime. */
	cancelCutoffMin: integer('cancel_cutoff_min'),
	/** Stop promoting waitlisted members within this many minutes of start; null/0 = always promote. */
	waitlistCutoffMin: integer('waitlist_cutoff_min'),
	/** Open charge posted per auto-marked no-show, in minor units; null/0 = no fee. */
	noShowFee: integer('no_show_fee'),
	/** Charged when a booking is cancelled inside cancelCutoffMin; also lets members late-cancel. */
	lateCancelFee: integer('late_cancel_fee'),
	/** Auto-suspend a membership once a charge is this many days overdue; null = off. */
	suspendAfterDays: integer('suspend_after_days'),
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
		/** Set via the signed /unsubscribe link in member-facing emails. */
		unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
		joinedAt: date('joined_at', { mode: 'string' }),
		birthday: date('birthday', { mode: 'string' }),
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
		/** Days a pack stays valid after purchase; null = never expires. */
		packDays: integer('pack_days'),
		/** Free days before the first recurring charge posts; 0 = bill from day one. */
		trialDays: integer('trial_days').notNull().default(0),
		/** Guest check-ins a member on this plan may log per calendar month; null = none. */
		guestPasses: integer('guest_passes'),
		/** Minimum contract term in months — members can't self-cancel before it ends. */
		commitmentMonths: integer('commitment_months'),
		/** Shown on the public join page. */
		listed: boolean('listed').notNull().default(true),
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('plan_org_idx').on(t.organizationId)]
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
		active: boolean('active').notNull().default(true),
		...timestamps
	},
	(t) => [index('class_type_org_idx').on(t.organizationId)]
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
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('booking_session_idx').on(t.sessionId),
		index('booking_member_idx').on(t.memberId),
		uniqueIndex('booking_open_idx')
			.on(t.sessionId, t.memberId)
			.where(sql`${t.status} != 'cancelled'`)
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
		checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('check_in_org_time_idx').on(t.organizationId, t.checkedAt),
		index('check_in_member_idx').on(t.memberId, t.checkedAt)
	]
);

export const chargeKind = pgEnum('charge_kind', ['membership', 'signup', 'dropin', 'other']);
export const chargeStatus = pgEnum('charge_status', ['open', 'paid', 'void']);

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

export const paymentMethod = pgEnum('payment_method', ['card', 'cash', 'bank', 'stripe', 'other']);

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
