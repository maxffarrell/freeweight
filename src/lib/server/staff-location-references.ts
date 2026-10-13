import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { classType, location, member } from './db/schema.ts';

/** IDs are organization staff member IDs, not global login IDs. Null/undefined remain optional. */
export async function staffLocationReferencesValid(
	orgId: string,
	refs: { locationId?: string | null; instructorId?: string | null; classTypeId?: string | null }
) {
	for (const [id, table] of [
		[refs.locationId, location, 'Location'],
		[refs.instructorId, member, 'Instructor'],
		[refs.classTypeId, classType, 'Class']
	] as const) {
		if (!id) continue;
		const [row] = await db
			.select({ id: table.id })
			.from(table)
			.where(and(eq(table.id, id), eq(table.organizationId, orgId)));
		if (!row) return false;
	}
	return true;
}

export async function assertStaffLocationReferences(
	orgId: string,
	refs: { locationId?: string | null; instructorId?: string | null; classTypeId?: string | null }
) {
	if (!(await staffLocationReferencesValid(orgId, refs)))
		error(404, 'Referenced location, instructor or class not found');
}
