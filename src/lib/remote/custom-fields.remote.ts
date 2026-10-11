import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOrg } from '#lib/server/context.ts';
import {
	customFieldsEnabled,
	deleteMemberField,
	listMemberFields,
	memberFieldValues,
	requireCustomFields,
	saveMemberField,
	setMemberFieldValue
} from '#lib/server/ee/custom-fields.ts';

/**
 * Enterprise custom member fields. Every call re-checks the license server-side;
 * queries degrade to {licensed:false} so unlicensed UI just hides the surfaces.
 */
export const getMemberFields = query(async () => {
	const { orgId } = await requireOrg();
	if (!customFieldsEnabled()) return { licensed: false, fields: [] };
	return { licensed: true, fields: await listMemberFields(orgId) };
});

const fieldInput = v.object({
	id: v.optional(v.string()),
	name: v.pipe(v.string(), v.trim(), v.nonEmpty('Name the field'), v.maxLength(60)),
	kind: v.picklist(['text', 'number', 'date', 'select']),
	options: v.optional(v.pipe(v.string(), v.maxLength(500))),
	showOnJoin: v.optional(v.boolean(), false),
	requireOnJoin: v.optional(v.boolean(), false),
	memberEditable: v.optional(v.boolean(), false)
});

export const saveMemberFieldCmd = command(fieldInput, async (input) => {
	const { orgId } = await requireOrg();
	requireCustomFields();
	const id = await saveMemberField(orgId, input);
	await getMemberFields().refresh();
	return { id };
});

export const deleteMemberFieldCmd = command(v.object({ id: v.string() }), async ({ id }) => {
	const { orgId } = await requireOrg();
	requireCustomFields();
	await deleteMemberField(orgId, id);
	await getMemberFields().refresh();
	return { ok: true };
});

/** Definitions + the member's values, for the member page editor. */
export const getMemberFieldValues = query(
	v.object({ memberId: v.string() }),
	async ({ memberId }) => {
		const { orgId } = await requireOrg();
		return memberFieldValues(orgId, memberId);
	}
);

export const setMemberFieldValueCmd = command(
	v.object({
		memberId: v.string(),
		fieldId: v.string(),
		value: v.pipe(v.string(), v.maxLength(500))
	}),
	async ({ memberId, fieldId, value }) => {
		const { orgId } = await requireOrg();
		requireCustomFields();
		await setMemberFieldValue(orgId, memberId, fieldId, value);
		await getMemberFieldValues({ memberId }).refresh();
		return { ok: true };
	}
);
