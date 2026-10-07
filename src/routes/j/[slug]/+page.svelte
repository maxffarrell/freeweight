<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { joinGymForm } from '#lib/remote/public.remote.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import Globe from '@lucide/svelte/icons/globe';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { org, settings, plans, sessions } = $derived(data);
	const tz = $derived(settings.timezone);
	const currency = $derived(settings.currency);

	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let planId = $state('');
	let website = $state(''); // honeypot — must stay empty
	let pending = $state(false);
	let joined = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await joinGymForm({
				slug: org.slug,
				input: { name, email, phone: phone || undefined, planId: planId || undefined, website }
			});
			joined = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not join — try again'));
		}
		pending = false;
	}
</script>

<svelte:head>
	<title>{org.name}</title>
	<meta
		name="description"
		content={settings.tagline || `Join ${org.name} — classes, memberships and check-ins.`}
	/>
</svelte:head>

<div class="min-h-svh bg-background">
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			<Logo />
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
									{formatMoney(p.amount, currency)}<span
										class="text-sm font-normal text-muted-foreground">/{p.interval}</span
									>
								</p>
								<div class="flex flex-wrap gap-1.5">
									{#if p.signupFee > 0}<Badge variant="outline"
											>{formatMoney(p.signupFee, currency)} signup</Badge
										>{/if}
									{#if p.classCredits}<Badge variant="outline"
											>{p.classCredits} classes/{p.interval}</Badge
										>{/if}
								</div>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			</section>
		{/if}

		{#if sessions.length}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold">This week's classes</h2>
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
							<span class="shrink-0 text-muted-foreground">
								{localDate(s.session.startsAt, tz)} · {localTime(s.session.startsAt, tz)}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Join</h2>
			{#if joined}
				<Card.Root>
					<Card.Content class="py-10 text-center">
						<p class="text-lg font-semibold">You're in!</p>
						<p class="mt-1 text-sm text-muted-foreground">
							The gym will reach out with your member portal link and first steps. See you on the
							floor.
						</p>
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
													<Select.Item value={p.id}
														>{p.name} — {formatMoney(p.amount, currency)}/{p.interval}</Select.Item
													>
												{/each}
											</Select.Content>
										</Select.Root>
									</Field.Field>
								{/if}
							</div>
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
						</form>
					</Card.Content>
				</Card.Root>
			{/if}
		</section>

		<p class="pb-4 text-center text-xs text-muted-foreground">
			Powered by <a href="https://github.com/maxffarrell/freeweight" class="underline">Freeweight</a
			>
		</p>
	</main>
</div>
