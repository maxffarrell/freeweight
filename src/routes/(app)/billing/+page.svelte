<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getCharges,
		addCharge,
		updateCharge,
		getMemberships,
		updateMembership,
		getPayments,
		recordPayment,
		getCurrency
	} from '#lib/remote/billing.remote.ts';
	import { getMembers } from '#lib/remote/members.remote.ts';
	import { formatMoney, formatDate, todayISO } from '#lib/format.ts';
	import { chargeKinds, paymentMethods } from '#lib/schemas.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Wallet from '@lucide/svelte/icons/wallet';

	const currency = await getCurrency();
	const memberList = await getMembers();
	let charges = $state(
		await getCharges({ status: page.url.searchParams.get('status') ?? undefined })
	);
	let memberships = $state(await getMemberships());
	let payments = $state(await getPayments());
	let chargeFilter = $state(page.url.searchParams.get('status') ?? '');

	async function filterCharges() {
		charges = await getCharges({ status: chargeFilter || undefined });
	}

	let pending = $state(false);

	// ------- record payment -------
	let payOpen = $state(page.url.searchParams.get('new') === 'payment');
	let payMemberId = $state('');
	let payAmount = $state<number | null>(null);
	let payMethod = $state<'card' | 'cash' | 'bank' | 'other'>('cash');
	let payNotes = $state('');
	async function submitPayment(e: SubmitEvent) {
		e.preventDefault();
		if (!payAmount) return;
		pending = true;
		try {
			await recordPayment({
				memberId: payMemberId,
				amount: payAmount,
				method: payMethod,
				notes: payNotes || undefined
			});
			toast.success('Payment recorded');
			payOpen = false;
			payMemberId = '';
			payAmount = null;
			payNotes = '';
			charges = await getCharges({ status: chargeFilter || undefined });
			payments = await getPayments();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record payment');
		}
		pending = false;
	}

	// ------- new charge -------
	let chargeOpen = $state(false);
	let cMemberId = $state('');
	let cKind = $state<'membership' | 'signup' | 'dropin' | 'other'>('other');
	let cDesc = $state('');
	let cAmount = $state<number | null>(null);
	let cDue = $state(todayISO());
	async function submitCharge(e: SubmitEvent) {
		e.preventDefault();
		if (!cAmount) return;
		pending = true;
		try {
			await addCharge({
				memberId: cMemberId,
				kind: cKind,
				description: cDesc || undefined,
				amount: cAmount,
				dueDate: cDue
			});
			toast.success('Charge added');
			chargeOpen = false;
			cMemberId = '';
			cDesc = '';
			cAmount = null;
			charges = await getCharges({ status: chargeFilter || undefined });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not add charge');
		}
		pending = false;
	}

	async function voidCharge(id: string) {
		try {
			await updateCharge({ id, status: 'void' });
			charges = await getCharges({ status: chargeFilter || undefined });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not void');
		}
	}
	async function setMembership(id: string, status: 'paused' | 'cancelled' | 'active') {
		try {
			await updateMembership({ id, status });
			memberships = await getMemberships();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update');
		}
	}
</script>

<PageHeader title="Billing">
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={() => (chargeOpen = true)}><Plus /> Charge</Button>
		<Button size="sm" onclick={() => (payOpen = true)}><Wallet /> Record payment</Button>
	{/snippet}
</PageHeader>

