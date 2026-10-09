<script lang="ts">
	import type { PageProps } from './$types';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import Logo from '#lib/components/app/logo.svelte';
	import {
		getTodayCheckIns,
		recordCheckIn,
		checkOut,
		voidCheckIn,
		getMembers,
		getUpNext,
		createMember,
		logGuestVisit,
		getDependents
	} from '#lib/remote/members.remote.ts';
	import { getRoster, checkInRoster } from '#lib/remote/schedule.remote.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { getLocations, getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';
	import LogOut from '@lucide/svelte/icons/log-out';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	const { data }: PageProps = $props();

	const settings = await getSettings();
	const locations = await getLocations().then((l) => l.filter((x) => !x.archivedAt));
	const tz = settings.timezone;
	const liveLocations = $derived(locations);

	let checkIns = $state(await getTodayCheckIns());
	const inside = $derived(checkIns.filter((c) => !c.checkIn.checkedOutAt).length);
	let upNext = $state(await getUpNext());
	let code = $state('');
	let locationId = $state(liveLocations[0]?.id ?? '');

	const MILESTONES = new Set([10, 25, 50, 100, 250, 500, 1000]);
	/** " — first visit!" / " — visit #100" suffix for the check-in flash. */
	function visitNote(n: number | undefined) {
		if (!n) return '';
		if (n === 1) return ' — first visit!';
		if (MILESTONES.has(n)) return ` — visit #${n}!`;
		return '';
	}
	let suggestions = $state<
		{
			id: string;
			name: string;
			status: string;
			openBalance: number;
			planName: string | null;
			photoDocumentId: string | null;
			deskNote: string | null;
			tags: string[];
		}[]
	>([]);
	/** Dependents per suggested member — family check-in rows under each result. */
	let families = $state<
		Record<
			string,
			{
				id: string;
				name: string;
				status: string;
				deskNote: string | null;
				photoDocumentId: string | null;
			}[]
		>
	>({});
	let flash = $state<{
		ok: boolean;
		text: string;
		photo?: string | null;
		note?: string | null;
	} | null>(null);
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.filter(Boolean)
			.slice(0, 2)
			.join('')
			.toUpperCase();
	let pending = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let now = $state(new Date());
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const t = setInterval(async () => {
			now = new Date();
			upNext = await getUpNext();
			checkIns = await getTodayCheckIns();
		}, 30_000);
		inputEl?.focus();
		return () => clearInterval(t);
	});

	function showFlash(ok: boolean, text: string, photo?: string | null, note?: string | null) {
		clearTimeout(flashTimer);
		flash = { ok, text, photo, note };
		flashTimer = setTimeout(() => (flash = null), 3000);
	}

	let searched = $state(false);
	let rosterOpen = $state(false);
	let rosterSess = $state<(typeof upNext)[number] | null>(null);
	const sessRoster = $derived(rosterSess ? await getRoster(rosterSess.session.id) : []);
	function openSessionRoster(s: (typeof upNext)[number]) {
		rosterSess = s;
		rosterOpen = true;
	}
	let rosterBusy = $state('');
	async function rosterCheckIn(memberId: string, memberName: string) {
		rosterBusy = memberId;
		try {
			const r = await recordCheckIn({
				code: memberId,
				locationId: rosterSess?.session.locationId ?? null
			});
			showFlash(
				true,
				`${memberName} checked in` +
					(r.birthday ? ' — happy birthday!' : '') +
					visitNote(r.visits) +
					(r.creditsLeft != null ? ` — ${r.creditsLeft} ${r.creditsClass ?? 'class'} left` : ''),
				r.member.photoDocumentId,
				[
					r.waiverMissing ? 'waiver unsigned' : '',
					r.suspended ? 'membership suspended' : '',
					r.creditsLeft === 0 ? 'pack empty' : '',
					r.guestPassesLeft != null ? `${r.guestPassesLeft} guest passes left this month` : '',
					r.nextClass ? `next: ${r.nextClass.className} at ${localTime(r.nextClass.startsAt, tz)}` : ''
				]
					.filter(Boolean)
					.join(' · ') || null
			);
			await getRoster(rosterSess!.session.id).refresh();
		} catch (err) {
			showFlash(false, errMsg(err, 'Could not check in'));
		}
		rosterBusy = '';
	}
	async function checkInAll() {
		rosterBusy = 'all';
		try {
			const r = await checkInRoster(rosterSess!.session.id);
			showFlash(
				true,
				r.checkedIn
					? `Checked in ${r.checkedIn} member${r.checkedIn === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}` +
							(r.birthdays.length ? ` — happy birthday, ${r.birthdays.join(' + ')}!` : '')
					: 'Nobody left to check in'
			);
			await getRoster(rosterSess!.session.id).refresh();
		} catch (err) {
			showFlash(false, errMsg(err, 'Could not check in'));
		}
		rosterBusy = '';
	}
	let walkInOpen = $state(false);
	let wName = $state('');
	let wPhone = $state('');
	let wEmail = $state('');
	let wPending = $state(false);
	let guestOpen = $state(false);
	let guestFor = $state<{ id: string; name: string } | null>(null);
	let guestName = $state('');
	let gPending = $state(false);

	function openGuest(m: { id: string; name: string }) {
		guestFor = m;
		guestName = '';
		guestOpen = true;
	}

	async function saveGuest(e: SubmitEvent) {
		e.preventDefault();
		if (gPending || !guestFor || !guestName.trim()) return;
		gPending = true;
		try {
			await logGuestVisit({ memberId: guestFor.id, guestName: guestName.trim() });
			showFlash(true, `${guestName.trim()} (guest of ${guestFor.name}) checked in`);
			guestOpen = false;
			checkIns = await getTodayCheckIns();
		} catch (err) {
			showFlash(false, errMsg(err, 'Guest check-in failed'));
		}
		gPending = false;
	}

	function onInput() {
		clearTimeout(searchTimer);
		const q = code.trim();
		searched = false;
		// fw1.* tokens and member ids aren't searchable text — skip the lookup.
		if (q.length < 2 || q.startsWith('fw1.')) {
			suggestions = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			suggestions = (await getMembers({ q })).slice(0, 5);
			searched = true;
			families = {};
			for (const m of suggestions) {
				families[m.id] = await getDependents(m.id).catch(() => []);
			}
		}, 150);
	}

	function openWalkIn() {
		wName = code.trim();
		walkInOpen = true;
	}

	async function saveWalkIn(e: SubmitEvent) {
		e.preventDefault();
		if (wPending || !wName.trim()) return;
		wPending = true;
		try {
			const m = await createMember({
				name: wName.trim(),
				phone: wPhone.trim() || undefined,
				email: wEmail.trim() || undefined
			});
			walkInOpen = false;
			wName = wPhone = wEmail = '';
			await checkIn(m!.id);
		} catch (err) {
			showFlash(false, errMsg(err, 'Could not add walk-in'));
		}
		wPending = false;
	}

	async function checkIn(memberIdOrCode: string) {
		pending = true;
		try {
			const r = await recordCheckIn({
				code: memberIdOrCode,
				locationId: locationId || undefined
			});
			showFlash(
				true,
				r.checkedOut
					? `${r.member.name} checked out`
					: `${r.member.name} checked in` +
							(r.attended ? ` — attended ${r.attended} class${r.attended > 1 ? 'es' : ''}` : '') +
							(r.birthday ? ' — happy birthday!' : '') +
							visitNote(r.visits) +
							(r.creditsLeft != null && r.creditsLeft > 0
								? ` — ${r.creditsLeft} ${r.creditsClass ?? 'class'} left`
								: ''),
				r.member.photoDocumentId,
				[
					r.waiverMissing ? 'waiver unsigned' : '',
					r.suspended ? 'membership suspended' : '',
					r.creditsLeft === 0 ? 'pack empty' : '',
					!r.checkedOut && r.guestPassesLeft != null
						? `${r.guestPassesLeft} guest passes left this month`
						: '',
					!r.checkedOut && r.nextClass
						? `next: ${r.nextClass.className} at ${localTime(r.nextClass.startsAt, tz)}`
						: '',
					r.member.deskNote
				]
					.filter(Boolean)
					.join(' · ') || null
			);
			checkIns = await getTodayCheckIns();
		} catch (err) {
			showFlash(false, errMsg(err, 'Check-in failed'));
		}
		code = '';
		suggestions = [];
		pending = false;
		inputEl?.focus();
	}

	async function checkOutRow(id: string) {
		try {
			await checkOut(id);
			checkIns = await getTodayCheckIns();
		} catch (err) {
			showFlash(false, errMsg(err, 'Check-out failed'));
		}
	}

	async function voidRow(id: string) {
		if (!confirm('Void this check-in? Same-day attendance marks revert too.')) return;
		try {
			await voidCheckIn(id);
			checkIns = await getTodayCheckIns();
			showFlash(true, 'Check-in voided');
		} catch (err) {
			showFlash(false, errMsg(err, 'Could not void'));
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (pending || !code.trim()) return;
		checkIn(code.trim());
	}
</script>

<div class="flex min-h-svh flex-col bg-background">
	<header class="flex items-center justify-between gap-4 border-b px-6 py-4">
		<div class="flex items-center gap-3">
			{#if settings.logoDocumentId}
				<img src="/api/logo/{settings.logoDocumentId}" alt="" class="h-8 w-auto object-contain" />
			{:else}
				<Logo class="size-8" />
			{/if}
			<div>
				<p class="font-semibold">{data.gymName}</p>
				<p class="text-xs text-muted-foreground">Front-desk check-in</p>
			</div>
		</div>
		<div class="flex items-center gap-4 text-sm">
			<span class="tabular-nums">{localTime(now, tz)}</span>
			<Badge
				variant="secondary"
				class={settings.occupancyCap != null && inside >= settings.occupancyCap
					? 'border-amber-500 text-amber-600'
					: ''}
			>
				{checkIns.length} today · {inside} inside{#if settings.occupancyCap != null}
					/ {settings.occupancyCap}{/if}{#if settings.occupancyCap != null && inside >= settings.occupancyCap}
					— at capacity{/if}
			</Badge>
			<Button variant="ghost" size="sm" href="/wall">PR board</Button>
			<Button variant="ghost" size="sm" href="/checkins"><LogOut /> Exit kiosk</Button>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
		{#if flash}
			<div
				class="flex items-center gap-4 rounded-xl border-2 px-6 py-5 text-xl font-medium {flash.ok
					? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400'
					: 'border-destructive bg-destructive/10 text-destructive'}"
			>
				{#if flash.photo}
					<img
						src="/api/documents/{flash.photo}"
						alt=""
						class="size-12 shrink-0 rounded-full object-cover"
					/>
				{:else if flash.ok}<CircleCheck class="size-8 shrink-0" />{:else}<TriangleAlert
						class="size-8 shrink-0"
					/>{/if}
				<span>
					{flash.text}
					{#if flash.note}
						<span class="ml-2 rounded-md bg-amber-500/25 px-2 py-0.5 text-base font-semibold"
							>{flash.note}</span
						>
					{/if}
				</span>
			</div>
		{/if}

		<form onsubmit={submit} class="space-y-3">
			<label class="flex items-center gap-2 text-sm font-medium" for="kiosk-code">
				<QrCode class="size-4" /> Scan a member QR code, or type their name
			</label>
			<Input
				id="kiosk-code"
				bind:ref={inputEl}
				bind:value={code}
				oninput={onInput}
				placeholder="fw1… or member name"
				autocomplete="off"
				class="h-14 font-mono text-xl"
			/>
			{#if suggestions.length}
				<div class="divide-y rounded-lg border">
					{#each suggestions as m (m.id)}
						<div class="flex items-center">
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted disabled:opacity-50"
								disabled={pending || m.status !== 'active'}
								onclick={() => checkIn(m.id)}
							>
								<span class="flex min-w-0 items-center gap-3">
									{#if m.photoDocumentId}
										<img
											src="/api/documents/{m.photoDocumentId}"
											alt=""
											class="size-9 shrink-0 rounded-full object-cover"
										/>
									{:else}
										<span
											class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
											>{initials(m.name)}</span
										>
									{/if}
									<span class="min-w-0">
										<span class="block truncate font-medium">
											{m.name}
											{#if m.planName}
												<span class="ml-1.5 text-xs font-normal text-muted-foreground"
													>{m.planName}</span
												>
											{/if}
											{#each m.tags.slice(0, 3) as t (t)}
												<Badge variant="secondary" class="ml-1 px-1 py-0 text-[10px]">{t}</Badge>
											{/each}
										</span>
										{#if m.deskNote}
											<span
												class="block truncate text-xs font-medium text-amber-600 dark:text-amber-400"
												>{m.deskNote}</span
											>
										{/if}
									</span>
								</span>
								<span class="flex items-center gap-2">
									{#if m.status !== 'active'}<Badge variant="outline">{m.status}</Badge>{/if}
									{#if m.openBalance > 0}
										<Badge variant="destructive"
											>owes {formatMoney(m.openBalance, settings.currency)}</Badge
										>
									{/if}
								</span>
							</button>
							{#if m.status === 'active'}
								<button
									type="button"
									class="shrink-0 border-l px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
									onclick={() => openGuest(m)}>+ Guest</button
								>
							{/if}
						</div>
						{#each families[m.id] ?? [] as dep (dep.id)}
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 border-l-2 border-primary/30 bg-muted/30 px-4 py-2 text-left hover:bg-muted disabled:opacity-50"
								disabled={pending || dep.status !== 'active'}
								onclick={() => checkIn(dep.id)}
							>
								<span class="flex min-w-0 items-center gap-3">
									{#if dep.photoDocumentId}
										<img
											src="/api/documents/{dep.photoDocumentId}"
											alt=""
											class="size-7 shrink-0 rounded-full object-cover"
										/>
									{:else}
										<span
											class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
											>{initials(dep.name)}</span
										>
									{/if}
									<span class="min-w-0">
										<span class="block truncate text-sm font-medium">
											{dep.name}
											<span class="ml-1.5 text-xs font-normal text-muted-foreground">family</span>
										</span>
										{#if dep.deskNote}
											<span
												class="block truncate text-xs font-medium text-amber-600 dark:text-amber-400"
												>{dep.deskNote}</span
											>
										{/if}
									</span>
								</span>
								{#if dep.status !== 'active'}
									<Badge variant="outline">{dep.status}</Badge>
								{/if}
							</button>
						{/each}
					{/each}
				</div>
			{:else if searched}
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left hover:bg-muted"
					onclick={openWalkIn}
				>
					<UserPlus class="size-5 shrink-0 text-muted-foreground" />
					<span class="text-sm"
						>No member found — <span class="font-medium">register "{code.trim()}"</span> as a walk-in</span
					>
				</button>
			{/if}
		</form>

		<Button variant="outline" size="sm" class="self-start" onclick={openWalkIn}
			><UserPlus class="mr-1 h-4 w-4" /> Register walk-in</Button
		>

		{#if liveLocations.length > 1}
			<div class="flex items-center gap-3 text-sm">
				<span class="text-muted-foreground">Location</span>
				{#each liveLocations as l (l.id)}
					<Button
						variant={locationId === l.id ? 'default' : 'outline'}
						size="sm"
						onclick={() => (locationId = l.id)}>{l.name}</Button
					>
				{/each}
			</div>
		{/if}

		{#if upNext.length}
			<div>
				<p class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Up next
				</p>
				<div class="flex flex-wrap gap-2">
					{#each upNext as s (s.session.id)}
						<button
							type="button"
							class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent"
							style="border-left: 4px solid {s.color}"
							onclick={() => openSessionRoster(s)}
						>
							<span class="font-medium tabular-nums">{localTime(s.session.startsAt, tz)}</span>
							<span>{s.className}</span>
							<span class="text-muted-foreground">
								{s.booked}/{s.session.capacity}{s.locationName ? ` · ${s.locationName}` : ''}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if checkIns.length}
			<div>
				<p class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Recent check-ins
				</p>
				<div class="divide-y rounded-lg border">
					{#each checkIns.slice(0, 8) as c (c.checkIn.id)}
						<div class="flex items-center justify-between gap-2 px-4 py-2 text-sm">
							<span class="flex min-w-0 items-center gap-2">
								{#if c.memberPhotoId}
									<img
										src="/api/documents/{c.memberPhotoId}"
										alt=""
										class="size-7 shrink-0 rounded-full object-cover"
									/>
								{/if}
								<span class="truncate"
									>{c.checkIn.guestName ? `${c.checkIn.guestName} (guest)` : c.memberName}</span
								>
							</span>
							<span class="flex items-center gap-2 text-muted-foreground">
								{c.locationName ?? ''}
								<Badge variant="outline" class="text-xs">{c.checkIn.method}</Badge>
								<span class="tabular-nums">{localTime(c.checkIn.checkedAt, tz)}</span>
								{#if c.checkIn.checkedOutAt}
									<span class="tabular-nums">out {localTime(c.checkIn.checkedOutAt, tz)}</span>
								{:else}
									<Button
										variant="ghost"
										size="sm"
										class="h-6 px-2 text-xs"
										onclick={() => checkOutRow(c.checkIn.id)}>Check out</Button
									>
								{/if}
								<Button
									variant="ghost"
									size="sm"
									class="h-6 px-2 text-xs"
									onclick={() => voidRow(c.checkIn.id)}>Void</Button
								>
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</main>
</div>

<Dialog.Root bind:open={walkInOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Register walk-in</Dialog.Title>
			<Dialog.Description>
				Creates a member record and checks them in. They can claim the portal later from their
				member page.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-3" onsubmit={saveWalkIn}>
			<div class="space-y-1">
				<Label for="w-name">Name</Label>
				<Input id="w-name" bind:value={wName} autocomplete="off" required />
			</div>
			<div class="space-y-1">
				<Label for="w-phone">Phone</Label>
				<Input id="w-phone" bind:value={wPhone} autocomplete="off" />
			</div>
			<div class="space-y-1">
				<Label for="w-email">Email</Label>
				<Input id="w-email" type="email" bind:value={wEmail} autocomplete="off" />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={wPending || !wName.trim()}>
					{wPending ? 'Saving…' : 'Add & check in'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={guestOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{guestFor?.name}'s guest</Dialog.Title>
			<Dialog.Description>
				Logs a guest visit — counted against {guestFor?.name}'s monthly guest passes.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-3" onsubmit={saveGuest}>
			<div class="space-y-1">
				<Label for="g-name">Guest name</Label>
				<Input id="g-name" bind:value={guestName} autocomplete="off" required />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={gPending || !guestName.trim()}>
					{gPending ? 'Checking in…' : 'Check in guest'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={rosterOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{rosterSess?.className} — {rosterSess ? localTime(rosterSess.session.startsAt, tz) : ''}
			</Dialog.Title>
			<Dialog.Description>
				Check in the booked members as they arrive.
				{#if rosterSess?.session.checkinCode}
					Class code for self check-in: <code class="font-mono"
						>{rosterSess.session.checkinCode}</code
					>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="divide-y rounded-lg border">
			{#each sessRoster as r (r.booking.id)}
				<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
					<span class="min-w-0">
						<span class="block truncate font-medium">{r.memberName}</span>
						<span class="text-xs text-muted-foreground capitalize">
							{r.booking.status.replace('_', ' ')}
						</span>
					</span>
					{#if r.booking.status === 'booked'}
						<Button
							size="sm"
							variant="outline"
							disabled={rosterBusy === r.booking.memberId}
							onclick={() => rosterCheckIn(r.booking.memberId, r.memberName)}
						>
							{rosterBusy === r.booking.memberId ? '…' : 'Check in'}
						</Button>
					{/if}
				</div>
			{:else}
				<p class="px-3 py-4 text-sm text-muted-foreground">Nobody booked yet.</p>
			{/each}
		</div>
		{#if sessRoster.some((r) => r.booking.status === 'booked')}
			<Dialog.Footer>
				<Button size="sm" disabled={rosterBusy === 'all'} onclick={checkInAll}>
					{rosterBusy === 'all' ? 'Checking in…' : 'Check in all'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
