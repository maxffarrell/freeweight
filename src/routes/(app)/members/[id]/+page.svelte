<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getMember,
		updateMember,
		getPortalInvite,
		recordCheckIn
	} from '#lib/remote/members.remote.ts';
	import {
		getPlans,
		createMembership,
		updateMembership,
		recordPayment,
		getCurrency
	} from '#lib/remote/billing.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { localTime, localDate } from '#lib/tz.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Link from '@lucide/svelte/icons/link';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import { paymentMethods } from '#lib/schemas.ts';

	const id = page.params.id!;
	const m = $derived(await getMember(id));
	const plans = $derived(await getPlans());
	const settings = $derived(await getSettings());
	const currency = $derived(await getCurrency());
	const tz = settings.timezone;

	const balance = $derived(
		m.charges
			.filter((c) => c.charge.status === 'open')
			.reduce((sum, c) => sum + c.charge.amount - c.paid, 0)
	);

	// ------- edit member -------
	let editOpen = $state(false);
	let name = $state(m.member.name);
	let email = $state(m.member.email ?? '');
	let phone = $state(m.member.phone ?? '');
	let status = $state<'active' | 'inactive'>(m.member.status);
	let pending = $state(false);
	async function saveMember(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await updateMember({
				id,
				name,
				email: email || undefined,
				phone: phone || undefined,
				status
			});
			toast.success('Member updated');
			editOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Update failed'));
		}
		pending = false;
	}

	// ------- membership -------
	let memOpen = $state(false);
	let planId = $state('');
	let startsAt = $state(new Date().toISOString().slice(0, 10));
	async function addMembership(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createMembership({ memberId: id, planId, startsAt });
			toast.success('Membership started — signup and first-period charges posted');
			memOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not start membership'));
		}
		pending = false;
	}

	async function setMembership(membershipId: string, status: 'paused' | 'cancelled' | 'active') {
		try {
			await updateMembership({ id: membershipId, status });
			toast.success(`Membership ${status}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- payment -------
	let payOpen = $state(false);
	let payAmount = $state<number | null>(null);
	let method = $state<'card' | 'cash' | 'bank' | 'other'>('cash');
	let notes = $state('');
	async function submitPayment(e: SubmitEvent) {
		e.preventDefault();
		if (!payAmount) return;
		pending = true;
		try {
			await recordPayment({ memberId: id, amount: payAmount, method, notes: notes || undefined });
			toast.success('Payment recorded');
			payOpen = false;
			payAmount = null;
			notes = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
		pending = false;
	}

	// ------- portal invite -------
	async function copyPortalLink() {
		try {
			const { url } = await getPortalInvite(id);
			await navigator.clipboard.writeText(url);
			toast.success('Portal link copied — valid 14 days');
		} catch (err) {
			toast.error(errMsg(err, 'Could not create link'));
		}
	}
	async function manualCheckIn() {
		try {
			await recordCheckIn({ code: id });
			toast.success(`${m.member.name} checked in`);
		} catch (err) {
			toast.error(errMsg(err, 'Check-in failed'));
		}
	}
</script>

<PageHeader title={m.member.name} crumbs={[{ label: 'Members', href: '/members' }]}>
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={manualCheckIn}><ScanLine /> Check in</Button>
		<Button variant="outline" size="sm" onclick={copyPortalLink}><Link /> Portal link</Button>
		<Button size="sm" variant="outline" onclick={() => (editOpen = true)}>Edit</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<div class="space-y-6 lg:col-span-1">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Details</Card.Title></Card.Header>
			<Card.Content class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Status</span><StatusBadge status={m.member.status} />
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Email</span><span class="truncate"
						>{m.member.email ?? '—'}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Phone</span><span>{m.member.phone ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Location</span><span>{m.locationName ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Joined</span><span
						>{formatDate(m.member.joinedAt)}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Open balance</span>
					<span class="font-medium tabular-nums">{formatMoney(balance, currency)}</span>
				</div>
			</Card.Content>
			{#if balance > 0}
				<Card.Footer>
					<Button class="w-full" onclick={() => ((payAmount = balance), (payOpen = true))}
						>Record payment</Button
					>
				</Card.Footer>
			{/if}
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Memberships</Card.Title>
				<Button size="sm" variant="outline" onclick={() => (memOpen = true)}><Plus /> New</Button>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#each m.memberships as mm (mm.membership.id)}
					<div class="flex items-center justify-between gap-2 text-sm">
						<div class="min-w-0">
							<p class="truncate font-medium">{mm.planName}</p>
							<p class="text-xs text-muted-foreground">
								{formatMoney(mm.amount, currency)}/{mm.interval} · from {formatDate(
									mm.membership.startsAt
								)}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<StatusBadge status={mm.membership.status} />
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
						</div>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No memberships.</p>
				{/each}
				{#if m.credits}
					<p class="text-xs text-muted-foreground">
						{m.credits.used} of {m.credits.limit} classes used this period
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root class="lg:col-span-2">
		<Tabs.Root value="charges">
			<Card.Header>
				<Tabs.List>
					<Tabs.Trigger value="charges">Charges</Tabs.Trigger>
					<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
					<Tabs.Trigger value="bookings">Bookings</Tabs.Trigger>
					<Tabs.Trigger value="checkins">Check-ins</Tabs.Trigger>
				</Tabs.List>
			</Card.Header>
			<Card.Content class="px-4 pb-4">
				<Tabs.Content value="charges">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Description</Table.Head>
								<Table.Head>Due</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
								<Table.Head class="text-right">Paid</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.charges as c (c.charge.id)}
								<Table.Row>
									<Table.Cell>{c.charge.description ?? c.charge.kind}</Table.Cell>
									<Table.Cell>{formatDate(c.charge.dueDate)}</Table.Cell>
									<Table.Cell><StatusBadge status={c.charge.status} /></Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(c.charge.amount, currency)}</Table.Cell
									>
									<Table.Cell class="text-right text-muted-foreground tabular-nums"
										>{formatMoney(c.paid, currency)}</Table.Cell
									>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={5} class="text-muted-foreground">No charges.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
				<Tabs.Content value="payments">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.payments as p (p.id)}
								<Table.Row>
									<Table.Cell>{formatDate(p.paidAt)}</Table.Cell>
									<Table.Cell class="capitalize">{p.method}</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(p.amount, currency)}</Table.Cell
									>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={3} class="text-muted-foreground">No payments.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
				<Tabs.Content value="bookings">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Class</Table.Head>
								<Table.Head>When</Table.Head>
								<Table.Head>Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.bookings as b (b.booking.id)}
								<Table.Row>
									<Table.Cell>{b.className}</Table.Cell>
									<Table.Cell class="text-muted-foreground"
										>{localDate(b.startsAt, tz)} {localTime(b.startsAt, tz)}</Table.Cell
									>
									<Table.Cell><StatusBadge status={b.booking.status} /></Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={3} class="text-muted-foreground">No bookings.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
				<Tabs.Content value="checkins">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>When</Table.Head>
								<Table.Head>Method</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.checkIns as c (c.id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground"
										>{localDate(c.checkedAt, tz)} {localTime(c.checkedAt, tz)}</Table.Cell
									>
									<Table.Cell class="uppercase">{c.method}</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={2} class="text-muted-foreground">No check-ins.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
			</Card.Content>
		</Tabs.Root>
	</Card.Root>
</div>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>Edit member</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={saveMember}>
			<Field.Field
				><Field.Label for="e-name">Name</Field.Label><Input
					id="e-name"
					required
					bind:value={name}
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="e-email">Email</Field.Label><Input
					id="e-email"
					type="email"
					bind:value={email}
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="e-phone">Phone</Field.Label><Input
					id="e-phone"
					bind:value={phone}
				/></Field.Field
			>
			<Field.Field>
				<Field.Label>Status</Field.Label>
				<Select.Root type="single" bind:value={status}>
					<Select.Trigger class="w-full">{status}</Select.Trigger>
					<Select.Content>
						<Select.Item value="active">active</Select.Item>
						<Select.Item value="inactive">inactive</Select.Item>
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Dialog.Footer><Button type="submit" disabled={pending}>Save</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={memOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New membership</Dialog.Title>
			<Dialog.Description
				>Posts the signup fee and the first period charge immediately.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={addMembership}>
			<Field.Field>
				<Field.Label>Plan</Field.Label>
				<Select.Root type="single" bind:value={planId}>
					<Select.Trigger class="w-full"
						>{plans.find((p) => p.id === planId)?.name ?? 'Choose a plan'}</Select.Trigger
					>
					<Select.Content>
						{#each plans.filter((p) => p.active) as p (p.id)}
							<Select.Item value={p.id}
								>{p.name} · {formatMoney(p.amount, currency)}/{p.interval}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="m-start">Starts</Field.Label>
				<Input id="m-start" type="date" required bind:value={startsAt} />
			</Field.Field>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !planId}>Start membership</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={payOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>Record payment</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={submitPayment}>
			<Field.Field>
				<Field.Label>Amount</Field.Label>
				<MoneyInput bind:value={payAmount} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Method</Field.Label>
				<Select.Root type="single" bind:value={method}>
					<Select.Trigger class="w-full">{method}</Select.Trigger>
					<Select.Content>
						{#each paymentMethods.filter((pm) => pm !== 'stripe') as pm (pm)}
							<Select.Item value={pm}>{pm}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field
				><Field.Label for="pay-notes">Note</Field.Label><Input
					id="pay-notes"
					bind:value={notes}
				/></Field.Field
			>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !payAmount}>Record</Button></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