<div class="p-4 md:p-6">
	<Tabs.Root value="charges">
		<Tabs.List class="mb-4">
			<Tabs.Trigger value="charges">Charges</Tabs.Trigger>
			<Tabs.Trigger value="memberships">Memberships</Tabs.Trigger>
			<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="charges">
			<div class="mb-3 flex items-center gap-2">
				<select
					bind:value={chargeFilter}
					onchange={filterCharges}
					class="h-8 rounded-md border bg-transparent px-2 text-sm"
				>
					<option value="">All</option>
					<option value="open">Open</option>
					<option value="paid">Paid</option>
					<option value="void">Void</option>
				</select>
			</div>
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Member</Table.Head>
								<Table.Head>Description</Table.Head>
								<Table.Head>Due</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
								<Table.Head class="text-right">Paid</Table.Head>
								<Table.Head></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each charges as c (c.charge.id)}
								<Table.Row>
									<Table.Cell>
										<a class="font-medium hover:underline" href="/members/{c.charge.memberId}"
											>{c.memberName}</a
										>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground"
										>{c.charge.description ?? c.charge.kind}</Table.Cell
									>
									<Table.Cell>{formatDate(c.charge.dueDate)}</Table.Cell>
									<Table.Cell><StatusBadge status={c.charge.status} /></Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(c.charge.amount, currency)}</Table.Cell
									>
									<Table.Cell class="text-right text-muted-foreground tabular-nums"
										>{formatMoney(c.paid, currency)}</Table.Cell
									>
									<Table.Cell class="text-right">
										{#if c.charge.status === 'open'}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => voidCharge(c.charge.id)}>Void</Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={7} class="text-muted-foreground">No charges.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="memberships">
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Member</Table.Head>
								<Table.Head>Plan</Table.Head>
								<Table.Head>Started</Table.Head>
								<Table.Head>Next charge</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each memberships as mm (mm.membership.id)}
								<Table.Row>
									<Table.Cell>
										<a class="font-medium hover:underline" href="/members/{mm.membership.memberId}"
											>{mm.memberName}</a
										>
									</Table.Cell>
									<Table.Cell
										>{mm.planName}
										<span class="text-muted-foreground"
											>· {formatMoney(mm.amount, currency)}/{mm.interval}</span
										></Table.Cell
									>
									<Table.Cell>{formatDate(mm.membership.startsAt)}</Table.Cell>
									<Table.Cell
										>{mm.membership.status === 'active'
											? formatDate(mm.membership.nextChargeAt)
											: '—'}</Table.Cell
									>
									<Table.Cell><StatusBadge status={mm.membership.status} /></Table.Cell>
									<Table.Cell class="text-right">
										{#if mm.membership.status === 'active'}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setMembership(mm.membership.id, 'paused')}>Pause</Button
											>
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs text-destructive"
												onclick={() => setMembership(mm.membership.id, 'cancelled')}>Cancel</Button
											>
										{:else if mm.membership.status === 'paused'}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setMembership(mm.membership.id, 'active')}>Resume</Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={6} class="text-muted-foreground">No memberships.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="payments">
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Member</Table.Head>
								<Table.Head>When</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each payments as p (p.payment.id)}
								<Table.Row>
									<Table.Cell>
										<a class="font-medium hover:underline" href="/members/{p.payment.memberId}"
											>{p.memberName}</a
										>
									</Table.Cell>
									<Table.Cell>{formatDate(p.payment.paidAt)}</Table.Cell>
									<Table.Cell class="capitalize">{p.payment.method}</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(p.payment.amount, currency)}</Table.Cell
									>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={4} class="text-muted-foreground">No payments.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>

<Dialog.Root bind:open={payOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Record payment</Dialog.Title>
			<Dialog.Description>Applied to the member's open charges oldest-first.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPayment}>
			<Field.Field>
				<Field.Label>Member</Field.Label>
				<Select.Root type="single" bind:value={payMemberId}>
					<Select.Trigger class="w-full"
						>{memberList.find((mm) => mm.id === payMemberId)?.name ?? 'Choose…'}</Select.Trigger
					>
					<Select.Content>
						{#each memberList as mm (mm.id)}
							<Select.Item value={mm.id}>{mm.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Amount</Field.Label>
				<MoneyInput bind:value={payAmount} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Method</Field.Label>
				<Select.Root type="single" bind:value={payMethod}>
					<Select.Trigger class="w-full">{payMethod}</Select.Trigger>
					<Select.Content>
						{#each paymentMethods.filter((pm) => pm !== 'stripe') as pm (pm)}
							<Select.Item value={pm}>{pm}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field
				><Field.Label for="bp-notes">Note</Field.Label><Input
					id="bp-notes"
					bind:value={payNotes}
				/></Field.Field
			>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !payMemberId || !payAmount}>Record</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={chargeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New charge</Dialog.Title>
			<Dialog.Description>One-off charges for drop-ins, fees, or anything else.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitCharge}>
			<Field.Field>
				<Field.Label>Member</Field.Label>
				<Select.Root type="single" bind:value={cMemberId}>
					<Select.Trigger class="w-full"
						>{memberList.find((mm) => mm.id === cMemberId)?.name ?? 'Choose…'}</Select.Trigger
					>
					<Select.Content>
						{#each memberList as mm (mm.id)}
							<Select.Item value={mm.id}>{mm.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Kind</Field.Label>
				<Select.Root type="single" bind:value={cKind}>
					<Select.Trigger class="w-full">{cKind}</Select.Trigger>
					<Select.Content>
						{#each chargeKinds.filter((k) => k !== 'membership' && k !== 'signup') as k (k)}
							<Select.Item value={k}>{k}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field
				><Field.Label for="c-desc">Description</Field.Label><Input
					id="c-desc"
					bind:value={cDesc}
					placeholder="Drop-in, towel service, merch…"
				/></Field.Field
			>
			<div class="grid grid-cols-2 gap-3">
				<Field.Field>
					<Field.Label>Amount</Field.Label>
					<MoneyInput bind:value={cAmount} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="c-due">Due date</Field.Label>
					<Input id="c-due" type="date" bind:value={cDue} />
				</Field.Field>
			</div>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !cMemberId || !cAmount}>Add charge</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
