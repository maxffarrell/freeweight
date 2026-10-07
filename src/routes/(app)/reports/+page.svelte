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
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';

	const r = await getReportsQuery();
	const currency = await getCurrency();

	const maxCheckIns = Math.max(1, ...r.checkIns.map((d) => d.count));
	const maxMembers = Math.max(1, ...r.members.map((m) => m.joined));
	const maxRevenue = Math.max(1, ...r.revenue.map((m) => m.total));
	const maxMembersByPlan = Math.max(1, ...r.plans.map((p) => p.count));
	const maxMethodTotal = Math.max(1, ...r.methods.map((m) => m.total));
	const maxHours = Math.max(1, ...r.hours.map((h) => h.count));
	const hourLabel = (h: number) =>
		h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

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
		<Card.Header>
			<Card.Title class="text-base">Instructor pay — this month</Card.Title>
			<Card.Description>Rated classes taught × per-class pay rate</Card.Description>
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
