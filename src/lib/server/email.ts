import {
	CRON_SECRET,
	EMAIL_FROM,
	FREEWEIGHT_DEMO,
	ORIGIN,
	RESEND_API_KEY,
	SMTP_URL
} from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { createTransport, type Transporter } from 'nodemailer';

export type Email = { to: string; subject: string; text: string; html: string };

export const emailProvider = (): 'resend' | 'smtp' | null =>
	RESEND_API_KEY ? 'resend' : SMTP_URL ? 'smtp' : null;

export const cronEnabled = () => !!CRON_SECRET;

export function appOrigin() {
	if (ORIGIN) return ORIGIN.replace(/\/$/, '');
	try {
		return getRequestEvent().url.origin;
	} catch {
		return 'http://localhost:5173';
	}
}

let smtp: Transporter | undefined;

/** Sends through Resend or SMTP; without either, logs instead. Never sends in the public demo. */
export async function sendEmail(email: Email) {
	if (FREEWEIGHT_DEMO) return;
	const from = EMAIL_FROM ?? 'Freeweight <no-reply@freeweight.localhost>';
	const provider = emailProvider();
	if (provider === 'resend') {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
			body: JSON.stringify({ from, ...email }),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
	} else if (provider === 'smtp') {
		smtp ??= createTransport(SMTP_URL);
		await smtp.sendMail({ from, ...email });
	} else {
		console.info(
			`[email] no provider configured; not sent: "${email.subject}"`,
			import.meta.env.DEV ? `to ${email.to}\n${email.text}` : ''
		);
	}
}
