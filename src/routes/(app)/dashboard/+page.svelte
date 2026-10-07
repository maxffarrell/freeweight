<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { getDashboard } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import Users from '@lucide/svelte/icons/users';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import Wallet from '@lucide/svelte/icons/wallet';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { goto } from '$app/navigation';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { getAiInsights, getAiStatus } from '#lib/remote/ai.remote.ts';
	import { getAtRisk } from '#lib/remote/reports.remote.ts';
	import {
		getMyShift,
		getOnShift,
		getShiftLog,
		clockIn,
		clockOut,
		closeShift,
		updateShift,
		deleteShift
	} from '#lib/remote/shifts.remote.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import Timer from '@lucide/svelte/icons/timer';

	const d = await getDashboard();
	const ai = await getAiStatus();
	const myShift = $derived(await getMyShift());
	const onShift = $derived(await getOnShift());
	const shiftLog = $derived(await getShiftLog());
	const atRisk = $derived(await getAtRisk());
	const isAdmin = $derived(myShift.role === 'owner' || myShift.role === 'admin');
	let logOpen = $state(false);
	const tzName = $derived(d.timezone);
	const fmtLocal = (date: Date | string) =>
		`${localDate(new Date(date), tzName)}T${localTime(new Date(date), tzName)}`;
	const shiftHours = (s: { clockedInAt: Date | string; clockedOutAt: Date | string | null }) =>
		s.clockedOutAt
			? `${((new Date(s.clockedOutAt).getTime() - new Date(s.clockedInAt).getTime()) / 3_600_000).toFixed(1)}h`
			: 'open';
	async function editShift(s: {
		id: string;
		clockedInAt: Date | string;
		clockedOutAt: Date | string | null;
	}) {
		const inAt = prompt('Clock-in (YYYY-MM-DDTHH:mm, gym time)', fmtLocal(s.clockedInAt));
		if (inAt === null) return;
		const outAt = prompt(
			'Clock-out (YYYY-MM-DDTHH:mm, blank = still open)',
			s.clockedOutAt ? fmtLocal(s.clockedOutAt) : ''
		);
		if (outAt === null) return;
		try {
			await updateShift({
				id: s.id,
				clockedInAt: inAt.trim(),
				clockedOutAt: outAt.trim() || null
			});
			toast.success('Shift updated');
		} catch (e) {
			toast.error(errMsg(e, 'Could not update shift'));
		}
	}
	async function toggleShift() {
		try {
			if (myShift.shift) {
				await clockOut();
				toast.success('Clocked out');
			} else {
				await clockIn({});
				toast.success('Clocked in');
			}
		} catch (e) {
			toast.error(errMsg(e, 'Could not update shift'));
		}
	}
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
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<Card.Title class="flex items-center gap-2 text-base"
						><Timer class="size-4" /> On shift</Card.Title
					>
					<div class="flex items-center gap-1.5">
						<Button size="sm" variant="ghost" onclick={() => (logOpen = true)}>Log</Button>
						<Button size="sm" variant={myShift.shift ? 'outline' : 'default'} onclick={toggleShift}
							>{myShift.shift ? 'Clock out' : 'Clock in'}</Button
						>
					</div>
				</Card.Header>
				<Card.Content class="px-4">
					{#if onShift.length}
						<ul class="space-y-2">
							{#each onShift as r (r.shift.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<span class="truncate font-medium">{r.staffName}</span>
									<Badge variant="outline" class="shrink-0"
										>since {localTime(r.shift.clockedInAt, d.timezone)}{r.locationName
											? ` · ${r.locationName}`
											: ''}</Badge
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-muted-foreground">Nobody clocked in.</p>
					{/if}
				</Card.Content>
			</Card.Root>
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
			{#if atRisk.length}
				<Card.Root class="border-amber-500/50">
					<Card.Header class="flex flex-row items-center justify-between space-y-0">
						<Card.Title class="text-base">Slipping away</Card.Title>
						<a href="/reports" class="text-xs text-muted-foreground hover:underline">Reports</a>
					</Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each atRisk.slice(0, 6) as r (r.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/members/{r.memberId}" class="truncate hover:underline">{r.name}</a>
									<Badge variant="outline" class="shrink-0"
										>{r.daysSince ? `${r.daysSince}d ago` : 'never visited'}</Badge
									>
								</li>
							{/each}
						</ul>
						{#if atRisk.length > 6}
							<p class="mt-2 text-xs text-muted-foreground">
								and {atRisk.length - 6} more — see Reports
							</p>
						{/if}
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

<Dialog.Root bind:open={logOpen}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Shift log — last 30 days</Dialog.Title>
			<Dialog.Description>
				Staff clock-ins. Admins can close, correct, or delete entries.
			</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-96 overflow-y-auto rounded-lg border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Staff</Table.Head>
						<Table.Head>In</Table.Head>
						<Table.Head>Out</Table.Head>
						<Table.Head class="text-right">Hours</Table.Head>
						{#if isAdmin}<Table.Head class="w-24"></Table.Head>{/if}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each shiftLog as r (r.shift.id)}
						<Table.Row>
							<Table.Cell class="font-medium">
								{r.staffName}
								{#if r.locationName}
									<span class="text-xs text-muted-foreground"> · {r.locationName}</span>{/if}
							</Table.Cell>
							<Table.Cell class="text-sm whitespace-nowrap"
								>{formatDate(r.shift.clockedInAt)}
								{localTime(r.shift.clockedInAt, tzName)}</Table.Cell
							>
							<Table.Cell class="text-sm whitespace-nowrap">
								{#if r.shift.clockedOutAt}
									{formatDate(r.shift.clockedOutAt)} {localTime(r.shift.clockedOutAt, tzName)}
								{:else}
									<span class="text-amber-600 dark:text-amber-400">open</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{shiftHours(r.shift)}</Table.Cell>
							{#if isAdmin}
								<Table.Cell class="text-right">
									<div class="flex justify-end gap-0.5">
										{#if !r.shift.clockedOutAt}
											<Button
												size="xs"
												variant="ghost"
												title="Force clock-out now"
												onclick={async () => {
													try {
														await closeShift(r.shift.id);
														toast.success('Clocked out');
													} catch (e) {
														toast.error(errMsg(e, 'Could not close'));
													}
												}}>Close</Button
											>
										{/if}
										<Button
											size="xs"
											variant="ghost"
											class="text-muted-foreground"
											title="Edit times"
											onclick={() => editShift(r.shift)}><Pencil /></Button
										>
										<Button
											size="xs"
											variant="ghost"
											class="text-muted-foreground"
											title="Delete shift"
											onclick={async () => {
												if (!confirm('Delete this shift record?')) return;
												try {
													await deleteShift(r.shift.id);
													toast.success('Deleted');
												} catch (e) {
													toast.error(errMsg(e, 'Could not delete'));
												}
											}}><Trash2 /></Button
										>
									</div>
								</Table.Cell>
							{/if}
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={isAdmin ? 5 : 4} class="text-muted-foreground"
								>No shifts yet — use Clock in on the dashboard.</Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</Dialog.Content>
</Dialog.Root>
