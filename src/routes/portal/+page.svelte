<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getPortalOverview,
		getBookable,
		memberBook,
		memberBookSeries,
		memberCancel,
		requestMembershipCancel,
		requestMembershipPause,
		withdrawMembershipPause,
		withdrawMembershipCancel,
		getProviders,
		startCheckout,
		signWaiver,
		getMyDocuments,
		getMeasurements,
		logMeasurement,
		removeMeasurement,
		resubscribe,
		getJoinablePlans,
		joinPlan,
		buyPack,
		changePlan,
		updateProfile,
		getPortalResources,
		getResourceDay,
		bookResource,
		cancelReservation,
		getReservations
	} from '#lib/remote/portal.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import FileText from '@lucide/svelte/icons/file-text';
	import Flame from '@lucide/svelte/icons/flame';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Copy from '@lucide/svelte/icons/copy';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const memberId = $derived(data.memberId);
	const d = $derived(await getPortalOverview(memberId));
	const bookable = $derived(await getBookable(memberId));
	const providers = $derived(await getProviders(memberId));
	const docs = $derived(await getMyDocuments(memberId));
	const joinablePlans = $derived(await getJoinablePlans(memberId));

	// ------- amenity reservations -------
	const amenities = $derived(await getPortalResources(memberId));
	const reservations = $derived(await getReservations(memberId));
	let amenityId = $state('');
	const amenity = $derived(
		amenities.find((a) => a.resource.id === amenityId) ?? amenities[0] ?? null
	);
	let amenityDay = $state('');
	const amenitySlots = $derived(
		amenity && amenityDay
			? await getResourceDay({ memberId, resourceId: amenity.resource.id, day: amenityDay })
			: null
	);
	let amenityBusy = $state(0);
	async function bookAmenity(startsAt: Date) {
		if (!amenity) return;
		amenityBusy = startsAt.getTime();
		try {
			await bookResource({
				memberId,
				resourceId: amenity.resource.id,
				day: amenityDay,
				time: localTime(startsAt, tz)
			});
			toast.success(`${amenity.resource.name} booked`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		amenityBusy = 0;
	}
	async function cancelRes(id: string) {
		try {
			await cancelReservation({ memberId, id });
			toast.success('Reservation cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
	}
	const planFull = (p: (typeof joinablePlans)[number]) =>
		!p.isPack && p.memberLimit !== null && p.activeMembers >= p.memberLimit;

	// ------- progress tracking -------
	const measurements = $derived(await getMeasurements(memberId));
	const KIND_LABELS = {
		weight: 'Weight',
		body_fat: 'Body fat',
		waist: 'Waist',
		chest: 'Chest'
	} as const;
	const UNITS = ['lb', 'kg', '%', 'in', 'cm'] as const;
	let msKind = $state<keyof typeof KIND_LABELS>('weight');
	let msValue = $state('');
	let msUnit = $state<(typeof UNITS)[number]>('lb');
	let msDate = $state('');
	let msPending = $state(false);
	/** Entries come newest-first; the next same-kind+unit row is the previous reading. */
	const statDelta = (e: (typeof measurements)[number]) => {
		const prev = measurements
			.slice(measurements.indexOf(e) + 1)
			.find((x) => x.kind === e.kind && x.unit === e.unit);
		return prev ? e.value - prev.value : null;
	};
	async function logStat(e: SubmitEvent) {
		e.preventDefault();
		msPending = true;
		try {
			await logMeasurement({
				memberId,
				kind: msKind,
				value: Number(msValue),
				unit: msUnit as (typeof UNITS)[number],
				recordedAt: msDate || undefined
			});
			msValue = '';
			toast.success('Logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log'));
		}
		msPending = false;
	}
	async function removeStat(id: string) {
		try {
			await removeMeasurement({ memberId, id });
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}
	/** Packs the member doesn't already hold — buyable alongside a normal plan. */
	const hasPlan = $derived(d.memberships.some((mm) => mm.membership.status === 'active'));
	const buyablePacks = $derived(
		joinablePlans.filter(
			(p) =>
				p.isPack &&
				!d.memberships.some((mm) => mm.plan.id === p.id && mm.membership.status === 'active')
		)
	);
	let joining = $state('');
	async function join(planId: string) {
		joining = planId;
		try {
			await joinPlan({ memberId, planId });
			toast.success('Membership activated — pay any open balance below');
		} catch (err) {
			toast.error(errMsg(err, 'Could not join plan'));
		}
		joining = '';
	}
	async function buy(planId: string) {
		joining = planId;
		try {
			await buyPack({ memberId, planId });
			toast.success('Pack added — pay it off below');
		} catch (err) {
			toast.error(errMsg(err, 'Could not buy the pack'));
		}
		joining = '';
	}
	let changeOpen = $state(false);
	let profileOpen = $state(false);
	let pName = $state('');
	let pPhone = $state('');
	let pBirthday = $state('');
	let pSaving = $state(false);
	function openProfile() {
		pName = d.member.name;
		pPhone = d.member.phone ?? '';
		pBirthday = d.member.birthday ?? '';
		profileOpen = !profileOpen;
	}
	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		pSaving = true;
		try {
			await updateProfile({
				memberId,
				name: pName,
				phone: pPhone || null,
				birthday: pBirthday || null
			});
			toast.success('Profile updated');
			profileOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not update profile'));
		}
		pSaving = false;
	}
	async function switchPlan(planId: string) {
		joining = planId;
		try {
			await changePlan({ memberId, planId });
			toast.success('Plan updated — your next bill reflects the new price');
			changeOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not change plan'));
		}
		joining = '';
	}
	const tz = $derived(d.settings?.timezone ?? 'UTC');
	const currency = $derived(d.settings?.currency ?? 'usd');
	const refLink = $derived(`${page.url.origin}/j/${d.orgSlug}?ref=${memberId}`);
	function copyRefLink() {
		navigator.clipboard
			.writeText(refLink)
			.then(() => toast.success('Referral link copied'))
			.catch(() => toast.error('Could not copy'));
	}

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
	async function rebook(classTypeId: string) {
		const next = bookable.find((b) => b.session.classTypeId === classTypeId && !b.myStatus);
		if (!next) {
			toast.error('No upcoming sessions');
			return;
		}
		busy = `rebook:${classTypeId}`;
		try {
			const b = await memberBook({ memberId, sessionId: next.session.id });
			toast.success(
				b.status === 'waitlisted'
					? 'Class full — you are on the waitlist'
					: `Booked ${next.className} ${localDate(next.session.startsAt, tz)}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		busy = null;
	}
	const nextOfType = (classTypeId: string) =>
		bookable.find((b) => b.session.classTypeId === classTypeId && !b.myStatus);
	async function bookSeriesAll(classTypeId: string, className: string) {
		if (!confirm(`Book into every upcoming ${className} session?`)) return;
		busy = `series:${classTypeId}`;
		try {
			const r = await memberBookSeries({ memberId, classTypeId });
			const parts = [`Booked ${r.booked}`];
			if (r.waitlisted) parts.push(`waitlisted ${r.waitlisted}`);
			if (r.skipped) parts.push(`skipped ${r.skipped}`);
			toast.success(parts.join(' · '));
		} catch (err) {
			toast.error(errMsg(err, 'Could not book the series'));
		}
		busy = null;
	}

	async function cancel(bookingId: string, sessionId: string) {
		busy = sessionId;
		try {
			const b = await memberCancel({ memberId, bookingId });
			toast.success(
				b.lateFeeApplied ? 'Cancelled — a late-cancel fee was charged' : 'Booking cancelled'
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
		busy = null;
	}

	const CANCEL_REASONS = [
		'Too expensive',
		'Moving',
		'Injury or health',
		'Too busy',
		'Schedule conflicts',
		'Other'
	];
	let cancelReqId = $state('');
	let requestReason = $state('');
	async function requestCancel(membershipId: string) {
		try {
			await requestMembershipCancel({
				memberId,
				membershipId,
				reason: requestReason || undefined
			});
			toast.success('Cancellation requested — staff will confirm');
			cancelReqId = '';
			requestReason = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not request'));
		}
	}
	async function withdrawCancel(membershipId: string) {
		try {
			await withdrawMembershipCancel({ memberId, membershipId });
			toast.success('Request withdrawn');
		} catch (err) {
			toast.error(errMsg(err, 'Could not withdraw'));
		}
	}
	let pauseReqId = $state('');
	let pauseResumeOn = $state('');
	async function requestPause(e: SubmitEvent) {
		e.preventDefault();
		try {
			await requestMembershipPause({
				memberId,
				membershipId: pauseReqId,
				resumeOn: pauseResumeOn,
				reason: requestReason || undefined
			});
			toast.success('Pause requested — staff will confirm');
			pauseReqId = '';
			pauseResumeOn = '';
			requestReason = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not request'));
		}
	}
	async function withdrawPause(membershipId: string) {
		try {
			await withdrawMembershipPause({ memberId, membershipId });
			toast.success('Request withdrawn');
		} catch (err) {
			toast.error(errMsg(err, 'Could not withdraw'));
		}
	}
	const myBookingId = (b: (typeof bookable)[number]) =>
		d.upcoming.find((u) => u.booking.sessionId === b.session.id && u.booking.status !== 'cancelled')
			?.booking.id;

	let resubscribing = $state(false);
	async function reenableEmails() {
		resubscribing = true;
		try {
			await resubscribe(memberId);
			toast.success("You're back on the email list");
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		resubscribing = false;
	}
</script>

<svelte:head><title>Member portal</title></svelte:head>

{#if d.settings.logoDocumentId}
	<img src="/api/logo/{d.settings.logoDocumentId}" alt="" class="mb-4 h-10 w-auto object-contain" />
{/if}

{#if data.options.length > 1}
	<select
		class="h-9 rounded-md border bg-background px-3 text-sm"
		onchange={(e) => goto(`/portal?m=${e.currentTarget.value}`, { invalidateAll: true })}
	>
		{#each data.options as o (o.memberId)}
			<option value={o.memberId} selected={o.memberId === memberId}>{o.label}</option>
		{/each}
	</select>
{/if}

{#if d.settings.portalNotice}
	<div
		class="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-sky-900 dark:bg-sky-950/40"
	>
		{d.settings.portalNotice}
	</div>
{/if}

{#if d.member.unsubscribedAt}
	<div
		class="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
	>
		<span>You're not receiving emails from the gym.</span>
		<Button size="sm" variant="outline" disabled={resubscribing} onclick={reenableEmails}
			>{resubscribing ? 'Turning on…' : 'Turn emails back on'}</Button
		>
	</div>
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
			<div class="flex items-center gap-4">
				{#if d.member.photoDocumentId}
					<img
						src="/api/portal/documents/{d.member.photoDocumentId}?m={d.member.id}"
						alt={d.member.name}
						class="size-16 shrink-0 rounded-full object-cover"
					/>
				{/if}
				<div>
					<h1 class="text-xl font-semibold">Hi {d.member.name.split(' ')[0]}</h1>
					<p class="text-sm text-muted-foreground">Show this code at the front desk to check in.</p>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each d.memberships as mm (mm.membership.id)}
							{#if mm.membership.status === 'active'}
								<Badge
									>{mm.plan.name}{mm.plan.isPack
										? ''
										: ` · ${formatMoney(mm.membership.price ?? mm.plan.amount, currency)}/${mm.plan.interval}`}</Badge
								>
							{/if}
						{/each}
						{#if !d.memberships.some((mm) => mm.membership.status === 'active')}
							<Badge variant="secondary">No active membership</Badge>
						{/if}
						{#if d.credits}
							<Badge variant="outline">{d.credits.used} of {d.credits.limit} classes used</Badge>
						{/if}
					</div>
					<p class="mt-1 text-xs">
						<button class="text-muted-foreground underline" onclick={openProfile}
							>Edit profile</button
						>
					</p>
					{#if profileOpen}
						<form class="mt-1 w-full max-w-xs space-y-2" onsubmit={saveProfile}>
							<Input bind:value={pName} required placeholder="Name" class="h-8 text-sm" />
							<Input bind:value={pPhone} placeholder="Phone" class="h-8 text-sm" />
							<Input bind:value={pBirthday} type="date" aria-label="Birthday" class="h-8 text-sm" />
							<div class="flex gap-2">
								<Button size="sm" class="h-7 px-3 text-xs" type="submit" disabled={pSaving}
									>{pSaving ? 'Saving…' : 'Save'}</Button
								>
								<Button
									size="sm"
									variant="outline"
									class="h-7 px-3 text-xs"
									type="button"
									onclick={() => (profileOpen = false)}>Cancel</Button
								>
							</div>
							<p class="text-xs text-muted-foreground">Email changes go through the front desk.</p>
						</form>
					{/if}
					{#if !d.memberships.some((mm) => mm.membership.status === 'active') && joinablePlans.length}
						<div class="mt-2 w-full space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">Join a plan</p>
							{#each joinablePlans as p (p.id)}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{p.name}</span>
										<span class="text-muted-foreground">
											— {formatMoney(p.amount, currency)}{p.isPack
												? ` · ${p.classCredits} classes`
												: `/${p.interval}`}{p.trialDays
												? ` · ${p.trialDays}-day free trial`
												: ''}{p.commitmentMonths ? ` · ${p.commitmentMonths}-mo minimum` : ''}
										</span>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={joining === p.id || planFull(p)}
										onclick={() => join(p.id)}
										>{planFull(p) ? 'Full' : joining === p.id ? 'Joining…' : 'Join'}</Button
									>
								</div>
							{/each}
						</div>
					{/if}
					{#if d.memberships.some((mm) => mm.membership.status === 'active') && buyablePacks.length}
						<div class="mt-2 w-full space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">Class packs</p>
							{#each buyablePacks as p (p.id)}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{p.name}</span>
										<span class="text-muted-foreground">
											— {formatMoney(p.amount, currency)} · {p.classCredits} classes{p.packDays
												? ` · expires in ${p.packDays} days`
												: ''}
										</span>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={joining === p.id}
										onclick={() => buy(p.id)}>{joining === p.id ? 'Adding…' : 'Buy'}</Button
									>
								</div>
							{/each}
						</div>
					{/if}
					{#each d.memberships as mm (mm.membership.id)}
						{#if mm.membership.status === 'active'}
							<p class="mt-1 text-xs text-muted-foreground">
								{#if mm.membership.cancelRequestedAt}
									{mm.plan.name}: cancellation requested — staff will confirm shortly.
									<button class="underline" onclick={() => withdrawCancel(mm.membership.id)}
										>Withdraw request</button
									>
								{:else if mm.membership.pauseRequestedAt}
									{mm.plan.name}: pause requested{mm.membership.pauseUntil
										? ` until ${formatDate(mm.membership.pauseUntil)}`
										: ''} — staff will confirm shortly.
									<button class="underline" onclick={() => withdrawPause(mm.membership.id)}
										>Withdraw request</button
									>
								{:else}
									{#if !mm.plan.isPack && joinablePlans.some((p) => !p.isPack && p.id !== mm.plan.id)}
										<button class="underline" onclick={() => (changeOpen = !changeOpen)}
											>Change plan</button
										>
										·
									{/if}
									{#if !mm.plan.isPack}
										<button
											class="underline"
											onclick={() =>
												(pauseReqId = pauseReqId === mm.membership.id ? '' : mm.membership.id)}
											>Request pause</button
										>
										·
									{/if}
									<button
										class="underline"
										onclick={() =>
											(cancelReqId = cancelReqId === mm.membership.id ? '' : mm.membership.id)}
										>Request cancellation of {mm.plan.name}</button
									>
								{/if}
							</p>
							{#if pauseReqId === mm.membership.id}
								<form class="mt-1 flex flex-wrap items-center gap-2" onsubmit={requestPause}>
									<label class="text-xs text-muted-foreground" for="pause-date">Resume on</label>
									<Input
										id="pause-date"
										type="date"
										required
										class="h-7 w-auto text-xs"
										bind:value={pauseResumeOn}
									/>
									<select
										bind:value={requestReason}
										class="h-7 rounded-md border bg-transparent px-1 text-xs"
									>
										<option value="">Reason (optional)</option>
										{#each CANCEL_REASONS as r (r)}<option value={r}>{r}</option>{/each}
									</select>
									<Button size="sm" variant="outline" class="h-7 px-2 text-xs" type="submit"
										>Request pause</Button
									>
								</form>
							{/if}
							{#if cancelReqId === mm.membership.id}
								<form
									class="mt-1 flex flex-wrap items-center gap-2"
									onsubmit={(e) => {
										e.preventDefault();
										void requestCancel(mm.membership.id);
									}}
								>
									<select
										bind:value={requestReason}
										class="h-7 rounded-md border bg-transparent px-1 text-xs"
									>
										<option value="">Reason (optional)</option>
										{#each CANCEL_REASONS as r (r)}<option value={r}>{r}</option>{/each}
									</select>
									<Button size="sm" variant="outline" class="h-7 px-2 text-xs" type="submit"
										>Confirm cancellation request</Button
									>
								</form>
							{/if}
						{/if}
					{/each}
					{#if changeOpen}
						<div class="mt-2 w-full space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">
								Switch plans — takes effect now, billed at your next charge
							</p>
							{#each joinablePlans.filter((p) => !p.isPack && !d.memberships.some((mm) => mm.plan.id === p.id && mm.membership.status === 'active')) as p (p.id)}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{p.name}</span>
										<span class="text-muted-foreground">
											— {formatMoney(p.amount, currency)}/{p.interval}{p.classCredits
												? ` · ${p.classCredits} classes`
												: ''}{p.trialDays
												? ` · ${p.trialDays}-day free trial`
												: ''}{p.commitmentMonths ? ` · ${p.commitmentMonths}-mo minimum` : ''}
										</span>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={joining === p.id || planFull(p)}
										onclick={() => switchPlan(p.id)}
										>{planFull(p) ? 'Full' : joining === p.id ? 'Switching…' : 'Switch'}</Button
									>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	{#if amenities.length || reservations.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Amenities</Card.Title>
				<Card.Description>Book the sauna, court, or child care.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if amenities.length}
					<div class="flex flex-wrap items-end gap-3">
						<div class="space-y-1">
							<label for="am-res" class="text-xs text-muted-foreground">Amenity</label>
							{#if amenities.length === 1}
								<p id="am-res" class="h-9 content-center text-sm font-medium">
									{amenity!.resource.name}
								</p>
							{:else}
								<select
									id="am-res"
									bind:value={amenityId}
									class="h-9 rounded-md border bg-transparent px-2 text-sm"
								>
									{#each amenities as a (a.resource.id)}
										<option value={a.resource.id}>{a.resource.name}</option>
									{/each}
								</select>
							{/if}
						</div>
						<div class="space-y-1">
							<label for="am-day" class="text-xs text-muted-foreground">Day</label>
							<Input
								id="am-day"
								type="date"
								min={localDate(new Date(), tz)}
								bind:value={amenityDay}
							/>
						</div>
					</div>
					{#if amenity && amenityDay}
						{#if amenitySlots?.slots.length}
							<div class="flex flex-wrap gap-2">
								{#each amenitySlots.slots as s (s.startsAt.getTime())}
									{@const full = s.taken >= amenitySlots.resource.capacity}
									{@const past = s.startsAt.getTime() <= Date.now()}
									<Button
										variant="outline"
										size="sm"
										disabled={full || past || amenityBusy > 0}
										onclick={() => bookAmenity(s.startsAt)}
									>
										{localTime(s.startsAt, tz)}{#if full}
											· full{:else if amenitySlots.resource.capacity > 1}
											· {amenitySlots.resource.capacity - s.taken} left{/if}
									</Button>
								{/each}
							</div>
						{:else if amenitySlots}
							<p class="text-sm text-muted-foreground">Not bookable that day.</p>
						{:else}
							<p class="text-sm text-muted-foreground">Loading…</p>
						{/if}
					{:else}
						<p class="text-sm text-muted-foreground">Pick a day to see open slots.</p>
					{/if}
				{/if}
				{#if reservations.length}
					<div class="divide-y rounded-lg border">
						{#each reservations as r (r.booking.id)}
							<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
								<div>
									<span class="font-medium">{r.resourceName}</span>
									<span class="text-muted-foreground">
										· {localDate(r.booking.startsAt, tz)} at {localTime(r.booking.startsAt, tz)}
									</span>
								</div>
								<Button variant="ghost" size="sm" onclick={() => cancelRes(r.booking.id)}
									>Cancel</Button
								>
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if d.orgSlug}
		<Card.Root class="sm:col-span-2">
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Refer a friend</Card.Title>
				<Card.Description>
					Share your link — anyone who joins from it counts toward you
					{#if d.referralCount}
						({d.referralCount} joined so far){/if}.
					{#if d.settings?.referralCredits}
						Earn {d.settings.referralCredits} class credit{d.settings.referralCredits === 1
							? ''
							: 's'} for each one that pays.{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex items-center gap-2 px-6">
				<code class="flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs"
					>{refLink}</code
				>
				<Button size="sm" variant="outline" onclick={copyRefLink}><Copy /> Copy</Button>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if d.waiverRequired && (!d.signedWaiver || d.waiverStale)}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base"
					>{d.waiverStale ? 'Our waiver changed — please re-sign' : 'Sign your waiver'}</Card.Title
				>
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
			{#if d.payments.length}
				<div>
					<p class="mb-1 text-xs font-medium text-muted-foreground uppercase">Recent payments</p>
					<ul class="space-y-1 text-sm">
						{#each d.payments as p (p.payment.id)}
							<li class="flex justify-between gap-2">
								<span class="truncate text-muted-foreground">
									{p.chargeDescription ?? p.chargeKind ?? 'Payment'} · {localDate(
										p.payment.paidAt,
										tz
									)}
								</span>
								<span class="tabular-nums">{formatMoney(p.payment.amount, currency)}</span>
							</li>
						{/each}
					</ul>
				</div>
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

	{#if docs.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base"><FileText /> Documents</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#each docs as doc (doc.id)}
					<a
						href="/api/portal/documents/{doc.id}?m={memberId}"
						target="_blank"
						class="flex items-center gap-2 py-1.5 text-sm hover:underline"
					>
						<FileText class="size-4 shrink-0 text-muted-foreground" />
						<span class="truncate">{doc.name}</span>
					</a>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><Flame /> Attendance</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<p class="text-3xl font-semibold tabular-nums">{d.attendance.visitsThisMonth}</p>
					<p class="text-xs text-muted-foreground">visits this month</p>
				</div>
				<div>
					<p class="text-3xl font-semibold tabular-nums">{d.attendance.weekStreak}</p>
					<p class="text-xs text-muted-foreground">week streak</p>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				{d.attendance.totalVisits} visits in the last 6 months
			</p>
			{#if d.attendance.recent.length}
				<ul class="space-y-1.5 border-t pt-3">
					{#each d.attendance.recent as v (v.checkedAt)}
						<li class="flex items-baseline justify-between gap-2 text-sm">
							<span class="truncate">{v.locationName ?? 'Visit'}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								{localDate(v.checkedAt, tz)} · {localTime(v.checkedAt, tz)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><TrendingUp /> Progress</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			<form class="flex flex-wrap items-center gap-2" onsubmit={logStat}>
				<select bind:value={msKind} class="h-8 rounded-md border bg-transparent px-1.5 text-xs">
					{#each Object.entries(KIND_LABELS) as [k, label] (k)}
						<option value={k}>{label}</option>
					{/each}
				</select>
				<Input
					type="number"
					step="0.1"
					min="0"
					required
					bind:value={msValue}
					placeholder="Value"
					class="h-8 w-24"
				/>
				<select bind:value={msUnit} class="h-8 rounded-md border bg-transparent px-1.5 text-xs">
					{#each UNITS as u (u)}<option value={u}>{u}</option>{/each}
				</select>
				<Input type="date" bind:value={msDate} class="h-8 w-auto text-xs" aria-label="Date" />
				<Button size="sm" class="h-8" type="submit" disabled={msPending}>Log</Button>
			</form>
			{#if measurements.length}
				<ul class="space-y-1.5 border-t pt-3">
					{#each measurements as e (e.id)}
						{@const delta = statDelta(e)}
						<li class="group flex items-baseline gap-2 text-sm">
							<span class="w-16 shrink-0 text-xs text-muted-foreground"
								>{KIND_LABELS[e.kind as keyof typeof KIND_LABELS] ?? e.kind}</span
							>
							<span class="font-medium tabular-nums">{e.value} {e.unit}</span>
							{#if delta !== null}
								<span
									class="text-xs tabular-nums {delta > 0
										? 'text-amber-600'
										: delta < 0
											? 'text-green-600'
											: 'text-muted-foreground'}"
									>{delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}</span
								>
							{/if}
							<span class="ml-auto shrink-0 text-xs text-muted-foreground">{e.recordedAt}</span>
							<button
								class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
								onclick={() => removeStat(e.id)}
								aria-label="Delete entry"
							>
								<Trash2 class="size-3.5" />
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-muted-foreground">
					Log your first measurement — weight, body fat, waist.
				</p>
			{/if}
		</Card.Content>
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
					<span class="flex items-center gap-1.5">
						{#if u.waitlistPos}<span class="text-xs text-muted-foreground">#{u.waitlistPos}</span
							>{/if}
						<StatusBadge status={u.booking.status} />
					</span>
				</div>
			{:else}
				<p class="py-2 text-sm text-muted-foreground">Nothing booked — grab a spot below.</p>
			{/each}
			{#if d.upcoming.length}
				<a
					class="block pb-2 text-xs text-muted-foreground underline underline-offset-2"
					href="/portal/feed.ics?m={memberId}&t={d.calendarToken}"
					>Sync bookings to your calendar app</a
				>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Class history</Card.Title>
		</Card.Header>
		<Card.Content class="px-4">
			{#each d.history as h (h.booking.id)}
				<div class="flex items-center justify-between py-2 text-sm">
					<div class="min-w-0">
						<p class="truncate font-medium">{h.className}</p>
						<p class="text-xs text-muted-foreground">
							{localDate(h.startsAt, tz)}{#if h.locationName}
								· {h.locationName}{/if}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-2">
						{#if nextOfType(h.classTypeId)}
							<Button
								size="sm"
								variant="ghost"
								title={`Book the next ${h.className}`}
								disabled={busy === `rebook:${h.classTypeId}`}
								onclick={() => rebook(h.classTypeId)}>Again</Button
							>
						{/if}
						<StatusBadge status={h.booking.status} />
					</div>
				</div>
			{:else}
				<p class="py-2 text-sm text-muted-foreground">No classes yet.</p>
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
							{:else if !b.memberBookable}
								<span class="text-xs whitespace-nowrap text-muted-foreground">Book at the desk</span
								>
							{:else if !hasPlan && (!b.dropInPrice || b.dropInPrice <= 0)}
								<span class="text-xs whitespace-nowrap text-muted-foreground">Needs a plan</span>
							{:else if !hasPlan && b.booked >= b.session.capacity}
								<span class="text-xs whitespace-nowrap text-muted-foreground">Full</span>
							{:else}
								<div class="flex justify-end gap-1">
									{#if hasPlan}
										<Button
											size="sm"
											variant="ghost"
											title={`Book every upcoming ${b.className}`}
											disabled={busy === b.session.id || busy === `series:${b.session.classTypeId}`}
											onclick={() => bookSeriesAll(b.session.classTypeId, b.className)}
											>Series</Button
										>
									{/if}
									<Button
										size="sm"
										variant="outline"
										disabled={busy === b.session.id}
										onclick={() => book(b.session.id)}
									>
										{!hasPlan && b.dropInPrice
											? d.dropInFree
												? 'Book — first class free'
												: `Book — ${formatMoney(b.dropInPrice, currency)}`
											: b.booked >= b.session.capacity
												? 'Join waitlist'
												: 'Book'}
									</Button>
								</div>
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
