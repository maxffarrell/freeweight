<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { getReportsQuery } from '#lib/remote/reports.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';

	const r = await getReportsQuery();
	const currency = await getCurrency();

	const maxCheckIns = Math.max(1, ...r.checkIns.map((d) => d.count));
	const maxMembers = Math.max(1, ...r.members.map((m) => m.count));
	const maxRevenue = Math.max(1, ...r.revenue.map((m) => m.total));
	const maxMembersByPlan = Math.max(1, ...r.plans.map((p) => p.count));

	function monthLabel(ym: string) {
		return new Date(`${ym}-02T00:00:00Z`).toLocaleString('en', { month: 'short', year: '2-digit' });
	}
</script>

<PageHeader title="Reports" />

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-2">
	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Check-ins — last 30 days</Card.Title>
			<Card.Description>
				{r.checkIns.reduce((s, d) => s + d.count, 0)} total
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex h-32 items-end gap-px">
				{#each r.checkIns as d (d.day)}
					<div
						class="flex-1 rounded-t bg-primary/80"
						style="height: {Math.max(2, (d.count / maxCheckIns) * 100)}%"
						title="{formatDate(d.day)} — {d.count}"
					></div>
				{/each}
			</div>
			<div class="mt-1 flex justify-between text-xs text-muted-foreground">
				<span>{formatDate(r.checkIns[0]!.day)}</span>
				<span>{formatDate(r.checkIns.at(-1)!.day)}</span>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">New members</Card.Title>
			<Card.Description>Joined per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.members as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-14 shrink-0 text-muted-foreground">{monthLabel(m.month)}</span>
					<div
						class="h-4 rounded bg-primary/70"
						style="width: {(m.count / maxMembers) * 70}%"
					></div>
					<span class="tabular-nums">{m.count}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No members yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Revenue collected</Card.Title>
			<Card.Description>Payments per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.revenue as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-14 shrink-0 text-muted-foreground">{monthLabel(m.month)}</span>
					<div
						class="h-4 rounded bg-green-500/70"
						style="width: {(m.total / maxRevenue) * 70}%"
					></div>
					<span class="tabular-nums">{formatMoney(m.total, currency, true)}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No payments yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Memberships by plan</Card.Title>
			<Card.Description>Active memberships right now</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.plans as p (p.planName)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-32 shrink-0 truncate">{p.planName}</span>
					<div
						class="h-4 rounded bg-primary/70"
						style="width: {(p.count / maxMembersByPlan) * 70}%"
					></div>
					<span class="tabular-nums">{p.count}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No active memberships.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Class fill rate</Card.Title>
			<Card.Description>Booked vs capacity, sessions in the last 30 days</Card.Description>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Class</Table.Head>
						<Table.Head class="text-right">Sessions</Table.Head>
						<Table.Head class="text-right">Booked</Table.Head>
						<Table.Head class="text-right">Fill</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.fill as c (c.className)}
						<Table.Row>
							<Table.Cell class="font-medium">{c.className}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.sessions}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.booked}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{c.capacity > 0 ? Math.round((c.booked / c.capacity) * 100) : 0}%
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No sessions in the last 30 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
