// Applies pending SQL migrations from ./drizzle. Run with `node scripts/migrate.ts`.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), {
	migrationsFolder: new URL('../drizzle', import.meta.url).pathname
});
await client.end();
console.log('Migrations applied');
