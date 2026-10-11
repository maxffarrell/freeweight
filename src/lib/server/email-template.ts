const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

export type EmailContent = {
	orgName: string;
	logoUrl?: string;
	/** Licensed white-label orgs drop the 'with Freeweight' footer tag. */
	whiteLabel?: boolean;
	heading: string;
	lines: string[];
	action?: { label: string; url: string };
};

export function renderEmail({
	orgName,
	logoUrl,
	heading,
	lines,
	action,
	whiteLabel
}: EmailContent) {
	const text = [
		heading,
		'',
		...lines,
		...(action ? ['', `${action.label}: ${action.url}`] : []),
		'',
		`— ${orgName}${whiteLabel ? '' : ' with Freeweight'}`
	].join('\n');

	const paragraphs = lines
		.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(l)}</p>`)
		.join('');
	const button = action
		? `<p style="margin:24px 0 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(action.label)}</a></p>`
		: '';
	const brand = logoUrl
		? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(orgName)}" style="max-height:44px;max-width:180px;display:block;margin:0 0 16px" />`
		: `<p style="margin:0 0 16px;font-size:13px;color:#71717a">${escapeHtml(orgName)}</p>`;
	const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px"><tr><td style="padding:32px">${brand}<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>${paragraphs}${button}</td></tr></table><p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">Sent by ${escapeHtml(orgName)}${whiteLabel ? '' : ' with Freeweight'}</p></td></tr></table></body></html>`;

	return { text, html };
}
