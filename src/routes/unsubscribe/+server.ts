import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gymMember, organization } from '#lib/server/db/schema.ts';
import { validUnsubscribeToken } from '#lib/server/services/notifications.ts';
import type { RequestHandler } from './$types';

const page = (heading: string, body: string) =>
	new Response(
		`<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;background:#fff;border-radius:12px;padding:32px;text-align:center"><h1 style="font-size:20px;margin:0 0 12px">${heading}</h1><p style="font-size:14px;color:#52525b;margin:0">${body}</p></main></body></html>`,
		{ headers: { 'content-type': 'text/html' } }
	);

/** Signed unsubscribe link from member-facing email footers. */
export const GET: RequestHandler = async ({ url }) => {
	const memberId = url.searchParams.get('m') ?? '';
	const token = url.searchParams.get('t') ?? '';
	if (!memberId || !validUnsubscribeToken(memberId, token))
		return page('Invalid link', 'This unsubscribe link is invalid or has been tampered with.');

	const [m] = await db
		.select({ id: gymMember.id, orgName: organization.name })
		.from(gymMember)
		.innerJoin(organization, eq(gymMember.organizationId, organization.id))
		.where(eq(gymMember.id, memberId));
	if (!m)
		return page('Invalid link', 'This unsubscribe link is invalid or has been tampered with.');

	await db.update(gymMember).set({ unsubscribedAt: new Date() }).where(eq(gymMember.id, memberId));
	return page(
		"You're unsubscribed",
		`You'll no longer receive emails from ${m.orgName}. Class and membership updates will stop too — talk to the front desk if you change your mind.`
	);
};
