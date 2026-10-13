import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { location, member } from './db/schema.ts';

/** IDs are organization staff member IDs, not global login IDs. Null/undefined remain optional. */
export async function assertStaffLocationReferences(
	orgId: string,
	refs: { locationId?: string | null; instructorId?: string | null }
) {
	for (const [id, table, label] of [
		[refs.locationId, location, 'Location'],
		[refs.instructorId, member, 'Instructor']
	] as const) {
		if (!id) continue;
		const [row] = await db
			.select({ id: table.id })
			.from(table)
			.where(and(eq(table.id, id), eq(table.organizationId, orgId)));
		if (!row) error(404, `${label} not found`);
	}
}
