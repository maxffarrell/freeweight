<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { getDashboard } from '#lib/remote/workspace.remote.ts';
	import { formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';
	import Users from '@lucide/svelte/icons/users';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import Wallet from '@lucide/svelte/icons/wallet';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { goto } from '$app/navigation';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { getAiInsights, getAiStatus } from '#lib/remote/ai.remote.ts';

	const d = await getDashboard();
	const ai = await getAiStatus();
	let insights = $state<string[] | null | 'error'>(null);
	$effect(() => {
		if (!ai.configured || insights !== null) return;
		void getAiInsights()
			.then((r) => (insights = r.bullets.length ? r.bullets : 'error'))
			.catch(() => (insights = 'error'));
	});
	const kpis = [
		{ label: 'Active members', value: String(d.activeMembers), icon: Users, href: '/members' },
		{ label: 'New this month', value: String(d.newThisMonth), icon: TrendingUp, href: '/members' },
		{
			label: 'Check-ins today',
			value: `${d.checkInsToday} · ${d.inGymNow} inside`,
			icon: ScanLine,
			href: '/checkins'
		},
		{
			label: 'Monthly recurring',
			value: formatMoney(d.mrr, d.currency, true),
			icon: CalendarDays,
			href: '/billing'
		},
		{
			label: 'Open balance',
			value: formatMoney(d.openTotal, d.currency),
			icon: Wallet,
			href: '/billing'
		},
		{
			label: 'Overdue',
			value: formatMoney(d.overdueTotal, d.currency),
			icon: TriangleAlert,
			href: '/billing?status=open'
		}
	];
</script>

<PageHeader title="Dashboard" />

<div class="space-y-6 p-4 md:p-6">
	<div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
		{#each kpis as k (k.label)}
			<Card.Root
				class="cursor-pointer py-4 transition-shadow hover:shadow-sm"
				onclick={() => goto(k.href)}
			>
				<Card.Content class="px-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<k.icon class="size-3.5" />{k.label}
					</div>
					<div class="mt-1 text-2xl font-semibold tracking-tight">{k.value}</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>

	{#if ai.licensed}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base"
					><Sparkles class="size-4" /> AI insights</Card.Title
				>
			</Card.Header>
			<Card.Content class="px-4">
				{#if !ai.configured}
					<p class="text-sm text-muted-foreground">
						Enterprise AI is licensed but no provider is connected — set
						<code>FREEWEIGHT_AI_PROVIDER</code>, <code>FREEWEIGHT_AI_MODEL</code> and
						<code>FREEWEIGHT_AI_KEY</code> on the server to turn it on.
					</p>
				{:else if insights === null}
					<p class="text-sm text-muted-foreground">Reading this week's numbers…</p>
				{:else if insights === 'error' || !insights.length}
					<p class="text-sm text-muted-foreground">
						No insights right now — the AI provider may be unreachable.
					</p>
				{:else}
					<ul class="list-disc space-y-1.5 pl-5 text-sm">
						{#each insights as i (i)}
							<li>{i}</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="grid gap-6 xl:grid-cols-3">
		<Card.Root class="xl:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Today's classes</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#if d.todaySessions.length === 0}
					<p class="py-6 text-center text-sm text-muted-foreground">
						No classes today. <a href="/schedule" class="underline">Add one to the schedule.</a>
					</p>
				{:else}
					<Table.Root>
						<Table.Body>
							{#each d.todaySessions as s (s.id)}
								<Table.Row onclick={() => goto(`/schedule?focus=${s.id}`)} class="cursor-pointer">
									<Table.Cell>
										<span class="mr-2 inline-block size-2 rounded-full" style:background={s.color}
										></span>{s.name}
										{#if s.instructorName}<span class="text-muted-foreground"
												>· {s.instructorName}</span
											>{/if}
									</Table.Cell>
									<Table.Cell class="w-24 text-muted-foreground"
										>{localTime(s.startsAt, d.timezone)}</Table.Cell
									>
									<Table.Cell class="w-28 text-right">
										<Badge variant="secondary">{s.booked}/{s.capacity}</Badge>
										{#if s.waitlisted > 0}<Badge variant="outline" class="ml-1"
												>+{s.waitlisted} wait</Badge
											>{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>

		<div class="space-y-6">
			{#if d.pendingRequests.length}
				<Card.Root class="border-amber-500/50">
					<Card.Header><Card.Title class="text-base">Needs attention</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.pendingRequests as r (r.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a
										href="/members/{r.memberId}"
										class="truncate hover:underline"
										title={r.requestReason ?? undefined}>{r.memberName}</a
									>
									<Badge variant="outline" class="shrink-0">
										{r.kind === 'cancel'
											? `cancel ${r.planName}`
											: `pause${r.pauseUntil ? ` until ${formatDate(r.pauseUntil)}` : ''}`}{r.requestReason
											? ` · ${r.requestReason}`
											: ''}
									</Badge>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.coverNeeded.length}
				<Card.Root class="border-amber-500/50">
					<Card.Header><Card.Title class="text-base">Needs cover</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.coverNeeded as s (s.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/schedule" class="truncate hover:underline">{s.className}</a>
									<Badge variant="outline" class="shrink-0">
										{formatDate(s.startsAt)} · {localTime(s.startsAt, d.timezone)}{s.instructorName
											? ` · ${s.instructorName}`
											: ''}
									</Badge>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.liveChallenges.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Live challenges</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.liveChallenges as c (c.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<span class="truncate font-medium">{c.name}</span>
									<Badge variant="outline" class="shrink-0">
										{c.joined} in · ends {formatDate(c.endDate)}
									</Badge>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.birthdaysThisWeek.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Birthdays this week</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.birthdaysThisWeek as r (r.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/members/{r.memberId}" class="truncate hover:underline">{r.memberName}</a
									>
									<Badge variant={r.days === 0 ? 'default' : 'outline'} class="shrink-0">
										{r.days === 0 ? 'today' : formatDate(r.when)}
									</Badge>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.renewalsThisWeek.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Renewing this week</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.renewalsThisWeek as r (r.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/members/{r.memberId}" class="truncate hover:underline">{r.memberName}</a
									>
									<Badge variant="outline" class="shrink-0"
										>{r.planName} · ends {formatDate(r.endsAt)}</Badge
									>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between">
					<Card.Title class="text-base">Recent activity</Card.Title>
					<a href="/activity" class="text-xs text-muted-foreground hover:underline">View all</a>
				</Card.Header>
				<Card.Content class="px-4">
					{#if d.recentActivity.length === 0}
						<p class="py-4 text-sm text-muted-foreground">Nothing yet.</p>
					{:else}
						<ul class="space-y-3">
							{#each d.recentActivity.slice(0, 8) as a (a.id)}
								<li class="flex items-start gap-2 text-sm">
									<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
									<div class="min-w-0">
										<p class="truncate">{a.summary}</p>
										<p class="text-xs text-muted-foreground">{formatRelative(a.createdAt)}</p>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header><Card.Title class="text-base">Newest members</Card.Title></Card.Header>
				<Card.Content class="px-4">
					{#if d.recentMembers.length === 0}
						<p class="py-4 text-sm text-muted-foreground">No members yet.</p>
					{:else}
						<ul class="space-y-2">
							{#each d.recentMembers as m (m.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/members/{m.id}" class="truncate hover:underline">{m.name}</a>
									<StatusBadge status={m.status} />
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	</div>
</div>
