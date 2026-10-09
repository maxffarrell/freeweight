<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Logo from '#lib/components/app/logo.svelte';
	import { requestTrialForm } from '#lib/remote/public.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { localDate, localTime } from '#lib/tz.ts';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { org, settings, sessions } = $derived(data);
	const tz = $derived(settings.timezone);
	/** Deep link: /j/{slug}/schedule?session=<id> scrolls to + highlights one class. */
	const focusId = $derived(page.url.searchParams.get('session'));
	/** Deep link: /j/{slug}/schedule?class=<classTypeId> filters to one class. */
	const classFilter = $derived(page.url.searchParams.get('class'));
	$effect(() => {
		if (!focusId) return;
		void tick().then(() =>
			document.getElementById(`s-${focusId}`)?.scrollIntoView({ block: 'center' })
		);
	});
	const currency = $derived(settings.currency);

	// ------- free trial request -------
	let trialOpen = $state(false);
	let trialSessionId = $state('');
	let trialTitle = $state('');
	let tName = $state('');
	let tEmail = $state('');
	let tPhone = $state('');
	let tPending = $state(false);
	let tDone = $state(false);
	const trialRequested = new SvelteSet<string>();

	function openTrial(s: { session: { id: string }; className: string }) {
		trialSessionId = s.session.id;
		trialTitle = s.className;
		tDone = trialRequested.has(s.session.id);
		trialOpen = true;
	}

	async function submitTrial(e: SubmitEvent) {
		e.preventDefault();
		tPending = true;
		try {
			await requestTrialForm({
				slug: org.slug,
				input: {
					sessionId: trialSessionId,
					name: tName,
					email: tEmail,
					phone: tPhone || undefined
				}
			});
			tDone = true;
			trialRequested.add(trialSessionId);
		} catch (err) {
			toast.error(errMsg(err, 'Could not send — try again'));
		}
		tPending = false;
	}

	const dayLabel = (d: Date) =>
		new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			weekday: 'long',
			month: 'short',
			day: 'numeric'
		}).format(d);

	/** Sessions grouped by local day, in order. */
	const visible = $derived(
		classFilter ? sessions.filter((s) => s.session.classTypeId === classFilter) : sessions
	);
	const byDay = $derived(
		[...visible]
			.reduce((acc, s) => {
				const day = localDate(s.session.startsAt, tz);
				(acc.get(day) ?? acc.set(day, []).get(day)!).push(s);
				return acc;
			}, new Map<string, typeof sessions>())
			.entries()
			.toArray()
	);
</script>

<svelte:head>
	<title>Class schedule — {org.name}</title>
	<meta name="description" content="This week's class schedule at {org.name}." />
</svelte:head>

<div class="min-h-svh bg-background">
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			{#if settings.logoDocumentId}
				<img src="/api/logo/{settings.logoDocumentId}" alt="" class="h-8 w-auto object-contain" />
			{:else}
				<Logo />
			{/if}
			<span class="truncate font-semibold">{org.name}</span>
			{#if settings.address}
				<span class="ml-auto hidden items-center gap-1 text-sm text-muted-foreground sm:flex"
					><MapPin class="size-3.5" /> {settings.address}</span
				>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-3xl space-y-6 p-4 py-8">
		<div class="flex items-center justify-between gap-3">
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight">Class schedule</h1>
				<p class="text-sm text-muted-foreground">
					Next 7 days · {tz}{#if classFilter && visible[0]}
						· {visible[0].className} only{/if}
				</p>
			</div>
			<Button variant="outline" size="sm" href="/j/{org.slug}">
				<ArrowLeft /> Memberships
			</Button>
		</div>

		{#if Object.values(settings.openHours ?? {}).some(Boolean)}
			{@const hours = settings.openHours ?? {}}
			<div
				class="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border px-4 py-3 text-xs text-muted-foreground"
			>
				{#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as d, i (d)}
					<span
						><span class="font-medium text-foreground">{d}</span>
						{hours[String(i)] || 'Closed'}</span
					>
				{/each}
			</div>
		{/if}

		{#each byDay as [day, rows] (day)}
			<section class="space-y-2">
				<h2 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
					{dayLabel(new Date(`${day}T12:00:00Z`))}
				</h2>
				<div class="divide-y rounded-lg border">
					{#each rows as s (s.session.id)}
						{@const spots = s.session.capacity - s.booked}
						<div
							id={`s-${s.session.id}`}
							class="flex items-center justify-between gap-3 px-4 py-3 text-sm {s.session.id ===
							focusId
								? '-m-px rounded-lg bg-primary/5 ring-2 ring-primary'
								: ''}"
						>
							<div class="flex min-w-0 items-center gap-2.5">
								<span class="w-12 shrink-0 text-muted-foreground tabular-nums"
									>{localTime(s.session.startsAt, tz)}</span
								>
								<span class="size-2 shrink-0 rounded-full" style:background={s.color}></span>
								<span class="min-w-0">
									<span class="block truncate font-medium">{s.className}</span>
									<span class="block truncate text-xs text-muted-foreground">
										{[
											s.instructorName,
											s.locationName,
											`${Math.round(
												(s.session.endsAt.getTime() - s.session.startsAt.getTime()) / 60_000
											)} min`
										]
											.filter(Boolean)
											.join(' · ')}
									</span>
								</span>
							</div>
							<span class="flex shrink-0 items-center gap-2">
								{#if s.dropInPrice}<span class="hidden text-xs text-muted-foreground sm:inline"
										>{formatMoney(s.dropInPrice, currency)} drop-in</span
									>{/if}
								<Badge variant={spots <= 0 ? 'outline' : 'secondary'}>
									{spots <= 0 ? 'Full' : `${spots} spot${spots === 1 ? '' : 's'} left`}
								</Badge>
								{#if spots > 0}
									{#if trialRequested.has(s.session.id)}
										<Badge variant="secondary">Requested</Badge>
									{:else}
										<Button size="sm" variant="outline" onclick={() => openTrial(s)}
											>Free trial</Button
										>
									{/if}
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{:else}
			<div class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
				No classes scheduled this week — check back soon.
			</div>
		{/each}

		<div class="rounded-lg border bg-muted/40 p-4 text-center text-sm">
			<p class="mb-3 text-muted-foreground">
				Want to book a spot? Members book online — drop-ins welcome where priced.
			</p>
			<Button href="/j/{org.slug}">Join {org.name}</Button>
		</div>
	</main>

	<Dialog.Root bind:open={trialOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Free trial — {trialTitle}</Dialog.Title>
				<Dialog.Description>
					Leave your details and the gym will confirm your free class.
				</Dialog.Description>
			</Dialog.Header>
			{#if tDone}
				<div class="space-y-3 py-2 text-sm">
					<p class="font-medium">Request sent.</p>
					<p class="text-muted-foreground">
						The gym will confirm your spot — keep an eye on your email.
					</p>
				</div>
			{:else}
				<form class="space-y-4" onsubmit={submitTrial}>
					<Field.Field>
						<Field.Label for="t-name">Name</Field.Label>
						<Input id="t-name" required bind:value={tName} autocomplete="name" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="t-email">Email</Field.Label>
						<Input id="t-email" type="email" required bind:value={tEmail} autocomplete="email" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="t-phone"
							>Phone <span class="text-muted-foreground">(optional)</span></Field.Label
						>
						<Input id="t-phone" type="tel" bind:value={tPhone} autocomplete="tel" />
					</Field.Field>
					<Dialog.Footer>
						<Button type="submit" disabled={tPending}
							>{tPending ? 'Sending…' : 'Request free trial'}</Button
						>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
</div>
