import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema.ts';

const client = postgres(DATABASE_URL, { max: 10, idle_timeout: 20, prepare: true });

export const db = drizzle(client, { schema });
export type DB = typeof db;
export { schema };
