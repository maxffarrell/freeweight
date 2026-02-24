import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/private';

// Create a singleton for server-side use
export function createPocketBase() {
  const pb = new PocketBase(env.POCKETBASE_URL || 'http://127.0.0.1:8090');
  return pb;
}

export const pb = createPocketBase();
