<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import {
		bookDropInForm,
		buyDayPassForm,
		captureLeadForm,
		getReferrerName,
		joinGymForm
	} from '#lib/remote/public.remote.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { contrastText, errMsg, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import { referralSources } from '#lib/schemas.ts';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import Globe from '@lucide/svelte/icons/globe';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { org, settings, plans, sessions, closures, whiteLabel, brandColor } = $derived(data);
	const tz = $derived(settings.timezone);
	const currency = $derived(settings.currency);

	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let referralSource = $state<(typeof referralSources)[number] | ''>('');
	/** `?plan=<id>` preselects a plan (ads/campaign links); ignored when it isn't a listed plan. */
	const planFull = (p: (typeof plans)[number]) =>
		!p.isPack && p.memberLimit !== null && p.activeMembers >= p.memberLimit;
	let planId = $state(
		plans.some((p) => p.id === page.url.searchParams.get('plan') && !planFull(p))
			? page.url.searchParams.get('plan')!
			: ''
	);
	let promoCode = $state('');
	let website = $state(''); // honeypot — must stay empty
	let agreedWaiver = $state(false);
	const joinFields = $derived(data.joinFields ?? []);
	let customValues = $state<Record<string, string>>({});
	let pending = $state(false);
	let joined = $state(false);
	let checkoutUrl = $state<string | null>(null);
	const paid = page.url.searchParams.get('paid') === '1';
	const refId = page.url.searchParams.get('ref');
	const invitedBy = $derived(refId ? await getReferrerName({ slug: org.slug, ref: refId }) : null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const r = await joinGymForm({
				slug: org.slug,
				input: {
					name,
					email,
					phone: phone || undefined,
					referralSource: referralSource || null,
					referredById: refId || undefined,
					planId: planId || undefined,
					promoCode: promoCode || undefined,
					agreedWaiver,
					customValues,
					website
				}
			});
			checkoutUrl = r.checkoutUrl ?? null;
			joined = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not join — try again'));
		}
		pending = false;
	}

	// ------- drop-in -------
	const dropPaid = page.url.searchParams.get('dropin') === 'paid';
	let dropOpen = $state(false);
	let dropSessionId = $state('');
	let dropTitle = $state('');
	let dropPrice = $state(0);
	let dName = $state('');
	let dEmail = $state('');
	let dPhone = $state('');
	let dAgreed = $state(false);
	let dPending = $state(false);
	let dropCheckoutUrl = $state<string | null>(null);
	let dropDone = $state(false);
	const dropBooked = new SvelteSet<string>();

	function openDropIn(s: {
		session: { id: string };
		className: string;
		dropInPrice: number | null;
	}) {
		dropSessionId = s.session.id;
		dropTitle = s.className;
		dropPrice = s.dropInPrice ?? 0;
		dropDone = dropBooked.has(s.session.id);
		dropCheckoutUrl = null;
		dropOpen = true;
	}

	async function submitDropIn(e: SubmitEvent) {
		e.preventDefault();
		dPending = true;
		try {
			const r = await bookDropInForm({
				slug: org.slug,
				input: {
					sessionId: dropSessionId,
					name: dName,
					email: dEmail,
					phone: dPhone || undefined,
					agreedWaiver: dAgreed
				}
			});
			dropCheckoutUrl = r.checkoutUrl ?? null;
			dropDone = true;
			dropBooked.add(dropSessionId);
		} catch (err) {
			toast.error(errMsg(err, 'Could not book — try again'));
		}
		dPending = false;
	}

	// ------- day pass -------
	const dayPassPaid = page.url.searchParams.get('daypass') === 'paid';
	let passOpen = $state(false);
	let passDone = $state(false);
	let passCheckoutUrl = $state<string | null>(null);
	let passPending = $state(false);

	async function submitDayPass(e: SubmitEvent) {
		e.preventDefault();
		passPending = true;
		try {
			const r = await buyDayPassForm({
				slug: org.slug,
				input: { name: dName, email: dEmail, phone: dPhone || undefined, agreedWaiver: dAgreed }
			});
			passCheckoutUrl = r.checkoutUrl ?? null;
			passDone = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not buy — try again'));
		}
		passPending = false;
	}

	// ------- lead capture -------
	let leadOpen = $state(false);
	let lName = $state('');
	let lEmail = $state('');
	let lPhone = $state('');
	let lInterest = $state('');
	let lWebsite = $state(''); // honeypot
	let lPending = $state(false);
	let leadDone = $state(false);

	async function submitLead(e: SubmitEvent) {
		e.preventDefault();
		lPending = true;
		try {
			await captureLeadForm({
				slug: org.slug,
				input: {
					name: lName,
					email: lEmail,
					phone: lPhone || undefined,
					interest: lInterest || undefined,
					website: lWebsite
				}
			});
			leadDone = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not send — try again'));
		}
		lPending = false;
	}
