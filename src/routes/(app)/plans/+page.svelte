<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import { getPlans, createPlan, updatePlan, getCurrency } from '#lib/remote/billing.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import { planIntervals } from '#lib/schemas.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import CreditCard from '@lucide/svelte/icons/credit-card';

	const currency = await getCurrency();
	let plans = $state(await getPlans());

	let open = $state(page.url.searchParams.get('new') === '1');
	let editing = $state<(typeof plans)[number] | null>(null);
	let pending = $state(false);
	let name = $state('');
	let description = $state('');
	let amount = $state<number | null>(null);
	let interval = $state<'week' | 'month' | 'year'>('month');
	let signupFee = $state<number | null>(0);
	let classCredits = $state<number | null>(null);
	let isPack = $state(false);
	let packDays = $state<number | null>(null);
	let trialDays = $state(0);
	let guestPasses = $state<number | null>(null);
	let commitmentMonths = $state<number | null>(null);
	let listed = $state(true);
	let active = $state(true);

	function openEdit(p: (typeof plans)[number]) {
		editing = p;
		name = p.name;
		description = p.description ?? '';
		amount = p.amount;
		interval = p.interval;
		signupFee = p.signupFee;
		classCredits = p.classCredits;
		isPack = p.isPack;
		packDays = p.packDays;
		trialDays = p.trialDays;
		guestPasses = p.guestPasses;
		commitmentMonths = p.commitmentMonths;
		listed = p.listed;
		active = p.active;
		open = true;
	}
	function resetNew() {
		editing = null;
		name = description = '';
		amount = null;
		interval = 'month';
		signupFee = 0;
		classCredits = null;
		isPack = false;
		packDays = null;
		trialDays = 0;
		guestPasses = null;
		commitmentMonths = null;
		listed = active = true;
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (amount == null) return;
		pending = true;
		try {
			if (editing) {
				await updatePlan({
					id: editing.id,
					name,
					description,
					amount,
					interval,
					signupFee: signupFee ?? 0,
					classCredits: classCredits || null,
					isPack,
					packDays: isPack ? packDays || null : null,
					trialDays: trialDays || 0,
					guestPasses: guestPasses || null,
					commitmentMonths: isPack ? null : commitmentMonths || null,
					listed,
					active
				});
				toast.success('Plan updated');
			} else {
				await createPlan({
					name,
					description,
					amount,
					interval,
					signupFee: signupFee ?? 0,
					classCredits: classCredits || null,
					isPack,
					packDays: isPack ? packDays || null : null,
					trialDays: trialDays || 0,
					guestPasses: guestPasses || null,
					commitmentMonths: isPack ? null : commitmentMonths || null,
					listed,
					active
				});
				toast.success('Plan created');
			}
			plans = await getPlans();
			open = false;
			resetNew();
		} catch (err) {
			toast.error(errMsg(err, 'Could not save plan'));
		}
		pending = false;
	}
</script>

