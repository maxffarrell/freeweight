<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { authClient } from '#lib/auth-client.ts';
	import { getFranchise } from '#lib/remote/franchise.remote.ts';
	import { formatMoney } from '#lib/format.ts';

	const f = await getFranchise();
	const multiCurrency = new Set(f.gyms.map((g) => g.currency)).size > 1;
	let switching = $state<string | null>(null);

	async function switchTo(orgId: string, name: string) {
		switching = orgId;
		const { error } = await authClient.organization.setActive({ organizationId: orgId });
		if (error) {
			switching = null;
			toast.error(error.message ?? 'Could not switch gyms');
			return;
		}
		await goto('/dashboard');
		toast.success(`Switched to ${name}`);
	}
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
							<Table.Head class="text-right">New (30d)</Table.Head>
							<Table.Head class="text-right">MRR</Table.Head>
							<Table.Head class="text-right">Revenue (mo)</Table.Head>
							<Table.Head class="text-right">vs last mo</Table.Head>
							<Table.Head class="text-right">Check-ins (mo)</Table.Head>
							<Table.Head class="text-right">Sessions (7d)</Table.Head>
							<Table.Head class="w-0"></Table.Head>
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
								<Table.Cell class="text-right tabular-nums">{g.newMembers30}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(g.mrr, g.currency, true)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(g.monthRevenue, g.currency, true)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums">
									{#if g.prevMonthRevenue > 0}
										<span
											class={g.monthRevenue >= g.prevMonthRevenue
												? 'text-emerald-600'
												: 'text-destructive'}
											>{g.monthRevenue >= g.prevMonthRevenue ? '+' : ''}{Math.round(
												((g.monthRevenue - g.prevMonthRevenue) / g.prevMonthRevenue) * 100
											)}%</span
										>
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{g.monthCheckIns}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{g.sessionsNext7}</Table.Cell>
								<Table.Cell class="text-right">
									{#if g.id === f.activeId}
										<Badge>Current</Badge>
									{:else}
										<Button
											size="sm"
											variant="outline"
											disabled={switching !== null}
											onclick={() => switchTo(g.id, g.name)}>Switch</Button
										>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
