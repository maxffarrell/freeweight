/**
 * Workspace-timezone helpers. Anything user-facing ("today", schedule walls) uses the
 * workspace's IANA timezone, never the server's.
 */

/** `YYYY-MM-DD` in `tz`. */
export function localDate(d: Date, tz: string) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(d);
}

/** `HH:mm` (24h) in `tz`. */
export function localTime(d: Date | string, tz: string) {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(new Date(d));
}

/** Weekday (0 = Sunday) in `tz`. */
export function localWeekday(d: Date, tz: string) {
	const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
	return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

/** Minutes since midnight in `tz`. */
export function localMinutes(d: Date, tz: string) {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(d);
	return (
		Number(parts.find((p) => p.type === 'hour')!.value) * 60 +
		Number(parts.find((p) => p.type === 'minute')!.value)
	);
}

/**
 * Interprets `YYYY-MM-DDTHH:mm` as wall-clock time in `tz` and returns the UTC instant.
 * Iterates once to resolve the UTC offset at that local time (DST-safe).
 */
export function zonedToUtc(local: string, tz: string): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
	if (!m) throw new Error('Expected YYYY-MM-DDTHH:mm');
	const [, y, mo, d, h, mi] = m.map(Number);
	let guess = Date.UTC(y, mo - 1, d, h, mi);
	for (let i = 0; i < 3; i++) {
		const fmt = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		const parts = fmt.formatToParts(new Date(guess));
		const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
		const asUtc = Date.UTC(
			get('year'),
			get('month') - 1,
			get('day'),
			get('hour') % 24,
			get('minute')
		);
		const diff = asUtc - Date.UTC(y, mo - 1, d, h, mi);
		if (diff === 0) break;
		guess -= diff;
	}
	return new Date(guess);
}

/** Adds `days` to a `YYYY-MM-DD` date string. */
export function addDays(iso: string, days: number) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
