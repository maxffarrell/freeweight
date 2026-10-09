<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';
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
		resendReceipt,
		recordPayment,
		refundPayment,
		requestAllPayments,
		getCurrency,
		getShopItems,
		createShopItem,
		updateShopItem,
		sellItem,
		getPendingPickups,
		markPickedUp,
		getGiftCards,
		sellGiftCard,
		getRecurring,
		addRecurring,
		updateRecurring,
		removeRecurring,
		getExpenses,
		addExpense,
		removeExpense,
		getRecurringExpenses,
		addRecurringExpense,
		updateRecurringExpense,
		removeRecurringExpense
	} from '#lib/remote/billing.remote.ts';
	import { getMembers } from '#lib/remote/members.remote.ts';
	import { errMsg, formatDate, formatMoney, todayISO } from '#lib/format.ts';
	import { chargeKinds, expenseCategories, paymentMethods } from '#lib/schemas.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Download from '@lucide/svelte/icons/download';
	import Gift from '@lucide/svelte/icons/gift';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toCsv } from '#lib/csv.ts';

	const currency = await getCurrency();
	const memberList = await getMembers();
	let charges = $state(
		await getCharges({ status: page.url.searchParams.get('status') ?? undefined })
	);
	let memberships = $state(await getMemberships());
	let msPlanFilter = $state('');
	let msStatusFilter = $state('');
	const msPlans = $derived([...new Set(memberships.map((m) => m.planName))].sort());
	const filteredMemberships = $derived(
		memberships.filter(
			(m) =>
				(!msPlanFilter || m.planName === msPlanFilter) &&
				(!msStatusFilter || m.membership.status === msStatusFilter)
		)
	);
	let payments = $state(await getPayments());
	let payMethodFilter = $state('');
	const payMethods = $derived([...new Set(payments.map((p) => p.payment.method))].sort());
	let giftCards = $state(await getGiftCards());
	let recurring = $state(await getRecurring());
	let expenses = $state(await getExpenses());
	let recExpenses = $state(await getRecurringExpenses());
	let reLabel = $state('');
	let reCategory = $state('rent');
	let reAmount = $state<number | null>(null);
	let reInterval = $state('month');
	let reNextDue = $state(todayISO());
	async function submitRecExpense(e: SubmitEvent) {
		e.preventDefault();
		if (!reLabel.trim() || !reAmount) return;
		pending = true;
		try {
			recExpenses = [
				...recExpenses,
				await addRecurringExpense({
					label: reLabel.trim(),
					category: reCategory as never,
					amountCents: reAmount,
					interval: reInterval as never,
					nextDue: reNextDue
				})
			];
			reLabel = '';
			reAmount = null;
			toast.success('Recurring expense added');
		} catch (e2) {
			toast.error(errMsg(e2, 'Could not add'));
		}
		pending = false;
	}
	async function toggleRecExpense(id: string, active: boolean) {
		try {
			await updateRecurringExpense({ id, active });
			recExpenses = await getRecurringExpenses();
		} catch (e2) {
			toast.error(errMsg(e2, 'Could not update'));
		}
	}
	async function deleteRecExpense(id: string) {
		try {
			await removeRecurringExpense(id);
			recExpenses = recExpenses.filter((r) => r.id !== id);
		} catch (e2) {
			toast.error(errMsg(e2, 'Could not remove'));
		}
	}
	let expLabel = $state('');
	let expCategory = $state('rent');
	let expAmount = $state<number | null>(null);
	let expOn = $state(todayISO());
	async function submitExpense(e: SubmitEvent) {
		e.preventDefault();
		if (!expLabel.trim() || !expAmount) return;
		pending = true;
		try {
			expenses = [
				await addExpense({
					label: expLabel.trim(),
					category: expCategory as never,
					amountCents: expAmount,
					expenseOn: expOn
				}),
				...expenses
			];
			expLabel = '';
			expAmount = null;
			toast.success('Expense logged');
		} catch (e2) {
			toast.error(errMsg(e2, 'Could not log expense'));
		}
		pending = false;
	}
	async function deleteExpense(id: string) {
		try {
			await removeExpense(id);
			expenses = expenses.filter((e) => e.id !== id);
		} catch (e2) {
			toast.error(errMsg(e2, 'Could not remove expense'));
		}
	}
	let openCharges = $state(await getCharges({ status: 'open' }));
	let chargeFilter = $state(page.url.searchParams.get('status') ?? '');
	let kindFilter = $state('');

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
		charges = applyChargeFilter(
			await getCharges({
				status:
					chargeFilter === '__overdue' || chargeFilter === '__duetoday'
						? 'open'
						: chargeFilter || undefined,
				kind: kindFilter || undefined
			})
		);
	}

	function applyChargeFilter(rows: Awaited<ReturnType<typeof getCharges>>) {
		return chargeFilter === '__overdue'
			? rows.filter((c) => c.charge.dueDate < todayISO())
			: chargeFilter === '__duetoday'
				? rows.filter((c) => c.charge.dueDate === todayISO())
				: rows;
	}

	async function refreshCharges() {
		charges = applyChargeFilter(
			await getCharges({
				status: chargeFilter === '__overdue' ? 'open' : chargeFilter || undefined,
				kind: kindFilter || undefined
			})
		);
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

	// ------- gift cards -------
	let gcOpen = $state(false);
	let gcMemberId = $state('');
	let gcAmount = $state<number | null>(null);
	let gcNote = $state('');
	async function submitGiftCard(e: SubmitEvent) {
		e.preventDefault();
		if (!gcAmount) return;
		pending = true;
		try {
			const card = await sellGiftCard({ memberId: gcMemberId, amount: gcAmount, note: gcNote });
			giftCards = await getGiftCards();
			await navigator.clipboard.writeText(card.code).catch(() => {});
			toast.success(`Card ${card.code} sold — code copied`);
			gcOpen = false;
			gcNote = '';
			gcAmount = null;
		} catch (err) {
			toast.error(errMsg(err, 'Could not sell card'));
		}
		pending = false;
	}
	async function copyCode(code: string) {
		await navigator.clipboard.writeText(code).catch(() => {});
		toast.success('Code copied');
	}

	// ------- recurring add-ons -------
	let rcMemberId = $state('');
	let rcDesc = $state('');
	let rcAmount = $state<number | null>(null);
	let rcInterval = $state<'week' | 'month' | 'year'>('month');
	let rcNextDue = $state(todayISO());
	async function submitRecurring(e: SubmitEvent) {
		e.preventDefault();
		if (!rcAmount || !rcDesc.trim()) return;
		pending = true;
		try {
			await addRecurring({
				memberId: rcMemberId,
				description: rcDesc.trim(),
				amount: rcAmount,
				interval: rcInterval,
				nextDue: rcNextDue
			});
			recurring = await getRecurring();
			toast.success('Recurring add-on created');
			rcDesc = '';
			rcAmount = null;
		} catch (err) {
			toast.error(errMsg(err, 'Could not create'));
		}
		pending = false;
	}
	async function toggleRecurring(r: { rec: { id: string; active: boolean } }) {
		try {
			await updateRecurring({ id: r.rec.id, active: !r.rec.active });
			recurring = await getRecurring();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}
	async function deleteRecurring(r: { rec: { id: string; description: string } }) {
		if (!confirm(`Delete the recurring "${r.rec.description}"? Past charges stay.`)) return;
		try {
			await removeRecurring(r.rec.id);
			recurring = await getRecurring();
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

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

	let selectedCharges = $state<string[]>([]);
	let voidingMany = $state(false);
	async function voidSelected() {
		if (!selectedCharges.length) return;
		if (!confirm(`Void ${selectedCharges.length} open charge(s)?`)) return;
		voidingMany = true;
		try {
			for (const id of selectedCharges) await updateCharge({ id, status: 'void' });
			toast.success(`${selectedCharges.length} charge(s) voided`);
			selectedCharges = [];
			await refreshCharges();
		} catch (err) {
			toast.error(errMsg(err, 'Could not void all'));
		} finally {
			voidingMany = false;
		}
	}

	async function voidCharge(id: string) {
		try {
			await updateCharge({ id, status: 'void' });
			await refreshCharges();
		} catch (err) {
			toast.error(errMsg(err, 'Could not void'));
		}
	}
	async function writeOffCharge(id: string) {
		if (!confirm("Write this charge off as bad debt? It leaves the member's open balance.")) return;
		try {
			await updateCharge({ id, status: 'written_off' });
			await refreshCharges();
		} catch (err) {
			toast.error(errMsg(err, 'Could not write off'));
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
	let pickups = $state(await getPendingPickups());
	async function pickup(id: string) {
		try {
			await markPickedUp(id);
			toast.success('Marked as picked up');
			pickups = await getPendingPickups();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}
	let itemName = $state('');
	let itemPrice = $state<number | null>(null);
	let itemStock = $state<number | null>(null);
	let itemLowStock = $state<number | null>(null);
	let itemCost = $state<number | null>(null);
	async function addItem(e: SubmitEvent) {
		e.preventDefault();
		if (itemPrice == null) return;
		pending = true;
		try {
			await createShopItem({
				name: itemName,
				price: itemPrice,
				stock: itemStock,
				lowStockAt: itemLowStock,
				cost: itemCost
			});
			itemName = '';
			itemPrice = null;
			itemStock = null;
			itemLowStock = null;
			itemCost = null;
			shopItems = await getShopItems();
		} catch (err) {
			toast.error(errMsg(err, 'Could not add item'));
		}
		pending = false;
	}
	/** Prompts for a new count, alert level and unit cost; blank = untracked. */
	async function setStock(item: {
		id: string;
		name: string;
		stock: number | null;
		lowStockAt: number | null;
		cost: number | null;
	}) {
		const raw = prompt(
			`${item.name} — units on hand (blank = unlimited)`,
			String(item.stock ?? '')
		);
		if (raw === null) return;
		const n = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)));
		if (n !== null && !Number.isFinite(n)) return toast.error('Not a number');
		const rawLow = prompt(
			`${item.name} — alert staff when stock drops to (blank = never)`,
			String(item.lowStockAt ?? '')
		);
		if (rawLow === null) return;
		const low = rawLow.trim() === '' ? null : Math.max(0, Math.floor(Number(rawLow)));
		if (low !== null && !Number.isFinite(low)) return toast.error('Not a number');
		const rawCost = prompt(
			`${item.name} — unit cost in cents (blank = untracked)`,
			String(item.cost ?? '')
		);
		if (rawCost === null) return;
		const cost = rawCost.trim() === '' ? null : Math.max(0, Math.floor(Number(rawCost)));
		if (cost !== null && !Number.isFinite(cost)) return toast.error('Not a number');
		try {
			await updateShopItem({ id: item.id, stock: n, lowStockAt: low, cost });
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
			pickups = await getPendingPickups();
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
			<Tabs.Trigger value="recurring">Recurring</Tabs.Trigger>
			<Tabs.Trigger value="expenses">Expenses</Tabs.Trigger>
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
				<NativeSelect bind:value={chargeFilter} onchange={filterCharges}>
					<option value="">All</option>
					<option value="open">Open</option>
					<option value="__duetoday">Due today</option>
					<option value="__overdue">Overdue</option>
					<option value="paid">Paid</option>
					<option value="void">Void</option>
					<option value="written_off">Written off</option>
				</NativeSelect>
				<NativeSelect bind:value={kindFilter} onchange={filterCharges}>
					<option value="">All kinds</option>
					{#each chargeKinds as k (k)}
						<option value={k} class="capitalize">{k}</option>
					{/each}
				</NativeSelect>
				{#if selectedCharges.length}
					<Button size="sm" variant="destructive" disabled={voidingMany} onclick={voidSelected}
						>Void {selectedCharges.length}</Button
					>
				{/if}
				<Button size="sm" variant="outline" onclick={exportCharges}><Download /> Export</Button>
			</div>
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-8"></Table.Head>
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
										{#if c.charge.status === 'open'}
											<input
												type="checkbox"
												checked={selectedCharges.includes(c.charge.id)}
												onchange={() =>
													(selectedCharges = selectedCharges.includes(c.charge.id)
														? selectedCharges.filter((x) => x !== c.charge.id)
														: [...selectedCharges, c.charge.id])}
											/>
										{/if}
									</Table.Cell>
									<Table.Cell>
										<a class="font-medium hover:underline" href="/members/{c.charge.memberId}"
											>{c.memberName}</a
										>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground"
										>{c.charge.description ?? c.charge.kind}</Table.Cell
									>
									<Table.Cell
										>{formatDate(
											c.charge.dueDate
										)}{#if c.charge.status === 'open' && c.charge.dueDate < todayISO()}
											<Badge variant="destructive" class="ml-1">overdue</Badge>{/if}</Table.Cell
									>
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
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => writeOffCharge(c.charge.id)}>Write off</Button
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
			<div class="mb-3 flex items-center gap-2">
				<NativeSelect bind:value={msPlanFilter}>
					<option value="">All plans</option>
					{#each msPlans as p (p)}
						<option value={p}>{p}</option>
					{/each}
				</NativeSelect>
				<NativeSelect bind:value={msStatusFilter}>
					<option value="">All statuses</option>
					<option value="active">Active</option>
					<option value="paused">Paused</option>
					<option value="suspended">Suspended</option>
					<option value="cancelled">Cancelled</option>
				</NativeSelect>
				<span class="ml-auto text-xs text-muted-foreground"
					>{filteredMemberships.length} membership{filteredMemberships.length === 1
						? ''
						: 's'}</span
				>
			</div>
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
							{#each filteredMemberships as mm (mm.membership.id)}
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
											: '—'}
										{#if mm.membership.endsAt && new Date(mm.membership.endsAt).getTime() > Date.now() && new Date(mm.membership.endsAt).getTime() - Date.now() < 30 * 86400_000}
											<Badge variant="outline" class="ml-1 text-amber-600">ending soon</Badge>
										{/if}</Table.Cell
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
			<div class="mb-3 flex items-center gap-2">
				<NativeSelect bind:value={payMethodFilter}>
					<option value="">All methods</option>
					{#each payMethods as m (m)}
						<option value={m} class="capitalize">{m}</option>
					{/each}
				</NativeSelect>
				<span class="text-xs text-muted-foreground"
					>{formatMoney(
						payments
							.filter(
								(p) =>
									!p.payment.refundedAt &&
									(!payMethodFilter || p.payment.method === payMethodFilter)
							)
							.reduce((a, p) => a + p.payment.amount, 0),
						currency
					)} collected</span
				>
				<Button size="sm" variant="outline" class="ml-auto" onclick={exportPayments}
					><Download /> Export</Button
				>
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
							{#each payments.filter((p) => !payMethodFilter || p.payment.method === payMethodFilter) as p (p.payment.id)}
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
												onclick={async () => {
													try {
														await resendReceipt(p.payment.id);
														toast.success('Receipt sent');
													} catch (err) {
														toast.error(errMsg(err, 'Could not resend'));
													}
												}}>Receipt</Button
											>
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
											>{formatMoney(i.price, currency)}{#if i.cost !== null}<div
													class="text-xs {i.cost >= i.price
														? 'text-destructive'
														: 'text-muted-foreground'}"
												>
													margin {formatMoney(i.price - i.cost, currency)}
												</div>{/if}</Table.Cell
										>
										<Table.Cell class="text-right tabular-nums">
											{#if i.stock === null}—{:else}<span
													class={i.stock === 0
														? 'text-destructive'
														: i.lowStockAt !== null && i.stock <= i.lowStockAt
															? 'font-medium text-amber-600 dark:text-amber-400'
															: ''}>{i.stock}</span
												>{#if i.lowStockAt !== null}<span
														class="ml-1 text-xs text-muted-foreground"
														title="Alert level">≤{i.lowStockAt}</span
													>{/if}{/if}
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
							<Field.Field>
								<Field.Label>Unit cost — optional</Field.Label>
								<MoneyInput bind:value={itemCost} />
								<Field.Description>Feeds COGS and margin on the P&amp;L report.</Field.Description>
							</Field.Field>
							<Field.Field>
								<Field.Label for="i-low">Low-stock alert — optional</Field.Label>
								<Input
									id="i-low"
									type="number"
									min={0}
									bind:value={itemLowStock}
									placeholder="Email staff at this count"
								/>
							</Field.Field>
							<Button type="submit" disabled={pending || itemPrice == null || !itemName.trim()}
								>Add item</Button
							>
						</form>
					</Card.Content>
				</Card.Root>
			</div>

			{#if pickups.length}
				<Card.Root class="mt-4">
					<Card.Header>
						<Card.Title class="text-base">Awaiting pickup</Card.Title>
						<Card.Description>Members who bought items — mark when they collect</Card.Description>
					</Card.Header>
					<Card.Content class="px-0">
						<Table.Root>
							<Table.Body>
								{#each pickups as p (p.id)}
									<Table.Row>
										<Table.Cell class="font-medium">{p.memberName}</Table.Cell>
										<Table.Cell>{p.itemName}{p.qty > 1 ? ` ×${p.qty}` : ''}</Table.Cell>
										<Table.Cell class="text-muted-foreground">{formatDate(p.createdAt)}</Table.Cell>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => pickup(p.id)}>Picked up</Button
											>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>
			{/if}

			<Card.Root class="mt-4">
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title class="flex items-center gap-2 text-base"><Gift /> Gift cards</Card.Title>
						<Card.Description>
							Sell store credit with a desk-typed code; members redeem it in their portal.
						</Card.Description>
					</div>
					<Button size="sm" variant="outline" onclick={() => (gcOpen = true)}
						><Plus /> Sell a card</Button
					>
				</Card.Header>
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Code</Table.Head>
								<Table.Head>Sold to</Table.Head>
								<Table.Head class="text-right">Face value</Table.Head>
								<Table.Head>Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each giftCards as g (g.card.id)}
								<Table.Row>
									<Table.Cell>
										<button
											class="font-mono text-xs hover:underline"
											title="Copy code"
											onclick={() => copyCode(g.card.code)}>{g.card.code}</button
										>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{g.purchaserName ?? '—'}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(g.card.amount, currency)}</Table.Cell
									>
									<Table.Cell>
										{#if g.card.balance > 0}
											<StatusBadge status="open" />
										{:else}
											<span class="text-xs text-muted-foreground"
												>redeemed {g.redeemerName ? `by ${g.redeemerName}` : ''}
												{formatDate(g.card.redeemedAt)}</span
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={4} class="text-muted-foreground"
										>No gift cards sold yet.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="recurring">
			<div class="grid gap-4 lg:grid-cols-2">
				<Card.Root class="py-0">
					<Card.Content class="px-0">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Member</Table.Head>
									<Table.Head>Item</Table.Head>
									<Table.Head class="text-right">Amount</Table.Head>
									<Table.Head>Next due</Table.Head>
									<Table.Head>On</Table.Head>
									<Table.Head></Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each recurring as r (r.rec.id)}
									<Table.Row class={r.rec.active ? '' : 'opacity-50'}>
										<Table.Cell>
											<a class="font-medium hover:underline" href="/members/{r.rec.memberId}"
												>{r.memberName}</a
											>
										</Table.Cell>
										<Table.Cell class="text-muted-foreground"
											>{r.rec.description} · {r.rec
												.interval}ly{#if r.rec.active && r.rec.removalRequestedAt}
												<Badge
													variant="outline"
													class="ml-2 border-amber-500/50 text-amber-600 dark:text-amber-400"
													>removal requested</Badge
												>
											{/if}</Table.Cell
										>
										<Table.Cell class="text-right tabular-nums"
											>{formatMoney(r.rec.amount, currency)}</Table.Cell
										>
										<Table.Cell class="tabular-nums">{r.rec.nextDue}</Table.Cell>
										<Table.Cell
											><Switch
												checked={r.rec.active}
												onCheckedChange={() => toggleRecurring(r)}
											/></Table.Cell
										>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => deleteRecurring(r)}><Trash2 /></Button
											>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell colspan={6} class="text-muted-foreground"
											>No recurring add-ons — PT packages, towel service, locker rental live here.</Table.Cell
										></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">New recurring add-on</Card.Title>
						<Card.Description>
							Posts a charge each period — for extras that aren't part of a membership plan.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<form class="space-y-3" onsubmit={submitRecurring}>
							<Field.Field>
								<Field.Label>Member</Field.Label>
								<Select.Root type="single" bind:value={rcMemberId}>
									<Select.Trigger class="w-full">
										{memberList.find((m) => m.id === rcMemberId)?.name ?? 'Pick a member'}
									</Select.Trigger>
									<Select.Content>
										{#each memberList as m (m.id)}
											<Select.Item value={m.id}>{m.name}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</Field.Field>
							<Field.Field>
								<Field.Label for="rc-desc">Item</Field.Label>
								<Input id="rc-desc" required bind:value={rcDesc} placeholder="Towel service" />
							</Field.Field>
							<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
								<Field.Field>
									<Field.Label>Amount</Field.Label>
									<MoneyInput bind:value={rcAmount} />
								</Field.Field>
								<Field.Field>
									<Field.Label>Every</Field.Label>
									<Select.Root type="single" bind:value={rcInterval}>
										<Select.Trigger class="w-full">{rcInterval}</Select.Trigger>
										<Select.Content>
											<Select.Item value="week">week</Select.Item>
											<Select.Item value="month">month</Select.Item>
											<Select.Item value="year">year</Select.Item>
										</Select.Content>
									</Select.Root>
								</Field.Field>
								<Field.Field>
									<Field.Label for="rc-due">First charge</Field.Label>
									<Input id="rc-due" type="date" required bind:value={rcNextDue} />
								</Field.Field>
							</div>
							<Button type="submit" disabled={pending || !rcAmount || !rcDesc.trim() || !rcMemberId}
								>Add recurring</Button
							>
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>

		<Tabs.Content value="expenses">
			<div class="grid gap-4 lg:grid-cols-2">
				<Card.Root class="py-0">
					<Card.Content class="px-0">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Date</Table.Head>
									<Table.Head>Item</Table.Head>
									<Table.Head>Category</Table.Head>
									<Table.Head class="text-right">Amount</Table.Head>
									<Table.Head></Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each expenses as e (e.id)}
									<Table.Row>
										<Table.Cell class="tabular-nums">{e.expenseOn}</Table.Cell>
										<Table.Cell class="font-medium">{e.label}</Table.Cell>
										<Table.Cell
											><Badge variant="outline" class="capitalize">{e.category}</Badge></Table.Cell
										>
										<Table.Cell class="text-right tabular-nums"
											>{formatMoney(e.amountCents, currency)}</Table.Cell
										>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => deleteExpense(e.id)}><Trash2 /></Button
											>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell colspan={5} class="text-muted-foreground"
											>No expenses logged — rent, payroll and equipment buys feed the P&amp;L on
											Reports.</Table.Cell
										></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Log an expense</Card.Title>
						<Card.Description>
							Operating costs — tracked against revenue on the Reports page.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<form class="space-y-3" onsubmit={submitExpense}>
							<Field.Field>
								<Field.Label for="exp-label">Item</Field.Label>
								<Input id="exp-label" required bind:value={expLabel} placeholder="Monthly rent" />
							</Field.Field>
							<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
								<Field.Field>
									<Field.Label>Category</Field.Label>
									<Select.Root type="single" bind:value={expCategory}>
										<Select.Trigger class="w-full capitalize">{expCategory}</Select.Trigger>
										<Select.Content>
											{#each expenseCategories as c (c)}
												<Select.Item value={c} class="capitalize">{c}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</Field.Field>
								<Field.Field>
									<Field.Label>Amount</Field.Label>
									<MoneyInput bind:value={expAmount} />
								</Field.Field>
								<Field.Field>
									<Field.Label for="exp-on">Date</Field.Label>
									<Input id="exp-on" type="date" required bind:value={expOn} />
								</Field.Field>
							</div>
							<Button type="submit" disabled={pending || !expAmount || !expLabel.trim()}
								>Log expense</Button
							>
						</form>
					</Card.Content>
				</Card.Root>
			</div>

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Recurring expenses</Card.Title>
					<Card.Description>
						Rent, software, insurance — the cron posts an expense row every period.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					{#if recExpenses.length}
						<div class="divide-y rounded-lg border">
							{#each recExpenses as r (r.id)}
								<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{r.label}</span>
										<span class="text-muted-foreground">
											· {formatMoney(r.amountCents, currency)}/{r.interval} · next {r.nextDue}
										</span>
									</div>
									<span class="flex items-center gap-2">
										{#if !r.active}<Badge variant="outline">paused</Badge>{/if}
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											onclick={() => toggleRecExpense(r.id, !r.active)}
											>{r.active ? 'Pause' : 'Resume'}</Button
										>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											onclick={() => deleteRecExpense(r.id)}><Trash2 /></Button
										>
									</span>
								</div>
							{/each}
						</div>
					{/if}
					<form class="flex flex-wrap items-end gap-3" onsubmit={submitRecExpense}>
						<Field.Field class="min-w-40 flex-1">
							<Field.Label for="re-label">Item</Field.Label>
							<Input id="re-label" required bind:value={reLabel} placeholder="Monthly rent" />
						</Field.Field>
						<Field.Field>
							<Field.Label>Category</Field.Label>
							<NativeSelect bind:value={reCategory} class="capitalize">
								{#each expenseCategories as c (c)}
									<option value={c} class="capitalize">{c}</option>
								{/each}
							</NativeSelect>
						</Field.Field>
						<Field.Field>
							<Field.Label>Amount</Field.Label>
							<MoneyInput bind:value={reAmount} />
						</Field.Field>
						<Field.Field>
							<Field.Label>Every</Field.Label>
							<NativeSelect bind:value={reInterval}>
								<option value="week">week</option>
								<option value="month">month</option>
								<option value="year">year</option>
							</NativeSelect>
						</Field.Field>
						<Field.Field>
							<Field.Label for="re-due">Starting</Field.Label>
							<Input id="re-due" type="date" required bind:value={reNextDue} />
						</Field.Field>
						<Button type="submit" disabled={pending || !reAmount || !reLabel.trim()}>Add</Button>
					</form>
				</Card.Content>
			</Card.Root>
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

<Dialog.Root bind:open={gcOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Sell a gift card</Dialog.Title>
			<Dialog.Description>
				Posts the card's face value as a charge on the buyer. Hand them the code — the recipient
				redeems it in their portal and it pays down their charges, any leftover becoming credit.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitGiftCard}>
			<Field.Field>
				<Field.Label>Buyer</Field.Label>
				<Select.Root type="single" bind:value={gcMemberId}>
					<Select.Trigger class="w-full">
						{memberList.find((m) => m.id === gcMemberId)?.name ?? 'Pick a member'}
					</Select.Trigger>
					<Select.Content>
						{#each memberList as m (m.id)}
							<Select.Item value={m.id}>{m.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Amount</Field.Label>
				<MoneyInput bind:value={gcAmount} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="gc-note">Note — optional</Field.Label>
				<Input id="gc-note" bind:value={gcNote} placeholder="Birthday gift for Sam" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending || !gcAmount || !gcMemberId}>
					{gcAmount ? `Sell for ${formatMoney(gcAmount, currency)}` : 'Sell card'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
