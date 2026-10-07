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

	type Props = {
		user: { name: string; email: string; image: string | null };
		org: { name: string };
		onsearch: () => void;
	};
	let { user, org, onsearch }: Props = $props();

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
				<Sidebar.MenuButton
					variant="outline"
					onclick={onsearch}
					tooltipContent="Search (⌘K)"
					class="text-muted-foreground"
				>
					<Search />
					<span>Search or jump to…</span>
					<Kbd class="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
				</Sidebar.MenuButton>
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
