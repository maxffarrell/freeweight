<script lang="ts">
	import { getContext } from 'svelte';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getMyClasses,
		getMyTeachingMonth,
		updateSession,
		getCoverNeeded,
		claimCover,
		getTimeOff,
		addTimeOff,
		removeTimeOff,
		getAvailability,
		setAvailability,
		getMyRatings,
		getPtRequests,
		approvePtRequest,
		declinePtRequest,
		getClassTypes
	} from '#lib/remote/schedule.remote.ts';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatDate } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';

	const settings = await getSettings();
	const tz = settings.timezone;
	const classes = await getMyClasses();
	const month = await getMyTeachingMonth();
	const cover = $derived(await getCoverNeeded());
	const timeOff = $derived(await getTimeOff());
	const availability = await getAvailability();
	const ratings = await getMyRatings();
	const ptRequests = $derived(await getPtRequests());
	const classTypes = $derived((await getClassTypes()).filter((c) => c.active));
	let ptApproveId = $state<string | null>(null);
	let ptApproveType = $state('');
	let ptApproveAt = $state('');
	let ptBusy = $state(false);
	async function approvePt(id: string) {
		if (!ptApproveType) return toast.error('Pick a class type');
		ptBusy = true;
		try {
			await approvePtRequest({
				id,
				classTypeId: ptApproveType,
				startsAt: ptApproveAt || undefined
			});
			toast.success('Session created and member booked');
			ptApproveId = null;
		} catch (err) {
			toast.error(errMsg(err, 'Could not approve'));
		}
		ptBusy = false;
	}
	async function declinePt(id: string) {
		try {
			await declinePtRequest(id);
			toast.success('Declined');
		} catch (err) {
			toast.error(errMsg(err, 'Could not decline'));
		}
	}
	const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	let windows = $state<{ weekday: string; startTime: string; endTime: string }[]>(
		availability.map((w) => ({
			weekday: String(w.weekday),
			startTime: w.startTime,
			endTime: w.endTime
		}))
	);
	let availBusy = $state(false);

	async function saveAvailability() {
		availBusy = true;
		try {
			await setAvailability({
				windows: windows.map((w) => ({ ...w, weekday: Number(w.weekday) }))
			});
			toast.success(
				windows.length ? 'Availability saved' : 'Availability cleared — you show as always free'
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not save availability'));
		}
		availBusy = false;
	}
	let offStart = $state('');
	let offEnd = $state('');
	let offNote = $state('');
	let offBusy = $state(false);

	async function addOff(e: SubmitEvent) {
		e.preventDefault();
		offBusy = true;
		try {
			await addTimeOff({
				startDate: offStart,
				endDate: offEnd || offStart,
				note: offNote.trim() || undefined
			});
			toast.success('Time off added — conflicting sessions are flagged for cover');
			offStart = offEnd = offNote = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
		offBusy = false;
	}
	async function removeOff(id: string) {
		try {
			await removeTimeOff(id);
			toast.success('Removed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove'));
		}
	}
	let toggling = $state<string | null>(null);
	let claiming = $state<string | null>(null);

	async function claim(id: string) {
		claiming = id;
		try {
			const r = await claimCover(id);
			toast.success(`You're covering ${r.className} — attendees are emailed`);
			await Promise.all([getCoverNeeded().refresh(), getMyClasses().refresh()]);
		} catch (err) {
			toast.error(errMsg(err, 'Could not claim cover'));
		}
		claiming = null;
	}

	async function toggleCover(id: string, on: boolean) {
		toggling = id;
		try {
			await updateSession({ id, needsCover: on });
			toast.success(on ? 'Marked as needing cover' : 'Cover request cleared');
			await getMyClasses().refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		toggling = null;
	}
	const __brand = getContext<{ whiteLabel?: boolean; orgName?: string } | undefined>('orgBrand');
	const appName = __brand?.whiteLabel && __brand?.orgName ? __brand.orgName : 'Freeweight';
</script>

<svelte:head><title>My classes · {appName}</title></svelte:head>

<PageHeader title="My classes" />

<div class="mx-auto w-full max-w-3xl space-y-4">
	<Card.Root>
		<Card.Header><Card.Title class="text-base">This month</Card.Title></Card.Header>
		<Card.Content class="flex gap-6 px-6 pb-4">
			<div>
				<p class="text-2xl font-semibold">{month.sessions}</p>
				<p class="text-xs text-muted-foreground">sessions taught</p>
			</div>
			<div>
				<p class="text-2xl font-semibold">{month.attendees}</p>
				<p class="text-xs text-muted-foreground">attendees booked</p>
			</div>
			{#if month.cancelled}
				<div>
					<p class="text-2xl font-semibold text-muted-foreground">{month.cancelled}</p>
					<p class="text-xs text-muted-foreground">cancelled</p>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Sessions you teach</Card.Title>
			<Card.Description>Next 2 weeks · live booked counts</Card.Description>
		</Card.Header>
		<Card.Content class="divide-y px-6 pb-4">
			{#if classes.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Nothing on the schedule for you yet.
				</p>
			{/if}
			{#each classes as row (row.session.id)}
				{@const needsCover = !!row.session.coverRequestedAt}
				<div class="flex items-center gap-3 py-3">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="size-2.5 shrink-0 rounded-full" style:background={row.color ?? '#888'}
							></span>
							<a
								href="/schedule?focus={row.session.id}"
								class="truncate font-medium hover:underline">{row.className}</a
							>
							{#if needsCover}<Badge variant="secondary" class="text-amber-600">needs cover</Badge
								>{/if}
							{#if row.session.checkinCode}
								<Badge variant="outline" class="font-mono tracking-widest"
									>code {row.session.checkinCode}</Badge
								>
							{/if}
						</div>
						<div class="text-sm text-muted-foreground">
							{formatDate(row.session.startsAt)} · {localTime(
								row.session.startsAt,
								tz
							)}{#if row.locationName}
								· {row.locationName}{/if}{#if row.session.streamUrl}
								· <a
									href={row.session.streamUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="text-primary hover:underline">stream</a
								>{/if}
						</div>
					</div>
					<div class="text-sm whitespace-nowrap text-muted-foreground">
						{row.booked}/{row.session.capacity ?? '∞'}{#if row.waitlisted}
							<span class="text-amber-600"> +{row.waitlisted}</span>{/if}
					</div>
					<Button
						size="sm"
						variant={needsCover ? 'outline' : 'secondary'}
						disabled={toggling === row.session.id}
						onclick={() => toggleCover(row.session.id, !needsCover)}
					>
						{needsCover ? 'Clear cover' : 'Request cover'}
					</Button>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Time off</Card.Title>
			<Card.Description>
				Dates you're away — your sessions then get flagged "needs cover" automatically.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 px-6 pb-4">
			{#if timeOff.length === 0}
				<p class="text-sm text-muted-foreground">No time off planned.</p>
			{/if}
			{#each timeOff as o (o.id)}
				<div class="flex items-center gap-3">
					<span class="text-sm">
						{o.startDate} → {o.endDate}{#if o.note}
							· <span class="text-muted-foreground">{o.note}</span>{/if}
					</span>
					<Button variant="ghost" size="sm" class="ml-auto" onclick={() => removeOff(o.id)}
						>Remove</Button
					>
				</div>
			{/each}
			<form class="flex flex-wrap items-end gap-3 pt-1" onsubmit={addOff}>
				<div class="space-y-1">
					<label for="off-start" class="text-xs text-muted-foreground">From</label>
					<Input id="off-start" type="date" required bind:value={offStart} />
				</div>
				<div class="space-y-1">
					<label for="off-end" class="text-xs text-muted-foreground">Until</label>
					<Input id="off-end" type="date" min={offStart} bind:value={offEnd} />
				</div>
				<Input
					class="min-w-36 flex-1"
					placeholder="Note (optional)"
					maxlength={120}
					bind:value={offNote}
				/>
				<Button type="submit" disabled={offBusy}>Add</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Availability</Card.Title>
			<Card.Description>
				Your usual weekly hours — schedulers get a warning if a session is placed outside them.
				Leave empty to show as always available.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 px-6 pb-4">
			{#if windows.length === 0}
				<p class="text-sm text-muted-foreground">No hours set — you show as always available.</p>
			{/if}
			{#each windows as w, i (i)}
				<div class="flex flex-wrap items-center gap-3">
					<Select.Root type="single" bind:value={windows[i].weekday}>
						<Select.Trigger class="w-32">{WEEKDAYS[Number(w.weekday)]}</Select.Trigger>
						<Select.Content>
							{#each WEEKDAYS as d, di (d)}
								<Select.Item value={String(di)}>{d}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Input type="time" class="w-28" bind:value={windows[i].startTime} />
					<span class="text-sm text-muted-foreground">–</span>
					<Input type="time" class="w-28" bind:value={windows[i].endTime} />
					<Button
						variant="ghost"
						size="icon"
						class="ml-auto"
						onclick={() => windows.splice(i, 1)}
						aria-label="Remove window"><Trash2 class="size-4" /></Button
					>
				</div>
			{/each}
			<div class="flex items-center gap-2 pt-1">
				<Button
					variant="outline"
					onclick={() => windows.push({ weekday: '1', startTime: '06:00', endTime: '12:00' })}
					>Add window</Button
				>
				<Button onclick={saveAvailability} disabled={availBusy}>Save</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Your ratings</Card.Title>
			<Card.Description>What members gave your classes</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 px-6 pb-4">
			{#if ratings.count === 0}
				<p class="text-sm text-muted-foreground">
					No ratings yet — members are asked to rate after class.
				</p>
			{:else}
				<p>
					<span class="text-3xl font-semibold tabular-nums">{ratings.avg}</span>
					<span class="text-amber-500">★</span>
					<span class="ml-2 text-sm text-muted-foreground"
						>from {ratings.count} rating{ratings.count === 1 ? '' : 's'}</span
					>
				</p>
				{#if ratings.recent.length}
					<div class="divide-y">
						{#each ratings.recent as r (r.className + r.startsAt.toISOString() + r.comment)}
							<div class="py-2 text-sm">
								<span class="text-amber-500">{'★'.repeat(r.rating)}</span>
								<span class="text-muted-foreground">{r.className} · {formatDate(r.startsAt)}</span>
								<p class="mt-0.5">{r.comment}</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>

	{#if ptRequests.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">PT requests</Card.Title>
				<Card.Description>Members asking for a 1:1 session</Card.Description>
			</Card.Header>
			<Card.Content class="divide-y px-6 pb-4">
				{#each ptRequests as r (r.request.id)}
					<div class="py-3">
						<div class="flex items-center gap-3">
							<div class="min-w-0 flex-1">
								<div class="truncate font-medium">{r.memberName}</div>
								<div class="text-sm text-muted-foreground">
									{formatDate(r.request.preferredAt)} · {localTime(r.request.preferredAt, tz)}
									{#if r.instructorName}
										· with {r.instructorName}{:else}
										· any coach{/if}{#if r.request.note}
										· “{r.request.note}”{/if}
								</div>
							</div>
							{#if ptApproveId === r.request.id}
								<Button variant="ghost" size="sm" onclick={() => (ptApproveId = null)}>Back</Button>
							{:else}
								<Button
									size="sm"
									onclick={() => {
										ptApproveId = r.request.id;
										ptApproveAt = '';
									}}>Approve</Button
								>
								<Button variant="ghost" size="sm" onclick={() => declinePt(r.request.id)}
									>Decline</Button
								>
							{/if}
						</div>
						{#if ptApproveId === r.request.id}
							<div class="mt-2 flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-2">
								<div class="min-w-40">
									<span class="text-xs text-muted-foreground">Class type</span>
									<Select.Root type="single" bind:value={ptApproveType}>
										<Select.Trigger class="h-8 w-full">
											{classTypes.find((c) => c.id === ptApproveType)?.name ?? 'Pick type'}
										</Select.Trigger>
										<Select.Content>
											{#each classTypes as ct (ct.id)}
												<Select.Item value={ct.id}>{ct.name}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
								<div>
									<span class="text-xs text-muted-foreground">Time</span>
									<Input
										type="datetime-local"
										class="h-8"
										bind:value={ptApproveAt}
										placeholder="requested time"
									/>
								</div>
								<Button size="sm" disabled={ptBusy} onclick={() => approvePt(r.request.id)}
									>Book it</Button
								>
							</div>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if cover.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Needs cover</Card.Title>
				<Card.Description>Open requests from other instructors</Card.Description>
			</Card.Header>
			<Card.Content class="divide-y px-6 pb-4">
				{#each cover as row (row.session.id)}
					<div class="flex items-center gap-3 py-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="size-2.5 shrink-0 rounded-full" style:background={row.color ?? '#888'}
								></span>
								<a
									href="/schedule?focus={row.session.id}"
									class="truncate font-medium hover:underline">{row.className}</a
								>
							</div>
							<div class="text-sm text-muted-foreground">
								{formatDate(row.session.startsAt)} · {localTime(
									row.session.startsAt,
									tz
								)}{#if row.locationName}
									· {row.locationName}{/if}{#if row.instructorName}
									· for {row.instructorName}{/if}
							</div>
						</div>
						<div class="text-sm whitespace-nowrap text-muted-foreground">
							{row.booked} booked
						</div>
						<Button
							size="sm"
							disabled={claiming === row.session.id}
							onclick={() => claim(row.session.id)}>Cover it</Button
						>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
