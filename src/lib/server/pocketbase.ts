import PocketBase from 'pocketbase';
import { POCKETBASE_URL } from '$app/env/private';

// Create a singleton for server-side use
export function createPocketBase() {
  const pb = new PocketBase(POCKETBASE_URL || 'http://127.0.0.1:8090');
  return pb;
}

export const pb = createPocketBase();
