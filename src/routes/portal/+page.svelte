<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getPortalOverview,
		getBookable,
		memberBook,
		memberCancel,
		getProviders,
		startCheckout,
		signWaiver
	} from '#lib/remote/portal.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const memberId = $derived(data.memberId);
	const d = $derived(await getPortalOverview(memberId));
	const bookable = $derived(await getBookable(memberId));
	const providers = $derived(await getProviders(memberId));
	const tz = $derived(d.settings?.timezone ?? 'UTC');
	const currency = $derived(d.settings?.currency ?? 'usd');

	let qrUrl = $state('');
	$effect(() => {
		const code = d.checkInCode;
		void import('qrcode').then((QRCode) =>
			QRCode.toDataURL(code, { width: 240, margin: 1 }).then((u: string) => (qrUrl = u))
		);
	});

	let paying = $state(false);
	onMount(() => {
		if (page.url.searchParams.get('paid') === '1') {
			toast.success('Thanks! Your payment was received.');
			void goto('/portal', { shallow: true, replace: true });
		}
	});
	async function pay(provider: string) {
		paying = true;
		try {
			const { url } = await startCheckout({ memberId, provider });
			location.assign(url);
		} catch (err) {
			paying = false;
			toast.error(errMsg(err, 'Could not start payment'));
		}
	}

	let signingWaiver = $state(false);
	async function sign() {
		signingWaiver = true;
		try {
			await signWaiver(memberId);
			toast.success('Waiver signed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not sign'));
		}
		signingWaiver = false;
	}

	let busy = $state<string | null>(null);
	async function book(sessionId: string) {
		busy = sessionId;
		try {
			const b = await memberBook({ memberId, sessionId });
			toast.success(b.status === 'waitlisted' ? 'Class full — you are on the waitlist' : 'Booked!');
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		busy = null;
	}
	async function cancel(bookingId: string, sessionId: string) {
		busy = sessionId;
		try {
			await memberCancel({ memberId, bookingId });
			toast.success('Booking cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
		busy = null;
	}
	const myBookingId = (b: (typeof bookable)[number]) =>
		d.upcoming.find((u) => u.booking.sessionId === b.session.id && u.booking.status !== 'cancelled')
			?.booking.id;
</script>

<svelte:head><title>Member portal</title></svelte:head>

{#if data.options.length > 1}
	<select
		class="h-9 rounded-md border bg-background px-3 text-sm"
		onchange={(e) => goto(`/portal?m=${e.currentTarget.value}`, { invalidateAll: true })}
	>
		{#each data.options as o (o.memberId)}
			<option value={o.memberId} selected={o.memberId === memberId}>{o.gymName}</option>
		{/each}
	</select>
{/if}

<div class="grid gap-4 sm:grid-cols-2">
	<Card.Root class="sm:col-span-2">
		<Card.Content class="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
			{#if qrUrl}
				<img
					src={qrUrl}
					alt="Your check-in QR code"
					class="size-36 rounded-lg border bg-white p-2"
				/>
			{:else}
				<div class="size-36 animate-pulse rounded-lg bg-muted"></div>
			{/if}
			<div>
				<h1 class="text-xl font-semibold">Hi {d.member.name.split(' ')[0]}</h1>
				<p class="text-sm text-muted-foreground">Show this code at the front desk to check in.</p>
				<div class="mt-3 flex flex-wrap gap-1.5">
					{#each d.memberships as mm (mm.membership.id)}
						{#if mm.membership.status === 'active'}
							<Badge>{mm.plan.name} · {mm.membership.status}</Badge>
						{/if}
					{/each}
					{#if !d.memberships.some((mm) => mm.membership.status === 'active')}
						<Badge variant="secondary">No active membership</Badge>
					{/if}
					{#if d.credits}
						<Badge variant="outline">{d.credits.used} of {d.credits.limit} classes used</Badge>
					{/if}
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	{#if d.waiverRequired && !d.signedWaiver}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Sign your waiver</Card.Title>
				<Card.Description>Your gym requires this before your next visit.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 px-6">
				<p
					class="max-h-40 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground"
				>
					{d.settings?.waiver}
				</p>
				<Button onclick={sign} disabled={signingWaiver}
					>{signingWaiver ? 'Signing…' : 'I agree — sign waiver'}</Button
				>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><CreditCard /> Balance</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			<p class="text-3xl font-semibold tabular-nums">{formatMoney(d.balance, currency)}</p>
			{#if d.openCharges.length}
				<ul class="space-y-1 text-sm">
					{#each d.openCharges as c (c.charge.id)}
						<li class="flex justify-between gap-2">
							<span class="truncate text-muted-foreground"
								>{c.charge.description ?? c.charge.kind}</span
							>
							<span class="tabular-nums">{formatMoney(c.charge.amount - c.paid, currency)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
		{#if d.balance > 0 && providers.length}
			<Card.Footer class="flex flex-col gap-2">
				{#each providers as p (p.id)}
					<Button class="w-full" disabled={paying} onclick={() => pay(p.id)}>
						{paying ? 'Starting…' : p.payLabel}
					</Button>
				{/each}
			</Card.Footer>
		{/if}
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><CalendarDays /> Upcoming</Card.Title>
		</Card.Header>
		<Card.Content class="px-4">
			{#each d.upcoming as u (u.booking.id)}
				<div class="flex items-center justify-between py-2 text-sm">
					<div class="min-w-0">
						<p class="truncate font-medium">{u.className}</p>
						<p class="text-xs text-muted-foreground">
							{localDate(u.startsAt, tz)}
							{localTime(u.startsAt, tz)}
						</p>
					</div>
					<StatusBadge status={u.booking.status} />
				</div>
			{:else}
				<p class="py-2 text-sm text-muted-foreground">Nothing booked — grab a spot below.</p>
			{/each}
		</Card.Content>
	</Card.Root>
</div>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">Book a class</Card.Title>
		<Card.Description
			>The next two weeks at {data.options.find((o) => o.memberId === memberId)
				?.gymName}.</Card.Description
		>
	</Card.Header>
	<Card.Content class="px-4">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Class</Table.Head>
					<Table.Head class="hidden sm:table-cell">When</Table.Head>
					<Table.Head>Spots</Table.Head>
					<Table.Head class="text-right"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each bookable as b (b.session.id)}
					<Table.Row>
						<Table.Cell>
							<span class="mr-2 inline-block size-2 rounded-full" style:background={b.color}></span>
							{b.className}
							{#if b.locationName}<span class="text-xs text-muted-foreground"
									>· {b.locationName}</span
								>{/if}
						</Table.Cell>
						<Table.Cell class="hidden text-muted-foreground sm:table-cell">
							{localDate(b.session.startsAt, tz)}
							{localTime(b.session.startsAt, tz)}
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">
							{b.booked}/{b.session.capacity}
						</Table.Cell>
						<Table.Cell class="text-right">
							{#if b.myStatus && b.myStatus !== 'cancelled'}
								<span class="mr-2"><StatusBadge status={b.myStatus} /></span>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy === b.session.id}
									onclick={() => cancel(myBookingId(b)!, b.session.id)}>Cancel</Button
								>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={busy === b.session.id}
									onclick={() => book(b.session.id)}
								>
									{b.booked >= b.session.capacity ? 'Join waitlist' : 'Book'}
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row
						><Table.Cell colspan={4} class="text-muted-foreground">No classes scheduled.</Table.Cell
						></Table.Row
					>
				{/each}
			</Table.Body>
		</Table.Root>
	</Card.Content>
</Card.Root>
