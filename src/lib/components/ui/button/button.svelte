<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	export const buttonVariants = tv({
		base: "inline-flex shrink-0 items-center justify-center gap-2 rounded-[4px] font-bold uppercase text-sm transition-all duration-200 border-[3px] border-black cursor-pointer",
		variants: {
			variant: {
				default: "bg-[#FFFF00] text-black shadow-[4px_4px_0_0_#000]",
				destructive: "bg-[#e74c3c] text-white shadow-[4px_4px_0_0_#000]",
				outline: "bg-transparent text-black shadow-[4px_4px_0_0_#000]",
				secondary: "bg-[#FF69B4] text-black shadow-[4px_4px_0_0_#000]",
				ghost: "bg-transparent border-transparent shadow-none hover:bg-[#FFFF00]",
				link: "text-black underline-offset-4 hover:underline border-transparent shadow-none",
			},
			size: {
				default: "h-10 px-4 py-2",
				sm: "h-8 px-3 py-1 text-xs",
				lg: "h-12 px-6 py-3 text-base",
				icon: "size-10",
				"icon-sm": "size-8",
				"icon-lg": "size-12",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(
			buttonVariants({ variant, size }),
			"hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#000]",
			"active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#000]",
			className
		)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(
			buttonVariants({ variant, size }),
			"hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#000]",
			"active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#000]",
			className
		)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
