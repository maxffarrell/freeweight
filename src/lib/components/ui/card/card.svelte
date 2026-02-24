<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		"bg-white border-[3px] border-black rounded-[4px] shadow-[4px_4px_0_0_#000] flex flex-col gap-4 p-6",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