</script>

<svelte:head>
	<title>{org.name}</title>
	<meta
		name="description"
		content={settings.tagline || `Join ${org.name} — classes, memberships and check-ins.`}
	/>
</svelte:head>

<div
	class="min-h-svh bg-background"
	style={brandColor
		? `--primary:${brandColor};--primary-foreground:${contrastText(brandColor)}`
		: ''}
>
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

	<main class="mx-auto max-w-3xl space-y-8 p-4 py-8">
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold tracking-tight">{org.name}</h1>
			{#if settings.tagline}<p class="text-lg text-muted-foreground">{settings.tagline}</p>{/if}
			<div class="flex flex-wrap gap-3 text-sm text-muted-foreground">
				{#if settings.address}<span class="flex items-center gap-1"
						><MapPin class="size-3.5" />{settings.address}</span
					>{/if}
				{#if settings.phone}<span class="flex items-center gap-1"
						><Phone class="size-3.5" />{settings.phone}</span
					>{/if}
				{#if settings.website}<a
						class="flex items-center gap-1 underline-offset-4 hover:underline"
						href={settings.website.startsWith('http')
							? settings.website
							: `https://${settings.website}`}><Globe class="size-3.5" />Website</a
					>{/if}
			</div>
		</div>

		{#if plans.length}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold">Memberships</h2>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each plans as p (p.id)}
						<Card.Root>
							<Card.Header>
								<Card.Title class="text-base">{p.name}</Card.Title>
								{#if p.description}<Card.Description>{p.description}</Card.Description>{/if}
							</Card.Header>
							<Card.Content class="space-y-2 px-6">
								<p class="text-2xl font-semibold tabular-nums">
									{formatMoney(p.amount, currency)}{#if p.isPack}<span
											class="text-sm font-normal text-muted-foreground">one-time</span
										>{:else}<span class="text-sm font-normal text-muted-foreground"
											>/{p.interval}</span
										>{/if}
								</p>
								<div class="flex flex-wrap gap-1.5">
									{#if p.memberLimit !== null && !p.isPack}
										<Badge variant={planFull(p) ? 'destructive' : 'secondary'}
											>{planFull(p) ? 'Full' : `${p.activeMembers}/${p.memberLimit} spots`}</Badge
										>
									{/if}
									{#if p.signupFee > 0}<Badge variant="outline"
											>{formatMoney(p.signupFee, currency)} signup</Badge
										>{/if}
									{#if p.classCredits}<Badge variant="outline"
											>{p.classCredits} classes{p.isPack ? '' : `/${p.interval}`}</Badge
										>{/if}
									{#if p.isPack && p.packClassName}<Badge variant="outline"
											>{p.packClassName} only</Badge
										>{/if}
									{#if p.commitmentMonths}<Badge variant="outline"
											>{p.commitmentMonths}-mo minimum{p.earlyCancelFeeCents
												? ` · ${formatMoney(p.earlyCancelFeeCents, currency)} early cancel`
												: ''}</Badge
										>{/if}
								</div>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			</section>
		{/if}

		{#if closures.length}
			<div class="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
				{#each closures as c (c.id)}
					<p><span class="font-medium">Closed {c.date}</span>{c.reason ? ` — ${c.reason}` : ''}</p>
				{/each}
			</div>
		{/if}
		{#if sessions.length}
			<section class="space-y-3">
				<h2 class="flex items-baseline justify-between text-lg font-semibold">
					This week's classes
					<a
						href="/j/{org.slug}/schedule"
						class="text-sm font-normal text-muted-foreground underline-offset-4 hover:underline"
						>Timetable</a
					>
				</h2>
				<div class="divide-y rounded-lg border">
					{#each sessions as s (s.session.id)}
						<div class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
							<div class="flex min-w-0 items-center gap-2">
								<span class="size-2 shrink-0 rounded-full" style:background={s.color}></span>
								<span class="truncate font-medium">{s.className}</span>
								{#if s.locationName}<span class="hidden text-muted-foreground sm:inline"
										>· {s.locationName}</span
									>{/if}
							</div>
							<span class="flex shrink-0 items-center gap-2 text-muted-foreground">
								<span>
									{localDate(s.session.startsAt, tz)} · {localTime(s.session.startsAt, tz)}
								</span>
								{#if s.booked < s.session.capacity && s.session.capacity - s.booked <= 5}
									<Badge variant="secondary" class="text-amber-700 dark:text-amber-400"
										>{s.session.capacity - s.booked} left</Badge
									>
								{/if}
								{#if s.dropInPrice}
									{#if s.booked >= s.session.capacity}
										<Badge variant="outline">Full</Badge>
									{:else if dropBooked.has(s.session.id)}
										<Badge variant="secondary">Booked</Badge>
									{:else}
										<Button size="sm" variant="outline" onclick={() => openDropIn(s)}>
											Drop in · {formatMoney(s.dropInPrice, currency)}
										</Button>
									{/if}
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if settings.dayPassPrice}
			<Card.Root>
				<Card.Content class="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
					<div>
						<p class="font-medium">Just visiting?</p>
						<p class="text-sm text-muted-foreground">Train for a day — no membership needed.</p>
					</div>
					<Button variant="outline" onclick={() => (passOpen = true)}
						>Day pass · {formatMoney(settings.dayPassPrice, currency)}</Button
					>
				</Card.Content>
			</Card.Root>
		{/if}

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">
				Join{#if invitedBy}
					<span class="ml-2 text-sm font-normal text-muted-foreground"
						>— invited by {invitedBy}</span
					>
				{/if}
			</h2>
			{#if dropPaid}
				<Card.Root class="border-green-500">
					<Card.Content class="px-6 py-4 text-sm text-green-700 dark:text-green-400">
						Drop-in paid — see you in class.
					</Card.Content>
				</Card.Root>
			{/if}
			{#if paid}
				<Card.Root class="border-green-500">
					<Card.Content class="px-6 py-4 text-sm text-green-700 dark:text-green-400">
						Signup fee paid — see you on the floor.
					</Card.Content>
				</Card.Root>
			{/if}
			{#if dayPassPaid}
				<Card.Root class="border-green-500">
					<Card.Content class="px-6 py-4 text-sm text-green-700 dark:text-green-400">
						Day pass paid — see you on the floor.
					</Card.Content>
				</Card.Root>
			{/if}
			{#if joined}
				<Card.Root>
					<Card.Content class="py-10 text-center">
						<p class="text-lg font-semibold">You're in!</p>
						<p class="mt-1 text-sm text-muted-foreground">
							The gym will reach out with your member portal link and first steps. See you on the
							floor.
						</p>
						{#if checkoutUrl}
							<Button class="mt-4" href={checkoutUrl}>Pay the signup fee</Button>
						{/if}
					</Card.Content>
				</Card.Root>
			{:else}
				<Card.Root>
					<Card.Content class="px-6 py-6">
						<form class="space-y-4" onsubmit={submit}>
							<div class="grid gap-4 sm:grid-cols-2">
								<Field.Field>
									<Field.Label for="j-name">Name</Field.Label>
									<Input id="j-name" required bind:value={name} autocomplete="name" />
								</Field.Field>
								<Field.Field>
									<Field.Label for="j-email">Email</Field.Label>
									<Input
										id="j-email"
										type="email"
										required
										bind:value={email}
										autocomplete="email"
									/>
								</Field.Field>
							</div>
							<div class="grid gap-4 sm:grid-cols-2">
								<Field.Field>
									<Field.Label for="j-phone">Phone (optional)</Field.Label>
									<Input id="j-phone" bind:value={phone} autocomplete="tel" />
								</Field.Field>
								<Field.Field>
									<Field.Label>How did you hear about us?</Field.Label>
									<Select.Root type="single" bind:value={referralSource}>
										<Select.Trigger class="w-full">
											{referralSource || 'Select (optional)'}
										</Select.Trigger>
										<Select.Content>
											{#each referralSources as src (src)}
												<Select.Item value={src}>{src}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</Field.Field>
								{#if plans.length}
									<Field.Field>
										<Field.Label>Plan (optional)</Field.Label>
										<Select.Root type="single" bind:value={planId}>
											<Select.Trigger class="w-full">
												{plans.find((p) => p.id === planId)?.name ?? 'Choose later'}
											</Select.Trigger>
											<Select.Content>
												<Select.Item value="">Choose later</Select.Item>
												{#each plans as p (p.id)}
													<Select.Item value={p.id} disabled={planFull(p)}
														>{p.name} — {formatMoney(p.amount, currency)}{p.isPack
															? ' one-time'
															: `/${p.interval}`}{planFull(p) ? ' · FULL' : ''}</Select.Item
													>
												{/each}
											</Select.Content>
										</Select.Root>
									</Field.Field>
									{#if planId}
										<Field.Field>
											<Field.Label for="j-promo">Promo code (optional)</Field.Label>
											<Input
												id="j-promo"
												bind:value={promoCode}
												placeholder="LAUNCH20"
												class="uppercase"
											/>
										</Field.Field>
									{/if}
								{/if}
							</div>
							{#each joinFields as f (f.id)}
								<div class="space-y-1.5">
									<Field.Label for="jf-{f.id}">{f.name}</Field.Label>
									{#if f.kind === 'select'}
										<Select.Root type="single" bind:value={customValues[f.id]}>
											<Select.Trigger class="w-full"
												>{customValues[f.id] || 'Select'}</Select.Trigger
											>
											<Select.Content>
												{#each f.options
													.split(/[\n,]/)
													.map((o) => o.trim())
													.filter(Boolean) as opt (opt)}
													<Select.Item value={opt}>{opt}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									{:else}
										<Input
											id="jf-{f.id}"
											type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
											bind:value={customValues[f.id]}
										/>
									{/if}
								</div>
							{/each}
							{#if settings.waiver}
								<div class="rounded-lg border bg-muted/40 p-3">
									<p
										class="mb-2 max-h-32 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground"
									>
										{settings.waiver}
									</p>
									<label class="flex items-start gap-2 text-sm">
										<input type="checkbox" required bind:checked={agreedWaiver} class="mt-0.5" />
										<span>I have read and agree to the liability waiver.</span>
									</label>
								</div>
							{/if}
							<!-- honeypot -->
							<input
								type="text"
								name="website"
								bind:value={website}
								tabindex="-1"
								autocomplete="off"
								class="pointer-events-none absolute -left-[9999px] opacity-0"
								aria-hidden="true"
							/>
							<Button type="submit" class="w-full" disabled={pending}>
								{pending ? 'Joining…' : `Join ${org.name}`}
							</Button>
							<button
								type="button"
								class="w-full pt-1 text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
								onclick={() => (leadOpen = true)}
							>
								Not ready to join? Leave your info and we'll reach out.
							</button>
						</form>
					</Card.Content>
				</Card.Root>
			{/if}
		</section>

		{#if !whiteLabel}
			<p class="pb-4 text-center text-xs text-muted-foreground">
				Powered by <a href="https://github.com/maxffarrell/freeweight" class="underline"
					>Freeweight</a
				>
			</p>
		{/if}
	</main>

	<Dialog.Root bind:open={dropOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Drop in — {dropTitle}</Dialog.Title>
				<Dialog.Description>
					One class, {formatMoney(dropPrice, currency)}. No membership needed.
				</Dialog.Description>
			</Dialog.Header>
			{#if dropDone}
				<div class="space-y-3 py-2 text-sm">
					<p class="font-medium">You're booked in.</p>
					{#if dropCheckoutUrl}
						<p class="text-muted-foreground">Pay now to lock it in:</p>
						<Button class="w-full" href={dropCheckoutUrl}
							>Pay {formatMoney(dropPrice, currency)}</Button
						>
					{:else}
						<p class="text-muted-foreground">Pay at the front desk when you arrive.</p>
					{/if}
				</div>
			{:else}
				<form class="space-y-4" onsubmit={submitDropIn}>
					<Field.Field>
						<Field.Label for="d-name">Name</Field.Label>
						<Input id="d-name" required bind:value={dName} autocomplete="name" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-email">Email</Field.Label>
						<Input id="d-email" type="email" required bind:value={dEmail} autocomplete="email" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-phone"
							>Phone <span class="text-muted-foreground">(optional)</span></Field.Label
						>
						<Input id="d-phone" type="tel" bind:value={dPhone} autocomplete="tel" />
					</Field.Field>
					{#if settings.waiver}
						<div class="rounded-lg border bg-muted/40 p-3">
							<p
								class="mb-2 max-h-32 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground"
							>
								{settings.waiver}
							</p>
							<label class="flex items-start gap-2 text-sm">
								<input type="checkbox" required bind:checked={dAgreed} class="mt-0.5" />
								<span>I have read and agree to the liability waiver.</span>
							</label>
						</div>
					{/if}
					<Dialog.Footer>
						<Button type="submit" disabled={dPending}
							>{dPending ? 'Booking…' : 'Book this class'}</Button
						>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={passOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Day pass — {org.name}</Dialog.Title>
				<Dialog.Description>
					{formatMoney(settings.dayPassPrice ?? 0, currency)} for today's visit. No membership needed.
				</Dialog.Description>
			</Dialog.Header>
			{#if passDone}
				<div class="space-y-3 py-2 text-sm">
					<p class="font-medium">You're set for today.</p>
					{#if passCheckoutUrl}
						<p class="text-muted-foreground">Pay now to lock it in:</p>
						<Button class="w-full" href={passCheckoutUrl}
							>Pay {formatMoney(settings.dayPassPrice ?? 0, currency)}</Button
						>
					{:else}
						<p class="text-muted-foreground">Pay at the front desk when you arrive.</p>
					{/if}
				</div>
			{:else}
				<form class="space-y-4" onsubmit={submitDayPass}>
					<Field.Field>
						<Field.Label for="p-name">Name</Field.Label>
						<Input id="p-name" required bind:value={dName} autocomplete="name" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="p-email">Email</Field.Label>
						<Input id="p-email" type="email" required bind:value={dEmail} autocomplete="email" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="p-phone"
							>Phone <span class="text-muted-foreground">(optional)</span></Field.Label
						>
						<Input id="p-phone" type="tel" bind:value={dPhone} autocomplete="tel" />
					</Field.Field>
					{#if settings.waiver}
						<div class="rounded-lg border bg-muted/40 p-3">
							<p
								class="mb-2 max-h-32 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground"
							>
								{settings.waiver}
							</p>
							<label class="flex items-start gap-2 text-sm">
								<input type="checkbox" required bind:checked={dAgreed} class="mt-0.5" />
								<span>I have read and agree to the liability waiver.</span>
							</label>
						</div>
					{/if}
					<Dialog.Footer>
						<Button type="submit" disabled={passPending}
							>{passPending ? 'Buying…' : `Buy a day pass`}</Button
						>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={leadOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Keep me posted</Dialog.Title>
				<Dialog.Description>
					Not ready to join yet — leave your info and {org.name} will reach out.
				</Dialog.Description>
			</Dialog.Header>
			{#if leadDone}
				<div class="space-y-3 py-2 text-sm">
					<p class="font-medium">Thanks — we'll be in touch.</p>
					<p class="text-muted-foreground">
						The gym has your details and will reach out when you're ready.
					</p>
				</div>
			{:else}
				<form class="space-y-4" onsubmit={submitLead}>
					<Field.Field>
						<Field.Label for="l-name">Name</Field.Label>
						<Input id="l-name" required bind:value={lName} autocomplete="name" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="l-email">Email</Field.Label>
						<Input id="l-email" type="email" required bind:value={lEmail} autocomplete="email" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="l-phone"
							>Phone <span class="text-muted-foreground">(optional)</span></Field.Label
						>
						<Input id="l-phone" type="tel" bind:value={lPhone} autocomplete="tel" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="l-interest"
							>What are you interested in? <span class="text-muted-foreground">(optional)</span
							></Field.Label
						>
						<Input
							id="l-interest"
							bind:value={lInterest}
							placeholder="e.g. trial week, personal training"
						/>
					</Field.Field>
					<!-- honeypot -->
					<input
						type="text"
						name="website"
						tabindex="-1"
						autocomplete="off"
						class="hidden"
						bind:value={lWebsite}
					/>
					<Dialog.Footer>
						<Button type="submit" disabled={lPending}
							>{lPending ? 'Sending…' : 'Send my info'}</Button
						>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
</div>
