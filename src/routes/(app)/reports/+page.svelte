<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import { emailAllMembers } from '#lib/remote/members.remote.ts';
	import { errMsg } from '#lib/format.ts';
	import Mail from '@lucide/svelte/icons/mail';
	import { getReportsQuery } from '#lib/remote/reports.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import { toCsv } from '#lib/csv.ts';
	import Download from '@lucide/svelte/icons/download';

	const r = await getReportsQuery();
	const currency = await getCurrency();
	const repSettings = await getSettings();
	const thisMonthRevenue =
		r.revenue.find((m) => m.month === new Date().toISOString().slice(0, 7))?.total ?? 0;

	const maxCheckIns = Math.max(1, ...r.checkIns.map((d) => d.count));
	const maxMembers = Math.max(1, ...r.members.map((m) => m.joined));
	const maxRevenue = Math.max(1, ...r.revenue.map((m) => m.total));
	const maxMembersByPlan = Math.max(1, ...r.plans.map((p) => p.count));
	const maxMethodTotal = Math.max(1, ...r.methods.map((m) => m.total));
	const maxKindTotal = Math.max(1, ...r.kinds.map((k) => k.total));
	const maxSourceJoins = Math.max(1, ...r.sources.map((s) => s.joins));
	const maxLeadMonth = Math.max(1, ...r.leads.byMonth.map((x) => x.leads));
	const KIND_LABELS: Record<string, string> = {
		membership: 'Membership',
		signup: 'Signup fee',
		dropin: 'Drop-in',
		other: 'Other / shop',
		unapplied: 'Unapplied'
	};
	const maxHours = Math.max(1, ...r.hours.map((h) => h.count));
	const hourLabel = (h: number) =>
		h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

	function exportPayroll() {
		const csv = toCsv([
			['Instructor', 'Class', 'Date', 'Attended', 'Rate'],
			...r.payrollDetail.map((d) => [
				d.instructor,
				d.className,
				formatDate(d.startsAt),
				d.attended,
				((d.rate ?? 0) / 100).toFixed(2)
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `instructor-pay-${new Date().toISOString().slice(0, 7)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function monthLabel(ym: string) {
		return new Date(`${ym}-02T00:00:00Z`).toLocaleString('en', { month: 'short', year: '2-digit' });
	}

	// ------- email the at-risk list -------
	let emailOpen = $state(false);
	let emailSubject = $state('');
	let emailBody = $state('');
	let emailPending = $state(false);
	async function submitWinBack(e: SubmitEvent) {
		e.preventDefault();
		emailPending = true;
		try {
			const res = await emailAllMembers({
				subject: emailSubject,
				message: emailBody,
				memberIds: r.atRisk.map((m) => m.memberId)
			});
			toast.success(res.total ? `Sent to ${res.sent} of ${res.total} members` : 'No emails sent');
			emailOpen = false;
			emailSubject = emailBody = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send — try again'));
		}
		emailPending = false;
	}
</script>

<PageHeader title="Reports" />

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-2">
	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Check-ins — last 30 days</Card.Title>
			<Card.Description>
				{r.checkIns.reduce((s, d) => s + d.count, 0)} total{#if r.visit.minutes != null}
					· avg visit {r.visit.minutes} min ({r.visit.visits} with check-outs){/if}
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

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Busiest hours — last 90 days</Card.Title>
			<Card.Description>Member check-ins by hour, gym timezone</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex h-24 items-end gap-px">
				{#each r.hours as h (h.hour)}
					<div
						class="flex-1 rounded-t bg-primary/80"
						style="height: {Math.max(2, (h.count / maxHours) * 100)}%"
						title="{hourLabel(h.hour)} — {h.count}"
					></div>
				{/each}
			</div>
			<div class="mt-1 flex justify-between text-xs text-muted-foreground">
				<span>12a</span>
				<span>6a</span>
				<span>12p</span>
				<span>6p</span>
				<span>11p</span>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Traffic heatmap — last 90 days</Card.Title>
			<Card.Description>Check-ins by day × hour, gym timezone</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto">
			{@const maxCell = Math.max(1, ...r.heatmap.map((c) => c.n))}
			{@const hrs = [...new Set(r.heatmap.map((c) => c.hour))].sort((a, b) => a - b)}
			<table class="w-full min-w-150 border-collapse text-[10px] tabular-nums">
				<thead>
					<tr>
						<th class="p-1 text-left font-medium text-muted-foreground"></th>
						{#each hrs as h (h)}
							<th class="p-1 font-medium text-muted-foreground">{hourLabel(h)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as d, dow (d)}
						<tr>
							<td class="p-1 pr-2 font-medium text-muted-foreground">{d}</td>
							{#each hrs as h (h)}
								{@const c = r.heatmap.find((x) => x.dow === dow && x.hour === h)}
								<td
									class="p-1 text-center {c?.n ? 'font-medium' : 'text-muted-foreground'}"
									style="background: {c?.n ? `rgb(37 99 235 / ${Math.round(15 + 85 * (c.n / maxCell))}%)` : 'transparent'}"
									title="{d} {hourLabel(h)} — {c?.n ?? 0} check-ins">{c?.n || ''}</td
								>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Member growth</Card.Title>
			<Card.Description>Joined vs cancelled per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.members as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-14 shrink-0 text-muted-foreground">{monthLabel(m.month)}</span>
					<div class="relative h-4 flex-1">
						<div
							class="absolute inset-y-0 left-0 rounded bg-primary/70"
							style="width: {(m.joined / maxMembers) * 70}%"
						></div>
					</div>
					<span class="w-14 shrink-0 text-right tabular-nums">
						{m.joined}
						{#if m.cancelled > 0}<span class="text-destructive"> −{m.cancelled}</span>{/if}
					</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No members yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Retention by cohort</Card.Title>
			<Card.Description
				>Members who joined each month and are still active — newest month first</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.retention as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-14 shrink-0 text-muted-foreground">{monthLabel(m.month)}</span>
					<div class="relative h-4 flex-1">
						<div
							class="absolute inset-y-0 left-0 rounded bg-primary/70"
							style="width: {(m.active / m.joined) * 70}%"
						></div>
					</div>
					<span class="w-28 shrink-0 text-right tabular-nums">
						{m.active}/{m.joined}
						<span class="text-muted-foreground">({Math.round((m.active / m.joined) * 100)}%)</span>
					</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No members joined in the last 12 months.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Why members leave</Card.Title>
			<Card.Description>Stated reasons on current cancelled and paused memberships</Card.Description
			>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Reason</Table.Head>
						<Table.Head class="text-right">Cancelled</Table.Head>
						<Table.Head class="text-right">Paused</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.churn as c (c.reason)}
						<Table.Row>
							<Table.Cell class="font-medium">{c.reason}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.cancelled}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.paused}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>Nobody has left yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Cover claims</Card.Title>
			<Card.Description>Who flags sessions for cover vs who picks them up</Card.Description>
		</Card.Header>
		<Card.Content class="p-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Staff</Table.Head>
						<Table.Head class="text-right">Flagged</Table.Head>
						<Table.Head class="text-right">Covered</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.covers as c (c.name)}
						<Table.Row>
							<Table.Cell class="font-medium">{c.name}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.requested}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.claimed}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No cover activity yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	{#if r.tags?.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Member tags</Card.Title>
				<Card.Description>Active members per tag — how your labels distribute</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Tag</Table.Head>
							<Table.Head class="text-right">Members</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.tags as t (t.tag)}
							<Table.Row>
								<Table.Cell class="font-medium">{t.tag}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{t.n}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Churn by plan</Card.Title>
			<Card.Description>Memberships cancelled in the last 90 days vs still active</Card.Description>
		</Card.Header>
		<Card.Content class="p-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Plan</Table.Head>
						<Table.Head class="text-right">Active</Table.Head>
						<Table.Head class="text-right">Cancelled (90d)</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.planChurn as p (p.planName)}
						<Table.Row>
							<Table.Cell class="font-medium">{p.planName}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{p.active}</Table.Cell>
							<Table.Cell
								class="text-right tabular-nums {p.cancelled > p.active ? 'text-red-500' : ''}"
								>{p.cancelled}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground">No memberships yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Recurring revenue</Card.Title>
			<Card.Description>Monthly run rate from {r.mrr.activeMembers} active members</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-3">
			<p class="text-3xl font-semibold tabular-nums">{formatMoney(r.mrr.total, currency, true)}</p>
			<div class="space-y-1 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Memberships</span>
					<span class="tabular-nums">{formatMoney(r.mrr.memberships, currency, true)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Add-ons</span>
					<span class="tabular-nums">{formatMoney(r.mrr.addons, currency, true)}</span>
				</div>
				<div class="flex justify-between border-t pt-1 text-muted-foreground">
					<span>Annualized</span>
					<span class="tabular-nums">{formatMoney(r.mrr.total * 12, currency, true)}</span>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Member value</Card.Title>
			<Card.Description>Lifetime collected per member — all time</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			<p class="text-3xl font-semibold tabular-nums">
				{formatMoney(r.memberValue.avgPerActive, currency, true)}
			</p>
			<div class="space-y-1 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Total collected</span>
					<span class="tabular-nums">{formatMoney(r.memberValue.total, currency, true)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Avg per active member</span>
					<span class="tabular-nums">{formatMoney(r.memberValue.avgPerActive, currency, true)}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground"
						>Avg per paying member ({r.memberValue.payingMembers})</span
					>
					<span class="tabular-nums">{formatMoney(r.memberValue.avgPerPayer, currency, true)}</span>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Top spenders</Card.Title>
			<Card.Description>
				Highest lifetime payments · avg {formatMoney(r.spenders.avg, currency, true)} across {r.spenders.payers} payers
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#each r.spenders.rows as row, i (row.memberId)}
				<div class="flex items-center justify-between gap-2 py-1 text-sm">
					<span class="min-w-0 truncate">
						<span class="mr-1.5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
						<a href="/members/{row.memberId}" class="hover:underline">{row.name}</a>
					</span>
					<span class="shrink-0 tabular-nums">{formatMoney(row.total, currency, true)}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No payments collected yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Gift cards</Card.Title>
			<Card.Description
				>Unredeemed balance — services the gym still owes cardholders</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if r.giftCards.issued === 0}
				<p class="text-sm text-muted-foreground">
					No gift cards issued yet — sell them from the front-desk shop.
				</p>
			{:else}
				<p class="text-3xl font-semibold tabular-nums">
					{formatMoney(r.giftCards.outstanding, currency, true)}
				</p>
				<div class="space-y-1 text-sm">
					<div class="flex justify-between">
						<span class="text-muted-foreground">Issued</span>
						<span class="tabular-nums"
							>{r.giftCards.issued} · {formatMoney(r.giftCards.issuedValue, currency, true)}</span
						>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">Redeemed</span>
						<span class="tabular-nums">{r.giftCards.redeemed}</span>
					</div>
					<div class="flex justify-between border-t pt-1">
						<span class="text-muted-foreground">With balance left</span>
						<span class="tabular-nums">{r.giftCards.active}</span>
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Revenue collected</Card.Title>
			<Card.Description>Payments per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#if repSettings.revenueTarget}
				<div class="mb-3 space-y-1">
					<div class="flex justify-between text-xs text-muted-foreground">
						<span>This month vs target</span>
						<span class="tabular-nums"
							>{formatMoney(thisMonthRevenue, currency, true)} / {formatMoney(
								repSettings.revenueTarget,
								currency,
								true
							)}</span
						>
					</div>
					<div class="h-2 rounded bg-muted">
						<div
							class="h-2 rounded {thisMonthRevenue >= repSettings.revenueTarget
								? 'bg-green-500'
								: 'bg-amber-500'}"
							style="width: {Math.min(
								100,
								Math.round((thisMonthRevenue / repSettings.revenueTarget) * 100)
							)}%"
						></div>
					</div>
				</div>
			{/if}
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

	{#if r.pnl.months.length}
		<Card.Root class="lg:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Profit &amp; loss</Card.Title>
				<Card.Description>
					Revenue vs logged expenses + shop cost-of-goods per month — costs on Billing → Expenses,
					item cost on Billing → Shop
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-6 md:grid-cols-[1fr_auto]">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Month</Table.Head>
								<Table.Head class="text-right">Revenue</Table.Head>
								<Table.Head class="text-right">Expenses</Table.Head>
								<Table.Head class="text-right">Shop COGS</Table.Head>
								<Table.Head class="text-right">Net</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.pnl.months.slice(-8).reverse() as m (m.month)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground">{monthLabel(m.month)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(m.revenue, currency)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(m.expenses, currency)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{m.cogs ? formatMoney(m.cogs, currency) : '—'}</Table.Cell
									>
									<Table.Cell
										class="text-right font-medium tabular-nums {m.net < 0
											? 'text-destructive'
											: ''}">{formatMoney(m.net, currency)}</Table.Cell
									>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
					{#if r.pnl.byCategory.length}
						<div class="min-w-44 space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">Spend by category (all time)</p>
							{#each r.pnl.byCategory as c (c.category)}
								<div class="flex items-center justify-between gap-3 text-sm">
									<span class="capitalize">{c.category}</span>
									<span class="tabular-nums">{formatMoney(c.total, currency, true)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Trial conversion</Card.Title>
			<Card.Description>Trial memberships that became paying members</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if r.trials.trials > 0}
				<p class="text-4xl font-bold tabular-nums">
					{Math.round((r.trials.converted / r.trials.trials) * 100)}%
				</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{r.trials.converted} of {r.trials.trials} trials converted
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					No trial memberships yet — set free-trial days on a plan to use trials.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if r.waivers.required}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Waivers</Card.Title>
				<Card.Description>Active members who signed the liability waiver</Card.Description>
			</Card.Header>
			<Card.Content>
				<p class="text-4xl font-bold tabular-nums">
					{r.waivers.total > 0 ? Math.round((r.waivers.signed / r.waivers.total) * 100) : 0}%
				</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{r.waivers.signed} of {r.waivers.total} signed
					{#if r.waivers.total > r.waivers.signed}
						· {r.waivers.total - r.waivers.signed} outstanding — the daily job emails them once{/if}
				</p>
			</Card.Content>
		</Card.Root>
	{/if}

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
			<Card.Title class="text-base">Payments by method</Card.Title>
			<Card.Description>Collected (excl. refunds), last 90 days</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.methods as m (m.method)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-16 shrink-0 capitalize">{m.method}</span>
					<div
						class="h-4 rounded bg-green-500/70"
						style="width: {(m.total / maxMethodTotal) * 70}%"
					></div>
					<span class="tabular-nums"
						>{formatMoney(m.total, currency, true)}
						<span class="text-xs text-muted-foreground">· {m.count}</span></span
					>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No payments in the last 90 days.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Revenue by kind</Card.Title>
			<Card.Description>Collected (excl. refunds), last 90 days</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.kinds as k (k.kind)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-24 shrink-0">{KIND_LABELS[k.kind] ?? k.kind}</span>
					<div
						class="h-4 rounded bg-green-500/70"
						style="width: {(k.total / maxKindTotal) * 70}%"
					></div>
					<span class="tabular-nums"
						>{formatMoney(k.total, currency, true)}
						<span class="text-xs text-muted-foreground">· {k.count}</span></span
					>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No payments in the last 90 days.</p>
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

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">No-show rate by class</Card.Title>
			<Card.Description>Bookings that flaked, sessions in the last 90 days</Card.Description>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Class</Table.Head>
						<Table.Head class="text-right">Attended</Table.Head>
						<Table.Head class="text-right">No-shows</Table.Head>
						<Table.Head class="text-right">Rate</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.noShows as c (c.className)}
						<Table.Row>
							<Table.Cell class="font-medium">{c.className}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.attended}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.noShows}</Table.Cell>
							<Table.Cell class="text-right tabular-nums {c.rate >= 20 ? 'text-destructive' : ''}"
								>{c.rate}%</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No concluded bookings in the last 90 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Class economics — last 30 days</Card.Title>
			<Card.Description
				>Sessions run, average attendance, drop-in revenue and instructor cost per class. Margin
				counts drop-in sales only — membership revenue isn't attributable to one class.</Card.Description
			>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Class</Table.Head>
						<Table.Head class="text-right">Sessions</Table.Head>
						<Table.Head class="text-right">Avg attendance</Table.Head>
						<Table.Head class="text-right">Drop-in revenue</Table.Head>
						<Table.Head class="text-right">Instructor cost</Table.Head>
						<Table.Head class="text-right">Margin</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.profitability as c (c.className)}
						<Table.Row>
							<Table.Cell class="font-medium">
								{#if c.color}<span
										class="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
										style="background:{c.color}"
									></span>{/if}
								{c.className}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.sessions}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{c.avgAttendance}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(c.dropIn, currency, true)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{c.cost === null ? '—' : formatMoney(c.cost, currency, true)}</Table.Cell
							>
							<Table.Cell
								class="text-right tabular-nums {c.margin !== null && c.margin < 0
									? 'text-destructive'
									: ''}"
								>{c.margin === null ? '—' : formatMoney(c.margin, currency, true)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={6} class="text-muted-foreground"
								>No sessions ran in the last 30 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Events</Card.Title>
			<Card.Description
				>Signups, show rate and signup revenue per event, last 90 days + upcoming</Card.Description
			>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Event</Table.Head>
						<Table.Head>Date</Table.Head>
						<Table.Head class="text-right">Registered</Table.Head>
						<Table.Head class="text-right">Attended</Table.Head>
						<Table.Head class="text-right">Show rate</Table.Head>
						<Table.Head class="text-right">Revenue</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.events as e (e.event.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{e.event.name}</Table.Cell>
							<Table.Cell>{formatDate(e.event.startsAt)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.registered}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.past ? e.attended : '—'}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{e.past ? `${e.showRate}%` : '—'}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{e.revenue ? formatMoney(e.revenue, currency) : '—'}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={6} class="text-muted-foreground"
								>No events in the last 90 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	{#if r.amenities.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Amenity use</Card.Title>
				<Card.Description
					>Portal reservations in the last 30 days, against each amenity's open-slot capacity</Card.Description
				>
			</Card.Header>
			<Card.Content class="px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Amenity</Table.Head>
							<Table.Head>Kind</Table.Head>
							<Table.Head class="text-right">Bookings</Table.Head>
							<Table.Head class="text-right">Utilization</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.amenities as a (a.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{a.name}</Table.Cell>
								<Table.Cell class="text-muted-foreground">{a.kind || '—'}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{a.bookings}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{a.util}%{a.util >= 90 ? ' · near capacity' : ''}</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Fill by weekday</Card.Title>
			<Card.Description>Booked vs capacity per day, sessions in the last 90 days</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex h-24 items-end gap-1.5">
				{#each r.weekdays as w (w.day)}
					<div
						class="flex-1 rounded-t bg-primary/80"
						style="height: {w.capacity > 0 ? Math.max(2, (w.booked / w.capacity) * 100) : 0}%"
						title="{w.day} — {w.capacity > 0
							? Math.round((w.booked / w.capacity) * 100)
							: 0}% ({w.booked}/{w.capacity})"
					></div>
				{/each}
			</div>
			<div class="mt-1 flex justify-between gap-1.5 text-center text-xs text-muted-foreground">
				{#each r.weekdays as w (w.day)}
					<span class="flex-1">{w.day}</span>
				{/each}
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Instructors — last 30 days</Card.Title>
			<Card.Description>Sessions taught and attendance outcomes</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Instructor</Table.Head>
						<Table.Head class="text-right">Sessions</Table.Head>
						<Table.Head class="text-right">Booked</Table.Head>
						<Table.Head class="text-right">Attended</Table.Head>
						<Table.Head class="text-right">No-shows</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.instructors as t (t.instructor)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.instructor}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.sessions}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.booked}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.attended}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.noShow}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={5} class="text-muted-foreground"
								>No instructor-assigned sessions in the last 30 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="flex-row items-start justify-between space-y-0">
			<div>
				<Card.Title class="text-base">Instructor pay — this month</Card.Title>
				<Card.Description>Rated classes taught × per-class pay rate</Card.Description>
			</div>
			{#if r.payrollDetail.length}
				<Button variant="ghost" size="sm" onclick={exportPayroll}>
					<Download class="size-3.5" /> CSV
				</Button>
			{/if}
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Instructor</Table.Head>
						<Table.Head class="text-right">Classes</Table.Head>
						<Table.Head class="text-right">Owed</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.payroll.rows as t (t.instructor)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.instructor}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.sessions}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{formatMoney(t.pay, currency)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No rated classes this month — set a pay rate on a class type.</Table.Cell
							></Table.Row
						>
					{/each}
					{#if r.payroll.rows.length > 1}
						<Table.Row class="font-medium">
							<Table.Cell>Total</Table.Cell>
							<Table.Cell></Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(r.payroll.total, currency)}</Table.Cell
							>
						</Table.Row>
					{/if}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Staff hours — last 30 days</Card.Title>
			<Card.Description>Clocked-in time per staff member (dashboard clock in/out)</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Staff</Table.Head>
						<Table.Head class="text-right">Shifts</Table.Head>
						<Table.Head class="text-right">Hours</Table.Head>
						<Table.Head class="text-right">Est. pay</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.staffShifts as s (s.memberId)}
						<Table.Row>
							<Table.Cell class="font-medium">{s.staffName}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{s.shifts}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{(s.minutes / 60).toFixed(1)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{s.hourlyRateCents != null
									? formatMoney(Math.round((s.minutes / 60) * s.hourlyRateCents), currency)
									: '—'}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No shifts yet — staff clock in from the dashboard.</Table.Cell
							></Table.Row
						>
					{/each}
					{#if r.staffShifts.length > 1}
						<Table.Row class="font-medium">
							<Table.Cell>Total</Table.Cell>
							<Table.Cell></Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{(r.staffShifts.reduce((n, s) => n + s.minutes, 0) / 60).toFixed(1)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(
									r.staffShifts.reduce(
										(n, s) =>
											n +
											(s.hourlyRateCents ? Math.round((s.minutes / 60) * s.hourlyRateCents) : 0),
										0
									),
									currency
								)}</Table.Cell
							>
						</Table.Row>
					{/if}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	{#if r.locations.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">By location — last 30 days</Card.Title>
				<Card.Description>Members, class volume and check-ins per site</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Location</Table.Head>
							<Table.Head class="text-right">Members</Table.Head>
							<Table.Head class="text-right">Sessions</Table.Head>
							<Table.Head class="text-right">Fill</Table.Head>
							<Table.Head class="text-right">No-shows</Table.Head>
							<Table.Head class="text-right">Check-ins</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.locations as l (l.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{l.name}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{l.members}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{l.sessions}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{l.capacity ? `${Math.round((l.booked / l.capacity) * 100)}%` : '—'}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums">{l.noShows}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{l.checkIns}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.ratings.byClass.length || r.ratings.byInstructor.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Class ratings — last 90 days</Card.Title>
				<Card.Description>Member star ratings submitted in the portal</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-6 sm:grid-cols-2">
				<div>
					<p class="mb-2 text-xs font-medium text-muted-foreground uppercase">By class</p>
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Class</Table.Head>
								<Table.Head class="text-right">Avg</Table.Head>
								<Table.Head class="text-right">Ratings</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.ratings.byClass as c (c.name)}
								<Table.Row>
									<Table.Cell class="font-medium">{c.name}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{c.avg.toFixed(1)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{c.ratings}</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row><Table.Cell colspan={3}>—</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				<div>
					<p class="mb-2 text-xs font-medium text-muted-foreground uppercase">By instructor</p>
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Instructor</Table.Head>
								<Table.Head class="text-right">Avg</Table.Head>
								<Table.Head class="text-right">Ratings</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.ratings.byInstructor as i (i.name)}
								<Table.Row>
									<Table.Cell class="font-medium">{i.name}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{i.avg.toFixed(1)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{i.ratings}</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row><Table.Cell colspan={3}>—</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if r.ratings.recent.length}
					<div class="sm:col-span-2">
						<p class="mb-2 text-xs font-medium text-muted-foreground uppercase">Recent comments</p>
						<Table.Root>
							<Table.Body>
								{#each r.ratings.recent as f (f.createdAt)}
									<Table.Row>
										<Table.Cell class="font-medium whitespace-nowrap text-amber-500">
											{'★'.repeat(f.rating)}<span class="text-muted-foreground"
												>{'★'.repeat(5 - f.rating)}</span
											>
										</Table.Cell>
										<Table.Cell class="font-medium">{f.className}</Table.Cell>
										<Table.Cell>{f.comment}</Table.Cell>
										<Table.Cell class="text-muted-foreground">{f.memberName}</Table.Cell>
										<Table.Cell class="text-right whitespace-nowrap text-muted-foreground"
											>{formatDate(f.createdAt)}</Table.Cell
										>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.never?.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Never visited</Card.Title>
				<Card.Description>
					{r.never.length} active member{r.never.length === 1 ? '' : 's'} with zero check-ins —
					signed up but never showed
				</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Member</Table.Head>
							<Table.Head class="text-right">Joined</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.never as m (m.memberId)}
							<Table.Row>
								<Table.Cell>
									<a
										class="font-medium underline-offset-2 hover:underline"
										href="/members/{m.memberId}">{m.name}</a
									>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{m.joinedAt ?? '—'}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root class="lg:col-span-2">
		<Card.Header class="flex-row items-center justify-between space-y-0">
			<Card.Title class="text-base">At-risk members</Card.Title>
			{#if r.atRisk.length}
				<Button size="sm" variant="outline" onclick={() => (emailOpen = true)}
					><Mail /> Email list</Button
				>
			{/if}
			<Card.Description>
				{r.atRisk.length} active member{r.atRisk.length === 1 ? '' : 's'} with no check-in in 30+ days
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Member</Table.Head>
						<Table.Head>Email</Table.Head>
						<Table.Head class="text-right">Last visit</Table.Head>
						<Table.Head class="text-right">Days away</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.atRisk as m (m.memberId)}
						<Table.Row>
							<Table.Cell>
								<a
									class="font-medium underline-offset-2 hover:underline"
									href="/members/{m.memberId}">{m.name}</a
								>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{m.email ?? '—'}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{m.lastVisit ? formatDate(m.lastVisit) : 'Never'}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{m.daysSince ?? '30+'}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>Everyone has checked in within the last 30 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Top attendees — last 30 days</Card.Title>
			<Card.Description>Your most consistent members (member check-ins, no guests)</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Body>
					{#each r.top as m, i (m.memberId)}
						<Table.Row>
							<Table.Cell class="w-8 text-muted-foreground">{i + 1}</Table.Cell>
							<Table.Cell>
								<a
									class="font-medium underline-offset-2 hover:underline"
									href="/members/{m.memberId}">{m.name}</a
								>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{m.visits} visits</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="text-muted-foreground">No check-ins yet this period.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Lead sources</Card.Title>
			<Card.Description>Signups by "How did you hear about us?" — all time</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.sources as s (s.source)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-24 shrink-0 truncate">{s.source}</span>
					<div
						class="h-4 rounded bg-indigo-500/70"
						style="width: {(s.joins / maxSourceJoins) * 70}%"
					></div>
					<span class="tabular-nums">{s.joins}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No signups yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Leads</Card.Title>
			<Card.Description
				>Join-page lead form captures — last 6 months, {r.leads.converted} of {r.leads.total}
				joined ({r.leads.total
					? Math.round((r.leads.converted / r.leads.total) * 100)
					: 0}%)</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.leads.byMonth as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-20 shrink-0">{m.month}</span>
					<div
						class="h-4 rounded bg-emerald-500/70"
						style="width: {(m.leads / maxLeadMonth) * 70}%"
					></div>
					<span class="tabular-nums">{m.leads}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">
					No leads captured yet — the "leave your info" form lives on the join page.
				</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">On pause</Card.Title>
			<Card.Description>Paused memberships and when they come back</Card.Description>
		</Card.Header>
		<Card.Content class="divide-y px-6">
			{#each r.paused as p (p.memberName + p.planName)}
				<div class="flex items-center justify-between gap-2 py-2 text-sm">
					<span class="truncate font-medium">{p.memberName}</span>
					<span class="shrink-0 text-xs text-muted-foreground">
						{p.planName}
						{#if p.frozenUntil}
							· resumes {p.frozenUntil}
						{:else if p.pauseUntil}
							· out until {p.pauseUntil}
						{:else}
							· manual resume
						{/if}
					</span>
				</div>
			{:else}
				<p class="py-2 text-sm text-muted-foreground">No paused memberships.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Renewals</Card.Title>
			<Card.Description>Expected membership billing, next 3 months</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Month</Table.Head>
						<Table.Head class="text-right">Renewals</Table.Head>
						<Table.Head class="text-right">Expected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.renewals as m (m.month)}
						<Table.Row>
							<Table.Cell class="font-medium">{m.month}</Table.Cell>
							<Table.Cell class="text-right">{m.n}</Table.Cell>
							<Table.Cell class="text-right">{formatMoney(m.total, currency, true)}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row><Table.Cell colspan={3} class="text-muted-foreground">No renewals due in the next 90 days.</Table.Cell></Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Member funnel</Card.Title>
			<Card.Description>Leads → members → trialed → paying → retained 90+ days</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each [{ label: 'Leads captured', n: r.funnel.leads }, { label: 'Members on file', n: r.funnel.members }, { label: 'Trialed a plan', n: r.funnel.trialed }, { label: 'Paying now', n: r.funnel.paying }, { label: 'Active 90+ days', n: r.funnel.retained }] as step (step.label)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-28 shrink-0">{step.label}</span>
					<div
						class="h-4 rounded bg-sky-500/70"
						style="width: {r.funnel.members ? (step.n / r.funnel.members) * 70 : 0}%"
					></div>
					<span class="tabular-nums">{step.n}</span>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	{#if r.courses.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Member feedback</Card.Title>
				<Card.Description
					>One-tap scores members leave in the portal — promoters minus detractors is the NPS.</Card.Description
				>
			</Card.Header>
			<Card.Content>
				{#if r.nps.n}
					<div class="flex items-baseline gap-2">
						<span class="text-2xl font-bold tabular-nums">{r.nps.score ?? '—'}</span>
						<span class="text-sm text-muted-foreground"
							>NPS · {r.nps.avg}/10 avg across {r.nps.n} response{r.nps.n === 1 ? '' : 's'}</span
						>
					</div>
					{#if r.nps.recent.length}
						<ul class="mt-3 divide-y text-sm">
							{#each r.nps.recent as nr (nr.createdAt)}
								<li class="flex items-baseline justify-between gap-2 py-1.5">
									<span class="font-medium">{nr.memberName}</span>
									<span class="text-muted-foreground"
										>{nr.score}/10{nr.comment ? ` — ${nr.comment}` : ''}</span
									>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">No feedback yet.</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Courses</Card.Title>
				<Card.Description
					>Enrollees, sessions held, attendance, and revenue per course</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Course</Table.Head>
							<Table.Head class="text-right">Enrollees</Table.Head>
							<Table.Head class="text-right">Sessions</Table.Head>
							<Table.Head class="text-right">Attendance</Table.Head>
							<Table.Head class="text-right">Revenue</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.courses as c (c.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{c.name}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{c.enrollees}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{c.sessions}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{c.attendancePct == null ? '—' : `${c.attendancePct}%`}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(c.revenue, currency, true)}</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Top referrers</Card.Title>
			<Card.Description>Members whose referral links drove the most signups</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Body>
					{#each r.referrers as m, i (m.memberId)}
						<Table.Row>
							<Table.Cell class="w-8 text-muted-foreground">{i + 1}</Table.Cell>
							<Table.Cell>
								<a
									class="font-medium underline-offset-2 hover:underline"
									href="/members/{m.memberId}">{m.name}</a
								>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{m.joins} joined</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="text-muted-foreground"
								>No referred signups yet — members get their link in the portal.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open={emailOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Email at-risk members</Dialog.Title>
			<Dialog.Description>
				Goes to the {r.atRisk.length} member{r.atRisk.length === 1 ? '' : 's'} in the list — a "we miss
				you" nudge to bring them back.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitWinBack}>
			<Field.Field>
				<Field.Label for="w-subject">Subject</Field.Label>
				<Input id="w-subject" required bind:value={emailSubject} autofocus />
			</Field.Field>
			<Field.Field>
				<Field.Label for="w-body">Message</Field.Label>
				<Textarea
					id="w-body"
					required
					bind:value={emailBody}
					rows={6}
					placeholder="We miss you at the gym — your next class is on us…"
				/>
			</Field.Field>
			<Dialog.Footer
				><Button type="submit" disabled={emailPending}>
					{emailPending ? 'Sending…' : 'Send'}
				</Button></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
