import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiContext } from '#lib/server/api/auth.ts';
import { parseBody, resource } from '#lib/server/api/resources.ts';

export const GET: RequestHandler = async (event) => {
	const ctx = await apiContext(event, 'read');
	return json({ data: await resource(event.params.resource).list(ctx, event.url) });
};

export const POST: RequestHandler = async (event) => {
	const ctx = await apiContext(event, 'write');
	const r = resource(event.params.resource);
	if (!r.create) error(405, 'Not supported');
	const input = await parseBody(r.create.schema, event.request);
	return json({ data: await r.create.run(ctx, input as never) }, { status: 201 });
};
