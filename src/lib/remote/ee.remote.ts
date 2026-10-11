import { query } from '$app/server';
import { getRequestEvent } from '$app/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/auth.schema.ts';
import { activity, gymSettings } from '#lib/server/db/schema.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { toCsv } from '#lib/csv.ts';
import { requireOrg } from '#lib/server/context.ts';
import {
	auditExportEnabled,
	exportOrgData,
	requireAuditExport
} from '#lib/server/ee/audit-export.ts';
import { healthFormsEnabled } from '#lib/server/ee/health-forms.ts';
import {
	anonymizeInactive,
	dataRetentionEnabled,
	requireDataRetention
} from '#lib/server/ee/data-retention.ts';
import {
	doorAccessEnabled,
	fireDoorWebhook,
	requireDoorAccess
} from '#lib/server/ee/door-access.ts';
import { command } from '$app/server';
import * as v from 'valibot';
import {
	exportPayroll,
	listAccessLog,
	payrollExportEnabled
} from '#lib/server/ee/payroll-export.ts';
import { customFieldsEnabled } from '#lib/server/ee/custom-fields.ts';
import { hasFeature } from '#lib/server/ee/license.ts';

/** Feature flags for the current install — drives every gated surface in one round-trip. */
export const getEntitlements = query(async () => {
	const { orgId } = await requireOrg();
	let brandColor = '';
	if (hasFeature('white-label')) {
		const [s] = await db
			.select({ whiteLabel: gymSettings.whiteLabel, brandColor: gymSettings.brandColor })
			.from(gymSettings)
			.where(eq(gymSettings.organizationId, orgId))
			.limit(1);
		if (s?.whiteLabel) brandColor = s.brandColor;
	}
	return {
		customFields: customFieldsEnabled(),
		whiteLabel: hasFeature('white-label'),
		auditExport: auditExportEnabled(),
		healthForms: healthFormsEnabled(),
		kioskPin: hasFeature('kiosk-pin'),
		payrollExport: payrollExportEnabled(),
		dataRetention: dataRetentionEnabled(),
		doorAccess: doorAccessEnabled(),
		reportDigests: hasFeature('report-digests'),
		brandColor,
		ai: hasFeature('ai')
	};
});

/** Full-org JSON dump for compliance/backup. Unlicensed installs get {licensed:false}. */
export const getOrgDataExport = query(async () => {
	const { orgId } = await requireOrg('admin');
	if (!auditExportEnabled()) return { licensed: false, data: null };
	return { licensed: true, data: await exportOrgData(orgId) };
});

/** Branding for the error page — org name when the install is white-labelled. Never throws. */
export const getErrorBranding = query(async () => {
	const fallback = { appName: 'Freeweight', hideBranding: false };
	try {
		const orgId = getRequestEvent().locals.session?.activeOrganizationId;
		if (!orgId) return fallback;
		const [row] = await db
			.select({ name: organization.name, whiteLabel: gymSettings.whiteLabel })
			.from(organization)
			.leftJoin(gymSettings, eq(gymSettings.organizationId, organization.id))
			.where(eq(organization.id, orgId))
			.limit(1);
		if (!row?.whiteLabel || !hasFeature('white-label')) return fallback;
		return { appName: row.name, hideBranding: true };
	} catch {
		return fallback;
	}
});

/** Monthly pay run for payroll providers — CSV on the Reports page. */
export const getPayrollExport = query(
	v.object({
		from: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
		to: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)))
	}),
	async ({ from, to }) => {
		const { orgId } = await requireOrg('admin');
		if (!payrollExportEnabled()) return { licensed: false, data: null };
		return { licensed: true, data: await exportPayroll(orgId, from, to) };
	}
);

/** Staff sign-in access log for the audit view (audit-export flag). */
export const getAccessLog = query(async () => {
	const { orgId } = await requireOrg('admin');
	if (!auditExportEnabled()) return { licensed: false, rows: [] };
	return { licensed: true, rows: await listAccessLog(orgId) };
});

/** Test ping to the org's door webhook — proves the integration from Settings. */
export const testDoorWebhook = command(async () => {
	const { orgId } = await requireOrg('admin');
	requireDoorAccess();
	await fireDoorWebhook(orgId, 'member.checked_in', {
		memberId: 'test',
		memberName: 'Test member',
		checkedAt: new Date().toISOString(),
		locationId: null
	});
	return { ok: true };
});

/** Bulk GDPR anonymize — scrubs members with no visit in 24+ months. */
export const anonymizeInactiveMembers = command(
	v.object({ months: v.optional(v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(120))) }),
	async (input) => {
		const ctx = await requireOrg('admin');
		requireDataRetention();
		return { anonymized: await anonymizeInactive(ctx.orgId, input.months ?? 24) };
	}
);

/** Per-member data export (GDPR subject access) — everything we hold on one member. */
export const getMemberDataExport = query(
	v.object({ memberId: v.string() }),
	async ({ memberId }) => {
		const { orgId } = await requireOrg('admin');
		if (!dataRetentionEnabled()) return { licensed: false as const, data: null };
		const {
			gymMember,
			membership,
			plan,
			booking,
			checkIn,
			charge,
			payment,
			memberNote,
			memberMeasurement
		} = await import('#lib/server/db/schema.ts');
		const { and, desc, eq } = await import('drizzle-orm');
		const [m] = await db
			.select()
			.from(gymMember)
			.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)))
			.limit(1);
		if (!m) return { licensed: true as const, data: null };
		const [memberships, bookings, checkIns, charges, payments, notes, measurements] =
			await Promise.all([
				db
					.select({ membership, planName: plan.name })
					.from(membership)
					.leftJoin(plan, eq(membership.planId, plan.id))
					.where(eq(membership.memberId, memberId)),
				db.select().from(booking).where(eq(booking.memberId, memberId)),
				db.select().from(checkIn).where(eq(checkIn.memberId, memberId)),
				db.select().from(charge).where(eq(charge.memberId, memberId)),
				db.select().from(payment).where(eq(payment.memberId, memberId)),
				db
					.select()
					.from(memberNote)
					.where(eq(memberNote.memberId, memberId))
					.orderBy(desc(memberNote.createdAt)),
				db.select().from(memberMeasurement).where(eq(memberMeasurement.memberId, memberId))
			]);
		return {
			licensed: true as const,
			data: {
				exportedAt: new Date().toISOString(),
				member: m,
				memberships,
				bookings,
				checkIns,
				charges,
				payments,
				notes,
				measurements
			}
		};
	}
);

/** Enterprise audit-export: every audit row as one CSV (cap 20k) — compliance dump. */
export const exportAuditLog = query(async () => {
	const { orgId } = await requireOrg();
	requireAuditExport();
	const rows = await db
		.select({
			createdAt: activity.createdAt,
			actorName: user.name,
			entityType: activity.entityType,
			entityId: activity.entityId,
			action: activity.action,
			summary: activity.summary
		})
		.from(activity)
		.leftJoin(user, eq(activity.actorId, user.id))
		.where(eq(activity.organizationId, orgId))
		.orderBy(desc(activity.createdAt))
		.limit(20_000);
	const csv = toCsv([
		['When', 'Actor', 'Type', 'Entity', 'Action', 'Summary'],
		...rows.map((r) => [
			r.createdAt.toISOString(),
			r.actorName ?? '',
			r.entityType,
			r.entityId,
			r.action,
			r.summary
		])
	]);
	return { csv, count: rows.length, truncated: rows.length === 20_000 };
});
