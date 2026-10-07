import { goto } from '$app/navigation';
import { isTypingTarget } from './keys.ts';

/**
 * Keyboard navigation for list views: j/k or arrows move, Enter opens, c creates.
 * Rows must carry `data-row` and an `href` (or `data-href`).
 */
export class RowNav {
	index = $state(-1);
	#count: () => number;
	#open: (i: number) => void;
	#create?: () => void;

	constructor(opts: { count: () => number; open: (i: number) => void; create?: () => void }) {
		this.#count = opts.count;
		this.#open = opts.open;
		this.#create = opts.create;
	}

	onkeydown = (e: KeyboardEvent) => {
		if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
		const n = this.#count();
		if ((e.key === 'j' || e.key === 'ArrowDown') && n) {
			e.preventDefault();
			this.index = Math.min(n - 1, this.index + 1);
			this.#scroll();
		} else if ((e.key === 'k' || e.key === 'ArrowUp') && n) {
			e.preventDefault();
			this.index = Math.max(0, this.index - 1);
			this.#scroll();
		} else if (e.key === 'Enter' && this.index >= 0 && this.index < n) {
			e.preventDefault();
			this.#open(this.index);
		} else if (e.key === 'c' && this.#create) {
			e.preventDefault();
			this.#create();
		}
	};

	#scroll() {
		queueMicrotask(() =>
			document.querySelector(`[data-row="${this.index}"]`)?.scrollIntoView({ block: 'nearest' })
		);
	}
}

export const openHref = (href: string) => void goto(href);
