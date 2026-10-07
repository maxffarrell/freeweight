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
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getCharges,
		addCharge,
		bulkCharge,
		updateCharge,
		getMemberships,
		updateMembership,
		getPayments,
		recordPayment,
		refundPayment,
		requestAllPayments,
		getCurrency,
		getShopItems,
		createShopItem,
		updateShopItem,
		sellItem
	} from '#lib/remote/billing.remote.ts';
	import { getMembers } from '#lib/remote/members.remote.ts';
	import { errMsg, formatDate, formatMoney, todayISO } from '#lib/format.ts';
	import { chargeKinds, paymentMethods } from '#lib/schemas.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Download from '@lucide/svelte/icons/download';
	import { toCsv } from '#lib/csv.ts';

	const currency = await getCurrency();
	const memberList = await getMembers();
	let charges = $state(
		await getCharges({ status: page.url.searchParams.get('status') ?? undefined })
	);
	let memberships = $state(await getMemberships());
	let payments = $state(await getPayments());
	let openCharges = $state(await getCharges({ status: 'open' }));
	let chargeFilter = $state(page.url.searchParams.get('status') ?? '');

	const aging = $derived.by(() => {
		const today = todayISO();
		const b = {
			current: { n: 0, sum: 0 },
			d30: { n: 0, sum: 0 },
			d60: { n: 0, sum: 0 },
			d60plus: { n: 0, sum: 0 }
		};
		const debtors: Record<string, true> = {};
		for (const c of openCharges) {
			const balance = c.charge.amount - c.paid;
			if (balance <= 0) continue;
			debtors[c.charge.memberId] = true;
			const days = Math.floor((Date.parse(today) - Date.parse(c.charge.dueDate)) / 86400000);
			const bucket = days <= 0 ? b.current : days <= 30 ? b.d30 : days <= 60 ? b.d60 : b.d60plus;
			bucket.n++;
			bucket.sum += balance;
		}
		return { ...b, debtors: Object.keys(debtors).length };
	});

	async function filterCharges() {
		charges = await getCharges({ status: chargeFilter || undefined });
	}

	async function refreshCharges() {
		charges = await getCharges({ status: chargeFilter || undefined });
		openCharges = await getCharges({ status: 'open' });
	}

	let remindingAll = $state(false);
	async function emailAllDebtors() {
		if (!confirm(`Email a payment request to all ${aging.debtors} members owing?`)) return;
		remindingAll = true;
		try {
			const r = await requestAllPayments();
			toast.success(`Sent ${r.sent} payment request${r.sent === 1 ? '' : 's'}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
		}
		remindingAll = false;
	}

	async function refund(paymentId: string, amount: number) {
		if (!confirm(`Refund ${formatMoney(amount, currency)}? The charge it covered reopens.`)) return;
		try {
			await refundPayment(paymentId);
			payments = await getPayments();
			toast.success('Payment refunded');
		} catch (err) {
			toast.error(errMsg(err, 'Could not refund'));
		}
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
			await refreshCharges();
			payments = await getPayments();
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
		pending = false;
	}

	// ------- new charge -------
	let chargeOpen = $state(false);
	let cMemberId = $state('');
	let cAll = $state(false);
	let cKind = $state<'membership' | 'signup' | 'dropin' | 'other'>('other');
	let cDesc = $state('');
	let cAmount = $state<number | null>(null);
	let cDue = $state(todayISO());
	const activeCount = $derived(
		new Set(
			memberships
				.filter((mm) => mm.membership.status === 'active')
				.map((mm) => mm.membership.memberId)
		).size
	);
	async function submitCharge(e: SubmitEvent) {
		e.preventDefault();
		if (!cAmount) return;
		pending = true;
		try {
			if (cAll) {
				const r = await bulkCharge({ description: cDesc, amount: cAmount, dueDate: cDue });
				toast.success(`Charge posted to ${r.posted} member${r.posted === 1 ? '' : 's'}`);
			} else {
				await addCharge({
					memberId: cMemberId,
					kind: cKind,
					description: cDesc || undefined,
					amount: cAmount,
					dueDate: cDue
				});
				toast.success('Charge added');
			}
			chargeOpen = false;
			cMemberId = '';
			cAll = false;
			cDesc = '';
			cAmount = null;
			await refreshCharges();
		} catch (err) {
			toast.error(errMsg(err, 'Could not add charge'));
		}
		pending = false;
	}

	function exportCharges() {
		const csv = toCsv([
			['Member', 'Description', 'Kind', 'Due', 'Status', 'Amount', 'Paid', 'Balance'],
			...charges.map((c) => [
				c.memberName,
				c.charge.description,
				c.charge.kind,
				c.charge.dueDate,
				c.charge.status,
				(c.charge.amount / 100).toFixed(2),
				(c.paid / 100).toFixed(2),
				((c.charge.amount - c.paid) / 100).toFixed(2)
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `charges-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function exportPayments() {
		const csv = toCsv([
			['Member', 'Paid at', 'Method', 'Amount', 'Refunded'],
			...payments.map((p) => [
				p.memberName,
				p.payment.paidAt.toISOString(),
				p.payment.method,
				(p.payment.amount / 100).toFixed(2),
				p.payment.refundedAt ? p.payment.refundedAt.toISOString() : ''
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	async function voidCharge(id: string) {
		try {
			await updateCharge({ id, status: 'void' });
			await refreshCharges();
		} catch (err) {
			toast.error(errMsg(err, 'Could not void'));
		}
	}
	async function setMembership(id: string, status: 'paused' | 'cancelled' | 'active') {
		try {
			await updateMembership({ id, status });
			memberships = await getMemberships();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- shop -------
	let shopItems = $state(await getShopItems());
	let itemName = $state('');
	let itemPrice = $state<number | null>(null);
	let itemStock = $state<number | null>(null);
	async function addItem(e: SubmitEvent) {
		e.preventDefault();
		if (itemPrice == null) return;
		pending = true;
		try {
			await createShopItem({ name: itemName, price: itemPrice, stock: itemStock });
			itemName = '';
			itemPrice = null;
			itemStock = null;
			shopItems = await getShopItems();
		} catch (err) {
			toast.error(errMsg(err, 'Could not add item'));
		}
		pending = false;
	}
	/** Prompt for a new count; '' or 'x' clears tracking (unlimited). */
	async function setStock(item: { id: string; name: string; stock: number | null }) {
		const raw = prompt(
			`${item.name} — units on hand (blank = unlimited)`,
			String(item.stock ?? '')
		);
		if (raw === null) return;
		const n = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)));
		if (n !== null && !Number.isFinite(n)) return toast.error('Not a number');
		try {
			await updateShopItem({ id: item.id, stock: n });
			shopItems = await getShopItems();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update stock'));
		}
	}
	async function toggleItem(item: { id: string; active: boolean }) {
		try {
			await updateShopItem({ id: item.id, active: !item.active });
			shopItems = await getShopItems();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update item'));
		}
	}

	let sellOpen = $state(false);
	let sellItemId = $state('');
	let sellMemberId = $state('');
	let sellQty = $state(1);
	let sellPayNow = $state(true);
	let sellMethod = $state<'card' | 'cash' | 'bank' | 'other'>('cash');
	const sellItemRow = $derived(shopItems.find((i) => i.id === sellItemId));
	async function submitSale(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await sellItem({
				itemId: sellItemId,
				memberId: sellMemberId,
				qty: sellQty,
				payNow: sellPayNow,
				method: sellMethod
			});
			toast.success(sellPayNow ? 'Sale recorded' : 'Charge posted');
			sellOpen = false;
			sellMemberId = '';
			sellQty = 1;
			await refreshCharges();
			payments = await getPayments();
		} catch (err) {
			toast.error(errMsg(err, 'Could not record sale'));
		}
		pending = false;
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
			<Tabs.Trigger value="shop">Shop</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="charges">
			{#if aging.debtors}
				<Card.Root class="mb-4">
					<Card.Content class="flex flex-wrap items-center gap-x-8 gap-y-2 py-3">
						<a href="/members?owes=1" class="group">
							<p class="text-xs text-muted-foreground">Members owing</p>
							<p class="text-lg font-semibold group-hover:underline">{aging.debtors}</p>
						</a>
						<div>
							<p class="text-xs text-muted-foreground">Not yet due</p>
							<p class="text-lg font-semibold">
								{formatMoney(aging.current.sum, currency)}
								<span class="text-xs font-normal text-muted-foreground">({aging.current.n})</span>
							</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">1–30 days overdue</p>
							<p class="text-lg font-semibold">
								{formatMoney(aging.d30.sum, currency)}
								<span class="text-xs font-normal text-muted-foreground">({aging.d30.n})</span>
							</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">31–60 days</p>
							<p class="text-lg font-semibold">
								{formatMoney(aging.d60.sum, currency)}
								<span class="text-xs font-normal text-muted-foreground">({aging.d60.n})</span>
							</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">60+ days</p>
							<p class="text-lg font-semibold text-destructive">
								{formatMoney(aging.d60plus.sum, currency)}
								<span class="text-xs font-normal">({aging.d60plus.n})</span>
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							class="ml-auto"
							disabled={remindingAll}
							onclick={emailAllDebtors}>Email all</Button
						>
					</Card.Content>
				</Card.Root>
			{/if}
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
				<Button size="sm" variant="outline" onclick={exportCharges}><Download /> Export</Button>
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
			<div class="mb-3 flex justify-end">
				<Button size="sm" variant="outline" onclick={exportPayments}><Download /> Export</Button>
			</div>
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Member</Table.Head>
								<Table.Head>When</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
								<Table.Head></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each payments as p (p.payment.id)}
								<Table.Row class={p.payment.refundedAt ? 'opacity-50' : ''}>
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
									<Table.Cell class="text-right">
										{#if p.payment.refundedAt}
											<span class="text-xs text-muted-foreground"
												>refunded {formatDate(p.payment.refundedAt)}</span
											>
										{:else}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => refund(p.payment.id, p.payment.amount)}>Refund</Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={5} class="text-muted-foreground">No payments.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="shop">
			<div class="grid gap-4 lg:grid-cols-2">
				<Card.Root class="py-0">
					<Card.Content class="px-0">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Item</Table.Head>
									<Table.Head class="text-right">Price</Table.Head>
									<Table.Head class="text-right">Stock</Table.Head>
									<Table.Head>Selling</Table.Head>
									<Table.Head></Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each shopItems as i (i.id)}
									<Table.Row class={i.active ? '' : 'opacity-50'}>
										<Table.Cell class="font-medium">{i.name}</Table.Cell>
										<Table.Cell class="text-right tabular-nums"
											>{formatMoney(i.price, currency)}</Table.Cell
										>
										<Table.Cell class="text-right tabular-nums">
											{#if i.stock === null}—{:else}<span
													class={i.stock === 0 ? 'text-destructive' : ''}>{i.stock}</span
												>{/if}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-1.5 text-xs text-muted-foreground"
												onclick={() => setStock(i)}>Set</Button
											>
										</Table.Cell>
										<Table.Cell
											><Switch
												checked={i.active}
												onCheckedChange={() => toggleItem(i)}
											/></Table.Cell
										>
										<Table.Cell class="text-right">
											{#if i.active}
												{#if i.stock === 0}
													<span class="px-2 text-xs text-muted-foreground">Out of stock</span>
												{:else}
													<Button
														variant="ghost"
														size="sm"
														class="h-7 px-2 text-xs"
														onclick={() => {
															sellItemId = i.id;
															sellOpen = true;
														}}>Sell</Button
													>
												{/if}
											{/if}
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell colspan={5} class="text-muted-foreground"
											>No items yet — add one on the right.</Table.Cell
										></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">New item</Card.Title>
						<Card.Description>
							Water, wraps, shirts — anything the front desk sells.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<form class="space-y-3" onsubmit={addItem}>
							<Field.Field>
								<Field.Label for="i-name">Name</Field.Label>
								<Input id="i-name" required bind:value={itemName} placeholder="Water bottle" />
							</Field.Field>
							<Field.Field>
								<Field.Label>Price</Field.Label>
								<MoneyInput bind:value={itemPrice} />
							</Field.Field>
							<Field.Field>
								<Field.Label for="i-stock">Units in stock — optional</Field.Label>
								<Input
									id="i-stock"
									type="number"
									min={0}
									bind:value={itemStock}
									placeholder="Leave blank for unlimited"
								/>
							</Field.Field>
							<Button type="submit" disabled={pending || itemPrice == null || !itemName.trim()}
								>Add item</Button
							>
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>
	</Tabs.Root>
</div>

<Dialog.Root bind:open={sellOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Sell {sellItemRow?.name ?? 'item'}</Dialog.Title>
			<Dialog.Description>
				{#if sellItemRow}{formatMoney(sellItemRow.price, currency)} each{#if sellItemRow.stock !== null}
						· {sellItemRow.stock} in stock{/if}.{/if}
				Posts a charge to the member — or mark it paid now.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitSale}>
			<Field.Field>
				<Field.Label>Member</Field.Label>
				<Select.Root type="single" bind:value={sellMemberId}>
					<Select.Trigger class="w-full">
						{memberList.find((m) => m.id === sellMemberId)?.name ?? 'Pick a member'}
					</Select.Trigger>
					<Select.Content>
						{#each memberList as m (m.id)}
							<Select.Item value={m.id}>{m.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="s-qty">Quantity</Field.Label>
				<Input
					id="s-qty"
					type="number"
					min={1}
					max={sellItemRow?.stock ?? 50}
					required
					bind:value={sellQty}
				/>
			</Field.Field>
			<label class="flex items-center gap-2 text-sm">
				<Switch bind:checked={sellPayNow} /> Paid now
			</label>
			{#if sellPayNow}
				<Field.Field>
					<Field.Label>Method</Field.Label>
					<Select.Root type="single" bind:value={sellMethod}>
						<Select.Trigger class="w-full capitalize">{sellMethod}</Select.Trigger>
						<Select.Content>
							{#each paymentMethods.filter((m) => m !== 'stripe') as m (m)}
								<Select.Item value={m} class="capitalize">{m}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			{/if}
			<Dialog.Footer>
				<Button type="submit" disabled={pending || !sellMemberId || !sellItemId}>
					{sellItemRow && sellQty
						? sellPayNow
							? `Take ${formatMoney(sellItemRow.price * sellQty, currency)}`
							: `Charge ${formatMoney(sellItemRow.price * sellQty, currency)}`
						: 'Sell'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

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
			<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
				<div>
					<p class="font-medium">Every active member</p>
					<p class="text-xs text-muted-foreground">
						Posts this charge to all {activeCount} members at once.
					</p>
				</div>
				<Switch bind:checked={cAll} />
			</div>
			{#if !cAll}
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
			{/if}
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
				><Button type="submit" disabled={pending || !cAmount || (cAll ? !cDesc.trim() : !cMemberId)}
					>{cAll ? `Post to ${activeCount} members` : 'Add charge'}</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
