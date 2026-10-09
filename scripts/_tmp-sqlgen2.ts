import { sql, eq, and, desc } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { pgTable, text, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { notificationLog, organization, activity } from '../src/lib/server/db/schema.ts';
import { drizzle } from 'drizzle-orm/pg-proxy';

const orgId = 'seedorg00000000000000000abc';
const db = drizzle(async () => []);
const q = db
	.select({
		subject: sql<string>`${activity.data}->>'subject'`,
		sent: sql<number>`(${activity.data}->>'sent')::int`,
		read: sql<number>`(select count(*) from ${notificationLog} nl where nl.organization_id = ${organization.id} and nl.kind = 'announcement' and nl.opened_at is not null and nl.entity_id = 'announcement:' || (${activity.data}->>'subject') || '::' || (${activity.data}->>'message'))`.mapWith(Number)
	})
	.from(activity)
	.where(and(eq(activity.organizationId, orgId), eq(activity.entityType, 'announcement')))
	.orderBy(desc(activity.createdAt))
	.limit(3)
	.toSQL();
console.log('SQL:', q.sql);
console.log('PARAMS:', JSON.stringify(q.params));
