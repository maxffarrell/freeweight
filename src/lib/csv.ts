export type CsvValue = string | number | null | undefined;

/** Picks `,`, `;` or tab, whichever appears most often outside quotes on the first line. */
function detectDelimiter(text: string) {
	const counts = new Map([
		[',', 0],
		[';', 0],
		['\t', 0]
	]);
	let quoted = false;
	for (const ch of text) {
		if (ch === '"') quoted = !quoted;
		else if (!quoted && (ch === '\n' || ch === '\r')) break;
		else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
	}
	const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
	return n > 0 ? best : ',';
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM. Blank lines are dropped. */
export function parseCsv(input: string): string[][] {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const delimiter = detectDelimiter(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += ch;
		} else if (ch === '"' && field === '') quoted = true;
		else if (ch === delimiter) {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += ch;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Spreadsheet apps run cells starting with these as formulas. */
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: CsvValue) {
	if (value == null) return '';
	if (typeof value === 'number') return String(value);
	const safe = FORMULA.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(rows: CsvValue[][]) {
	return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
