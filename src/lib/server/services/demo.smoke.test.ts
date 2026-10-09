import { describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.ts';
import { sql } from 'drizzle-orm';
import { loadDemoData } from './demo.ts';

describe('loadDemoData', () => {
	it('seeds every surface against a fresh org', async () => {
		const orgId = 'demo-smoke-' + Date.now();
		await db.execute(
			sql`insert into organization (id, name, slug, created_at) values (${orgId}, 'Smoke', ${orgId}, now())`
		);
		try {
			const r = await loadDemoData({ orgId } as never);
			expect(r.members).toBe(8);
			const [row] = (await db.execute(sql`select
				(select count(*) from challenge where organization_id=${orgId}) chal,
				(select count(*) from challenge_entry where organization_id=${orgId}) che,
				(select count(*) from course where organization_id=${orgId}) course,
				(select count(*) from course_enrollment where organization_id=${orgId}) ce,
				(select count(*) from gym_event where organization_id=${orgId}) ev,
				(select count(*) from event_registration where organization_id=${orgId}) er,
				(select count(*) from facility_resource where organization_id=${orgId}) res,
				(select count(*) from resource_booking where organization_id=${orgId}) rb,
				(select count(*) from equipment where organization_id=${orgId}) eq,
				(select count(*) from shop_item where organization_id=${orgId}) shop,
				(select count(*) from expense where organization_id=${orgId}) exp,
				(select count(*) from waiver where organization_id=${orgId}) wav,
				(select count(*) from member_tag where organization_id=${orgId}) tag,
				(select count(*) from promo_code where organization_id=${orgId}) promo,
				(select count(*) from gift_card where organization_id=${orgId}) gc,
				(select count(*) from recurring_charge where organization_id=${orgId}) rc,
				(select count(*) from desk_task where organization_id=${orgId}) dt`)) as never as {
				rows?: Record<string, number>[];
			}[];
			console.log(JSON.stringify((row as never as { rows: Record<string, number>[] })?.rows?.[0] ?? row));
		} finally {
			await db.execute(sql`delete from organization where id=${orgId}`);
		}
	});
});
