<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { createPlan } from '#lib/remote/billing.remote.ts';
	import { createClassType, createTemplate } from '#lib/remote/schedule.remote.ts';
	import { toast } from 'svelte-sonner';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Check from '@lucide/svelte/icons/check';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const firstName = $derived(data.name.split(' ')[0]);

	let step = $state(0);
	let pending = $state(false);
	const totalSteps = 4;

	// ---- step 0: gym name ----
	let name = $state('');
	const slug = $derived(
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 40)
	);

	async function createOrg() {
		pending = true;
		const { data: org, error } = await authClient.organization.create({
			name: name.trim(),
			slug: `${slug || 'gym'}-${Math.random().toString(36).slice(2, 6)}`
		});
		if (error || !org) {
			pending = false;
			return toast.error(error?.message ?? 'Could not create workspace');
		}
		await authClient.organization.setActive({ organizationId: org.id });
		pending = false;
		step = 1;
	}

	// ---- step 1: first plan ----
	let planName = $state('Unlimited');
	let planPrice = $state('129');
	let planInterval = $state<'week' | 'month' | 'year'>('month');
	async function savePlan() {
		const cents = Math.round(parseFloat(planPrice || '0') * 100);
		if (!planName.trim() || !(cents > 0)) return toast.error('Name and a price are required');
		pending = true;
		try {
			await createPlan({
				name: planName.trim(),
				amount: cents,
				interval: planInterval,
				listed: true
			});
			step = 2;
		} catch (err) {
			toast.error((err as Error).message ?? 'Could not create plan');
		} finally {
			pending = false;
		}
	}

	// ---- step 2: first class + weekly slot ----
	let className = $state('');
	let classDuration = $state('60');
	let classDay = $state('1');
	let classTime = $state('18:00');
	async function saveClass() {
		if (!className.trim()) return toast.error('Name the class');
		pending = true;
		try {
			const ct = await createClassType({
				name: className.trim(),
				durationMin: parseInt(classDuration || '60') || 60,
				capacity: 20
			});
			await createTemplate({
				classTypeId: ct.id,
				weekday: parseInt(classDay),
				startTime: classTime
			});
			step = 3;
		} catch (err) {
			toast.error((err as Error).message ?? 'Could not create class');
		} finally {
			pending = false;
		}
	}

	// ---- step 3: invite team ----
	let inviteEmails = $state('');
	async function sendInvites() {
		const emails = inviteEmails
			.split(/[,\n]/)
			.map((e) => e.trim())
			.filter(Boolean);
		if (!emails.length) return (step = 4);
		pending = true;
		let sent = 0;
		for (const email of emails) {
			const { error } = await authClient.organization.inviteMember({ email, role: 'member' });
			if (error) toast.error(`${email}: ${error.message ?? 'Could not invite'}`);
			else sent++;
		}
		pending = false;
		if (sent) toast.success(`${sent} invite${sent === 1 ? '' : 's'} sent`);
		step = 4;
	}

	const weekdays = [
		{ value: '0', label: 'Sunday' },
		{ value: '1', label: 'Monday' },
		{ value: '2', label: 'Tuesday' },
		{ value: '3', label: 'Wednesday' },
		{ value: '4', label: 'Thursday' },
		{ value: '5', label: 'Friday' },
		{ value: '6', label: 'Saturday' }
	];
	const dayLabel = $derived(weekdays.find((d) => d.value === classDay)?.label ?? '');

	function next(e: SubmitEvent) {
		e.preventDefault();
		if (step === 0) return createOrg();
		if (step === 1) return savePlan();
		if (step === 2) return saveClass();
		return sendInvites();
	}
</script>

<svelte:head><title>Set up your gym · Freeweight</title></svelte:head>

