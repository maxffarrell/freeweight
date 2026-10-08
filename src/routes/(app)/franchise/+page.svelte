<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { getFranchise } from '#lib/remote/franchise.remote.ts';
	import { formatMoney } from '#lib/format.ts';

	const f = await getFranchise();
	const multiCurrency = new Set(f.gyms.map((g) => g.currency)).size > 1;
</script>

<svelte:head><title>Franchise · Freeweight</title></svelte:head>

<PageHeader title="Franchise" />

<div class="mx-auto w-full max-w-5xl space-y-4">
	{#if f.gyms.length === 0}
		<Card.Root>
			<Card.Content class="py-10 text-center text-sm text-muted-foreground">
				No gyms yet — this view rolls up every gym you own or administer.
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid gap-4 sm:grid-cols-3">
			<Card.Root>
				<Card.Header class="pb-2">
					<Card.Description>Active members</Card.Description>
					<Card.Title class="text-3xl tabular-nums">{f.totals.members}</Card.Title>
				</Card.Header>
				<Card.Content class="text-xs text-muted-foreground">
					across {f.gyms.length} gym{f.gyms.length === 1 ? '' : 's'}
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="pb-2">
					<Card.Description>Check-ins this month</Card.Description>
					<Card.Title class="text-3xl tabular-nums">{f.totals.monthCheckIns}</Card.Title>
				</Card.Header>
			</Card.Root>
			<Card.Root>
				<Card.Header class="pb-2">
					<Card.Description>Sessions next 7 days</Card.Description>
					<Card.Title class="text-3xl tabular-nums">{f.totals.sessionsNext7}</Card.Title>
				</Card.Header>
			</Card.Root>
		</div>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">All locations</Card.Title>
				<Card.Description>
					Headline numbers per gym. {#if multiCurrency}Amounts are in each gym's own currency.{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Gym</Table.Head>
							<Table.Head class="text-right">Members</Table.Head>
							<Table.Head class="text-right">MRR</Table.Head>
							<Table.Head class="text-right">Revenue (mo)</Table.Head>
							<Table.Head class="text-right">Check-ins (mo)</Table.Head>
							<Table.Head class="text-right">Sessions (7d)</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each f.gyms as g (g.id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									{g.name}
									<span class="ml-1 text-xs font-normal text-muted-foreground">{g.role}</span>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{g.members}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(g.mrr, g.currency, true)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(g.monthRevenue, g.currency, true)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums">{g.monthCheckIns}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{g.sessionsNext7}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
