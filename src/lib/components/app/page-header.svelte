<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';

	type Crumb = { label: string; href?: string };
	let {
		title,
		crumbs = [],
		actions
	}: { title: string; crumbs?: Crumb[]; actions?: Snippet } = $props();
</script>

<svelte:head><title>{title} · Freeweight</title></svelte:head>

<header
	class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur"
>
	<Sidebar.Trigger class="-ml-1" />
	<Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-4" />
	<Breadcrumb.Root class="min-w-0">
		<Breadcrumb.List class="flex-nowrap">
			{#each crumbs as crumb (crumb.label)}
				<Breadcrumb.Item class="hidden md:inline-flex">
					<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
				</Breadcrumb.Item>
				<Breadcrumb.Separator class="hidden md:block" />
			{/each}
			<Breadcrumb.Item class="min-w-0"
				><Breadcrumb.Page class="truncate font-medium">{title}</Breadcrumb.Page></Breadcrumb.Item
			>
		</Breadcrumb.List>
	</Breadcrumb.Root>
	{#if actions}<div class="ml-auto flex items-center gap-2">{@render actions()}</div>{/if}
</header>
