<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getSessions,
		getClassTypes,
		createClassType,
		createSession,
		updateSession,
		getRoster,
		bookSession,
		updateBooking,
		getInstructors
	} from '#lib/remote/schedule.remote.ts';
	import { getMembers } from '#lib/remote/members.remote.ts';
	import { getLocations, getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime, addDays } from '#lib/tz.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	const tz = (await getSettings()).timezone;
	const locations = await getLocations();
	const instructors = await getInstructors();
	const memberList = await getMembers();
	const classTypes = $derived(await getClassTypes());

	let weekStart = $state(localDate(new Date(), tz));
	const from = $derived(weekStart);
	const to = $derived(addDays(weekStart, 7));
	const sessions = $derived(await getSessions({ from, to }));

	// `.refresh()` re-runs this args instance, so the derived grid + roster update.
	async function reload() {
		await getSessions({ from, to }).refresh();
	}
	const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

	const days = $derived(
		Array.from({ length: 7 }, (_, i) => {
			const d = addDays(weekStart, i);
			return {
				date: d,
				label: dayFmt.format(new Date(`${d}T00:00:00Z`)),
				sessions: sessions.filter((s) => localDate(s.session.startsAt, tz) === d)
			};
		})
	);

	// ------- roster sheet -------
	let rosterOpen = $state(page.url.searchParams.get('focus') != null);
	let focusId = $state(page.url.searchParams.get('focus') ?? '');
	const roster = $derived(focusId ? await getRoster(focusId) : []);
	const focus = $derived(sessions.find((s) => s.session.id === focusId) ?? null);
	function openRoster(id: string) {
		focusId = id;
		rosterOpen = true;
	}
	if (focusId) void openRoster(focusId);

	let bookMemberId = $state('');
	async function book() {
		if (!bookMemberId) return;
		try {
			const b = await bookSession({ sessionId: focusId, memberId: bookMemberId });
			toast.success(b.status === 'waitlisted' ? 'Class full — waitlisted' : 'Booked');
			bookMemberId = '';
			await getRoster(focusId).refresh();
			await reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not book');
		}
	}
	async function setBooking(id: string, status: 'cancelled' | 'attended' | 'no_show') {
		try {
			await updateBooking({ id, status });
			await getRoster(focusId).refresh();
			await reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update');
		}
	}

	// ------- new session -------
	let sessOpen = $state(page.url.searchParams.get('new') === '1');
	let sessTypeId = $state('');
	let sessLocationId = $state('');
	let sessInstructorId = $state('');
	let sessStart = $state(localDate(new Date(), tz));
	let sessStartTime = $state('17:30');
	let sessRepeatUntil = $state('');
	let pending = $state(false);
	async function submitSession(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createSession({
				classTypeId: sessTypeId,
				locationId: sessLocationId || undefined,
				instructorId: sessInstructorId || undefined,
				startsAt: `${sessStart}T${sessStartTime}`,
				repeatUntil: sessRepeatUntil || undefined
			});
			toast.success('Session scheduled');
			sessOpen = false;
			await reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not schedule');
		}
		pending = false;
	}

	// ------- new class type -------
	let typeOpen = $state(false);
	let tName = $state('');
	let tColor = $state('#6366f1');
	let tDuration = $state(60);
	let tCapacity = $state(20);
	let tDescription = $state('');
	async function submitType(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createClassType({
				name: tName,
				color: tColor,
				durationMin: tDuration,
				capacity: tCapacity,
				description: tDescription || undefined
			});
			await getClassTypes().refresh();
			toast.success('Class type created');
			typeOpen = false;
			tName = tDescription = '';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create');
		}
		pending = false;
	}
</script>

