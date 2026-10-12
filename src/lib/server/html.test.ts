import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html.ts';

describe('unsubscribe HTML text boundary', () => {
	it('renders a malicious organization name as text', () => {
		expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
		expect(escapeHtml('&#60;script&#62;')).toBe('&amp;#60;script&amp;#62;');
	});
	it('preserves ordinary gym names and escapes punctuation', () => {
		expect(escapeHtml('Iron Works Gym')).toBe('Iron Works Gym');
		expect(escapeHtml(`Max's "Gym" & Studio`)).toBe('Max&#39;s &quot;Gym&quot; &amp; Studio');
	});
});
