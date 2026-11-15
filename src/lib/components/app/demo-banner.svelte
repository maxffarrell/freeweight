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
</script>

<div
	class="absolute top-14 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-primary/95 px-4 py-1.5 text-center text-xs text-primary-foreground shadow-lg backdrop-blur sm:top-2"
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
