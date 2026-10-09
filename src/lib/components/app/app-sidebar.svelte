<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toggleMode, mode } from 'mode-watcher';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { Kbd } from '#lib/components/ui/kbd/index.js';
	import { authClient } from '#lib/auth-client.ts';
	import { initials } from '#lib/format.ts';
	import Logo from './logo.svelte';
	import { mainNav, secondaryNav } from './nav.ts';
	import Search from '@lucide/svelte/icons/search';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Map from '@lucide/svelte/icons/map';
	import Bell from '@lucide/svelte/icons/bell';
	import { getNotifications } from '#lib/remote/workspace.remote.ts';

	type Props = {
		user: { name: string; email: string; image: string | null };
		org: { name: string };
		onsearch: () => void;
		ontour: () => void;
	};
	let { user, org, onsearch, ontour }: Props = $props();

	const sidebar = Sidebar.useSidebar();
	$effect(() => {
		void page.url.pathname;
		untrack(() => sidebar.openMobile && sidebar.setOpenMobile(false));
	});

	const isActive = (href: string) =>
		href === '/settings'
			? page.url.pathname === '/settings' ||
				(page.url.pathname.startsWith('/settings/') &&
					!page.url.pathname.startsWith('/settings/integrations'))
			: page.url.pathname === href || page.url.pathname.startsWith(href + '/');

	const notifications = $derived(await getNotifications());
	const unread = $derived(notifications.length);

	// Keep the bell fresh while staff sit on a page — poll every 30s.
	$effect(() => {
		const t = setInterval(() => getNotifications().refresh(), 30_000);
		return () => clearInterval(t);
	});

	async function signOut() {
		await authClient.signOut();
		await goto('/login', { invalidateAll: true });
	}
</script>

<Sidebar.Root collapsible="icon" variant="inset">
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<a href="/dashboard" {...props}>
							<Logo />
							<span class="grid flex-1 text-left leading-tight">
								<span class="truncate font-semibold">{org.name}</span>
								<span class="truncate text-xs text-muted-foreground">Freeweight</span>
							</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
			<Sidebar.MenuItem>
				<div class="flex gap-1">
					<Sidebar.MenuButton
						variant="outline"
						onclick={onsearch}
						tooltipContent="Search (⌘K)"
						class="flex-1 text-muted-foreground"
					>
						<Search />
						<span>Search or jump to…</span>
						<Kbd class="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
					</Sidebar.MenuButton>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Sidebar.MenuButton
									{...props}
									variant="outline"
									tooltipContent="Notifications"
									class="relative aspect-square !w-auto shrink-0 px-2 text-muted-foreground"
								>
									<Bell />
									{#if unread}
										<span
											class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
											>{unread > 9 ? '9+' : unread}</span
										>
									{/if}
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-72" align="start">
							<DropdownMenu.Label>Needs attention</DropdownMenu.Label>
							<DropdownMenu.Separator />
							{#each notifications as n (n.label + n.detail)}
								<DropdownMenu.Item onclick={() => goto(n.href)} class="flex-col items-start gap-0">
									<span class="text-sm">{n.label}</span>
									<span class="text-xs text-muted-foreground">{n.detail}</span>
								</DropdownMenu.Item>
							{:else}
								<DropdownMenu.Item disabled class="text-muted-foreground">
									All clear — nothing needs attention
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.Menu>
				{#each mainNav as item (item.href)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={isActive(item.href)}
							tooltipContent={`${item.label}  G ${item.key.toUpperCase()}`}
						>
							{#snippet child({ props })}
								<a href={item.href} {...props}><item.icon /><span>{item.label}</span></a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
		<Sidebar.Group class="mt-auto">
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton tooltipContent="Member portal">
						{#snippet child({ props })}
							<a href="/portal" target="_blank" {...props}
								><ExternalLink /><span>Member portal</span></a
							>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
				{#each secondaryNav as item (item.href)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={item.label}>
							{#snippet child({ props })}
								<a href={item.href} {...props}><item.icon /><span>{item.label}</span></a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton size="lg" {...props}>
								<Avatar.Root class="size-8 rounded-lg">
									{#if user.image}<Avatar.Image src={user.image} alt={user.name} />{/if}
									<Avatar.Fallback class="rounded-lg">{initials(user.name)}</Avatar.Fallback>
								</Avatar.Root>
								<span class="grid flex-1 text-left text-sm leading-tight">
									<span class="truncate font-medium">{user.name}</span>
									<span class="truncate text-xs text-muted-foreground">{user.email}</span>
								</span>
								<ChevronsUpDown class="ml-auto" />
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						side="top"
						align="start"
						class="w-(--bits-dropdown-menu-anchor-width) min-w-56"
					>
						<DropdownMenu.Item onclick={ontour}><Map /> Take the tour</DropdownMenu.Item>
						<DropdownMenu.Item onclick={toggleMode}>
							{#if mode.current === 'dark'}<Sun /> Light mode{:else}<Moon /> Dark mode{/if}
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={signOut}><LogOut /> Sign out</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
