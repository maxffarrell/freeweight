<script lang="ts">
	interface Props {
		expiresAt: number;
		serverNow: number;
		deployUrl: string;
	}

	let { expiresAt, serverNow, deployUrl }: Props = $props();
	let now = $state<number | null>(null);
	const remaining = $derived(Math.max(0, Math.ceil((expiresAt - (now ?? serverNow)) / 1000)));
	const countdown = $derived(
		`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
	);

	$effect(() => {
		// Use the server's clock, and elapsed time rather than counting interval ticks.
		// Background tabs catch up immediately when they become visible again.
		const offset = serverNow - Date.now();
		const update = () => (now = Date.now() + offset);
		update();
		const interval = window.setInterval(update, 1000);
		document.addEventListener('visibilitychange', update);
		return () => {
			window.clearInterval(interval);
			document.removeEventListener('visibilitychange', update);
		};
	});

	let el: HTMLDivElement;
	$effect(() => {
		if (!el) return;
		const set = () =>
			document.documentElement.style.setProperty('--demo-banner-h', `${el.offsetHeight}px`);
		set();
		const ro = new ResizeObserver(set);
		ro.observe(el);
		return () => {
			ro.disconnect();
			document.documentElement.style.removeProperty('--demo-banner-h');
		};
	});
</script>

<div
	bind:this={el}
	class="sticky top-0 z-50 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-1.5 text-center text-xs text-primary-foreground"
>
	<span>
		Private demo · {remaining > 0 ? 'Session ends in' : 'Session ended'}
		<span
			role="timer"
			aria-label="Demo session time remaining"
			aria-live="off"
			class="font-medium tabular-nums">{countdown}</span
		>
	</span>
	<a class="font-medium underline underline-offset-2" href={deployUrl}>Deploy your own</a>
</div>
