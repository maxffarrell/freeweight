/* @license Enterprise */

import { and, asc, eq, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { gymMember, memberField, memberFieldValue, outer } from '#lib/server/db/schema.ts';
import { hasFeature } from './license.ts';

export type MemberFieldKind = 'text' | 'number' | 'date' | 'select';

export function customFieldsEnabled(): boolean {
	return hasFeature('custom-fields');
}

/** Throws 403 when the install isn't licensed for custom fields. */
export function requireCustomFields(): void {
	if (!customFieldsEnabled()) throw error(403, 'Custom member fields are an Enterprise feature');
}

/** Field definitions for the org, in display order, with a usage count each. */
export async function listMemberFields(orgId: string) {
	return db
		.select({
			id: memberField.id,
			name: memberField.name,
			kind: memberField.kind,
			options: memberField.options,
			showOnJoin: memberField.showOnJoin,
			requireOnJoin: memberField.requireOnJoin,
			position: memberField.position,
			members:
				sql<number>`(select count(*) from ${memberFieldValue} v where v.field_id = ${outer(memberField.id)} and v.value != '')`.mapWith(
					Number
				)
		})
		.from(memberField)
		.where(eq(memberField.organizationId, orgId))
		.orderBy(asc(memberField.position), asc(memberField.name));
}

export async function saveMemberField(
	orgId: string,
	input: {
		id?: string;
		name: string;
		kind: MemberFieldKind;
		options?: string;
		showOnJoin?: boolean;
		requireOnJoin?: boolean;
	}
) {
	requireCustomFields();
	const options = (input.options ?? '').trim();
	if (input.id) {
		await db
			.update(memberField)
			.set({
				name: input.name,
				kind: input.kind,
				options,
				showOnJoin: !!input.showOnJoin,
				requireOnJoin: !!input.requireOnJoin
			})
			.where(and(eq(memberField.id, input.id), eq(memberField.organizationId, orgId)));
		return input.id;
	}
	const [max] = await db
		.select({ n: sql<number>`coalesce(max(${memberField.position}), -1)`.mapWith(Number) })
		.from(memberField)
		.where(eq(memberField.organizationId, orgId));
	const id = crypto.randomUUID();
	await db.insert(memberField).values({
		id,
		organizationId: orgId,
		name: input.name,
		kind: input.kind,
		options,
		showOnJoin: !!input.showOnJoin,
		requireOnJoin: !!input.requireOnJoin,
		position: max.n + 1
	});
	return id;
}

export async function deleteMemberField(orgId: string, id: string) {
	requireCustomFields();
	await db
		.delete(memberField)
		.where(and(eq(memberField.id, id), eq(memberField.organizationId, orgId)));
}

/** Options parsed for a select field. */
export function fieldOptions(field: { kind: string; options: string }): string[] {
	if (field.kind !== 'select') return [];
	return field.options
		.split(/[\n,]/)
		.map((o) => o.trim())
		.filter(Boolean);
}

/**
 * Definitions plus the member's current values, for the member page editor.
 * Unlicensed installs return empty so callers can skip the card entirely.
 */
export async function memberFieldValues(orgId: string, memberId: string) {
	if (!customFieldsEnabled()) return { licensed: false, rows: [] as FieldRow[] };
	const fields = await listMemberFields(orgId);
	const values = await db
		.select({ fieldId: memberFieldValue.fieldId, value: memberFieldValue.value })
		.from(memberFieldValue)
		.where(
			and(eq(memberFieldValue.organizationId, orgId), eq(memberFieldValue.memberId, memberId))
		);
	const byField = new Map(values.map((v) => [v.fieldId, v.value]));
	const rows: FieldRow[] = fields.map((f) => ({
		...f,
		parsedOptions: fieldOptions(f),
		value: byField.get(f.id) ?? ''
	}));
	return { licensed: true, rows };
}

interface FieldRow {
	id: string;
	name: string;
	kind: string;
	options: string;
	position: number;
	members: number;
	parsedOptions: string[];
	value: string;
}

/** Upserts one value; empty string clears the row. Validates select options. */
export async function setMemberFieldValue(
	orgId: string,
	memberId: string,
	fieldId: string,
	value: string
) {
	requireCustomFields();
	const [field] = await db
		.select()
		.from(memberField)
		.where(and(eq(memberField.id, fieldId), eq(memberField.organizationId, orgId)));
	if (!field) throw error(404, 'Field not found');
	const [member] = await db
		.select({ id: gymMember.id })
		.from(gymMember)
		.where(and(eq(gymMember.id, memberId), eq(gymMember.organizationId, orgId)));
	if (!member) throw error(404, 'Member not found');

	const v = value.trim();
	if (field.kind === 'select' && v && !fieldOptions(field).includes(v))
		throw error(400, 'Value must be one of the field options');
	if (field.kind === 'number' && v && Number.isNaN(Number(v)))
		throw error(400, 'Value must be a number');

	if (!v) {
		await db
			.delete(memberFieldValue)
			.where(and(eq(memberFieldValue.fieldId, fieldId), eq(memberFieldValue.memberId, memberId)));
		return;
	}
	await db
		.insert(memberFieldValue)
		.values({
			id: crypto.randomUUID(),
			organizationId: orgId,
			fieldId,
			memberId,
			value: v
		})
		.onConflictDoUpdate({
			target: [memberFieldValue.fieldId, memberFieldValue.memberId],
			set: { value: v }
		});
}

/** Fields flagged to appear on the public join page — licensed installs only. */
export async function joinPageFields(orgId: string) {
	if (!customFieldsEnabled()) return [];
	return db
		.select({
			id: memberField.id,
			name: memberField.name,
			kind: memberField.kind,
			options: memberField.options,
			requireOnJoin: memberField.requireOnJoin
		})
		.from(memberField)
		.where(and(eq(memberField.organizationId, orgId), eq(memberField.showOnJoin, true)))
		.orderBy(asc(memberField.position), asc(memberField.name));
}

/** Store join-page answers for a new member — ignores unknown/non-join field ids. */
export async function saveJoinAnswers(
	orgId: string,
	memberId: string,
	values: Record<string, string>
) {
	if (!customFieldsEnabled()) return;
	const fields = await joinPageFields(orgId);
	const missing = fields.find((f) => f.requireOnJoin && !values[f.id]?.trim());
	if (missing) error(400, `${missing.name} is required`);
	const allowed = new Set(fields.map((f) => f.id));
	const rows = Object.entries(values)
		.filter(([fid, val]) => allowed.has(fid) && val?.trim())
		.map(([fieldId, value]) => ({
			organizationId: orgId,
			fieldId,
			memberId,
			value: value.trim().slice(0, 500)
		}));
	if (rows.length) await db.insert(memberFieldValue).values(rows);
}
