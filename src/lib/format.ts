const currencyFormatters = new Map<string, Intl.NumberFormat>();

/** Message from a remote-function rejection (plain object, not always an Error). */
export function errMsg(err: unknown, fallback: string) {
	if (err instanceof Error) return err.message;
	if (
		typeof err === 'object' &&
		err !== null &&
		'message' in err &&
		typeof (err as { message: unknown }).message === 'string'
	)
		return (err as { message: string }).message;
	return fallback;
}

export function formatMoney(cents: number | null | undefined, currency = 'USD', compact = false) {
	if (cents == null) return '—';
	const key = `${currency}:${compact}`;
	let fmt = currencyFormatters.get(key);
	if (!fmt) {
		fmt = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency,
			maximumFractionDigits: compact ? 0 : 2,
			notation: compact ? 'compact' : 'standard'
		});
		currencyFormatters.set(key, fmt);
	}
	return fmt.format(cents / 100);
}

export const toCents = (dollars: number) => Math.round(dollars * 100);
export const toDollars = (cents: number | null | undefined) =>
	cents == null ? undefined : cents / 100;

const dateFmt = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric'
});
const shortDateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** Formats an ISO date (`YYYY-MM-DD`) or Date without timezone drift. */
export function formatDate(value: string | Date | null | undefined, short = false) {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
	return (short ? shortDateFmt : dateFmt).format(d);
}

const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function formatRelative(value: string | Date) {
	const d = typeof value === 'string' ? new Date(value) : value;
	const diff = (d.getTime() - Date.now()) / 1000;
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31536000],
		['month', 2592000],
		['day', 86400],
		['hour', 3600],
		['minute', 60]
	];
	for (const [unit, secs] of units) {
		if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
	}
	return 'just now';
}

export function todayISO() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthKey(d = new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function initials(name: string) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]!.toUpperCase())
		.join('');
}

const fromISO = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, days: number) {
	const d = fromISO(iso);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Same calendar day `years` later; Feb 29 rolls to Mar 1 in non-leap years. */
export function addYears(iso: string, years: number) {
	const d = fromISO(iso);
	d.setUTCFullYear(d.getUTCFullYear() + years);
	return d.toISOString().slice(0, 10);
}

/** `YYYY-MM` of the month after `month`. */
export function nextMonth(month: string) {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

export function monthLabel(month: string) {
	return fromISO(`${month}-01`).toLocaleString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
