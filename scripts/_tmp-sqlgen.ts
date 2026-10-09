import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { notificationLog, organization, activity } from '../src/lib/server/db/schema.ts';

const expr = sql`(select count(*) from ${notificationLog} nl where nl.organization_id = ${organization.id} and nl.kind = 'announcement' and nl.opened_at is not null and nl.entity_id = 'announcement:' || (${activity.data}->>'subject') || '::' || (${activity.data}->>'message'))`;
const q = new PgDialect().sqlToQuery(expr);
console.log('SQL:', q.sql);
console.log('PARAMS:', JSON.stringify(q.params));
