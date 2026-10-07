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
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getSessions,
		getClassTypes,
		createClassType,
		updateClassType,
		createSession,
		updateSession,
		getRoster,
		bookSession,
		updateBooking,
		getInstructors,
		getTemplates,
		createTemplate,
		deleteTemplate,
		emailSessionRoster,
		copyWeek
	} from '#lib/remote/schedule.remote.ts';
	import { getMembers } from '#lib/remote/members.remote.ts';
	import { getLocations, getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime, addDays } from '#lib/tz.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Copy from '@lucide/svelte/icons/copy';
	import Printer from '@lucide/svelte/icons/printer';
	import Mail from '@lucide/svelte/icons/mail';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';

	const settings = await getSettings();
	const tz = settings.timezone;
	const currency = settings.currency;
	const locations = await getLocations();
	const instructors = await getInstructors();
	const memberList = await getMembers();
	const classTypes = $derived(await getClassTypes());
	const templates = $derived(await getTemplates());

	let weekStart = $state(localDate(new Date(), tz));
	const from = $derived(weekStart);
	const to = $derived(addDays(weekStart, 7));
	const sessions = $derived(await getSessions({ from, to }));

	// `.refresh()` re-runs this args instance, so the derived grid + roster update.
	async function reload() {
		await getSessions({ from, to }).refresh();
	}
	const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

	// ------- filters -------
	let fType = $state('');
	let fInstructor = $state('');
	let fLocation = $state('');
	const visible = $derived(
		sessions.filter(
			(s) =>
				(!fType || s.session.classTypeId === fType) &&
				(!fInstructor || s.session.instructorId === fInstructor) &&
				(!fLocation || s.session.locationId === fLocation)
		)
	);

	const days = $derived(
		Array.from({ length: 7 }, (_, i) => {
			const d = addDays(weekStart, i);
			return {
				date: d,
				label: dayFmt.format(new Date(`${d}T00:00:00Z`)),
				sessions: visible.filter((s) => localDate(s.session.startsAt, tz) === d)
			};
		})
	);

	// ------- roster sheet -------
	let rosterOpen = $state(page.url.searchParams.get('focus') != null);
	let focusId = $state(page.url.searchParams.get('focus') ?? '');
	const roster = $derived(focusId ? await getRoster(focusId) : []);
	const focus = $derived(sessions.find((s) => s.session.id === focusId) ?? null);
	const printBooked = $derived(
		roster.filter((r) => r.booking.status === 'booked' || r.booking.status === 'attended')
	);
	const printWaitlist = $derived(roster.filter((r) => r.booking.status === 'waitlisted'));
	const waitlistPos = $derived(
		new Map(
			roster
				.filter((r) => r.booking.status === 'waitlisted')
				.map((r, i) => [r.booking.id, i + 1] as const)
		)
	);
	function openRoster(id: string) {
		focusId = id;
		rosterOpen = true;
	}
	if (focusId) void openRoster(focusId);

	let bookMemberId = $state('');
	async function book() {
		if (!bookMemberId) return;
		try {
			const m = memberList.find((mm) => mm.id === bookMemberId);
			const dropIn = m ? !m.planName : false;
			const b = await bookSession({ sessionId: focusId, memberId: bookMemberId, dropIn });
			toast.success(
				b.status === 'waitlisted'
					? 'Class full — waitlisted'
					: dropIn
						? `Drop-in booked — ${formatMoney(focus?.dropInPrice ?? 0, currency)} charge posted`
						: 'Booked'
			);
			bookMemberId = '';
			await getRoster(focusId).refresh();
			await reload();
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
	}
	async function setBooking(id: string, status: 'cancelled' | 'attended' | 'no_show') {
		try {
			await updateBooking({ id, status });
			await getRoster(focusId).refresh();
			await reload();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- edit session -------
	let editOpen = $state(false);
	let editDate = $state('');
	let editTime = $state('');
	let editCapacity = $state<number | null>(null);
	let editLocationId = $state('');
	let editInstructorId = $state('');
	let editNote = $state('');
	function openEdit() {
		if (!focus) return;
		editDate = localDate(focus.session.startsAt, tz);
		editTime = localTime(focus.session.startsAt, tz);
		editCapacity = focus.session.capacity;
		editLocationId = focus.session.locationId ?? '';
		editInstructorId = focus.session.instructorId ?? '';
		editNote = focus.session.note ?? '';
		editOpen = true;
	}
	async function submitEdit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await updateSession({
				id: focusId,
				startsAt: `${editDate}T${editTime}`,
				capacity: editCapacity ?? undefined,
				locationId: editLocationId || null,
				instructorId: editInstructorId || null,
				note: editNote.trim() || null
			});
			toast.success('Session updated');
			editOpen = false;
			await reload();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		pending = false;
	}

	// ------- message attendees -------
	let msgOpen = $state(false);
	let msgSubject = $state('');
	let msgBody = $state('');
	async function submitMsg(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const r = await emailSessionRoster({
				sessionId: focusId,
				subject: msgSubject,
				message: msgBody
			});
			toast.success(
				r.sent ? `Sent to ${r.sent} member${r.sent === 1 ? '' : 's'}` : 'Nobody to email'
			);
			msgOpen = false;
			msgSubject = '';
			msgBody = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
		}
		pending = false;
	}

	// ------- new session -------
	let sessOpen = $state(page.url.searchParams.get('new') === '1');
	let sessTypeId = $state('');
	let sessLocationId = $state('');
	let sessInstructorId = $state('');
	let sessStart = $state(localDate(new Date(), tz));
	let sessStartTime = $state('17:30');
	let sessRepeatUntil = $state('');
	let sessNote = $state('');
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
				repeatUntil: sessRepeatUntil || undefined,
				note: sessNote.trim() || undefined
			});
			toast.success('Session scheduled');
			sessOpen = false;
			await reload();
		} catch (err) {
			toast.error(errMsg(err, 'Could not schedule'));
		}
		pending = false;
	}

	// ------- recurring templates -------
	const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	let tplOpen = $state(false);
	let tplTypeId = $state('');
	let tplWeekday = $state('1');
	let tplTime = $state('06:00');
	let tplCapacity = $state<number | null>(null);
	async function submitTemplate(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createTemplate({
				classTypeId: tplTypeId,
				weekday: Number(tplWeekday),
				startTime: tplTime,
				capacity: tplCapacity ?? null
			});
			toast.success('Recurring template added — sessions generated 2 weeks out');
			await getTemplates().refresh();
			await reload();
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
		pending = false;
	}
	async function removeTemplate(id: string) {
		try {
			await deleteTemplate(id);
			await getTemplates().refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- class types -------
	let typeOpen = $state(false);
	let editTypeId = $state<string | null>(null);
	let tName = $state('');
	let tColor = $state('#6366f1');
	let tDuration = $state(60);
	let tCapacity = $state(20);
	let tDropIn = $state('');
	let tPayRate = $state('');
	let tDescription = $state('');
	let tActive = $state(true);
	function editType(c: (typeof classTypes)[number]) {
		editTypeId = c.id;
		tName = c.name;
		tDescription = c.description ?? '';
		tColor = c.color || '#6366f1';
		tDuration = c.durationMin;
		tCapacity = c.capacity;
		tDropIn = c.dropInPrice != null ? (c.dropInPrice / 100).toFixed(2) : '';
		tPayRate = c.payRate != null ? (c.payRate / 100).toFixed(2) : '';
		tActive = c.active;
	}
	function resetTypeForm() {
		editTypeId = null;
		tName = tDescription = '';
		tColor = '#6366f1';
		tDuration = 60;
		tCapacity = 20;
		tDropIn = '';
		tPayRate = '';
		tActive = true;
	}
	async function submitType(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const body = {
				name: tName,
				color: tColor,
				durationMin: tDuration,
				capacity: tCapacity,
				dropInPrice: tDropIn ? Math.round(parseFloat(tDropIn) * 100) : null,
				payRate: tPayRate ? Math.round(parseFloat(tPayRate) * 100) : null,
				description: tDescription || undefined,
				active: tActive
			};
			if (editTypeId) await updateClassType({ id: editTypeId, ...body });
			else await createClassType(body);
			await getClassTypes().refresh();
			toast.success(editTypeId ? 'Class updated' : 'Class type created');
			resetTypeForm();
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}
</script>

<PageHeader title="Schedule">
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={() => (tplOpen = true)}
			><Repeat /> Recurring</Button
		>
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
		<Button
			variant="outline"
			size="sm"
			disabled={pending}
			onclick={async () => {
				pending = true;
				try {
					const r = await copyWeek({ week: weekStart });
					toast.success(
						r.created
							? `Copied ${r.created} session${r.created === 1 ? '' : 's'} to next week` +
									(r.skipped ? ` — ${r.skipped} skipped (gym closed)` : '')
							: 'No sessions to copy'
					);
					await reload();
				} catch (err) {
					toast.error(errMsg(err, 'Could not copy week'));
				}
				pending = false;
			}}><Copy /> Copy week</Button
		>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			<select bind:value={fType} class="h-8 rounded-md border bg-transparent px-2 text-sm">
				<option value="">All classes</option>
				{#each classTypes as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			<select bind:value={fInstructor} class="h-8 rounded-md border bg-transparent px-2 text-sm">
				<option value="">All instructors</option>
				{#each instructors as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
			</select>
			{#if locations.filter((l) => !l.archivedAt).length > 1}
				<select bind:value={fLocation} class="h-8 rounded-md border bg-transparent px-2 text-sm">
					<option value="">All locations</option>
					{#each locations.filter((l) => !l.archivedAt) as l (l.id)}
						<option value={l.id}>{l.name}</option>
					{/each}
				</select>
			{/if}
		</div>
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
		{#if focus?.session.note}
			<p class="border-b px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
				{focus.session.note}
			</p>
		{/if}
		<div class="space-y-4 overflow-y-auto p-4">
			<Table.Root>
				<Table.Body>
					{#each roster.filter((r) => r.booking.status !== 'cancelled') as r (r.booking.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{r.memberName}</Table.Cell>
							<Table.Cell>
								<StatusBadge status={r.booking.status} />
								{#if r.booking.status === 'waitlisted'}
									<span class="ml-1 text-xs text-muted-foreground"
										>#{waitlistPos.get(r.booking.id)}</span
									>
								{/if}
							</Table.Cell>
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
			<div class="flex justify-end gap-1">
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (msgOpen = true)}
					><Mail class="mr-1 h-3.5 w-3.5" /> Message attendees</Button
				>
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => window.print()}
					><Printer class="mr-1 h-3.5 w-3.5" /> Print roster</Button
				>
			</div>
			<div class="flex gap-2 border-t pt-4">
				<Select.Root type="single" bind:value={bookMemberId}>
					<Select.Trigger class="w-full">
						{memberList.find((mm) => mm.id === bookMemberId)?.name ?? 'Book a member…'}
					</Select.Trigger>
					<Select.Content>
						{#each memberList.filter((mm) => mm.status === 'active') as mm (mm.id)}
							<Select.Item value={mm.id}
								>{mm.name}{#if !mm.planName}
									(drop-in){/if}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					onclick={book}
					disabled={!bookMemberId ||
						(!memberList.find((mm) => mm.id === bookMemberId)?.planName && !focus?.dropInPrice)}
					>Book</Button
				>
			</div>
			{#if bookMemberId && !memberList.find((mm) => mm.id === bookMemberId)?.planName}
				<p class="text-xs text-amber-600 dark:text-amber-400">
					{#if focus?.dropInPrice}
						No active membership — booking posts a {formatMoney(focus.dropInPrice, currency)}
						drop-in charge.
					{:else}
						No active membership and no drop-in price on this class — can't book.
					{/if}
				</p>
			{/if}
			{#if focus}
				<Button variant="outline" class="w-full" onclick={openEdit}>Edit session</Button>
				<Button
					variant="ghost"
					class="w-full"
					onclick={() => {
						if (!focus) return;
						sessTypeId = focus.session.classTypeId;
						sessLocationId = focus.session.locationId ?? '';
						sessInstructorId = focus.session.instructorId ?? '';
						sessStart = addDays(localDate(focus.session.startsAt, tz), 7);
						sessStartTime = localTime(focus.session.startsAt, tz);
						sessOpen = true;
					}}>Duplicate next week</Button
				>
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
							toast.error(errMsg(err, 'Failed'));
						}
					}}
				>
					{focus.session.cancelledAt ? 'Restore session' : 'Cancel session'}
				</Button>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

{#if focus}
	<div id="roster-print" class="hidden print:block">
		<h1 class="text-2xl font-bold">{focus.className}</h1>
		<p class="mt-1 text-sm">
			{formatDate(focus.session.startsAt)} · {localTime(
				focus.session.startsAt,
				tz
			)}{#if focus.instructorName}
				· {focus.instructorName}{/if}{#if focus.locationName}
				· {focus.locationName}{/if}
			· {focus.session.capacity} spots
		</p>
		{#if focus.session.note}<p class="mt-1 text-sm italic">{focus.session.note}</p>{/if}
		<table class="mt-6 w-full border-collapse text-left text-sm">
			<thead>
				<tr class="border-b-2 border-black">
					<th class="py-1">Member</th>
					<th class="w-24">Status</th>
					<th class="w-48">Sign-in</th>
				</tr>
			</thead>
			<tbody>
				{#each printBooked as r (r.booking.id)}
					<tr class="border-b">
						<td class="py-2">{r.memberName}</td>
						<td class="capitalize">{r.booking.status.replace('_', ' ')}</td>
						<td><span class="block h-6 border-b"></span></td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if printWaitlist.length}
			<h2 class="mt-8 font-semibold">Waitlist</h2>
			<ol class="mt-1 list-decimal pl-6 text-sm">
				{#each printWaitlist as r (r.booking.id)}
					<li class="py-0.5">{r.memberName}</li>
				{/each}
			</ol>
		{/if}
	</div>
{/if}

<svelte:head>
	<style>
		@media print {
			body * {
				visibility: hidden;
			}
			#roster-print,
			#roster-print * {
				visibility: visible;
			}
			#roster-print {
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
			}
		}
	</style>
</svelte:head>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit {focus?.className ?? 'session'}</Dialog.Title>
			<Dialog.Description>
				Booked members are emailed when the instructor or time/location changes.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitEdit}>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label for="edit-date">Date</Field.Label>
					<Input id="edit-date" type="date" required bind:value={editDate} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="edit-time">Start time</Field.Label>
					<Input id="edit-time" type="time" required bind:value={editTime} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="edit-cap">Capacity</Field.Label>
				<Input id="edit-cap" type="number" min={1} required bind:value={editCapacity} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Location</Field.Label>
				<Select.Root type="single" bind:value={editLocationId}>
					<Select.Trigger class="w-full">
						{locations.find((l) => l.id === editLocationId)?.name ?? 'No location'}
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
				<Select.Root type="single" bind:value={editInstructorId}>
					<Select.Trigger class="w-full">
						{instructors.find((i) => i.id === editInstructorId)?.name ?? 'Default'}
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
				<Field.Label for="edit-note">Note (optional)</Field.Label>
				<Input
					id="edit-note"
					bind:value={editNote}
					placeholder="Shown on the roster — e.g. pool closed, bring mats"
					maxlength={500}
				/>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

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
			<Field.Field>
				<Field.Label for="sess-note">Note (optional)</Field.Label>
				<Input
					id="sess-note"
					bind:value={sessNote}
					placeholder="Shown on the roster"
					maxlength={500}
				/>
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
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header><Dialog.Title>Class types</Dialog.Title></Dialog.Header>
		{#if classTypes.length}
			<div class="mb-4 divide-y rounded-lg border">
				{#each classTypes as c (c.id)}
					<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
						<div class="flex min-w-0 items-center gap-2">
							<span
								class="h-2.5 w-2.5 shrink-0 rounded-full"
								style:background={c.color || '#94a3b8'}
							></span>
							<span class="truncate">
								{c.name}
								<span class="text-muted-foreground"
									>· {c.durationMin}m · {c.capacity} seats{c.dropInPrice
										? ` · $${(c.dropInPrice / 100).toFixed(2)} drop-in`
										: ''}</span
								>
							</span>
							{#if !c.active}<Badge variant="outline">inactive</Badge>{/if}
							{#if editTypeId === c.id}<Badge variant="secondary">editing</Badge>{/if}
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="h-7 shrink-0 px-2 text-xs"
							onclick={() => editType(c)}>Edit</Button
						>
					</div>
				{/each}
			</div>
		{/if}
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
			<Field.Field>
				<Field.Label for="t-dropin">
					Drop-in price <span class="text-muted-foreground">(optional)</span>
				</Field.Label>
				<Input
					id="t-dropin"
					type="number"
					min={0}
					step="0.01"
					bind:value={tDropIn}
					placeholder="0.00 — leave empty to not sell drop-ins"
				/>
				<Field.Description>
					Visitors can book single classes on your public page at this price.
				</Field.Description>
			</Field.Field>
			<Field.Field>
				<Field.Label for="t-payrate">
					Instructor pay / class <span class="text-muted-foreground">(optional)</span>
				</Field.Label>
				<Input
					id="t-payrate"
					type="number"
					min={0}
					step="0.01"
					bind:value={tPayRate}
					placeholder="0.00 — feeds the payroll report"
				/>
			</Field.Field>
			{#if editTypeId}
				<div class="flex items-center justify-between rounded-lg border px-3 py-2">
					<span class="text-sm">Active — shows in booking picks</span>
					<Switch bind:checked={tActive} />
				</div>
			{/if}
			<Dialog.Footer>
				{#if editTypeId}
					<Button type="button" variant="ghost" onclick={resetTypeForm}>Cancel edit</Button>
				{/if}
				<Button type="submit" disabled={pending}>{editTypeId ? 'Save' : 'Create'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={tplOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header><Dialog.Title>Recurring templates</Dialog.Title></Dialog.Header>
		<p class="text-sm text-muted-foreground">
			Templates generate real sessions about two weeks ahead, every day. Editing or cancelling a
			generated session only changes that one session.
		</p>
		<form class="grid gap-3" onsubmit={submitTemplate}>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Field.Field class="col-span-2 sm:col-span-2">
					<Field.Label>Class</Field.Label>
					<Select.Root type="single" bind:value={tplTypeId}>
						<Select.Trigger class="w-full">
							{classTypes.find((c) => c.id === tplTypeId)?.name ?? 'Pick a class'}
						</Select.Trigger>
						<Select.Content>
							{#each classTypes as c (c.id)}
								<Select.Item value={c.id}>{c.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.Label>Day</Field.Label>
					<Select.Root type="single" bind:value={tplWeekday}>
						<Select.Trigger class="w-full">{WEEKDAYS[Number(tplWeekday)]}</Select.Trigger>
						<Select.Content>
							{#each WEEKDAYS as d, i (d)}
								<Select.Item value={String(i)}>{d}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.Label for="tpl-time">Time</Field.Label>
					<Input id="tpl-time" type="time" bind:value={tplTime} required />
				</Field.Field>
			</div>
			<div class="flex items-end gap-3">
				<Field.Field class="w-28">
					<Field.Label for="tpl-cap">
						Seats <span class="text-muted-foreground">(opt.)</span>
					</Field.Label>
					<Input id="tpl-cap" type="number" min={1} bind:value={tplCapacity} />
				</Field.Field>
				<Button type="submit" disabled={pending || !tplTypeId}>Add template</Button>
			</div>
		</form>
		{#if templates.length}
			<div class="divide-y rounded-lg border">
				{#each templates as t (t.template.id)}
					<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
						<div class="flex items-center gap-2">
							<span class="h-2.5 w-2.5 rounded-full" style:background={t.color || '#94a3b8'}></span>
							<span>
								<strong>{WEEKDAYS[t.template.weekday]}s {t.template.startTime}</strong>
								{t.className}{t.instructorName ? ` · ${t.instructorName}` : ''}{t.locationName
									? ` · ${t.locationName}`
									: ''}{t.template.capacity ? ` · ${t.template.capacity} seats` : ''}
							</span>
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="h-7 w-7 text-muted-foreground"
							onclick={() => removeTemplate(t.template.id)}><Trash2 class="h-4 w-4" /></Button
						>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">No templates yet.</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={msgOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Message attendees</Dialog.Title>
			<Dialog.Description
				>Emails everyone booked or waitlisted on {focus?.className ??
					'this session'}.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitMsg}>
			<Field.Field>
				<Field.Label for="msg-subject">Subject</Field.Label>
				<Input
					id="msg-subject"
					required
					bind:value={msgSubject}
					placeholder="Heads up about class"
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="msg-body">Message</Field.Label>
				<Textarea id="msg-body" required rows={4} bind:value={msgBody} />
			</Field.Field>
			<Button type="submit" class="w-full" disabled={pending}>Send to attendees</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>
