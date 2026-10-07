/**
 * Freeweight API client.
 *
 * Create an API key in Settings → API (`fw_…`), then:
 *
 * ```ts
 * import { Freeweight } from '@freeweight/sdk';
 * const fw = new Freeweight({ apiKey: 'fw_…', baseUrl: 'https://gym.example.com' });
 * const members = await fw.members.list();
 * ```
 */

export type FreeweightOptions = {
	/** API key from Settings → API. */
	apiKey: string;
	/** Defaults to Freeweight Cloud. */
	baseUrl?: string;
	fetch?: typeof fetch;
};

export type Member = {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
	status: 'active' | 'inactive';
	joinedAt: string | null;
};

export type ClassSession = {
	id: string;
	classType: string;
	location: string | null;
	instructor: string | null;
	startsAt: string;
	endsAt: string;
	capacity: number;
	booked: number;
	waitlisted: number;
};

export type Booking = {
	id: string;
	sessionId: string;
	memberId: string;
	status: 'booked' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show';
};

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export class Freeweight {
	#apiKey: string;
	#baseUrl: string;
	#fetch: typeof fetch;

	constructor({
		apiKey,
		baseUrl = 'https://app.freeweight.fit',
		fetch: f = fetch
	}: FreeweightOptions) {
		this.#apiKey = apiKey;
		this.#baseUrl = baseUrl.replace(/\/$/, '');
		this.#fetch = f;
	}

	async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await this.#fetch(`${this.#baseUrl}/api/v1${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.#apiKey}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (!res.ok) {
			let message = `HTTP ${res.status}`;
			try {
				const data = (await res.json()) as { message?: string };
				if (data.message) message = data.message;
			} catch {
				// keep the status line
			}
			throw new ApiError(res.status, message);
		}
		return res.json() as Promise<T>;
	}

	readonly members = {
		list: () => this.#request<Member[]>('GET', '/members'),
		create: (input: { name: string; email?: string; phone?: string }) =>
			this.#request<Member>('POST', '/members', input)
	};

	readonly sessions = {
		/** Sessions starting between `from` and `to` (ISO dates); defaults to the next 7 days. */
		list: (params: { from?: string; to?: string } = {}) =>
			this.#request<ClassSession[]>(
				'GET',
				`/sessions?${new URLSearchParams(
					Object.fromEntries(Object.entries(params).filter(([, v]) => v) as [string, string][])
				)}`
			)
	};

	readonly bookings = {
		create: (input: { sessionId: string; memberId: string }) =>
			this.#request<Booking>('POST', '/bookings', input),
		cancel: (id: string) => this.#request<Booking>('POST', `/bookings/${id}/cancel`)
	};
}
