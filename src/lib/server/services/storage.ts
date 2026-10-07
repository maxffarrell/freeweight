import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { documentBlob } from '#lib/server/db/schema.ts';

/**
 * Pluggable blob storage. The default stores files in Postgres so a fresh
 * one-click deploy works without extra services; swap for S3/R2 in production.
 */
export interface BlobStore {
	put(key: string, data: Uint8Array): Promise<void>;
	get(key: string): Promise<Uint8Array | null>;
	delete(key: string): Promise<void>;
}

export const postgresStore: BlobStore = {
	async put(key, data) {
		await db
			.insert(documentBlob)
			.values({ storageKey: key, data: Buffer.from(data).toString('base64') });
	},
	async get(key) {
		const [row] = await db.select().from(documentBlob).where(eq(documentBlob.storageKey, key));
		return row ? new Uint8Array(Buffer.from(row.data, 'base64')) : null;
	},
	async delete(key) {
		await db.delete(documentBlob).where(eq(documentBlob.storageKey, key));
	}
};

export const store: BlobStore = postgresStore;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
