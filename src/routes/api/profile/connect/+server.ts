import { startConnect } from '#lib/server/profile/client.ts';
import type { RequestHandler } from './$types';

/** "Connect your Leroa profile" — sends the member to the profile service's consent screen. */
export const GET: RequestHandler = (event) => startConnect(event);
