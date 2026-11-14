<script lang="ts">
	import { MessageScroller as MessageScrollerPrimitive } from '@shadcn-svelte/primitives/message-scroller';
	import { cn } from '#lib/utils.js';

	let {
		class: className,
		ref = $bindable(null),
		...restProps
	}: MessageScrollerPrimitive.ViewportProps = $props();
</script>

<MessageScrollerPrimitive.Viewport
	bind:ref
	data-slot="message-scroller-viewport"
	class={cn('size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain', className)}
	{...restProps}
/>
