import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymSettings, location } from '#lib/server/db/schema.ts';
import { deleteDocument, uploadDocument } from '#lib/server/services/documents.ts';
import type { OrgContext } from '#lib/server/context.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export async function getSettings(orgId: string) {
	const [row] = await db.select().from(gymSettings).where(eq(gymSettings.organizationId, orgId));
	if (row) return row;
	const [created] = await db
		.insert(gymSettings)
		.values({ organizationId: orgId })
		.onConflictDoNothing()
		.returning();
	return created!;
}

export async function updateSettings(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.settingsInput>
) {
	await getSettings(ctx.orgId);
	const [row] = await db
		.update(gymSettings)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(gymSettings.organizationId, ctx.orgId))
		.returning();
	return row;
}

/** Replaces the gym logo (raster images only — SVG can embed script). Old logo doc is deleted. */
export async function saveLogo(ctx: OrgContext, file: File) {
	if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
		error(400, 'Logo must be a PNG, JPEG, WebP or GIF');
	const [s] = await db
		.select({ logoDocumentId: gymSettings.logoDocumentId })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));
	const doc = await uploadDocument(ctx, file, { type: 'org_logo', id: ctx.orgId });
	await db
		.update(gymSettings)
		.set({ logoDocumentId: doc.id })
		.where(eq(gymSettings.organizationId, ctx.orgId));
	if (s?.logoDocumentId && s.logoDocumentId !== doc.id)
		await deleteDocument(ctx, s.logoDocumentId).catch(() => {});
	return doc;
}

export async function removeLogo(ctx: OrgContext) {
	const [s] = await db
		.select({ logoDocumentId: gymSettings.logoDocumentId })
		.from(gymSettings)
		.where(eq(gymSettings.organizationId, ctx.orgId));
	if (!s?.logoDocumentId) return;
	await db
		.update(gymSettings)
		.set({ logoDocumentId: null })
		.where(eq(gymSettings.organizationId, ctx.orgId));
	await deleteDocument(ctx, s.logoDocumentId).catch(() => {});
}

export async function listLocations(orgId: string, includeArchived = false) {
	return db
		.select()
		.from(location)
		.where(
			and(
				eq(location.organizationId, orgId),
				includeArchived ? undefined : isNull(location.archivedAt)
			)
		)
		.orderBy(asc(location.name));
}

export async function createLocation(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.locationInput>
) {
	const [row] = await db
		.insert(location)
		.values({ organizationId: ctx.orgId, name: input.name, address: input.address })
		.returning();
	return row;
}

export async function updateLocation(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.locationUpdate>
) {
	const [row] = await db
		.update(location)
		.set({
			name: input.name,
			address: input.address,
			archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null
		})
		.where(and(eq(location.organizationId, ctx.orgId), eq(location.id, input.id)))
		.returning();
	if (!row) error(404, 'Location not found');
	return row;
}
