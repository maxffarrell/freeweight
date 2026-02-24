<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		"data-slot": dataSlot = "input",
		...restProps
	}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			"flex h-10 w-full rounded-[4px] border-[3px] border-black bg-white px-3 py-2 text-sm font-bold uppercase shadow-[4px_4px_0_0_#000] transition-all duration-200",
			"focus:outline-none focus:shadow-[6px_6px_0_0_#000]",
			"disabled:cursor-not-allowed disabled:opacity-50",
			"placeholder:text-gray-500",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			"flex h-10 w-full rounded-[4px] border-[3px] border-black bg-white px-4 py-2 text-base font-bold uppercase shadow-[4px_4px_0_0_#000] transition-all duration-200",
			"focus:outline-none focus:shadow-[6px_6px_0_0_#000]",
			"disabled:cursor-not-allowed disabled:opacity-50",
			"placeholder:text-gray-500 placeholder:font-bold placeholder:uppercase placeholder:text-xs",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
