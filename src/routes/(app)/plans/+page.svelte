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
	import {
		getPlans,
		migratePlanMembers,
		createPlan,
		updatePlan,
		getCurrency,
		getPromoCodes,
		createPromoCode,
		updatePromoCode
	} from '#lib/remote/billing.remote.ts';
	import { getJoinInfo } from '#lib/remote/workspace.remote.ts';
	import { getClassTypes } from '#lib/remote/schedule.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { planIntervals } from '#lib/schemas.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Link2 from '@lucide/svelte/icons/link-2';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';

	const currency = await getCurrency();
	const joinInfo = await getJoinInfo();
	let classTypes = $state(await getClassTypes());
	let plans = $state(await getPlans());
	let promoCodes = $state(await getPromoCodes());

	/** Copy the join page deep-link that preselects this plan (ads/campaigns). */
	async function copyPlanLink(p: { id: string; name: string }) {
		await navigator.clipboard.writeText(`${joinInfo.url}?plan=${p.id}`);
		toast.success(`${p.name} join link copied`);
	}

	let open = $state(page.url.searchParams.get('new') === '1');
	let editing = $state<(typeof plans)[number] | null>(null);
	let migFrom = $state<(typeof plans)[number] | null>(null);
	let migTarget = $state('');
	let migBusy = $state(false);
	async function doMigrate() {
		if (!migFrom || !migTarget) return;
		if (
			!confirm(
				`Move every active/paused membership from ${migFrom.name} to the selected plan? Pricing and billing dates are kept.`
			)
		)
			return;
		migBusy = true;
		try {
			const r = await migratePlanMembers({ fromPlanId: migFrom.id, toPlanId: migTarget });
			toast.success(`Moved ${r.moved} membership${r.moved === 1 ? '' : 's'}`);
			migFrom = null;
			migTarget = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not move members'));
		}
		migBusy = false;
	}
	let pending = $state(false);
	let name = $state('');
	let description = $state('');
	let amount = $state<number | null>(null);
	let interval = $state<'week' | 'month' | 'year'>('month');
	let signupFee = $state<number | null>(0);
	let classCredits = $state<number | null>(null);
	let isPack = $state(false);
	/** 'any' = valid for every class; a class-type id scopes the pack to it. */
	let packClassType = $state('any');
	let packDays = $state<number | null>(null);
	let trialDays = $state(0);
	let guestPasses = $state<number | null>(null);
	let commitmentMonths = $state<number | null>(null);
	let earlyCancelFee = $state<number | null>(null);
	let memberLimit = $state<number | null>(null);
	let bookAheadDays = $state<number | null>(null);
	let grandfather = $state(false);
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
		packClassType = p.classTypeId ?? 'any';
		packDays = p.packDays;
		trialDays = p.trialDays;
		guestPasses = p.guestPasses;
		commitmentMonths = p.commitmentMonths;
		earlyCancelFee = p.earlyCancelFeeCents;
		memberLimit = p.memberLimit;
		bookAheadDays = p.bookAheadDays;
		listed = p.listed;
		active = p.active;
		grandfather = false;
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
		packClassType = 'any';
		packDays = null;
		trialDays = 0;
		guestPasses = null;
		commitmentMonths = null;
		earlyCancelFee = null;
		memberLimit = null;
		bookAheadDays = null;
		listed = active = true;
		grandfather = false;
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
					classTypeId: isPack && packClassType !== 'any' ? packClassType : null,
					packDays: isPack ? packDays || null : null,
					trialDays: trialDays || 0,
					guestPasses: guestPasses || null,
					commitmentMonths: isPack ? null : commitmentMonths || null,
					earlyCancelFeeCents: isPack ? null : earlyCancelFee || null,
					memberLimit: isPack ? null : memberLimit || null,
					bookAheadDays: isPack ? null : bookAheadDays || null,
					listed,
					active,
					grandfatherPrice: grandfather || undefined
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
					classTypeId: isPack && packClassType !== 'any' ? packClassType : null,
					packDays: isPack ? packDays || null : null,
					trialDays: trialDays || 0,
					guestPasses: guestPasses || null,
					commitmentMonths: isPack ? null : commitmentMonths || null,
					earlyCancelFeeCents: isPack ? null : earlyCancelFee || null,
					memberLimit: isPack ? null : memberLimit || null,
					bookAheadDays: isPack ? null : bookAheadDays || null,
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

	// ------- promo codes -------
	let promoOpen = $state(false);
	let pcCode = $state('');
	let pcPercent = $state<number | null>(null);
	let pcAmount = $state<number | null>(null);
	let pcMaxUses = $state<number | null>(null);
	let pcExpires = $state('');
	async function submitPromo(e: SubmitEvent) {
		e.preventDefault();
		if ((pcPercent == null) === (pcAmount == null)) {
			toast.error('Set either a percent or a flat amount off');
			return;
		}
		pending = true;
		try {
			await createPromoCode({
				code: pcCode,
				percentOff: pcPercent || null,
				amountOff: pcAmount != null ? Math.round(pcAmount * 100) : null,
				maxUses: pcMaxUses || null,
				expiresAt: pcExpires || null
			});
			toast.success('Promo code created');
			promoCodes = await getPromoCodes();
			promoOpen = false;
			pcCode = '';
			pcPercent = pcAmount = pcMaxUses = null;
			pcExpires = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not create code'));
		}
		pending = false;
	}
	async function togglePromo(id: string, active: boolean) {
		try {
			await updatePromoCode({ id, active });
			promoCodes = await getPromoCodes();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
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
					<div class="flex shrink-0">
						{#if p.listed && joinInfo.enabled}
							<Button
								variant="ghost"
								size="icon"
								title="Copy join-page link for {p.name}"
								onclick={() => copyPlanLink(p)}><Link2 /></Button
							>
						{/if}
						<Button
							variant="ghost"
							size="icon"
							title="Move members to another plan"
							onclick={() => {
								migFrom = p;
								migTarget = '';
							}}><ArrowRightLeft /></Button
						>
						<Button variant="ghost" size="icon" onclick={() => openEdit(p)}><Pencil /></Button>
					</div>
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
						{#if p.isPack && p.packClassName}<Badge variant="outline">{p.packClassName} only</Badge
							>{/if}
						{#if p.classCredits}<Badge variant="outline">{p.classCredits} credits</Badge>{/if}
						{#if p.trialDays > 0}<Badge variant="outline">{p.trialDays}d free trial</Badge>{/if}
						{#if p.guestPasses}<Badge variant="outline">{p.guestPasses} guest passes/mo</Badge>{/if}
						{#if p.commitmentMonths}<Badge variant="outline"
								>{p.commitmentMonths}-mo commitment</Badge
							>{/if}
						{#if p.bookAheadDays}<Badge variant="outline">books {p.bookAheadDays}d ahead</Badge
							>{/if}
						{#if p.listed}<Badge variant="secondary">public page</Badge>{/if}
						{#if p.activeMembers > 0 || p.memberLimit}<Badge
								variant={p.memberLimit !== null && p.activeMembers >= p.memberLimit
									? 'destructive'
									: 'outline'}
								>{p.activeMembers}{p.memberLimit !== null ? `/${p.memberLimit}` : ''} member{p.activeMembers ===
									1 && !p.memberLimit
									? ''
									: 's'}{p.memberLimit !== null && p.activeMembers >= p.memberLimit
									? ' · full'
									: ''}</Badge
							>{/if}
						{#if p.endingSoon > 0}<Badge variant="outline" class="text-amber-600"
								>{p.endingSoon} ending soon</Badge
							>{/if}
						{#if !p.isPack && p.activeMembers > 0}
							{@const mrr = Math.round(
								p.amount *
									p.activeMembers *
									(p.interval === 'week' ? 52 / 12 : p.interval === 'year' ? 1 / 12 : 1)
							)}
							<Badge variant="outline" class="text-muted-foreground"
								>≈ {formatMoney(mrr, currency, true)}/mo</Badge
							>
						{/if}
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

	<Card.Root class="mt-6">
		<Card.Header class="flex-row items-center justify-between">
			<div>
				<Card.Title class="text-base">Promo codes</Card.Title>
				<Card.Description>Discount the up-front charge on your public join page.</Card.Description>
			</div>
			<Button size="sm" variant="outline" onclick={() => (promoOpen = true)}
				><Plus /> New code</Button
			>
		</Card.Header>
		<Card.Content class="px-6">
			<div class="divide-y">
				{#each promoCodes as c (c.id)}
					<div class="flex items-center justify-between gap-3 py-2.5 text-sm">
						<div class="min-w-0">
							<p class="font-mono font-medium">{c.code}</p>
							<p class="text-xs text-muted-foreground">
								{c.percentOff != null
									? `${c.percentOff}% off`
									: `${formatMoney(c.amountOff!, currency)} off`}
								· {c.maxUses != null
									? `${c.timesUsed}/${c.maxUses} used`
									: `${c.timesUsed} used`}{c.expiresAt
									? ` · expires ${formatDate(c.expiresAt)}`
									: ''}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<StatusBadge status={c.active ? 'active' : 'inactive'} />
							<Switch checked={c.active} onCheckedChange={(v) => togglePromo(c.id, v)} />
						</div>
					</div>
				{:else}
					<p class="py-4 text-sm text-muted-foreground">
						No codes yet — make one like LAUNCH20 or FREEJOIN.
					</p>
				{/each}
			</div>
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open={promoOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New promo code</Dialog.Title>
			<Dialog.Description
				>Applies to the signup fee (and pack price) on the public join page.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPromo}>
			<Field.Field
				><Field.Label for="pc-code">Code</Field.Label><Input
					id="pc-code"
					required
					bind:value={pcCode}
					placeholder="LAUNCH20"
					class="font-mono uppercase"
					autofocus
				/></Field.Field
			>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label for="pc-pct">Percent off</Field.Label>
					<Input
						id="pc-pct"
						type="number"
						min={1}
						max={100}
						bind:value={pcPercent}
						placeholder="20"
						disabled={pcAmount != null}
					/>
				</Field.Field>
				<Field.Field>
					<Field.Label for="pc-amt">Amount off</Field.Label>
					<Input
						id="pc-amt"
						type="number"
						min={0.01}
						step={0.01}
						bind:value={pcAmount}
						placeholder="25.00"
						disabled={pcPercent != null}
					/>
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label for="pc-uses">Max uses</Field.Label>
					<Input
						id="pc-uses"
						type="number"
						min={1}
						bind:value={pcMaxUses}
						placeholder="Unlimited"
					/>
				</Field.Field>
				<Field.Field>
					<Field.Label for="pc-exp">Expires on</Field.Label>
					<Input id="pc-exp" type="date" bind:value={pcExpires} />
				</Field.Field>
			</div>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !pcCode}>Create code</Button></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!migFrom} onOpenChange={(o) => !o && (migFrom = null)}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Title>Move members from {migFrom?.name}</Dialog.Title>
		<Dialog.Description>
			Every active and paused membership switches to the new plan — pricing and billing dates are
			kept.
		</Dialog.Description>
		<Field.Field>
			<Field.Label>To plan</Field.Label>
			<NativeSelect bind:value={migTarget}>
				<option value="" disabled>Pick a plan…</option>
				{#each plans.filter((x) => x.id !== migFrom?.id && !x.isPack) as q (q.id)}
					<option value={q.id}>
						{q.name} — {formatMoney(q.amount, currency)}/{q.interval}
					</option>
				{/each}
			</NativeSelect>
		</Field.Field>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (migFrom = null)}>Cancel</Button>
			<Button disabled={!migTarget || migBusy} onclick={doMigrate}>
				{migBusy ? 'Moving…' : 'Move members'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

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
					{#if editing}
						<Field.Description
							>Members on this plan get an email when the price changes.</Field.Description
						>
					{/if}
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
				<Field.Field>
					<Field.Label for="p-etf">Early-cancel fee</Field.Label>
					<MoneyInput bind:value={earlyCancelFee} id="p-etf" />
					<Field.Description>Charged if cancelled inside the commitment window</Field.Description>
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label for="p-limit">Member cap</Field.Label>
					<Input
						id="p-limit"
						type="number"
						min={1}
						bind:value={memberLimit}
						placeholder="Unlimited"
						disabled={isPack}
					/>
					<Field.Description>Max active members on the plan</Field.Description>
				</Field.Field>
				<Field.Field>
					<Field.Label for="p-ahead">Book ahead (days)</Field.Label>
					<Input
						id="p-ahead"
						type="number"
						min={1}
						bind:value={bookAheadDays}
						placeholder="Gym default"
						disabled={isPack}
					/>
					<Field.Description>Overrides the gym-wide window</Field.Description>
				</Field.Field>
			</div>
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<span>Class pack — one-time purchase, no recurring billing</span>
				<Switch bind:checked={isPack} />
			</div>
			{#if isPack}
				<Field.Field>
					<Field.Label>Valid for</Field.Label>
					<Select.Root type="single" bind:value={packClassType}>
						<Select.Trigger class="w-full">
							{packClassType === 'any'
								? 'Any class'
								: classTypes.find((c) => c.id === packClassType)?.name}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="any">Any class</Select.Item>
							{#each classTypes as c (c.id)}
								<Select.Item value={c.id}>{c.name} only</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Field.Description
						>A restricted pack can't book other class types — a "Yoga 10-pack" only covers yoga.</Field.Description
					>
				</Field.Field>
			{/if}
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<span>Listed on public page</span>
				<Switch bind:checked={listed} />
			</div>
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<span>Active</span>
				<Switch bind:checked={active} />
			</div>
			{#if editing && !isPack && amount != null && amount !== editing.amount}
				<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
					<span
						>Keep current members at {formatMoney(editing.amount, currency)}
						— only new joins pay {formatMoney(amount, currency)}</span
					>
					<Switch bind:checked={grandfather} />
				</div>
			{/if}
			<Dialog.Footer
				><Button type="submit" disabled={pending || amount == null}
					>{editing ? 'Save' : 'Create plan'}</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
