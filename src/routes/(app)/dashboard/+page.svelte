<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import {
		getDashboard,
		getStaff,
		getChecklist,
		dismissChecklist
	} from '#lib/remote/workspace.remote.ts';
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
		getRota,
		getScheduledNow,
		setRota,
		setStaffRate,
		clockIn,
		clockOut,
		closeShift,
		updateShift,
		deleteShift,
		getDeskChecklist,
		toggleDeskTask,
		addDeskTask,
		removeDeskTask
	} from '#lib/remote/shifts.remote.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import Timer from '@lucide/svelte/icons/timer';
	import Check from '@lucide/svelte/icons/check';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import Circle from '@lucide/svelte/icons/circle';
	import { Progress } from '#lib/components/ui/progress/index.js';

	const d = await getDashboard();
	const ai = await getAiStatus();
	const myShift = $derived(await getMyShift());
	const onShift = $derived(await getOnShift());
	const scheduled = $derived(await getScheduledNow());
	const scheduledMissing = $derived(scheduled.filter((s) => !s.clockedInAt));
	const shiftLog = $derived(await getShiftLog());
	const rota = $derived(await getRota());
	const staff = $derived(await getStaff());
	const atRisk = $derived(await getAtRisk());
	const checklist = $derived(await getChecklist());
	const deskTasks = $derived(await getDeskChecklist());
	let newTask = $state('');
	async function addTask(e: SubmitEvent) {
		e.preventDefault();
		if (!newTask.trim()) return;
		try {
			await addDeskTask({ label: newTask.trim() });
			newTask = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add task'));
		}
	}
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
	const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	let rotaStaff = $state('');
	let rotaRate = $state('');
	let rotaWindows = $state<{ weekday: string; startTime: string; endTime: string }[]>([]);
	let rotaBusy = $state(false);

	function pickRotaStaff(memberId: string) {
		rotaStaff = memberId;
		const s = staff.find((x) => x.id === memberId);
		rotaRate = s?.hourlyRateCents != null ? (s.hourlyRateCents / 100).toFixed(2) : '';
		rotaWindows = rota
			.filter((r) => r.rota.memberId === memberId)
			.map((r) => ({
				weekday: String(r.rota.weekday),
				startTime: r.rota.startTime,
				endTime: r.rota.endTime
			}));
	}

	async function saveRota() {
		const cents = rotaRate.trim() === '' ? null : Math.round(Number(rotaRate) * 100);
		if (cents !== null && !Number.isFinite(cents)) {
			toast.error('Enter a valid hourly rate');
			return;
		}
		rotaBusy = true;
		try {
			await setStaffRate({ memberId: rotaStaff, hourlyRateCents: cents });
			await setRota({
				memberId: rotaStaff,
				windows: rotaWindows.map((w) => ({ ...w, weekday: Number(w.weekday) }))
			});
			toast.success('Rota saved');
		} catch (e) {
			toast.error(errMsg(e, 'Could not save rota'));
		}
		rotaBusy = false;
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
			href: '/checkins',
			sub: `last week ${d.checkInsLastWkDay}`
		},
		{
			label: 'Collected today',
			value: formatMoney(d.collectedToday, d.currency, true),
			icon: Wallet,
			href: '/billing',
			sub: `yesterday ${formatMoney(d.collectedYesterday, d.currency, true)} · 7d ${formatMoney(d.collectedWeek, d.currency, true)} vs ${formatMoney(d.collectedPrevWeek, d.currency, true)}`
		},
		{
			label: 'Check-ins this week',
			value: String(d.checkInsWeek),
			icon: Users,
			href: '/checkins',
			sub: `last week ${d.checkInsPrevWeek}`
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
	{#if checklist}
		{@const done = checklist.filter((i) => i.done).length}
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<div>
					<Card.Title class="text-base"
						>Getting set up — {done} of {checklist.length} done</Card.Title
					>
					<Card.Description>A few steps before launch</Card.Description>
				</div>
				<Button size="sm" variant="ghost" onclick={() => dismissChecklist()}>Dismiss</Button>
			</Card.Header>
			<Card.Content class="px-6 pb-5">
				<Progress value={done} max={checklist.length} class="mb-4" />
				<ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{#each checklist as item (item.key)}
						<li>
							<a href={item.href} class="flex items-center gap-2 text-sm hover:underline">
								{#if item.done}
									<Check class="size-4 shrink-0 text-green-600 dark:text-green-400" />
									<span class="text-muted-foreground line-through">{item.label}</span>
								{:else}
									<Circle class="size-4 shrink-0 text-muted-foreground/50" />
									{item.label}
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}

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
					{#if 'sub' in k && k.sub}<div class="text-xs text-muted-foreground">{k.sub}</div>{/if}
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
										{#if s.expected > 0 && new Date(s.startsAt).getTime() > Date.now()}
											<Badge variant="outline" class="ml-1">{s.expected} due in</Badge>
										{/if}
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
					{#if scheduledMissing.length}
						<ul class="mt-3 space-y-2 border-t pt-3">
							{#each scheduledMissing as s (s.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<span class="truncate text-muted-foreground">{s.staffName}</span>
									<Badge
										variant="outline"
										class="shrink-0 {s.late
											? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
											: ''}">{s.late ? 'late · ' : ''}rota {s.startTime}–{s.endTime}</Badge
									>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>

			{#if deskTasks.length || isAdmin}
				<Card.Root>
					<Card.Header>
						<Card.Title class="flex items-center gap-2 text-base"
							><ListChecks class="size-4" /> Desk checklist</Card.Title
						>
					</Card.Header>
					<Card.Content class="px-4">
						{#if deskTasks.length}
							<ul class="space-y-2">
								{#each deskTasks as t (t.id)}
									<li class="flex items-center gap-2 text-sm">
										<Checkbox
											checked={!!t.done}
											onCheckedChange={(v) =>
												toggleDeskTask({ taskId: t.id, done: v === true }).catch((e) =>
													toast.error(errMsg(e, 'Could not update task'))
												)}
										/>
										<span class={t.done ? 'text-muted-foreground line-through' : ''}>
											{t.label}
										</span>
										{#if t.done}
											<span class="ml-auto shrink-0 text-xs text-muted-foreground"
												>{t.done.staffName} · {localTime(t.done.at, d.timezone)}</span
											>
										{/if}
										{#if isAdmin}
											<Button
												size="icon"
												variant="ghost"
												class="size-6 shrink-0 text-muted-foreground {t.done ? '' : 'ml-auto'}"
												onclick={() =>
													removeDeskTask(t.id).catch((e) =>
														toast.error(errMsg(e, 'Could not remove task'))
													)}
												aria-label="Remove {t.label}"
											>
												<Trash2 class="size-3.5" />
											</Button>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-sm text-muted-foreground">
								No tasks yet — add the daily desk routine (unlock, tidy, check amenities).
							</p>
						{/if}
						{#if isAdmin}
							<form class="mt-3 flex gap-2 border-t pt-3" onsubmit={addTask}>
								<Input bind:value={newTask} placeholder="Add a task…" class="h-8" />
								<Button size="sm" type="submit" disabled={!newTask.trim()}>Add</Button>
							</form>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.pendingRequests.length}
				<Card.Root class="border-amber-500/50">
					<Card.Header><Card.Title class="text-base">Needs attention</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.pendingRequests as r (r.memberId + r.kind + r.planName)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a
										href={r.kind === 'equipment' || r.kind === 'empty'
											? '/schedule'
											: `/members/{r.memberId}`}
										class="truncate hover:underline"
										title={r.requestReason ?? undefined}>{r.memberName}</a
									>
									<Badge variant="outline" class="shrink-0">
										{r.kind === 'cancel'
											? `cancel ${r.planName}`
											: r.kind === 'addon'
												? `stop ${r.planName}`
												: r.kind === 'pt'
													? r.planName
													: r.kind === 'loan'
														? `kit ${r.planName}`
														: r.kind === 'trial'
															? r.planName
															: r.kind === 'sign'
																? r.planName
																: r.kind === 'deletion'
																	? 'delete my data'
																	: r.kind === 'equipment'
																		? r.planName
																		: r.kind === 'empty'
																			? r.planName
																			: r.kind === 'pickup'
																				? r.planName
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
			{#if d.inGymNow > 0}
				<Card.Root>
					<Card.Header
						><Card.Title class="text-base">Inside now · {d.inGymNow}</Card.Title></Card.Header
					>
					<Card.Content class="px-4">
						<p class="text-sm">
							{d.insideNames.slice(0, 8).join(', ')}{d.inGymNow > 8
								? ` +${d.inGymNow - 8} more`
								: ''}
						</p>
						<a
							href="/checkins"
							class="mt-2 inline-block text-xs text-muted-foreground hover:underline"
							>Check-in log</a
						>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.fullSessions?.length}
				<Card.Root class="border-amber-500/50">
					<Card.Header><Card.Title class="text-base">Full with a waitlist</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.fullSessions as s (s.sessionId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/schedule?focus={s.sessionId}" class="truncate hover:underline"
										>{s.className}
										{localDate(s.startsAt, d.timezone)}
										{localTime(s.startsAt, d.timezone)}</a
									>
									<Badge variant="outline" class="shrink-0">{s.waiting} waiting</Badge>
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
			{#if d.offSoon.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Off soon</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.offSoon as o (o.name + o.startDate)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<span class="truncate font-medium">{o.name}</span>
									<Badge variant="outline" class="shrink-0">
										{o.startDate === o.endDate ? o.startDate : `${o.startDate} → ${o.endDate}`}
									</Badge>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.inSessionNow.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">In session now</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.inSessionNow as sess (sess.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<span class="truncate font-medium">{sess.name}</span>
									<Badge variant="outline" class="shrink-0"
										>ends {localTime(sess.endsAt, d.timezone)} · {sess.booked}/{sess.capacity}</Badge
									>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.upcomingEvents.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Upcoming events</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.upcomingEvents as e (e.event.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<span class="truncate font-medium">{e.event.name}</span>
									<Badge variant="outline" class="shrink-0"
										>{formatDate(e.event.startsAt)} · {e.registered}/{e.event.capacity}</Badge
									>
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
			{#if d.expectedRevenue30d > 0}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Expected revenue</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<p class="text-2xl font-bold">{formatMoney(d.expectedRevenue30d, d.currency, true)}</p>
						<p class="text-xs text-muted-foreground">
							Open charges + membership renewals due in the next 30 days.
						</p>
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
			{#if d.trialsEnding.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Trials ending soon</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.trialsEnding as r (r.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/members/{r.memberId}" class="truncate hover:underline">{r.memberName}</a
									>
									<Badge variant="outline" class="shrink-0"
										>{r.planName} · bills {formatDate(r.firstBillAt)}</Badge
									>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			{#if d.packsExpiring.length}
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Packs expiring soon</Card.Title></Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.packsExpiring as r (r.memberId)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/members/{r.memberId}" class="truncate hover:underline">{r.memberName}</a
									>
									<Badge variant="outline" class="shrink-0"
										>{r.planName} · expires {formatDate(r.endsAt)}</Badge
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
		{#if isAdmin}
			<div class="mt-4 space-y-3 border-t pt-4">
				<p class="text-sm font-medium">Weekly rota</p>
				<Select.Root type="single" value={rotaStaff} onValueChange={(v) => pickRotaStaff(v)}>
					<Select.Trigger class="w-56"
						>{rotaStaff
							? staff.find((s) => s.id === rotaStaff)?.name
							: 'Pick a staff member'}</Select.Trigger
					>
					<Select.Content>
						{#each staff as s (s.id)}
							<Select.Item value={s.id}>{s.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if rotaStaff}
					{#each rotaWindows as w, i (i)}
						<div class="flex flex-wrap items-center gap-3">
							<Select.Root type="single" bind:value={rotaWindows[i].weekday}>
								<Select.Trigger class="w-32">{WEEKDAYS[Number(w.weekday)]}</Select.Trigger>
								<Select.Content>
									{#each WEEKDAYS as day, di (day)}
										<Select.Item value={String(di)}>{day}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							<Input type="time" class="w-28" bind:value={rotaWindows[i].startTime} />
							<span class="text-sm text-muted-foreground">–</span>
							<Input type="time" class="w-28" bind:value={rotaWindows[i].endTime} />
							<Button
								variant="ghost"
								size="icon"
								class="ml-auto"
								onclick={() => rotaWindows.splice(i, 1)}
								aria-label="Remove window"><Trash2 class="size-4" /></Button
							>
						</div>
					{/each}
					<div class="flex items-center gap-2">
						<label class="flex items-center gap-2 text-sm text-muted-foreground"
							>$/hour
							<Input
								type="number"
								min="0"
								step="0.25"
								placeholder="—"
								class="w-24"
								bind:value={rotaRate}
							/></label
						>
					</div>
					<div class="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								rotaWindows.push({ weekday: '1', startTime: '09:00', endTime: '17:00' })}
							>Add window</Button
						>
						<Button size="sm" disabled={rotaBusy} onclick={saveRota}
							>{rotaBusy ? 'Saving…' : 'Save rota'}</Button
						>
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
