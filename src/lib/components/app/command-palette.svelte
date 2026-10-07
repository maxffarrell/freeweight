<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Command from '#lib/components/ui/command/index.js';
	import { searchAll } from '#lib/remote/workspace.remote.ts';
	import type { SearchHit } from '#lib/server/services/search.ts';
	import { allNav } from './nav.ts';
	import { isTypingTarget } from './keys.ts';
	import User from '@lucide/svelte/icons/user';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Plus from '@lucide/svelte/icons/plus';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let pendingG = false;
	let gTimer: ReturnType<typeof setTimeout> | undefined;

	const icons = {
		member: User,
		class: CalendarDays,
		plan: CreditCard
	};
	const actions = [
		{ label: 'New member', href: '/members?new=1' },
		{ label: 'New class session', href: '/schedule?new=1' },
		{ label: 'New plan', href: '/plans?new=1' },
		{ label: 'Record payment', href: '/billing?new=payment' },
		{ label: 'Check a member in', href: '/checkins' }
	];

	$effect(() => {
		const q = query.trim();
		if (!q) {
			hits = [];
			return;
		}
		let cancelled = false;
		const t = setTimeout(async () => {
			const result = await searchAll(q);
			if (!cancelled) hits = result;
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	});

	function go(href: string) {
		open = false;
		query = '';
		void goto(href);
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			open = !open;
			return;
		}
		if (open || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === '/') {
			e.preventDefault();
			open = true;
			return;
		}
		if (pendingG) {
			pendingG = false;
			clearTimeout(gTimer);
			const target = allNav.find((n) => n.key === e.key.toLowerCase());
			if (target) {
				e.preventDefault();
				void goto(target.href);
			}
			return;
		}
		if (e.key === 'g') {
			pendingG = true;
			gTimer = setTimeout(() => (pendingG = false), 800);
		}
	}
</script>

<svelte:window {onkeydown} />

<Command.Dialog
	bind:open
	shouldFilter={!hits.length}
	title="Search"
	description="Search members, classes and plans"
>
	<Command.Input placeholder="Search members, classes, plans…" bind:value={query} />
	<Command.List>
		<Command.Empty>No results.</Command.Empty>
		{#if hits.length}
			<Command.Group heading="Results">
				{#each hits as hit (hit.kind + hit.id)}
					{@const Icon = icons[hit.kind]}
					<Command.Item value={`${hit.kind}-${hit.id}`} onSelect={() => go(hit.href)}>
						<Icon />
						<span class="truncate">{hit.title}</span>
						<span class="ml-auto truncate text-xs text-muted-foreground capitalize">{hit.sub}</span>
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}
		<Command.Group heading="Go to">
			{#each allNav as item (item.href)}
				<Command.Item value={`go ${item.label}`} onSelect={() => go(item.href)}>
					<item.icon />
					{item.label}
					<Command.Shortcut>G {item.key.toUpperCase()}</Command.Shortcut>
				</Command.Item>
			{/each}
		</Command.Group>
		<Command.Group heading="Create">
			{#each actions as action (action.href)}
				<Command.Item value={action.label} onSelect={() => go(action.href)}
					><Plus /> {action.label}</Command.Item
				>
			{/each}
		</Command.Group>
	</Command.List>
</Command.Dialog>
