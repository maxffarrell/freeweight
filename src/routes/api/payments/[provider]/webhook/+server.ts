import { error, json } from '@sveltejs/kit';
import { getProvider } from '#lib/server/payments/index.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const provider = getProvider(params.provider);
	if (!provider?.configured()) error(404, 'Not found');
	if (!(await provider.handleWebhook(await request.text(), request.headers)))
		error(400, 'Invalid signature');
	return json({ received: true });
};
