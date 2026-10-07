import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resources } from '#lib/server/api/resources.ts';

/** Documented webhook event types (`<entity>.<action>`). `*` subscribes to everything. */
const EVENT_TYPES = [
	'member.created',
	'member.updated',
	'member.joined',
	'membership.created',
	'membership.updated',
	'charge.created',
	'charge.updated',
	'payment.recorded',
	'booking.created',
	'booking.updated',
	'booking.cancelled',
	'check_in.recorded',
	'class_session.created',
	'class_session.updated',
	'class_template.created',
	'class_template.deleted',
	'document.created',
	'payment.refunded',
	'membership.cancel_requested',
	'membership.suspended',
	'member.imported',
	'member.lead',
	'member.waiver_signed',
	'booking.dropin'
] as const;

export const GET: RequestHandler = ({ url }) => {
	const paths: Record<string, unknown> = {};
	for (const [name, r] of Object.entries(resources)) {
		const tags = [name];
		const one = name.replace(/s$/, '');
		paths[`/${name}`] = {
			get: {
				tags,
				summary: `List ${name}`,
				description: `${r.description}. Requires \`${name}:read\`.`,
				responses: { 200: { description: 'OK' } }
			},
			...(r.create
				? {
						post: {
							tags,
							summary: `Create ${one}`,
							description: `Requires \`${name}:write\`.`,
							requestBody: { content: { 'application/json': {} } },
							responses: {
								201: { description: 'Created' },
								422: { description: 'Validation error' }
							}
						}
					}
				: {})
		};
		if (r.get || r.update || r.delete) {
			paths[`/${name}/{id}`] = {
				parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
				...(r.get
					? {
							get: {
								tags,
								summary: `Get ${one}`,
								description: `Requires \`${name}:read\`.`,
								responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } }
							}
						}
					: {}),
				...(r.update
					? {
							patch: {
								tags,
								summary: `Update ${one}`,
								description: `Requires \`${name}:write\`.`,
								requestBody: { content: { 'application/json': {} } },
								responses: { 200: { description: 'OK' } }
							}
						}
					: {}),
				...(r.delete
					? {
							delete: {
								tags,
								summary: `Delete ${one}`,
								description: `Requires \`${name}:write\`.`,
								responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } }
							}
						}
					: {})
			};
		}
	}
	return json({
		openapi: '3.1.0',
		info: {
			title: 'Freeweight API',
			version: '1.0.0',
			description: `API keys carry per-resource \`read\`/\`write\` permissions; requests outside them get 403. Amounts are integer cents. Webhook event types: ${EVENT_TYPES.join(', ')}.`
		},
		servers: [{ url: `${url.origin}/api/v1` }],
		security: [{ bearer: [] }],
		components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
		paths
	});
};
