<script lang="ts">
	let { class: cls = 'size-6' }: { class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	class={cls}
	aria-label="Freeweight"
>
	<path d="M2 12h2" /><path d="M4 9v6" /><path d="M6 7v10" /><path d="M8 12h8" />
	<path d="M18 7v10" /><path d="M20 9v6" /><path d="M22 12h-2" />
</svg>
