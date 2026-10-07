import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv.ts';

describe('parseCsv', () => {
	it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
		const text = '\ufeffName,Notes\r\n"Smith, Jane","She said ""hi""\nthen left"\r\n\r\nBob,\n';
		expect(parseCsv(text)).toEqual([
			['Name', 'Notes'],
			['Smith, Jane', 'She said "hi"\nthen left'],
			['Bob', '']
		]);
	});

	it('detects semicolon and tab delimiters', () => {
		expect(parseCsv('a;b\n1,5;2')).toEqual([
			['a', 'b'],
			['1,5', '2']
		]);
		expect(parseCsv('a\tb\n1\t2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('keeps a last line without a newline', () => {
		expect(parseCsv('a,b\n1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});
});

describe('toCsv', () => {
	it('quotes when needed and neutralises formulas', () => {
		expect(toCsv([['a,b', 'say "x"', '=SUM(A1)', -5, null, '@x']])).toBe(
			'"a,b","say ""x""",\'=SUM(A1),-5,,\'@x\r\n'
		);
	});

	it('round-trips through the parser', () => {
		const rows = [
			['Unit', 'Notes'],
			['1A', 'line one\nline two'],
			['2B', 'has "quotes", commas']
		];
		expect(parseCsv(toCsv(rows))).toEqual(rows);
	});
});