<div class="flex min-h-svh items-center justify-center p-6">
	<div class="w-full max-w-sm space-y-6">
		<Logo class="size-9" />

		{#if step === 0}
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight">Hi {firstName}, name your gym</h1>
				<p class="text-sm text-muted-foreground">
					This is what members see on your public page and receipts.
				</p>
			</div>
			<form class="space-y-6" onsubmit={next}>
				<Field.Field>
					<Field.Label for="org">Gym name</Field.Label>
					<Input id="org" placeholder="Iron Works Gym" required bind:value={name} autofocus />
				</Field.Field>
				<Button type="submit" class="w-full" disabled={pending || !name.trim()}>
					{pending ? 'Creating…' : 'Continue'}
				</Button>
			</form>
		{:else if step === 1}
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight">Create a membership plan</h1>
				<p class="text-sm text-muted-foreground">
					What members pay to train. You can add class packs and more plans later.
				</p>
			</div>
			<form class="space-y-4" onsubmit={next}>
				<Field.Field>
					<Field.Label for="pname">Plan name</Field.Label>
					<Input id="pname" placeholder="Unlimited" required bind:value={planName} autofocus />
				</Field.Field>
				<div class="grid grid-cols-2 gap-3">
					<Field.Field>
						<Field.Label for="pprice">Price</Field.Label>
						<Input id="pprice" type="number" min="1" step="0.01" required bind:value={planPrice} />
					</Field.Field>
					<Field.Field>
						<Field.Label>Billed</Field.Label>
						<Select.Root type="single" bind:value={planInterval}>
							<Select.Trigger class="w-full">
								{planInterval === 'week'
									? 'Weekly'
									: planInterval === 'year'
										? 'Yearly'
										: 'Monthly'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="week">Weekly</Select.Item>
								<Select.Item value="month">Monthly</Select.Item>
								<Select.Item value="year">Yearly</Select.Item>
							</Select.Content>
						</Select.Root>
					</Field.Field>
				</div>
				<div class="flex gap-2">
					<Button type="submit" class="flex-1" disabled={pending}>
						{pending ? 'Saving…' : 'Create plan'}
					</Button>
					<Button type="button" variant="ghost" onclick={() => (step = 2)}>Skip</Button>
				</div>
			</form>
		{:else if step === 2}
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight">Add your first class</h1>
				<p class="text-sm text-muted-foreground">
					A weekly recurring class — the schedule fills it in automatically from now on.
				</p>
			</div>
			<form class="space-y-4" onsubmit={next}>
				<Field.Field>
					<Field.Label for="cname">Class name</Field.Label>
					<Input
						id="cname"
						placeholder="Strength Foundations"
						required
						bind:value={className}
						autofocus
					/>
				</Field.Field>
				<div class="grid grid-cols-3 gap-3">
					<Field.Field>
						<Field.Label>Day</Field.Label>
						<Select.Root type="single" bind:value={classDay}>
							<Select.Trigger class="w-full">{dayLabel}</Select.Trigger>
							<Select.Content>
								{#each weekdays as d (d.value)}
									<Select.Item value={d.value}>{d.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label for="ctime">Starts</Field.Label>
						<Input id="ctime" type="time" required bind:value={classTime} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cdur">Minutes</Field.Label>
						<Input id="cdur" type="number" min="15" step="5" required bind:value={classDuration} />
					</Field.Field>
				</div>
				<div class="flex gap-2">
					<Button type="submit" class="flex-1" disabled={pending}>
						{pending ? 'Saving…' : 'Create class'}
					</Button>
					<Button type="button" variant="ghost" onclick={() => (step = 3)}>Skip</Button>
				</div>
			</form>
		{:else if step === 3}
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight">Invite your team</h1>
				<p class="text-sm text-muted-foreground">
					Coaches and front-desk staff get their own logins. Comma-separate emails — you can do this
					later in Settings.
				</p>
			</div>
			<form class="space-y-4" onsubmit={next}>
				<Field.Field>
					<Field.Label for="emails">Staff emails</Field.Label>
					<Input
						id="emails"
						placeholder="coach@gym.com, desk@gym.com"
						bind:value={inviteEmails}
						autofocus
					/>
				</Field.Field>
				<div class="flex gap-2">
					<Button type="submit" class="flex-1" disabled={pending}>
						{pending ? 'Sending…' : 'Send invites'}
					</Button>
					<Button type="button" variant="ghost" onclick={() => (step = 4)}>Skip</Button>
				</div>
			</form>
		{:else}
			<div class="space-y-1">
				<div
					class="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"
				>
					<Check class="h-6 w-6" />
				</div>
				<h1 class="text-2xl font-semibold tracking-tight">You're set up</h1>
				<p class="text-sm text-muted-foreground">
					{name.trim() || 'Your gym'} is ready. The dashboard has a checklist for what's next — load the
					demo data in Settings if you want to look around with sample members first.
				</p>
			</div>
			<Button class="w-full" onclick={() => goto('/dashboard', { invalidateAll: true })}>
				Open your dashboard
			</Button>
		{/if}

		{#if step > 0 && step < totalSteps}
			<div class="flex items-center justify-between">
				<Button variant="ghost" size="sm" onclick={() => step--} disabled={pending}>
					<ChevronLeft class="h-4 w-4" /> Back
				</Button>
				<div class="flex items-center gap-1.5" aria-label="Step {step + 1} of {totalSteps}">
					{#each Array(totalSteps) as _, i (i)}
						<span
							class="h-1.5 rounded-full transition-all {i <= step
								? 'w-4 bg-primary'
								: 'w-1.5 bg-muted-foreground/30'}"
						></span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>
