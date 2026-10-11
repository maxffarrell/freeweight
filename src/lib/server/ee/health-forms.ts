/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/auth.schema.ts';
import { gymMember, gymSettings, notificationLog } from '#lib/server/db/schema.ts';
import { sendEmail } from '#lib/server/email.ts';
import { renderEmail } from '#lib/server/email-template.ts';
import { hasFeature } from './license.ts';

/** Standard PAR-Q questions — indexes are stable, answers store as {"0": true, ...}. */
export const PARQ_QUESTIONS = [
	'Has a doctor ever said you have a heart condition and that you should only do physical activity recommended by a doctor?',
	'Do you feel pain in your chest when you do physical activity?',
	'In the past month, have you had chest pain when you were not doing physical activity?',
	'Do you lose your balance because of dizziness, or have you lost consciousness?',
	'Do you have a bone or joint problem that could be made worse by physical activity?',
	'Is a doctor currently prescribing anything for your blood pressure or a heart condition?',
	'Do you know of any other reason why you should not do physical activity?'
] as const;

export function healthFormsEnabled(): boolean {
	return hasFeature('health-forms');
}

/** Throws 403 when the install isn't licensed for health forms. */
export function requireHealthForms(): void {
	if (!healthFormsEnabled()) throw error(403, 'Health forms are an Enterprise feature');
}

/** Records a member's signed PAR-Q. Any "yes" answer is kept — staff follow up. */
export async function submitParq(
	memberId: string,
	orgId: string,
	answers: Record<string, boolean>
) {
	requireHealthForms();
	// The portal submits answers index-keyed against the served questions;
	// store them keyed by question text so staff views and exports stay
	// readable even if the gym's custom list changes later.
	const [st] = await db
		.select({ healthQuestions: gymSettings.healthQuestions })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	const custom = st?.healthQuestions
		.split('\n')
		.map((q) => q.trim())
		.filter(Boolean);
	const questions = custom?.length ? custom : [...PARQ_QUESTIONS];
	const keyed = Object.fromEntries(
		Object.entries(answers).map(([k, v]) => [questions[Number(k)] ?? k, v])
	);
	const [row] = await db
		.update(gymMember)
		.set({ parqAnswers: keyed, parqSignedAt: new Date() })
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)))
		.returning({ id: gymMember.id });
	if (!row) error(404, 'Member not found');
	return row;
}

/**
 * Daily cron: email members whose PAR-Q is expired or expires within 14 days,
 * at most once per calendar month each (notification_log dedupe).
 */
export async function sendParqReminders(orgId: string): Promise<number> {
	if (!healthFormsEnabled()) return 0;
	const [s] = await db
		.select({ months: gymSettings.parqMonths, logoDocumentId: gymSettings.logoDocumentId })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, orgId))
		.limit(1);
	if (!s?.months) return 0;
	const warnFrom = new Date(Date.now() - (s.months * 30.4 - 14) * 86400_000);
	const members = await db
		.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
		.from(gymMember)
		.where(
			and(
				eq(gymMember.organizationId, orgId),
				eq(gymMember.status, 'active'),
				isNotNull(gymMember.email),
				lt(gymMember.parqSignedAt, warnFrom)
			)
		)
		.limit(500);
	if (!members.length) return 0;
	const [o] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);
	const month = new Date().toISOString().slice(0, 7);
	let sent = 0;
	for (const m of members) {
		const [row] = await db
			.insert(notificationLog)
			.values({
				organizationId: orgId,
				kind: 'parq_reminder',
				entityId: `${m.id}:${month}`,
				recipient: m.email!
			})
			.onConflictDoNothing()
			.returning({ id: notificationLog.id });
		if (!row) continue;
		await sendEmail({
			to: m.email!,
			subject: `${o?.name ?? 'Your gym'} — health form due`,
			...renderEmail({
				orgName: o?.name ?? 'your gym',
				logoUrl: s.logoDocumentId ? `/api/logo/${s.logoDocumentId}` : undefined,
				heading: 'Your health form needs re-signing',
				lines: [
					`Hi ${m.name.split(' ')[0]},`,
					'Your health questionnaire (PAR-Q) is expired or about to expire. Re-sign it in the member portal — it takes a minute — so your bookings keep working.'
				]
			})
		});
		sent++;
	}
	return sent;
}
