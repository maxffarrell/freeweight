import { describe, expect, it } from 'vitest';
import { renderEmail } from './email-template.ts';

describe('notification HTML boundary', () => {
	it('escapes tenant text in HTML without changing the plain-text contract', () => {
		const untrusted = `<img src=x onerror="alert(1)"> & 'Gym'`;
		const result = renderEmail({
			orgName: untrusted,
			heading: untrusted,
			lines: [untrusted],
			action: { label: untrusted, url: 'https://example.test/?q="<&' },
			logoUrl: 'https://example.test/logo?x="<&'
		});
		expect(result.html).not.toContain(untrusted);
		expect(result.html).not.toContain('<img src=x');
		expect(result.html).toContain(
			'&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Gym&#39;'
		);
		expect(result.html).toContain('href="https://example.test/?q=&quot;&lt;&amp;"');
		expect(result.html).toContain('src="https://example.test/logo?x=&quot;&lt;&amp;"');
		expect(result.text).toContain(untrusted);
		expect(result.text).not.toContain('&lt;img');
	});
});
