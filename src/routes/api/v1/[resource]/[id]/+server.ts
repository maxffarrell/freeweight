import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiContext } from '#lib/server/api/auth.ts';
import { parseBody, resource } from '#lib/server/api/resources.ts';

export const GET: RequestHandler = async (event) => {
	const ctx = await apiContext(event, 'read');
	const r = resource(event.params.resource);
	if (!r.get) error(405, 'Not supported');
	return json({ data: await r.get(ctx, event.params.id) });
};

export const PATCH: RequestHandler = async (event) => {
	const ctx = await apiContext(event, 'write');
	const r = resource(event.params.resource);
	if (!r.update) error(405, 'Not supported');
	const input = await parseBody(r.update.schema, event.request, { id: event.params.id });
	return json({ data: await r.update.run(ctx, input as never) });
};
