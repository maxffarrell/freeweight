<script lang="ts">
	import { goto } from '$app/navigation';
	import Bell from '@lucide/svelte/icons/bell';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { getNotifications } from '#lib/remote/workspace.remote.ts';

	const notifications = $derived(await getNotifications());
	let open = $state(false);

	// Keep the bell fresh while staff sit on a page — poll every 30s.
	$effect(() => {
		const t = setInterval(() => getNotifications().refresh(), 30_000);
		return () => clearInterval(t);
	});
</script>

<Popover.Root
	bind:open
	onOpenChange={(v) => {
		if (v) void getNotifications().refresh();
	}}
>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Sidebar.MenuButton
				{...props}
				variant="outline"
				tooltipContent="Notifications"
				class="relative aspect-square !w-auto shrink-0 px-2 text-muted-foreground"
			>
				<Bell />
				{#if notifications.length}
					<span
						class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
						>{notifications.length > 9 ? '9+' : notifications.length}</span
					>
				{/if}
			</Sidebar.MenuButton>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content side="right" align="start" sideOffset={8} class="w-80 p-0 sm:w-96">
		<div class="flex items-center justify-between border-b px-4 py-2.5">
			<span class="text-sm font-medium">Needs attention</span>
		</div>
		{#if notifications.length === 0}
			<p class="px-4 py-8 text-center text-sm text-muted-foreground">
				All clear — nothing needs attention.
			</p>
		{:else}
			<ul class="max-h-96 divide-y overflow-y-auto">
				{#each notifications as n (n.label + n.detail)}
					<li>
						<button
							class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
							onclick={() => {
								open = false;
								goto(n.href);
							}}
						>
							<span class="mt-1.5 size-2 shrink-0 rounded-full bg-primary"></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium">{n.label}</span>
								<span class="mt-0.5 line-clamp-2 block text-xs text-muted-foreground"
									>{n.detail}</span
								>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</Popover.Content>
</Popover.Root>
