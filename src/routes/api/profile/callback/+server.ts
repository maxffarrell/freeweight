import { finishConnect } from '#lib/server/profile/client.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => finishConnect(event);
