<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';
	import { toast } from 'svelte-sonner';
	import { getCheckIns, recordCheckIn, voidCheckIn } from '#lib/remote/members.remote.ts';
	import { getLocations, getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Download from '@lucide/svelte/icons/download';
	import { errMsg } from '#lib/format.ts';
	import { toCsv } from '#lib/csv.ts';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';

	const settings = await getSettings();
	const locations = await getLocations();
	const today = localDate(new Date(), settings.timezone);

	let viewDate = $state(today);
	let q = $state('');
	let checkIns = $state(await getCheckIns({ date: viewDate }));
	let insideOnly = $state(false);
	let guestsOnly = $state(false);
	let method = $state<'' | 'qr' | 'manual'>('');
	async function refilter() {
		checkIns = await getCheckIns({
			date: viewDate,
			q: q.trim() || undefined,
			inside: insideOnly || undefined,
			guests: guestsOnly || undefined,
			method: method || undefined
		});
	}
	let searchTimer: ReturnType<typeof setTimeout>;
	function search() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void refilter(), 250);
	}
	async function voidRow(id: string) {
		if (!confirm('Void this check-in? Same-day attendance marks revert too.')) return;
		try {
			await voidCheckIn(id);
			toast.success('Check-in voided');
			await refilter();
		} catch (err) {
			toast.error(errMsg(err, 'Could not void'));
		}
	}

	let code = $state('');
	let locationId = $state('');
	let pending = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		if (!code.trim()) return;
		pending = true;
		try {
			const r = await recordCheckIn({ code: code.trim(), locationId: locationId || undefined });
			if ((r.visitsToday ?? 0) >= 3)
				toast.warning(
					`${r.member.name} — ${r.visitsToday ?? 0}th visit today. Possible shared card.`
				);
			if ((r.pendingSigns ?? 0) > 0)
				toast.warning(`${r.member.name} — a document needs their signature.`);
			toast.success(
				`${r.member.name} checked in` +
					(r.attended
						? ` — marked attended for ${r.attended} class${r.attended > 1 ? 'es' : ''}`
						: '') +
					(r.suspended ? ' — membership suspended' : '')
			);
			code = '';
			await refilter();
		} catch (err) {
			toast.error(errMsg(err, 'Check-in failed'));
		}
		pending = false;
		inputEl?.focus();
	}

	function exportCheckIns() {
		const csv = toCsv([
			['Member', 'Guest of', 'Checked at', 'Location', 'Method'],
			...checkIns.map((c) => [
				c.checkIn.guestName ?? c.memberName,
				c.checkIn.guestName ? c.memberName : '',
				c.checkIn.checkedAt.toISOString(),
				c.locationName ?? '',
				c.checkIn.method
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `check-ins-${viewDate}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}
</script>

<PageHeader title="Check-ins">
	{#snippet actions()}
		<Button size="sm" variant="outline" onclick={exportCheckIns} disabled={!checkIns.length}
			><Download /> Export</Button
		>
		<Button size="sm" variant="outline" href="/kiosk"><MonitorSmartphone /> Open kiosk</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"
				><QrCode /> Scan or enter a code</Card.Title
			>
			<Card.Description>
				Paste a member's QR code value, or their member ID. A USB scanner works too — it types and
				hits Enter.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form class="space-y-4" onsubmit={submit}>
				<Field.Field>
					<Field.Label for="code">Code</Field.Label>
					<Input
						id="code"
						bind:ref={inputEl}
						bind:value={code}
						placeholder="fw1… or member ID"
						autocomplete="off"
						autofocus
						class="font-mono text-sm"
					/>
				</Field.Field>
				{#if locations.filter((l) => !l.archivedAt).length > 1}
					<Field.Field>
						<Field.Label>Location</Field.Label>
						<NativeSelect bind:value={locationId}>
							<option value="">None</option>
							{#each locations.filter((l) => !l.archivedAt) as l (l.id)}
								<option value={l.id}>{l.name}</option>
							{/each}
						</NativeSelect>
					</Field.Field>
				{/if}
				<Button type="submit" class="w-full" disabled={pending || !code.trim()}>
					<ScanLine />
					{pending ? 'Checking in…' : 'Check in'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">{viewDate === today ? 'Today' : viewDate}</Card.Title>
			<Card.Description
				>{checkIns.length} check-in{checkIns.length === 1 ? '' : 's'}{viewDate === today
					? ' so far'
					: ''}{checkIns.filter((c) => !c.checkIn.checkedOutAt).length
					? ` · ${checkIns.filter((c) => !c.checkIn.checkedOutAt).length} still inside`
					: ''}.</Card.Description
			>
		</Card.Header>
		<Card.Content class="px-4">
			<div class="mb-3 flex gap-2">
				<Input type="date" class="w-40" bind:value={viewDate} onchange={() => void refilter()} />
				<Input
					placeholder="Search member or guest…"
					class="flex-1"
					bind:value={q}
					oninput={search}
				/>
				<Button
					size="sm"
					variant={insideOnly ? 'default' : 'outline'}
					onclick={() => {
						insideOnly = !insideOnly;
						guestsOnly = false;
						void refilter();
					}}>Still inside</Button
				>
				<Button
					size="sm"
					variant={guestsOnly ? 'default' : 'outline'}
					onclick={() => {
						guestsOnly = !guestsOnly;
						if (guestsOnly) insideOnly = false;
						void refilter();
					}}>Guests</Button
				>
				<Button
					size="sm"
					variant={method === 'qr' ? 'default' : 'outline'}
					onclick={() => {
						method = method === 'qr' ? '' : 'qr';
						void refilter();
					}}>QR</Button
				>
				<Button
					size="sm"
					variant={method === 'manual' ? 'default' : 'outline'}
					onclick={() => {
						method = method === 'manual' ? '' : 'manual';
						void refilter();
					}}>Manual</Button
				>
			</div>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Member</Table.Head>
						<Table.Head>Time</Table.Head>
						<Table.Head>Location</Table.Head>
						<Table.Head>Method</Table.Head>
						<Table.Head class="text-right">Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each checkIns as c (c.checkIn.id)}
						<Table.Row>
							<Table.Cell>
								<span class="flex items-center gap-2 font-medium">
									{#if c.memberPhotoId}
										<img
											src="/api/documents/{c.memberPhotoId}"
											alt=""
											class="size-7 shrink-0 rounded-full object-cover"
										/>
									{/if}
									<span class="truncate"
										>{c.checkIn.guestName
											? `${c.checkIn.guestName} (guest of ${c.memberName})`
											: c.memberName}</span
									>
								</span></Table.Cell
							>
							<Table.Cell class="text-muted-foreground"
								>{localTime(c.checkIn.checkedAt, settings.timezone)}</Table.Cell
							>
							<Table.Cell class="text-muted-foreground">{c.locationName ?? '—'}</Table.Cell>
							<Table.Cell
								><Badge
									variant={c.checkIn.method === 'qr' ? 'default' : 'secondary'}
									class="uppercase">{c.checkIn.method}</Badge
								></Table.Cell
							>
							<Table.Cell class="text-right"
								><div class="flex items-center justify-end gap-1">
									{#if c.checkIn.checkedOutAt}
										<span class="text-muted-foreground"
											>out {localTime(c.checkIn.checkedOutAt, settings.timezone)}</span
										>
									{:else}
										<Badge variant="default">In</Badge>
									{/if}
									<Button
										variant="ghost"
										size="sm"
										class="h-6 px-2 text-xs"
										onclick={() => voidRow(c.checkIn.id)}>Void</Button
									>
								</div></Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={5} class="text-muted-foreground"
								>No check-ins{q.trim() ? ' match that search' : ''}{viewDate === today
									? ' yet today'
									: ' that day'}.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
