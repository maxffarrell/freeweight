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
		getMembers
	} from '#lib/remote/members.remote.ts';
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
	let code = $state('');
	let locationId = $state(liveLocations[0]?.id ?? '');
	let suggestions = $state<
		{ id: string; name: string; status: string; openBalance: number; planName: string | null }[]
	>([]);
	let flash = $state<{ ok: boolean; text: string } | null>(null);
	let pending = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let now = $state(new Date());
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const t = setInterval(() => (now = new Date()), 30_000);
		inputEl?.focus();
		return () => clearInterval(t);
	});

	function showFlash(ok: boolean, text: string) {
		clearTimeout(flashTimer);
		flash = { ok, text };
		flashTimer = setTimeout(() => (flash = null), 3000);
	}

	function onInput() {
		clearTimeout(searchTimer);
		const q = code.trim();
		// fw1.* tokens and member ids aren't searchable text — skip the lookup.
		if (q.length < 2 || q.startsWith('fw1.')) {
			suggestions = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			suggestions = (await getMembers({ q })).slice(0, 5);
		}, 150);
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
							(r.attended ? ` — attended ${r.attended} class${r.attended > 1 ? 'es' : ''}` : '')
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

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (pending || !code.trim()) return;
		checkIn(code.trim());
	}
</script>

<div class="flex min-h-svh flex-col bg-background">
	<header class="flex items-center justify-between gap-4 border-b px-6 py-4">
		<div class="flex items-center gap-3">
			<Logo class="size-8" />
			<div>
				<p class="font-semibold">{data.gymName}</p>
				<p class="text-xs text-muted-foreground">Front-desk check-in</p>
			</div>
		</div>
		<div class="flex items-center gap-4 text-sm">
			<span class="tabular-nums">{localTime(now, tz)}</span>
			<Badge variant="secondary">
				{checkIns.length} today · {checkIns.filter((c) => !c.checkIn.checkedOutAt).length}
				inside
			</Badge>
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
				{#if flash.ok}<CircleCheck class="size-8 shrink-0" />{:else}<TriangleAlert
						class="size-8 shrink-0"
					/>{/if}
				{flash.text}
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
						<button
							type="button"
							class="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted disabled:opacity-50"
							disabled={pending || m.status !== 'active'}
							onclick={() => checkIn(m.id)}
						>
							<span class="font-medium">{m.name}</span>
							<span class="flex items-center gap-2">
								{#if m.status !== 'active'}<Badge variant="outline">{m.status}</Badge>{/if}
								{#if m.openBalance > 0}
									<Badge variant="destructive"
										>owes {formatMoney(m.openBalance, settings.currency)}</Badge
									>
								{/if}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</form>

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

		{#if checkIns.length}
			<div>
				<p class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Recent check-ins
				</p>
				<div class="divide-y rounded-lg border">
					{#each checkIns.slice(0, 8) as c (c.checkIn.id)}
						<div class="flex items-center justify-between px-4 py-2 text-sm">
							<span>{c.checkIn.guestName ? `${c.checkIn.guestName} (guest)` : c.memberName}</span>
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
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</main>
</div>