<PageHeader title="Schedule">
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={() => (typeOpen = true)}
			><Plus /> Class type</Button
		>
		<Button size="sm" onclick={() => (sessOpen = true)}><Plus /> Session</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="flex items-center gap-2">
		<Button
			variant="outline"
			size="icon"
			onclick={async () => ((weekStart = addDays(weekStart, -7)), await reload())}
			><ChevronLeft /></Button
		>
		<Button
			variant="outline"
			size="sm"
			onclick={async () => ((weekStart = localDate(new Date(), tz)), await reload())}
			>This week</Button
		>
		<Button
			variant="outline"
			size="icon"
			onclick={async () => ((weekStart = addDays(weekStart, 7)), await reload())}
			><ChevronRight /></Button
		>
		<span class="ml-2 text-sm text-muted-foreground">Week of {weekStart}</span>
	</div>

	<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
		{#each days as day (day.date)}
			<div class="space-y-2">
				<p class="text-xs font-medium text-muted-foreground">
					{day.label} <span class="tabular-nums">{day.date.slice(5)}</span>
				</p>
				{#each day.sessions as s (s.session.id)}
					<button
						type="button"
						class="w-full rounded-lg border bg-card p-3 text-left transition-shadow hover:shadow-sm"
						onclick={() => openRoster(s.session.id)}
					>
						<div class="flex items-center gap-1.5">
							<span class="size-2 rounded-full" style:background={s.color}></span>
							<span class="truncate text-sm font-medium">{s.className}</span>
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							{localTime(s.session.startsAt, tz)}
							{#if s.instructorName}
								· {s.instructorName}{/if}
						</p>
						<div class="mt-2 flex items-center gap-1">
							<Badge variant="secondary" class="text-xs">{s.booked}/{s.session.capacity}</Badge>
							{#if s.waitlisted > 0}<Badge variant="outline" class="text-xs">+{s.waitlisted}</Badge
								>{/if}
							{#if s.session.cancelledAt}<Badge variant="destructive" class="text-xs"
									>cancelled</Badge
								>{/if}
						</div>
					</button>
				{:else}
					<p class="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
						—
					</p>
				{/each}
			</div>
		{/each}
	</div>
</div>

<Sheet.Root bind:open={rosterOpen}>
	<Sheet.Content class="w-full sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title class="flex items-center gap-2">
				{#if focus}<span class="size-2.5 rounded-full" style:background={focus.color}
					></span>{focus.className}
					· {focus ? localTime(focus.session.startsAt, tz) : ''}{/if}
			</Sheet.Title>
			<Sheet.Description>Roster — booked first, waitlist below.</Sheet.Description>
		</Sheet.Header>
		<div class="space-y-4 overflow-y-auto p-4">
			<Table.Root>
				<Table.Body>
					{#each roster.filter((r) => r.booking.status !== 'cancelled') as r (r.booking.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{r.memberName}</Table.Cell>
							<Table.Cell><StatusBadge status={r.booking.status} /></Table.Cell>
							<Table.Cell class="text-right">
								{#if r.booking.status === 'booked'}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										onclick={() => setBooking(r.booking.id, 'attended')}>Attended</Button
									>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										onclick={() => setBooking(r.booking.id, 'no_show')}>No-show</Button
									>
								{/if}
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-destructive"
									onclick={() => setBooking(r.booking.id, 'cancelled')}>Cancel</Button
								>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="text-muted-foreground">No bookings yet.</Table.Cell></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
			<div class="flex gap-2 border-t pt-4">
				<Select.Root type="single" bind:value={bookMemberId}>
					<Select.Trigger class="w-full">
						{memberList.find((mm) => mm.id === bookMemberId)?.name ?? 'Book a member…'}
					</Select.Trigger>
					<Select.Content>
						{#each memberList.filter((mm) => mm.status === 'active') as mm (mm.id)}
							<Select.Item value={mm.id}>{mm.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button onclick={book} disabled={!bookMemberId}>Book</Button>
			</div>
			{#if focus}
				<Button
					variant="outline"
					class="w-full"
					onclick={async () => {
						try {
							await updateSession({ id: focusId, cancelled: !focus!.session.cancelledAt });
							toast.success(focus!.session.cancelledAt ? 'Session restored' : 'Session cancelled');
							await reload();
							rosterOpen = false;
						} catch (err) {
							toast.error(err instanceof Error ? err.message : 'Failed');
						}
					}}
				>
					{focus.session.cancelledAt ? 'Restore session' : 'Cancel session'}
				</Button>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={sessOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Schedule a class</Dialog.Title>
			<Dialog.Description>Times are in the workspace timezone ({tz}).</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitSession}>
			<Field.Field>
				<Field.Label>Class type</Field.Label>
				<Select.Root type="single" bind:value={sessTypeId}>
					<Select.Trigger class="w-full">
						{classTypes.find((c) => c.id === sessTypeId)?.name ?? 'Choose…'}
					</Select.Trigger>
					<Select.Content>
						{#each classTypes.filter((c) => c.active) as c (c.id)}
							<Select.Item value={c.id}>{c.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label for="sess-date">Date</Field.Label>
					<Input id="sess-date" type="date" required bind:value={sessStart} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="sess-time">Start time</Field.Label>
					<Input id="sess-time" type="time" required bind:value={sessStartTime} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label>Location</Field.Label>
				<Select.Root type="single" bind:value={sessLocationId}>
					<Select.Trigger class="w-full">
						{locations.find((l) => l.id === sessLocationId)?.name ?? 'No location'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">No location</Select.Item>
						{#each locations.filter((l) => !l.archivedAt) as l (l.id)}
							<Select.Item value={l.id}>{l.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Instructor</Field.Label>
				<Select.Root type="single" bind:value={sessInstructorId}>
					<Select.Trigger class="w-full">
						{instructors.find((i) => i.id === sessInstructorId)?.name ?? 'Default'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">Default</Select.Item>
						{#each instructors as i (i.id)}
							<Select.Item value={i.id}>{i.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="sess-repeat">Repeat weekly until (optional)</Field.Label>
				<Input id="sess-repeat" type="date" bind:value={sessRepeatUntil} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending || !sessTypeId}
					>{pending ? 'Scheduling…' : 'Schedule'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={typeOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>New class type</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={submitType}>
			<Field.Field
				><Field.Label for="t-name">Name</Field.Label><Input
					id="t-name"
					required
					bind:value={tName}
					placeholder="HIIT, Yoga, Open gym…"
					autofocus
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="t-desc">Description</Field.Label><Input
					id="t-desc"
					bind:value={tDescription}
				/></Field.Field
			>
			<div class="grid grid-cols-3 gap-3">
				<Field.Field>
					<Field.Label for="t-color">Color</Field.Label>
					<Input id="t-color" type="color" bind:value={tColor} class="h-9 p-1" />
				</Field.Field>
				<Field.Field>
					<Field.Label for="t-dur">Minutes</Field.Label>
					<Input id="t-dur" type="number" min={5} bind:value={tDuration} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="t-cap">Capacity</Field.Label>
					<Input id="t-cap" type="number" min={1} bind:value={tCapacity} />
				</Field.Field>
			</div>
			<Dialog.Footer><Button type="submit" disabled={pending}>Create</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
