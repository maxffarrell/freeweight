<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
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
	import { markPayrollPaid, getReportsQuery } from '#lib/remote/reports.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import { toCsv } from '#lib/csv.ts';
	import Download from '@lucide/svelte/icons/download';
	import { BarChart } from 'layerchart';
	import * as Chart from '#lib/components/ui/chart/index.js';
	import type { ChartConfig } from '#lib/components/ui/chart/index.js';

	const r = await getReportsQuery();
	const currency = await getCurrency();
	const repSettings = await getSettings();
	const thisMonthRevenue =
		r.revenue.find((m) => m.month === new Date().toISOString().slice(0, 7))?.total ?? 0;

	const KIND_LABELS: Record<string, string> = {
		membership: 'Membership',
		signup: 'Signup fee',
		dropin: 'Drop-in',
		other: 'Other / shop',
		unapplied: 'Unapplied'
	};
	const hourLabel = (h: number) =>
		h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

	const checkInCfg = {
		count: { label: 'Check-ins', color: 'var(--chart-1)' }
	} satisfies ChartConfig;
	const hoursCfg = {
		count: { label: 'Check-ins', color: 'var(--chart-1)' }
	} satisfies ChartConfig;
	const growthCfg = {
		joined: { label: 'Joined', color: 'var(--chart-2)' },
		cancelled: { label: 'Cancelled', color: 'var(--destructive)' }
	} satisfies ChartConfig;
	const retentionCfg = {
		pct: { label: 'Still active %', color: 'var(--chart-1)' }
	} satisfies ChartConfig;
	const revenueCfg = {
		total: { label: 'Revenue', color: 'var(--chart-2)' }
	} satisfies ChartConfig;
	const fillCfg = {
		fill: { label: 'Fill %', color: 'var(--chart-1)' }
	} satisfies ChartConfig;
	const planCfg = {
		count: { label: 'Members', color: 'var(--chart-1)' }
	} satisfies ChartConfig;
	const methodCfg = {
		total: { label: 'Collected', color: 'var(--chart-2)' }
	} satisfies ChartConfig;
	const kindCfg = {
		total: { label: 'Collected', color: 'var(--chart-2)' }
	} satisfies ChartConfig;
	const sourceCfg = {
		joins: { label: 'Signups', color: 'var(--chart-3)' }
	} satisfies ChartConfig;
	const leadCfg = {
		leads: { label: 'Leads', color: 'var(--chart-4)' }
	} satisfies ChartConfig;
	const fillWeekday = r.weekdays.map((w) => ({
		day: w.day,
		fill: w.capacity > 0 ? Math.round((w.booked / w.capacity) * 100) : 0
	}));
	const retentionPct = r.retention.map((m) => ({
		month: m.month,
		pct: m.joined ? Math.round((m.active / m.joined) * 100) : 0,
		active: m.active,
		joined: m.joined
	}));

	let payrollPending = $state(false);
	const thisMonth = new Date().toISOString().slice(0, 7);
	let payrollPaidMonth = $state<string | null>(r.payrollPaid?.month ?? null);
	async function markPaid() {
		payrollPending = true;
		try {
			const res = await markPayrollPaid();
			toast.success(`${res.month} payroll marked paid`);
			payrollPaidMonth = res.month;
		} catch (err) {
			toast.error(errMsg(err, 'Could not mark paid'));
		}
		payrollPending = false;
	}

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
	function exportPnl() {
		const csv = toCsv([
			['Month', 'Revenue', 'Expenses', 'Shop COGS', 'Net', 'Margin %'],
			...r.pnl.months.map((m) => [
				m.month,
				(m.revenue / 100).toFixed(2),
				(m.expenses / 100).toFixed(2),
				(m.cogs / 100).toFixed(2),
				(m.net / 100).toFixed(2),
				m.revenue > 0 ? Math.round((100 * m.net) / m.revenue) : ''
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `pnl-${new Date().toISOString().slice(0, 7)}.csv`;
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
			<Chart.Container config={checkInCfg} class="h-40 w-full">
				<BarChart
					data={r.checkIns}
					x="day"
					series={[{ key: 'count', label: 'Check-ins', color: 'var(--color-count)' }]}
					props={{ xAxis: { format: (d) => formatDate(d) } }}
				>
					{#snippet tooltip()}
						<Chart.Tooltip />
					{/snippet}
				</BarChart>
			</Chart.Container>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Busiest hours — last 90 days</Card.Title>
			<Card.Description>Member check-ins by hour, gym timezone</Card.Description>
		</Card.Header>
		<Card.Content>
			<Chart.Container config={hoursCfg} class="h-36 w-full">
				<BarChart
					data={r.hours}
					x="hour"
					series={[{ key: 'count', label: 'Check-ins', color: 'var(--color-count)' }]}
					props={{ xAxis: { format: (d) => hourLabel(d) } }}
				>
					{#snippet tooltip()}
						<Chart.Tooltip />
					{/snippet}
				</BarChart>
			</Chart.Container>
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
									style="background: {c?.n
										? `rgb(37 99 235 / ${Math.round(15 + 85 * (c.n / maxCell))}%)`
										: 'transparent'}"
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
		<Card.Content>
			{#if r.members.length}
				<Chart.Container config={growthCfg} class="h-48 w-full">
					<BarChart
						data={r.members}
						x="month"
						series={[
							{ key: 'joined', label: 'Joined', color: 'var(--color-joined)' },
							{ key: 'cancelled', label: 'Cancelled', color: 'var(--color-cancelled)' }
						]}
						props={{ xAxis: { format: (d) => monthLabel(d) } }}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No members yet.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Retention by cohort</Card.Title>
			<Card.Description
				>Members who joined each month and are still active — newest month first</Card.Description
			>
		</Card.Header>
		<Card.Content>
			{#if retentionPct.length}
				<Chart.Container config={retentionCfg} class="h-48 w-full">
					<BarChart
						data={retentionPct}
						x="month"
						series={[{ key: 'pct', label: 'Still active %', color: 'var(--color-pct)' }]}
						props={{
							xAxis: { format: (d) => monthLabel(d) },
							yAxis: { ticks: [0, 25, 50, 75, 100] }
						}}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No members joined in the last 12 months.</p>
			{/if}
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
				{#if r.compValue.members > 0}
					<div class="flex justify-between text-muted-foreground">
						<span>Comp'd ({r.compValue.members})</span>
						<span class="tabular-nums"
							>{formatMoney(r.compValue.monthly, currency, true)}/mo foregone</span
						>
					</div>
				{/if}
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
				Highest lifetime payments · avg {formatMoney(r.spenders.avg, currency, true)} across {r
					.spenders.payers} payers
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
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Pack burn-down</Card.Title>
			<Card.Description>How much of each sold pack gets used before it ends</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-2 text-sm">
			{#if r.packBurn.finished === 0 && r.packBurn.active === 0}
				<p class="text-muted-foreground">No class packs yet.</p>
			{:else}
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Finished packs ({r.packBurn.finished})</span>
					<span>{r.packBurn.finishedPct}% used</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Active packs ({r.packBurn.active})</span>
					<span>{r.packBurn.activePct}% used so far</span>
				</div>
				{#if r.packBurn.unusedFinished > 0}
					<p class="text-xs text-muted-foreground">
						{r.packBurn.unusedFinished} credits expired unused — packs that didn't finish are money left
						on the table.
					</p>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Wrong plan?</Card.Title>
			<Card.Description>Members paying for more (or less) than they use</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 text-sm">
			{#if !r.wrongPlan.overpaying.length && !r.wrongPlan.upgrading.length}
				<p class="text-muted-foreground">Everyone's on the right plan.</p>
			{:else}
				{#each r.wrongPlan.overpaying as m (m.memberId)}
					<div class="flex items-center justify-between gap-2">
						<span class="min-w-0 flex-1 truncate"
							><a class="font-medium hover:underline" href="/members/{m.memberId}">{m.name}</a>
							<span class="text-muted-foreground"> · {m.plan}</span></span
						>
						<span class="shrink-0 text-xs text-amber-600 dark:text-amber-400">{m.alt}</span>
					</div>
				{/each}
				{#each r.wrongPlan.upgrading as m (m.memberId)}
					<div class="flex items-center justify-between gap-2">
						<span class="min-w-0 flex-1 truncate"
							><a class="font-medium hover:underline" href="/members/{m.memberId}">{m.name}</a>
							<span class="text-muted-foreground"> · {m.plan}</span></span
						>
						<span class="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">{m.alt}</span>
					</div>
				{/each}
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Guests</Card.Title>
			<Card.Description>{r.guestStats.monthTotal} guest check-ins this month</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5 text-sm">
			{#each r.guestStats.bringers as g (g.memberId)}
				<div class="flex items-center justify-between">
					<a class="min-w-0 flex-1 truncate hover:underline" href="/members/{g.memberId}"
						>{g.name}</a
					>
					<span class="text-muted-foreground tabular-nums"
						>{g.guests} guest{g.guests === 1 ? '' : 's'}</span
					>
				</div>
			{:else}
				<p class="text-muted-foreground">No guest check-ins yet this month.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Walk-ins</Card.Title>
			<Card.Description>Check-ins without a class booking — last 30 days</Card.Description>
		</Card.Header>
		<Card.Content class="text-sm">
			{#if r.walkIns.total === 0}
				<p class="text-muted-foreground">No member check-ins in the last 30 days.</p>
			{:else}
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Walked in (no booking)</span>
					<span class="font-medium tabular-nums">
						{r.walkIns.walkIn} · {Math.round((r.walkIns.walkIn / r.walkIns.total) * 100)}%
					</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Booked a class</span>
					<span class="font-medium tabular-nums">{r.walkIns.total - r.walkIns.walkIn}</span>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Booking lead time</Card.Title>
			<Card.Description>How far ahead members book — last 30 days</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5 text-sm">
			{#each r.leadTimes.byClass as c (c.name)}
				<div class="flex items-center justify-between">
					<span class="min-w-0 flex-1 truncate">{c.name}</span>
					<span class="text-muted-foreground tabular-nums"
						>{c.avgHours >= 24 ? `${Math.round(c.avgHours / 24)}d` : `${c.avgHours}h`} ahead</span
					>
				</div>
			{:else}
				<p class="text-muted-foreground">No bookings in the last 30 days.</p>
			{/each}
			{#if r.leadTimes.cancelAvgHours != null}
				<p class="border-t pt-1.5 text-xs text-muted-foreground">
					Cancels average {r.leadTimes.cancelAvgHours >= 24
						? `${Math.round(r.leadTimes.cancelAvgHours / 24)}d`
						: `${r.leadTimes.cancelAvgHours}h`} before class ({r.leadTimes.cancelN} cancels)
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Session cancels</Card.Title>
			<Card.Description
				>{r.sessionCancels.cancelled} cancelled of {r.sessionCancels.cancelled +
					r.sessionCancels.held} sessions — last 30 days</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-1.5 text-sm">
			{#each r.sessionCancels.byClass as c (c.name)}
				<div class="flex items-center justify-between">
					<span class="min-w-0 flex-1 truncate">{c.name}</span>
					<span class="text-muted-foreground tabular-nums">{c.cancelled} cancelled</span>
				</div>
			{:else}
				<p class="text-muted-foreground">No sessions cancelled.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	{#if r.lockers.total}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Lockers</Card.Title>
				<Card.Description>{r.lockers.assigned} of {r.lockers.total} assigned</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				{#each r.lockers.rows as l (l.id)}
					<div class="flex items-center justify-between">
						<a class="min-w-0 flex-1 truncate hover:underline" href="/members/{l.memberId}"
							>{l.memberName}</a
						>
						<span class="text-muted-foreground">{l.label}</span>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.ages.known}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Age distribution</Card.Title>
				<Card.Description>{r.ages.known} active members with a birthday on file</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				<div class="flex items-center justify-between">
					<span>Under 18</span><span class="text-muted-foreground tabular-nums"
						>{r.ages.buckets.u18}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>18–25</span><span class="text-muted-foreground tabular-nums"
						>{r.ages.buckets.y18_25}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>26–35</span><span class="text-muted-foreground tabular-nums"
						>{r.ages.buckets.y26_35}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>36–50</span><span class="text-muted-foreground tabular-nums"
						>{r.ages.buckets.y36_50}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>50+</span><span class="text-muted-foreground tabular-nums"
						>{r.ages.buckets.over50}</span
					>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.checkInMethods.total}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Check-in methods</Card.Title>
				<Card.Description>How visits were logged this month</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				<div class="flex items-center justify-between">
					<span>QR self-scan</span>
					<span class="text-muted-foreground tabular-nums">
						{r.checkInMethods.qr} ({Math.round(
							(r.checkInMethods.qr / r.checkInMethods.total) * 100
						)}%)</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>Manual desk entry</span>
					<span class="text-muted-foreground tabular-nums">
						{r.checkInMethods.manual} ({Math.round(
							(r.checkInMethods.manual / r.checkInMethods.total) * 100
						)}%)</span
					>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.planRevenue.length}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Revenue by plan</Card.Title>
				<Card.Description>Membership charges collected this month</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				{#each r.planRevenue as p (p.planName)}
					<div class="flex items-center justify-between">
						<span class="truncate">{p.planName}</span>
						<span class="text-muted-foreground tabular-nums"
							>{formatMoney(p.collected, currency, true)} · {p.payers} payer{p.payers === 1
								? ''
								: 's'}</span
						>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.referralConversion.referred}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Referral conversion</Card.Title>
				<Card.Description>Members who joined via a referral link</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				<div class="flex items-center justify-between">
					<span>Referred members</span><span class="text-muted-foreground tabular-nums"
						>{r.referralConversion.referred}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>Now paying</span><span class="text-muted-foreground tabular-nums"
						>{r.referralConversion.paying} ({Math.round(
							(r.referralConversion.paying / r.referralConversion.referred) * 100
						)}%)</span
					>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.newVsReturning.newMembers + r.newVsReturning.returning + r.newVsReturning.guests}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">New vs returning</Card.Title>
				<Card.Description>Check-ins this month by member tenure</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				<div class="flex items-center justify-between">
					<span>New members (&lt;30d)</span><span class="text-muted-foreground tabular-nums"
						>{r.newVsReturning.newMembers}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>Returning members</span><span class="text-muted-foreground tabular-nums"
						>{r.newVsReturning.returning}</span
					>
				</div>
				<div class="flex items-center justify-between">
					<span>Guests</span><span class="text-muted-foreground tabular-nums"
						>{r.newVsReturning.guests}</span
					>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.waitlistedNow.length}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Waitlisted now</Card.Title>
				<Card.Description>Members still queueing for upcoming sessions</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				{#each r.waitlistedNow as w (w.startsAt + w.className)}
					<div class="flex items-center justify-between">
						<span class="truncate">{w.className}</span>
						<span class="text-muted-foreground tabular-nums"
							>{formatDate(w.startsAt)} · {w.waiting} waiting</span
						>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.tenureAtCancel.length}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Tenure at cancel</Card.Title>
				<Card.Description
					>How long members kept each plan before cancelling (12 months)</Card.Description
				>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				{#each r.tenureAtCancel as t (t.name)}
					<div class="flex items-center justify-between">
						<span class="truncate">{t.name}</span>
						<span class="text-muted-foreground tabular-nums"
							>{Math.round(t.avgDays / 30)} mo avg · {t.n} cancelled</span
						>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.arpu.members}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Revenue per member</Card.Title>
				<Card.Description>Collected this month per active member</Card.Description>
			</Card.Header>
			<Card.Content class="text-sm">
				<div class="flex items-center justify-between">
					<span class="text-2xl font-semibold tabular-nums"
						>{formatMoney(Math.round(r.arpu.collected / r.arpu.members), currency)}</span
					>
					<span class="text-muted-foreground tabular-nums"
						>{formatMoney(r.arpu.collected, currency)} ÷ {r.arpu.members}</span
					>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.lostMrr.n}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Lost MRR</Card.Title>
				<Card.Description>Recurring revenue that cancelled this month</Card.Description>
			</Card.Header>
			<Card.Content class="text-sm">
				<div class="flex items-center justify-between">
					<span class="text-2xl font-semibold text-destructive tabular-nums"
						>{formatMoney(r.lostMrr.lost, currency)}/mo</span
					>
					<span class="text-muted-foreground tabular-nums"
						>{r.lostMrr.n} cancellation{r.lostMrr.n === 1 ? '' : 's'}</span
					>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.streakLeaders.length}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Streak leaders</Card.Title>
				<Card.Description>Longest current weekly check-in streaks</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5 text-sm">
				{#each r.streakLeaders as st (st.memberId)}
					<div class="flex items-center justify-between">
						<span class="truncate">{st.memberName}</span>
						<span class="text-muted-foreground tabular-nums">{st.streak} wk</span>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Instructor reliability</Card.Title>
				<Card.Description>Sessions taught vs cancelled, last 90 days.</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if !r.instructorReliability.length}
					<p class="text-sm text-muted-foreground">No sessions yet.</p>
				{:else}
					<ul class="space-y-1.5 text-sm">
						{#each r.instructorReliability as i (i.instructorName)}
							<li class="flex items-center justify-between gap-2">
								<span class="truncate">{i.instructorName}</span>
								<span class="shrink-0 text-muted-foreground tabular-nums"
									>{i.taught} taught{#if i.cancelled}
										· <span class="text-amber-600">{i.cancelled} cancelled</span>{/if}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Shop sales</Card.Title>
				<Card.Description>Top retail items, last 30 days.</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if !r.shopTop.length}
					<p class="text-sm text-muted-foreground">No sales yet.</p>
				{:else}
					<ul class="space-y-1.5 text-sm">
						{#each r.shopTop as i (i.itemName)}
							<li class="flex items-center justify-between gap-2">
								<span class="truncate">{i.itemName}</span>
								<span class="shrink-0 text-muted-foreground tabular-nums"
									>{i.units} × · {formatMoney(i.revenue, currency)}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Members by status</Card.Title>
				<Card.Description>Current headcount per status.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="flex flex-wrap gap-2">
					{#each r.statusBreakdown as b (b.status)}
						<Badge variant={b.status === 'active' ? 'default' : 'outline'} class="text-sm"
							>{b.status}: <span class="ml-1 font-semibold tabular-nums">{b.n}</span></Badge
						>
					{:else}
						<p class="text-sm text-muted-foreground">No members yet.</p>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Visit frequency</Card.Title>
			<Card.Description
				>Active members bucketed by check-ins this month (of {r.visitFrequency
					.total})</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-1.5 text-sm">
			<div class="flex items-center justify-between">
				<span>0 visits</span><span class="text-muted-foreground tabular-nums"
					>{r.visitFrequency.buckets.zero}</span
				>
			</div>
			<div class="flex items-center justify-between">
				<span>1 visit</span><span class="text-muted-foreground tabular-nums"
					>{r.visitFrequency.buckets.one}</span
				>
			</div>
			<div class="flex items-center justify-between">
				<span>2–3 visits</span><span class="text-muted-foreground tabular-nums"
					>{r.visitFrequency.buckets.few}</span
				>
			</div>
			<div class="flex items-center justify-between">
				<span>4–7 visits</span><span class="text-muted-foreground tabular-nums"
					>{r.visitFrequency.buckets.regular}</span
				>
			</div>
			<div class="flex items-center justify-between">
				<span>8+ visits</span><span class="text-muted-foreground tabular-nums"
					>{r.visitFrequency.buckets.frequent}</span
				>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Waitlist conversion</Card.Title>
			<Card.Description>Last 90 days — promoted off the queue vs still waiting</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5 text-sm">
			{#each r.waitlist as w (w.name)}
				<div class="flex items-center justify-between gap-2">
					<span class="min-w-0 flex-1 truncate">{w.name}</span>
					<span class="text-muted-foreground tabular-nums"
						>{w.promoted} promoted · {w.queued} queued · {w.pct}%</span
					>
				</div>
			{:else}
				<p class="text-muted-foreground">No waitlist activity in the last 90 days.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Refunds</Card.Title>
			<Card.Description>Money returned to members, by month</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5 text-sm">
			{#each r.refunds.slice(0, 6) as m (m.month)}
				<div class="flex items-center justify-between gap-2">
					<span>{m.month}</span>
					<span class="text-muted-foreground tabular-nums"
						>{m.n} · {formatMoney(m.total, currency, true)}{m.methods.length
							? ` (${m.methods.map((x) => x.method).join(', ')})`
							: ''}</span
					>
				</div>
			{:else}
				<p class="text-muted-foreground">No refunds yet.</p>
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
			{#if r.revenue.length}
				<Chart.Container config={revenueCfg} class="h-48 w-full">
					<BarChart
						data={r.revenue}
						x="month"
						series={[{ key: 'total', label: 'Revenue', color: 'var(--color-total)' }]}
						props={{
							xAxis: { format: (d) => monthLabel(d) },
							yAxis: { format: (v) => formatMoney(v, currency, true) }
						}}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No payments yet.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if r.pnl.months.length}
		<Card.Root class="lg:col-span-2">
			<Card.Header class="flex-row items-start justify-between">
				<div>
					<Card.Title class="text-base">Profit &amp; loss</Card.Title>
					<Card.Description>
						Revenue vs logged expenses + shop cost-of-goods per month — costs on Billing → Expenses,
						item cost on Billing → Shop
					</Card.Description>
				</div>
				<Button size="sm" variant="outline" onclick={exportPnl}><Download /> CSV</Button>
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
								<Table.Head class="text-right">Margin</Table.Head>
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
									<Table.Cell class="text-right text-muted-foreground tabular-nums"
										>{m.revenue > 0 ? `${Math.round((100 * m.net) / m.revenue)}%` : '—'}</Table.Cell
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
		<Card.Content>
			{#if r.plans.length}
				<Chart.Container config={planCfg} class="h-44 w-full">
					<BarChart
						data={r.plans}
						x="planName"
						series={[{ key: 'count', label: 'Members', color: 'var(--color-count)' }]}
						props={{ xAxis: { format: (d) => (d.length > 10 ? d.slice(0, 9) + '…' : d) } }}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No active memberships.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Payments by method</Card.Title>
			<Card.Description>Collected (excl. refunds), last 90 days</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if r.methods.length}
				<Chart.Container config={methodCfg} class="h-44 w-full">
					<BarChart
						data={r.methods}
						x="method"
						series={[{ key: 'total', label: 'Collected', color: 'var(--color-total)' }]}
						props={{ yAxis: { format: (v) => formatMoney(v, currency, true) } }}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No payments in the last 90 days.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Revenue by kind</Card.Title>
			<Card.Description>Collected (excl. refunds), last 90 days</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if r.kinds.length}
				<Chart.Container config={kindCfg} class="h-44 w-full">
					<BarChart
						data={r.kinds}
						x="kind"
						series={[{ key: 'total', label: 'Collected', color: 'var(--color-total)' }]}
						props={{
							xAxis: { format: (d) => KIND_LABELS[d] ?? d },
							yAxis: { format: (v) => formatMoney(v, currency, true) }
						}}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No payments in the last 90 days.</p>
			{/if}
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
			<Chart.Container config={fillCfg} class="h-36 w-full">
				<BarChart
					data={fillWeekday}
					x="day"
					series={[{ key: 'fill', label: 'Fill %', color: 'var(--color-fill)' }]}
				>
					{#snippet tooltip()}
						<Chart.Tooltip />
					{/snippet}
				</BarChart>
			</Chart.Container>
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
			<div class="flex items-center gap-1">
				{#if payrollPaidMonth === thisMonth}
					<Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400"
						>Paid {thisMonth}</Badge
					>
				{:else}
					<Button variant="outline" size="sm" disabled={payrollPending} onclick={markPaid}
						>Mark paid</Button
					>
				{/if}
				{#if r.payrollDetail.length}
					<Button variant="ghost" size="sm" onclick={exportPayroll}>
						<Download class="size-3.5" /> CSV
					</Button>
				{/if}
			</div>
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

	{#if r.staffing.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Desk staffing — this month</Card.Title>
				<Card.Description
					>Rota'd (scheduled) vs clocked (actual) hours per staff member</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Staff</Table.Head>
							<Table.Head class="text-right">Rota'd</Table.Head>
							<Table.Head class="text-right">Clocked</Table.Head>
							<Table.Head class="text-right">Δ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.staffing as st (st.name)}
							<Table.Row>
								<Table.Cell class="font-medium">{st.name}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{st.rotaHrs.toFixed(1)}h</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{st.clockedHrs.toFixed(1)}h</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									<Badge variant={st.deltaHrs >= 0 ? 'secondary' : 'destructive'}>
										{st.deltaHrs >= 0 ? '+' : ''}{st.deltaHrs.toFixed(1)}h
									</Badge>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.challenges.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Challenges</Card.Title>
				<Card.Description>Participation and finish rate per challenge</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Challenge</Table.Head>
							<Table.Head class="text-right">Goal</Table.Head>
							<Table.Head class="text-right">Joined</Table.Head>
							<Table.Head class="text-right">Finished</Table.Head>
							<Table.Head class="text-right">Rate</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.challenges as c (c.challenge.id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									{c.challenge.name}
									{#if c.challenge.teamMode}
										<Badge variant="outline" class="ml-1">teams</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{c.challenge.goal}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{c.joined}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{c.finished}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{c.joined ? Math.round((c.finished / c.joined) * 100) : 0}%</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.saveOffers.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Save offers</Card.Title>
				<Card.Description
					>Members who took the stay-instead discount — and how many stayed</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Month</Table.Head>
							<Table.Head class="text-right">Taken</Table.Head>
							<Table.Head class="text-right">Still active</Table.Head>
							<Table.Head class="text-right">Held %</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.saveOffers as m (m.month)}
							<Table.Row>
								<Table.Cell class="font-medium">{m.month}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{m.taken}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{m.stayed}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{Math.round((m.stayed / m.taken) * 100)}%</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

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
					{r.never.length} active member{r.never.length === 1 ? '' : 's'} with zero check-ins — signed
					up but never showed
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
		<Card.Content>
			{#if r.sources.length}
				<Chart.Container config={sourceCfg} class="h-44 w-full">
					<BarChart
						data={r.sources}
						x="source"
						series={[{ key: 'joins', label: 'Signups', color: 'var(--color-joins)' }]}
						props={{ xAxis: { format: (d) => (d.length > 10 ? d.slice(0, 9) + '…' : d) } }}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">No signups yet.</p>
			{/if}
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
		<Card.Content>
			{#if r.leads.byMonth.length}
				<Chart.Container config={leadCfg} class="h-44 w-full">
					<BarChart
						data={r.leads.byMonth}
						x="month"
						series={[{ key: 'leads', label: 'Leads', color: 'var(--color-leads)' }]}
					>
						{#snippet tooltip()}
							<Chart.Tooltip />
						{/snippet}
					</BarChart>
				</Chart.Container>
			{:else}
				<p class="text-sm text-muted-foreground">
					No leads captured yet — the "leave your info" form lives on the join page.
				</p>
			{/if}
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
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No renewals due in the next 90 days.</Table.Cell
							></Table.Row
						>
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