<PageHeader title="Membership plans">
	{#snippet actions()}
		<Button size="sm" onclick={() => (resetNew(), (open = true))}><Plus /> New plan</Button>
	{/snippet}
</PageHeader>

<div class="p-4 md:p-6">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each plans as p (p.id)}
			<Card.Root>
				<Card.Header class="flex-row items-start justify-between">
					<div class="min-w-0">
						<Card.Title class="flex items-center gap-2 text-base">
							<CreditCard class="size-4 text-muted-foreground" />
							<span class="truncate">{p.name}</span>
						</Card.Title>
						<Card.Description class="truncate">{p.description || '—'}</Card.Description>
					</div>
					<Button variant="ghost" size="icon" onclick={() => openEdit(p)}><Pencil /></Button>
				</Card.Header>
				<Card.Content class="space-y-2 px-6">
					<div class="flex items-baseline gap-1">
						<span class="text-2xl font-semibold tabular-nums"
							>{formatMoney(p.amount, currency)}</span
						>
						{#if p.isPack}<span class="text-sm text-muted-foreground">one-time</span>{:else}<span
								class="text-sm text-muted-foreground">/ {p.interval}</span
							>{/if}
					</div>
					<div class="flex flex-wrap gap-1.5 text-xs">
						{#if p.signupFee > 0}<Badge variant="outline"
								>{formatMoney(p.signupFee, currency)} signup</Badge
							>{/if}
						{#if p.isPack}<Badge variant="secondary"
								>pack{p.packDays ? ` · ${p.packDays} days` : ''}</Badge
							>{/if}
						{#if p.classCredits}<Badge variant="outline">{p.classCredits} credits</Badge>{/if}
						{#if p.trialDays > 0}<Badge variant="outline">{p.trialDays}d free trial</Badge>{/if}
						{#if p.guestPasses}<Badge variant="outline">{p.guestPasses} guest passes/mo</Badge>{/if}
						{#if p.commitmentMonths}<Badge variant="outline"
								>{p.commitmentMonths}-mo commitment</Badge
							>{/if}
						{#if p.listed}<Badge variant="secondary">public page</Badge>{/if}
						{#if p.activeMembers > 0}<Badge variant="outline"
								>{p.activeMembers} member{p.activeMembers === 1 ? '' : 's'}</Badge
							>{/if}
						<StatusBadge status={p.active ? 'active' : 'inactive'} />
					</div>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root class="sm:col-span-2 xl:col-span-3">
				<Card.Content class="py-10 text-center">
					<p class="text-sm text-muted-foreground">
						No plans yet — create one to start billing members.
					</p>
					<Button class="mt-3" onclick={() => (resetNew(), (open = true))}><Plus /> New plan</Button
					>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editing ? `Edit ${editing.name}` : 'New plan'}</Dialog.Title>
			<Dialog.Description
				>{editing
					? 'Changes apply to new memberships only.'
					: 'Shown on your public page when "listed" is on.'}</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submit}>
			<Field.Field
				><Field.Label for="p-name">Name</Field.Label><Input
					id="p-name"
					required
					bind:value={name}
					placeholder="Unlimited"
					autofocus
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="p-desc">Description</Field.Label><Input
					id="p-desc"
					bind:value={description}
				/></Field.Field
			>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label>Price</Field.Label>
					<MoneyInput bind:value={amount} required />
				</Field.Field>
				{#if isPack}
					<Field.Field>
						<Field.Label for="p-days">Valid for (days)</Field.Label>
						<Input id="p-days" type="number" min={1} bind:value={packDays} placeholder="Never" />
					</Field.Field>
				{:else}
					<Field.Field>
						<Field.Label>Billed</Field.Label>
						<Select.Root type="single" bind:value={interval}>
							<Select.Trigger class="w-full">per {interval}</Select.Trigger>
							<Select.Content>
								{#each planIntervals as i (i)}
									<Select.Item value={i}>per {i}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
				{/if}
			</div>
			{#if !isPack}
				<Field.Field>
					<Field.Label for="p-trial">Free trial (days)</Field.Label>
					<Input id="p-trial" type="number" min={0} bind:value={trialDays} placeholder="0" />
				</Field.Field>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label>Signup fee</Field.Label>
					<MoneyInput bind:value={signupFee} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="p-credits">Class credits {isPack ? 'in pack' : '/ period'}</Field.Label>
					<Input
						id="p-credits"
						type="number"
						min={1}
						bind:value={classCredits}
						placeholder="Unlimited"
					/>
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label for="p-guests">Guest passes / month</Field.Label>
					<Input id="p-guests" type="number" min={1} bind:value={guestPasses} placeholder="None" />
				</Field.Field>
				<Field.Field>
					<Field.Label for="p-commit">Commitment (months)</Field.Label>
					<Input
						id="p-commit"
						type="number"
						min={1}
						bind:value={commitmentMonths}
						placeholder="None"
						disabled={isPack}
					/>
				</Field.Field>
			</div>
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<span>Class pack — one-time purchase, no recurring billing</span>
				<Switch bind:checked={isPack} />
			</div>
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<span>Listed on public page</span>
				<Switch bind:checked={listed} />
			</div>
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<span>Active</span>
				<Switch bind:checked={active} />
			</div>
			<Dialog.Footer
				><Button type="submit" disabled={pending || amount == null}
					>{editing ? 'Save' : 'Create plan'}</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
