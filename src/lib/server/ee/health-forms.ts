/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymMember } from '#lib/server/db/schema.ts';
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
	const [row] = await db
		.update(gymMember)
		.set({ parqAnswers: answers, parqSignedAt: new Date() })
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)))
		.returning({ id: gymMember.id });
	if (!row) error(404, 'Member not found');
	return row;
}
