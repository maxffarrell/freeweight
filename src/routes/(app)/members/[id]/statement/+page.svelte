<script lang="ts">
	import { page } from '$app/state';
	import { getMember } from '#lib/remote/members.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import { Button } from '#lib/components/ui/button/index.js';
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

	const billedTo = [m.member.name, m.member.email].filter(Boolean) as string[];
</script>

<div class="mx-auto max-w-4xl space-y-6 p-6 print:p-0">
	<div class="flex items-center justify-between print:hidden">
		<Button variant="ghost" size="sm" href="/members/{m.member.id}"
			><ArrowLeft /> Back to member</Button
		>
		<Button size="sm" onclick={() => window.print()}><Printer /> Print / save as PDF</Button>
	</div>

	<div class="bg-white px-14 py-14 print:px-0 print:py-0">
		<header class="flex items-start justify-between">
			<div>
				<p class="text-lg font-semibold">{m.orgName}</p>
				<p class="mt-1 text-neutral-500">Member statement</p>
			</div>
			<dl class="w-72 space-y-5">
				<div class="grid grid-cols-[8rem_1fr] gap-x-4">
					<dt class="text-sm text-neutral-400">From</dt>
					<dd class="text-sm">{m.orgName}</dd>
				</div>
				<div class="grid grid-cols-[8rem_1fr] gap-x-4">
					<dt class="text-sm text-neutral-400">Billed to</dt>
					<dd class="text-sm">
						{#each billedTo as line (line)}
							{line}<br />
						{/each}
					</dd>
				</div>
				<div class="grid grid-cols-[8rem_1fr] gap-x-4">
					<dt class="text-sm text-neutral-400">Generated</dt>
					<dd class="text-sm">{formatDate(new Date())}</dd>
					<dt class="text-sm text-neutral-400">Balance due</dt>
					<dd class="text-sm font-semibold">{formatMoney(balance, currency)}</dd>
				</div>
			</dl>
		</header>

		<h1 class="mt-16 text-right text-7xl font-bold tracking-tight">Statement</h1>

		<p class="mt-14 text-sm font-medium">Charges</p>
		<table class="mt-2 w-full border-t border-neutral-200 text-sm">
			<thead>
				<tr>
					<th class="w-32 py-3 text-left font-medium">Due</th>
					<th class="py-3 text-left font-medium">Item</th>
					<th class="w-24 py-3 text-left font-medium">Status</th>
					<th class="w-28 py-3 text-right font-medium">Amount</th>
					<th class="w-28 py-3 text-right font-medium">Paid</th>
				</tr>
			</thead>
			<tbody>
				{#each charges as c (c.charge.id)}
					<tr>
						<td class="py-2">{c.charge.dueDate}</td>
						<td class="py-2">{c.charge.description ?? kindLabel(c.charge.kind)}</td>
						<td class="py-2 text-neutral-500 capitalize">{c.charge.status}</td>
						<td class="py-2 text-right tabular-nums">{formatMoney(c.charge.amount, currency)}</td>
						<td class="py-2 text-right tabular-nums">{formatMoney(c.paid, currency)}</td>
					</tr>
				{:else}
					<tr><td colspan={5} class="py-2 text-neutral-500">No charges.</td></tr>
				{/each}
			</tbody>
		</table>

		<p class="mt-12 text-sm font-medium">Payments</p>
		<table class="mt-2 w-full border-t border-neutral-200 text-sm">
			<thead>
				<tr>
					<th class="w-32 py-3 text-left font-medium">Date</th>
					<th class="py-3 text-left font-medium">Method</th>
					<th class="w-24 py-3 text-left font-medium">Status</th>
					<th class="w-28 py-3 text-right font-medium">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each payments as p (p.id)}
					<tr>
						<td class="py-2">{formatDate(p.paidAt)}</td>
						<td class="py-2 text-neutral-500 capitalize">{p.method}</td>
						<td class="py-2 text-neutral-500">{p.refundedAt ? 'Refunded' : 'Paid'}</td>
						<td class="py-2 text-right tabular-nums">{formatMoney(p.amount, currency)}</td>
					</tr>
				{:else}
					<tr><td colspan={4} class="py-2 text-neutral-500">No payments.</td></tr>
				{/each}
			</tbody>
		</table>

		<div class="mt-10 flex justify-end">
			<dl class="w-72 text-sm">
				<div class="grid grid-cols-2 gap-x-4 border-t border-neutral-200 pt-2 text-lg">
					<dt>Balance {currency.toUpperCase()}</dt>
					<dd class="text-right font-semibold tabular-nums">
						{formatMoney(balance, currency)}
					</dd>
				</div>
			</dl>
		</div>
	</div>
</div>
