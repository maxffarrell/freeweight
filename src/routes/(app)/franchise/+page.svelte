<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { errMsg } from '#lib/format.ts';
	import { authClient } from '#lib/auth-client.ts';
	import {
		copyFranchiseMember,
		getFranchise,
		searchFranchiseMembers
	} from '#lib/remote/franchise.remote.ts';
	import { formatMoney } from '#lib/format.ts';
	import { SvelteSet } from 'svelte/reactivity';

	const f = await getFranchise();
	const multiCurrency = new Set(f.gyms.map((g) => g.currency)).size > 1;
	const totals = $derived({
		members: f.gyms.reduce((a, g) => a + g.members, 0),
		newMembers30: f.gyms.reduce((a, g) => a + g.newMembers30, 0),
		mrr: f.gyms.reduce((a, g) => a + g.mrr, 0),
		monthRevenue: f.gyms.reduce((a, g) => a + g.monthRevenue, 0),
		monthCheckIns: f.gyms.reduce((a, g) => a + g.monthCheckIns, 0),
		sessionsNext7: f.gyms.reduce((a, g) => a + g.sessionsNext7, 0)
	});
	let switching = $state<string | null>(null);
	const expanded = new SvelteSet<string>();
	let memberQ = $state('');
	let memberHits = $state<
		{
			orgId: string;
			orgName: string;
			memberId: string;
			name: string;
			email: string | null;
			status: string;
			memberships: number;
		}[]
	>([]);
	let searchPending = $state(false);

	async function runSearch() {
		if (memberQ.trim().length < 2) {
			memberHits = [];
			return;
		}
		searchPending = true;
		try {
			memberHits = await searchFranchiseMembers(memberQ);
		} finally {
			searchPending = false;
		}
	}

	function toggle(g: { id: string }) {
		if (expanded.has(g.id)) {
			expanded.delete(g.id);
		} else {
			expanded.add(g.id);
		}
	}

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
				<Card.Title class="text-base">Find a member across gyms</Card.Title>
				<Card.Description
					>Name or email — searches every gym you own or administer.</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<form
					class="flex gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						runSearch();
					}}
				>
					<Input class="max-w-xs" placeholder="member@email.com or a name" bind:value={memberQ} />
					<Button type="submit" variant="outline" disabled={searchPending}
						>{searchPending ? 'Searching…' : 'Search'}</Button
					>
				</form>
				{#if memberHits.length}
					<Table.Root class="mt-4">
						<Table.Header>
							<Table.Row>
								<Table.Head>Member</Table.Head>
								<Table.Head>Email</Table.Head>
								<Table.Head>Gym</Table.Head>
								<Table.Head class="text-right">Active plans</Table.Head>
								<Table.Head class="text-right">Copy to</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each memberHits as h (h.orgId + h.memberId)}
								<Table.Row>
									<Table.Cell class="font-medium">{h.name}</Table.Cell>
									<Table.Cell class="text-muted-foreground">{h.email ?? '—'}</Table.Cell>
									<Table.Cell>{h.orgName}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{h.memberships}</Table.Cell>
									<Table.Cell class="text-right">
										<NativeSelect
											size="sm"
											class="ml-auto w-28"
											value=""
											onchange={async (e) => {
												const target = (e.target as HTMLSelectElement).value;
												if (!target) return;
												try {
													await copyFranchiseMember({
														memberId: h.memberId,
														targetOrgId: target
													});
													toast.success(`${h.name} copied`);
												} catch (err) {
													toast.error(errMsg(err, 'Could not copy'));
												}
												(e.target as HTMLSelectElement).value = '';
											}}
										>
											<option value="">Copy to…</option>
											{#each f.gyms.filter((g) => g.id !== h.orgId) as g (g.id)}
												<option value={g.id}>{g.name}</option>
											{/each}
										</NativeSelect>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{:else if memberQ.trim().length >= 2 && !searchPending}
					<p class="mt-3 text-sm text-muted-foreground">No members match across your gyms.</p>
				{/if}
			</Card.Content>
		</Card.Root>

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
							<Table.Row class="cursor-pointer" onclick={() => toggle(g)}>
								<Table.Cell class="font-medium">
									<span class="mr-1 inline-block w-3 text-muted-foreground"
										>{expanded.has(g.id) ? '▾' : '▸'}</span
									>
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
							{#if expanded.has(g.id)}
								<Table.Row class="bg-muted/40 hover:bg-muted/40">
									<Table.Cell colspan={9} class="py-3">
										<div class="flex flex-wrap gap-x-8 gap-y-1 text-sm">
											<span
												><span class="text-muted-foreground">Seats booked (7d):</span>
												{g.seatsBooked7}</span
											>
											<span
												><span class="text-muted-foreground">Members owing:</span>
												{g.debtors}</span
											>
											<span>
												<span class="text-muted-foreground">Plans:</span>
												{#if g.planMix.length}
													{g.planMix.map((p) => `${p.name} (${p.members})`).join(' · ')}
												{:else}
													none
												{/if}
											</span>
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}
						{/each}
						{#if f.gyms.length > 1}
							<Table.Row class="border-t-2 font-medium">
								<Table.Cell>Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{totals.members}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{totals.newMembers30}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{multiCurrency
										? '—'
										: formatMoney(totals.mrr, f.gyms[0].currency, true)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{multiCurrency
										? '—'
										: formatMoney(totals.monthRevenue, f.gyms[0].currency, true)}</Table.Cell
								>
								<Table.Cell class="text-right text-muted-foreground">—</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{totals.monthCheckIns}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{totals.sessionsNext7}</Table.Cell>
								<Table.Cell></Table.Cell>
							</Table.Row>
						{/if}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
