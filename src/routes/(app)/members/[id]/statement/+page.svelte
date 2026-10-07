<script lang="ts">
	import { page } from '$app/state';
	import { getMember } from '#lib/remote/members.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const settings = await getSettings();
	const currency = settings.currency;
	const m = await getMember(page.params.id!);

	// getMember returns newest-first; a statement reads oldest → newest.
	const charges = $derived([...m.charges].reverse());
	const payments = $derived([...m.payments].reverse());
	const open = $derived(m.charges.filter((c) => c.charge.status === 'open'));
	const balance = $derived(open.reduce((sum, c) => sum + c.charge.amount - c.paid, 0));
	const kindLabel = (k: string) =>
		({
			membership: 'Membership',
			signup: 'Signup fee',
			dropin: 'Drop-in',
			other: 'Other'
		})[k] ?? k;
</script>

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<div class="flex items-center justify-between print:hidden">
		<Button variant="ghost" size="sm" href="/members/{m.member.id}"
			><ArrowLeft /> Back to member</Button
		>
		<Button size="sm" onclick={() => window.print()}><Printer /> Print / save as PDF</Button>
	</div>

	<div class="rounded-lg border p-8">
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{m.orgName}
				</p>
				<h1 class="text-2xl font-semibold">Statement</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					{m.member.name}{#if m.member.email}
						· {m.member.email}{/if}
				</p>
			</div>
			<div class="text-right text-sm text-muted-foreground">
				<p>Generated {formatDate(new Date())}</p>
				<p class="mt-1 text-base font-semibold text-foreground">
					Balance due: {formatMoney(balance, currency)}
				</p>
			</div>
		</div>

		<h2 class="mb-2 text-sm font-semibold tracking-wide uppercase">Charges</h2>
		<Table.Root class="mb-6">
			<Table.Header>
				<Table.Row>
					<Table.Head>Due</Table.Head>
					<Table.Head>Item</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="text-right">Amount</Table.Head>
					<Table.Head class="text-right">Paid</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each charges as c (c.charge.id)}
					<Table.Row>
						<Table.Cell>{c.charge.dueDate}</Table.Cell>
						<Table.Cell>{c.charge.description ?? kindLabel(c.charge.kind)}</Table.Cell>
						<Table.Cell class="capitalize">{c.charge.status}</Table.Cell>
						<Table.Cell class="text-right">{formatMoney(c.charge.amount, currency)}</Table.Cell>
						<Table.Cell class="text-right">{formatMoney(c.paid, currency)}</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row
						><Table.Cell colspan={5} class="text-muted-foreground">No charges.</Table.Cell
						></Table.Row
					>
				{/each}
			</Table.Body>
		</Table.Root>

		<h2 class="mb-2 text-sm font-semibold tracking-wide uppercase">Payments</h2>
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Date</Table.Head>
					<Table.Head>Method</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="text-right">Amount</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each payments as p (p.id)}
					<Table.Row>
						<Table.Cell>{formatDate(p.paidAt)}</Table.Cell>
						<Table.Cell class="capitalize">{p.method}</Table.Cell>
						<Table.Cell>{p.refundedAt ? 'Refunded' : 'Paid'}</Table.Cell>
						<Table.Cell class="text-right">{formatMoney(p.amount, currency)}</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row
						><Table.Cell colspan={4} class="text-muted-foreground">No payments.</Table.Cell
						></Table.Row
					>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
